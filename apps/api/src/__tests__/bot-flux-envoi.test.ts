import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * Un formulaire refuse n'emporte pas la question — ADR 0055.
 *
 * La machine pure garantit l'ORDRE : le Flow part d'abord, la question part
 * en dernier, « c'est elle qui reste visible si le Flow echoue ». Elle ne peut
 * pas garantir l'ENVOI — et c'est la que la promesse se jouait vraiment.
 *
 * `envoyerSequence` relancait l'exception du premier message refuse : un Flow
 * depublie, un identifiant perime, un numero non eligible, et l'acheteuse
 * recevait le SILENCE a l'etape la plus couteuse du parcours. Constate en
 * lisant le code apres la sonde de production du 08/08/2026, avant qu'aucune
 * acheteuse ne le rencontre.
 *
 * Ce fichier exige une vraie base : c'est le service, pas le domaine, qui
 * envoie.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 141 * 1000 + selExecution();
const NOW = new Date("2026-08-08T10:00:00+01:00");
const FLUX_ID = "1234567890123456";

/** Refuse les formulaires, accepte tout le reste — la panne qu'on redoute. */
class EnvoyeurSansFlux implements EnvoyeurBot {
  readonly nom = "sans-flux";
  readonly envoyes: MessageSortant[] = [];
  readonly refuses: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    const forme = (m as { interactive?: { type?: string } }).interactive?.type;
    if (forme === "flow") {
      this.refuses.push(m);
      throw new Error("envoi bot refuse : HTTP 400, code Meta 132015");
    }
    this.envoyes.push(m);
  }
}

const formes = (ms: MessageSortant[]): string[] =>
  ms.map((m) => (m as { interactive?: { type?: string } }).interactive?.type ?? m.type);

const bouton = (de: string, id: string, wamid: string) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});

let compteur = 0;
const suivant = () => RUN * 100 + ++compteur;

interface Scene {
  acheteuseWaId: string;
  wamid: string;
  envoyeur: EnvoyeurSansFlux;
  deps: BotDeps;
}

/** Une acheteuse au moment du choix du mode, panier deja rempli. */
async function scene(suffixe: number): Promise<Scene> {
  const vendeuseWaId = `23767${String(1000000 + suffixe).slice(-7)}`;
  const acheteuseWaId = `23769${String(1000000 + suffixe).slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse flux ${suffixe}`,
      email: `flux-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique flux ${suffixe}`,
      slug: `flux-${suffixe}`,
      city: "Douala",
      payoutPhone: "+237656746215",
      payoutPhoneVerifiedAt: NOW,
    },
  });
  const p = await prisma.product.create({
    data: { sellerId: v.id, name: "Sac en raphia", priceXaf: 8000, position: 0 },
  });
  await prisma.botConversation.create({
    data: {
      phone: `+${acheteuseWaId}`,
      etat: { nom: "mode", slug: v.slug, panier: [{ articleId: p.id, quantite: 1 }] },
    },
  });

  const envoyeur = new EnvoyeurSansFlux();
  return {
    acheteuseWaId,
    wamid: `wamid.flux.${suffixe}`,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      fluxLivraisonId: FLUX_ID,
      maintenant: () => NOW,
      aleatoire: (n: number) => new Uint8Array(randomBytes(n)),
    },
  };
}

describeDb("le formulaire de livraison a l'envoi (ADR 0055)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("un formulaire REFUSE laisse partir la question — le parcours continue", async () => {
    const s = await scene(suivant());
    const lignes: string[] = [];
    const espion = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lignes.push(a.map(String).join(" "));
    });
    try {
      await traiterLivraisonBot(s.deps, bouton(s.acheteuseWaId, "mode:livraison", s.wamid));
    } finally {
      espion.mockRestore();
    }

    /* Le formulaire a bien ete TENTE, et refuse. */
    expect(formes(s.envoyeur.refuses)).toEqual(["flow"]);
    /* Et la question est partie quand meme : c'est tout l'enjeu. */
    expect(formes(s.envoyeur.envoyes)).toContain("button");

    /* Le refus se NOMME au journal, sans une lettre de conversation
       (ADR 0023) — sinon la panne serait muette. */
    expect(lignes.some((l) => l.includes("formulaire de livraison refuse"))).toBe(true);
    expect(lignes.every((l) => !l.includes(s.acheteuseWaId))).toBe(true);
  });

  it("l'etat avance malgre le refus : elle est bien a l'etape « ville »", async () => {
    const s = await scene(suivant());
    const espion = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await traiterLivraisonBot(s.deps, bouton(s.acheteuseWaId, "mode:livraison", s.wamid));
    } finally {
      espion.mockRestore();
    }
    const apres = await prisma.botConversation.findUniqueOrThrow({
      where: { phone: `+${s.acheteuseWaId}` },
      select: { etat: true },
    });
    expect((apres.etat as { nom?: string }).nom).toBe("ville");
  });
});
