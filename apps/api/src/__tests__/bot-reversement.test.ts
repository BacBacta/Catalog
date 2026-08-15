import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import { PayoutOtpStore } from "../adapters/payout-otp-store.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import { jetonFlux } from "../domain/bot/flux.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import type { SmsMessage } from "../domain/sms-sender.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le reversement dans le fil, de bout en bout — ADR 0097 (lot P3).
 *
 * Ce que le domaine ne peut pas prouver seul : les gardes rejouees AVANT
 * l'emission (gel, numero inchange, debit), l'etat qui ne se pose QU'APRES un
 * SMS parti, la verification par LE MEME service que la route — journal
 * d'audit compris, refus compris — et l'invitation qui disparait une fois le
 * numero pose.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-reversement");
const NOW = new Date("2026-08-15T10:00:00+01:00");
const FLUX_ID = "1122334455667788";

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

/** L'envoyeur SMS : capture le code, ou echoue sur demande. */
class SmsMemoire {
  readonly name = "memoire";
  readonly envoyes: SmsMessage[] = [];
  enPanne = false;
  async send(m: SmsMessage): Promise<void> {
    if (this.enPanne) throw new Error("passerelle muette");
    this.envoyes.push(m);
  }
  dernierCode(): string {
    const texte = this.envoyes.at(-1)?.text ?? "";
    return /\d{6}/.exec(texte)?.[0] ?? "";
  }
}

const texteEntrant = (de: string, corps: string) => ({
  messages: [{ from: de, type: "text", text: { body: corps } }],
});

const boutonEntrant = (de: string, id: string) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});

/** La reponse du formulaire, telle que Meta la livre (`nfm_reply`). */
const reponseFlux = (de: string, champs: Record<string, unknown>) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: {
          response_json: JSON.stringify({ flow_token: jetonFlux("reversement"), ...champs }),
        },
      },
    },
  ],
});

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

const estFlow = (m: MessageSortant): boolean =>
  (m as { interactive?: { type?: string } }).interactive?.type === "flow";

interface Scene {
  waId: string;
  phone: string;
  numeroOrange: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  sms: SmsMemoire;
  deps: BotDeps;
}

async function scene(options: { sansFlux?: boolean; gelee?: boolean } = {}): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  /* Un numero de reversement DISTINCT du numero de connexion — la double SIM
     est la norme. 69x : prefixe Orange, coherent avec l'operateur declare. */
  const numeroOrange = `+23769${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse reversement ${n}`,
      email: ids.email("bot-reversement"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique reversement ${n}`,
      slug: `bot-reversement-${n}`,
      city: "Douala",
      ...(options.gelee ? { reversementGeleDepuis: NOW } : {}),
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  const sms = new SmsMemoire();
  return {
    waId,
    phone: `+${waId}`,
    numeroOrange,
    sellerId: v.id,
    envoyeur,
    sms,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      ...(options.sansFlux ? {} : { fluxReversementId: FLUX_ID }),
      reversement: {
        otp: new PayoutOtpStore({ prisma, secret: "secret-de-test" }),
        tentatives: new PrismaOtpAttemptStore(prisma),
        sms,
      },
    },
  };
}

/** Le formulaire rendu, jusqu'a l'etat d'attente du code. */
async function demanderLeCode(s: Scene): Promise<void> {
  await traiterLivraisonBot(
    s.deps,
    reponseFlux(s.waId, { numero: s.numeroOrange, operateur: "orange" }),
  );
}

async function etatEnBase(phone: string): Promise<Record<string, unknown> | null> {
  const c = await prisma.botConversation.findUnique({ where: { phone }, select: { etat: true } });
  return (c?.etat as Record<string, unknown> | null) ?? null;
}

async function journal(sellerId: string): Promise<Array<{ kind: string }>> {
  return prisma.sellerAuditEvent.findMany({
    where: { sellerId },
    orderBy: { at: "asc" },
    select: { kind: true },
  });
}

describeDb("le formulaire emet le code, les gardes d'abord — ADR 0097", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("chemin nominal : SMS au NOUVEAU numero, puis l'etat d'attente — dans cet ordre", async () => {
    const s = await scene();
    await demanderLeCode(s);

    expect(s.sms.envoyes).toHaveLength(1);
    expect(s.sms.envoyes[0]?.to).toBe(s.numeroOrange);
    expect(s.sms.envoyes[0]?.kind).toBe("otp_reversement");
    expect(s.sms.dernierCode()).toMatch(/^\d{6}$/);

    const etat = await etatEnBase(s.phone);
    expect(etat?.nom).toBe("reversement_code");
    expect(etat?.numero).toBe(s.numeroOrange);
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("Collez-le ici tel quel");
  });

  it("un envoi SMS qui echoue ne pose AUCUN etat — le fil n'attend pas un code jamais parti", async () => {
    const s = await scene();
    s.sms.enPanne = true;
    await demanderLeCode(s);

    expect(await etatEnBase(s.phone)).toBeNull();
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("n'a pas pu être envoyé");
  });

  it("le gel refuse AVANT d'emettre, et laisse sa trace par le service de la route", async () => {
    const s = await scene({ gelee: true });
    await demanderLeCode(s);

    expect(s.sms.envoyes).toHaveLength(0);
    expect(await etatEnBase(s.phone)).toBeNull();
    /* On ne dit pas « vol signale » — la meme phrase que la route. */
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("suspendu");
    expect((await journal(s.sellerId)).map((j) => j.kind)).toContain("reversement_refuse");
  });

  it("le numero deja pose refuse sans emettre — avec la phrase de la route", async () => {
    const s = await scene();
    await prisma.seller.update({
      where: { id: s.sellerId },
      data: { payoutPhone: s.numeroOrange, payoutOperator: "orange", payoutPhoneVerifiedAt: NOW },
    });
    await demanderLeCode(s);

    expect(s.sms.envoyes).toHaveLength(0);
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain(
      "deja votre numero de reversement",
    );
  });

  it("un prefixe MTN sous une declaration Orange est dit AVANT d'envoyer un code", async () => {
    const s = await scene();
    const numeroMtn = s.numeroOrange.replace("+23769", "+23767");
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, { numero: numeroMtn, operateur: "orange" }),
    );

    expect(s.sms.envoyes).toHaveLength(0);
    expect(await etatEnBase(s.phone)).toBeNull();
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("Vérifiez le numéro");
  });

  it("la limitation de debit vaut pour la SOMME des surfaces — meme table que la route", async () => {
    const s = await scene();
    /* Trois envois deja partis pour CE numero aujourd'hui, par la route ou
       par le fil — peu importe : la table est la meme. */
    const store = new PrismaOtpAttemptStore(prisma);
    for (let i = 0; i < 3; i += 1) {
      await store.enregistrer({
        phone: s.numeroOrange,
        ip: "inconnue",
        at: NOW,
        kind: "otp_reversement",
      });
    }
    await demanderLeCode(s);

    expect(s.sms.envoyes).toHaveLength(0);
    expect(await etatEnBase(s.phone)).toBeNull();
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("Trop de demandes");
  });

  it("une reponse en vol SANS cablage renvoie vers l'espace — jamais un silence", async () => {
    const s = await scene();
    const deps = { ...s.deps };
    delete (deps as { reversement?: unknown }).reversement;
    await traiterLivraisonBot(
      deps,
      reponseFlux(s.waId, { numero: s.numeroOrange, operateur: "orange" }),
    );
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("espace vendeuse");
  });
});

describeDb("le code colle : LE MEME service que la route, verdict par verdict", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("un code faux : refus journalise, l'etat RESTE — on recolle sans rejouer le formulaire", async () => {
    const s = await scene();
    await demanderLeCode(s);
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "000001"));

    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("ne correspond pas");
    expect((await etatEnBase(s.phone))?.nom).toBe("reversement_code");
    /* La trace du refus — le service de la route l'ecrit, pas le bot. */
    expect((await journal(s.sellerId)).map((j) => j.kind)).toContain("reversement_refuse");
    const vendeuse = await prisma.seller.findUnique({
      where: { id: s.sellerId },
      select: { payoutPhone: true },
    });
    expect(vendeuse?.payoutPhone).toBeNull();
  });

  it("le bon code : numero pose, operateur DERIVE du prefixe, journal, confirmation", async () => {
    const s = await scene();
    await demanderLeCode(s);
    /* Colle tel quel, SMS entier — le collage n'est jamais bloque. */
    await traiterLivraisonBot(
      s.deps,
      texteEntrant(
        s.waId,
        `Catalog : code ${s.sms.dernierCode()} pour confirmer que c'est bien sur ce numero que vous voulez etre payee.`,
      ),
    );

    const vendeuse = await prisma.seller.findUnique({
      where: { id: s.sellerId },
      select: { payoutPhone: true, payoutOperator: true, payoutPhoneVerifiedAt: true },
    });
    expect(vendeuse?.payoutPhone).toBe(s.numeroOrange);
    expect(vendeuse?.payoutOperator).toBe("orange");
    expect(vendeuse?.payoutPhoneVerifiedAt).toEqual(NOW);
    expect((await journal(s.sellerId)).map((j) => j.kind)).toContain("reversement_modifie");
    expect((await etatEnBase(s.phone))?.nom).not.toBe("reversement_code");
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("vérifié");
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("paient d'avance");
  });

  it("un code expire ferme l'etat : il faut un nouveau code, donc le formulaire", async () => {
    const s = await scene();
    await demanderLeCode(s);
    const code = s.sms.dernierCode();
    const plusTard = new Date(NOW.getTime() + 6 * 60_000);
    await traiterLivraisonBot(
      { ...s.deps, maintenant: () => plusTard },
      texteEntrant(s.waId, code),
    );

    expect(corps(s.envoyeur.envoyes.at(-2) as MessageSortant)).toContain("expire");
    /* Le formulaire se re-propose : c'est lui qui emet un nouveau code. */
    expect(estFlow(s.envoyeur.envoyes.at(-1) as MessageSortant)).toBe(true);
    expect((await etatEnBase(s.phone))?.nom).not.toBe("reversement_code");
    const vendeuse = await prisma.seller.findUnique({
      where: { id: s.sellerId },
      select: { payoutPhone: true },
    });
    expect(vendeuse?.payoutPhone).toBeNull();
  });
});

describeDb("l'invitation accompagne la publication, et disparait une fois verifie", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Publie un article sans photo, par les questions du fil. */
  async function publierArticle(s: Scene, nom: string, prix: string): Promise<void> {
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, nom));
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, prix));
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, "sans_photo"));
  }

  it("pas au premier article (le mode d'emploi porte la ligne), puis presente, puis plus rien", async () => {
    const s = await scene();

    await publierArticle(s, "Pagne wax", "15000");
    /* Premier article : le mode d'emploi part, l'invitation NON — deux
       invitations dans une salve seraient du bruit (ADR 0086). */
    expect(s.envoyeur.envoyes.some((m) => corps(m).includes("mode d'emploi"))).toBe(true);
    expect(s.envoyeur.envoyes.filter(estFlow)).toHaveLength(0);

    s.envoyeur.envoyes.length = 0;
    await publierArticle(s, "Huile de palme", "4500");
    /* Deuxieme article, numero absent : l'invitation accompagne la reponse. */
    const invitations = s.envoyeur.envoyes.filter(estFlow);
    expect(invitations).toHaveLength(1);
    expect(corps(invitations[0] as MessageSortant)).toContain("Un dernier réglage");

    /* Le numero se pose — par le chemin complet du fil. */
    await demanderLeCode(s);
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, s.sms.dernierCode()));

    s.envoyeur.envoyes.length = 0;
    await publierArticle(s, "Bijoux perles", "3000");
    /* Numero pose : plus d'invitation, nulle part. */
    expect(s.envoyeur.envoyes.filter(estFlow)).toHaveLength(0);
  });

  it("sans WABOT_FLUX_REVERSEMENT_ID, aucune invitation — le fil est celui d'hier", async () => {
    const s = await scene({ sansFlux: true });
    await publierArticle(s, "Pagne wax", "15000");
    await publierArticle(s, "Huile de palme", "4500");
    expect(s.envoyeur.envoyes.filter(estFlow)).toHaveLength(0);
  });
});
