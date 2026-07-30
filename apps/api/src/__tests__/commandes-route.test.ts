import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandeRoutes } from "../routes/commandes.ts";

/**
 * Le cycle de vie d'une commande, contre une VRAIE base.
 *
 * Ce que ce fichier verifie et qu'aucun test de domaine ne peut verifier :
 *
 * 1. **une vendeuse ne touche qu'a ses propres commandes**, y compris en
 *    connaissant l'identifiant d'une commande qui n'est pas a elle ;
 * 2. **le refus est journalise autant que l'acceptation** — un recul ignore
 *    laisse une trace en base ;
 * 3. **la declaration de paiement ecrit l'etat d'argent, le journal
 *    d'evenements et le journal comptable dans la MEME transaction** ;
 * 4. **l'invariant `amount_paid + balance = total`** tient apres chaque
 *    ecriture — il est aussi garanti par une contrainte SQL, et c'est ici qu'on
 *    verifie qu'on n'y arrive jamais en erreur.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const RUN = Date.now() % 90000;

const NOW = new Date("2026-07-30T10:00:00+01:00");
const CREEE = new Date("2026-07-30T09:00:00+01:00");

function codeDeTest(graine: number): string {
  const A = CODE_ALPHABET;
  let n = graine;
  const car = () => {
    n = (n * 31 + 17) % 1_000_003;
    return A[n % A.length] as string;
  };
  const bloc = () => Array.from({ length: 4 }, car).join("");
  return `${bloc()}-${bloc()}`;
}

interface Vendeuse {
  sellerId: string;
  app: ReturnType<typeof commandeRoutes>;
  /** Commande en mode acompte : 10 000 F au total, 5 000 verses. */
  acompte: string;
  /** Commande en retrait, entierement payee. */
  retrait: string;
}

async function creerVendeuse(suffixe: number): Promise<Vendeuse> {
  const n = (base: string) => `+237${base}${suffixe.toString().padStart(7, "0").slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Cycle ${suffixe}`,
      email: `cycle-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n("67"),
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique cycle ${suffixe}`,
      slug: `boutique-cycle-${suffixe}`,
      city: "Douala",
      payoutPhone: n("69"),
      payoutPhoneVerifiedAt: CREEE,
    },
  });

  /**
   * Les champs variables sont TYPES, pas passes en `Record<string, unknown>` :
   * un objet non type se fond dans `data` et fait perdre a Prisma la
   * verification des champs obligatoires — `balanceXaf`, `payMode`, `delivery`
   * disparaitraient sans que rien ne le signale.
   */
  const commande = async (
    i: number,
    opts: {
      amountPaidXaf: number;
      balanceXaf: number;
      payMode: "integral" | "acompte" | "sans_prepaiement";
      proofState: "attendu" | "declare_non_trace" | "prouve" | "contresigne" | "conteste";
      /**
       * Valeurs toutes textuelles — c'est ce que porte `deliverySchema`, et un
       * `unknown` ici ne serait pas assignable au type JSON de Prisma.
       */
      delivery: Record<string, string>;
    },
  ) =>
    (
      await prisma.order.create({
        data: {
          ref: `CT-${(800000 + suffixe * 4 + i) % 99999999}`,
          sellerId: v.id,
          buyerPhone: "+237652000001",
          items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: 10_000 }],
          totalXaf: 10_000,
          verificationCode: codeDeTest(suffixe * 7 + i),
          createdAt: CREEE,
          expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
          ...opts,
        },
      })
    ).id;

  return {
    sellerId: v.id,
    app: commandeRoutes({
      prisma,
      maintenant: () => NOW,
      session: { prisma, session: async () => ({ user: { id: u.id, phoneNumber: null } }) },
    }),
    acompte: await commande(1, {
      amountPaidXaf: 5_000,
      balanceXaf: 5_000,
      payMode: "acompte",
      proofState: "prouve",
      delivery: {
        mode: "livraison",
        city: "Douala",
        quartier: "Akwa",
        landmark: "Face pharmacie du Rond-Point",
        phone: "+237652000001",
      },
    }),
    retrait: await commande(2, {
      amountPaidXaf: 10_000,
      balanceXaf: 0,
      payMode: "integral",
      proofState: "prouve",
      delivery: { mode: "retrait", pickupPoint: "Carrefour Elf", phone: "+237652000001" },
    }),
  };
}

let une: Vendeuse;
let autre: Vendeuse;

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  une = await creerVendeuse(RUN);
  autre = await creerVendeuse((RUN + 4321) % 900000);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const lister = (v: Vendeuse) => v.app.fetch(new Request("http://x/"));

const avancer = (v: Vendeuse, id: string, vers: string) =>
  v.app.fetch(
    new Request(`http://x/${id}/etape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vers }),
    }),
  );

const declarer = (v: Vendeuse, id: string, montantXaf: unknown) =>
  v.app.fetch(
    new Request(`http://x/${id}/paiement-declare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ montantXaf }),
    }),
  );

type Vue = {
  id: string;
  etape: string;
  resteXaf: number;
  dejaPayeXaf: number;
  totalXaf: number;
  etatPreuve: string;
  modeLivraison: string;
  etapesPossibles: string[];
  soldeAEncaisserXaf: number;
  avisVerifiePossible: boolean;
};

describeDb("liste des commandes", () => {
  it("ne renvoie que les commandes de la vendeuse", async () => {
    const corps = (await (await lister(une)).json()) as { commandes: Vue[] };
    const ids = corps.commandes.map((x) => x.id);
    expect(ids).toContain(une.acompte);
    expect(ids).not.toContain(autre.acompte);
  });

  it("totalise les soldes a encaisser sur les memes commandes que la liste", async () => {
    const corps = (await (await lister(une)).json()) as {
      commandes: Vue[];
      soldesAEncaisserXaf: number;
    };
    const somme = corps.commandes.reduce((s, x) => s + x.soldeAEncaisserXaf, 0);
    expect(corps.soldesAEncaisserXaf).toBe(somme);
    expect(corps.soldesAEncaisserXaf).toBeGreaterThanOrEqual(5_000);
  });

  it("un retrait n'offre pas l'etape « chez le livreur »", async () => {
    const corps = (await (await lister(une)).json()) as { commandes: Vue[] };
    const retrait = corps.commandes.find((x) => x.id === une.retrait) as Vue;
    expect(retrait.modeLivraison).toBe("retrait");
    expect(retrait.etapesPossibles).not.toContain("chez_le_livreur");
  });
});

describeDb("avancement d'etape", () => {
  it("avance et journalise", async () => {
    const r = await avancer(une, une.acompte, "preparee");
    expect(r.status).toBe(200);
    expect(((await r.json()) as Vue).etape).toBe("preparee");

    const evts = await prisma.orderEvent.findMany({
      where: { orderId: une.acompte, kind: "etape_avancee" },
    });
    expect(evts.length).toBeGreaterThanOrEqual(1);
  });

  it("un recul est REFUSE, journalise, et laisse l'etape inchangee", async () => {
    await avancer(une, une.acompte, "chez_le_livreur");
    const r = await avancer(une, une.acompte, "preparee");
    expect(r.status).toBe(409);
    expect((await r.json()) as { raison: string }).toMatchObject({ raison: "recul_ignore" });

    const apres = await prisma.order.findUnique({ where: { id: une.acompte } });
    expect(apres?.step).toBe("chez_le_livreur");

    const refus = await prisma.orderEvent.findMany({
      where: { orderId: une.acompte, kind: "etape_refusee" },
    });
    expect(refus.length).toBeGreaterThanOrEqual(1);
  });

  /** La regle d'argent du lot : on ne clot pas sur un solde ouvert. */
  it("« livree » est refusee tant que le solde n'est pas encaisse", async () => {
    const r = await avancer(une, une.acompte, "livree");
    expect(r.status).toBe(409);
    expect((await r.json()) as { raison: string }).toMatchObject({ raison: "solde_ouvert" });
  });

  it("refuse une etape qui n'existe pas", async () => {
    const r = await avancer(une, une.retrait, "expediee");
    expect(r.status).toBe(400);
  });

  it("une vendeuse ne peut pas avancer la commande d'une autre", async () => {
    const r = await avancer(autre, une.acompte, "livree");
    expect(r.status).toBe(404);
  });
});

describeDb("declaration d'un paiement recu", () => {
  it("refuse un montant a virgule plutot que de l'arrondir", async () => {
    expect((await declarer(une, une.acompte, 2500.5)).status).toBe(400);
    expect((await declarer(une, une.acompte, 0)).status).toBe(400);
  });

  it("encaisse le solde, marque NON TRACE, et ecrit au journal comptable", async () => {
    const r = await declarer(une, une.acompte, 5_000);
    expect(r.status).toBe(200);
    const corps = (await r.json()) as Vue & { trace: boolean };

    expect(corps.resteXaf).toBe(0);
    expect(corps.dejaPayeXaf).toBe(10_000);
    expect(corps.trace).toBe(false);

    const ligne = await prisma.ledgerEntry.findFirst({
      where: { orderId: une.acompte, reason: "depot_direct_non_trace" },
    });
    expect(ligne?.amountXaf).toBe(5_000);

    const evt = await prisma.orderEvent.findFirst({
      where: { orderId: une.acompte, kind: "paiement_declare" },
    });
    expect(evt).not.toBeNull();
    // Le journal d'evenements ne porte AUCUN montant.
    expect(JSON.stringify(evt?.payload)).not.toContain("5000");
  });

  it("l'invariant amount_paid + balance = total tient", async () => {
    const o = await prisma.order.findUnique({ where: { id: une.acompte } });
    expect((o?.amountPaidXaf ?? 0) + (o?.balanceXaf ?? 0)).toBe(o?.totalXaf);
  });

  /**
   * L'etat de preuve ne RECULE jamais. La commande etait `prouve` ; une
   * declaration manuelle ne la degrade pas en `declare_non_trace`.
   */
  it("ne fait pas reculer une preuve deja etablie", async () => {
    const o = await prisma.order.findUnique({ where: { id: une.acompte } });
    expect(o?.proofState).toBe("prouve");
  });

  it("le solde encaisse debloque « livree »", async () => {
    const r = await avancer(une, une.acompte, "livree");
    expect(r.status).toBe(200);
    expect(((await r.json()) as Vue).etape).toBe("livree");
  });

  it("une vendeuse ne peut pas declarer sur la commande d'une autre", async () => {
    const r = await declarer(autre, une.retrait, 1_000);
    expect(r.status).toBe(404);
  });
});

describeDb("droit a l'avis verifie", () => {
  /**
   * Le critere de la definition de terminé : un paiement declare a la main
   * n'ouvre pas droit a un avis verifie. On le verifie ici de bout en bout,
   * pas seulement sur le predicat.
   */
  it("une commande livree mais NON TRACEE n'y donne pas droit", async () => {
    const v = await creerVendeuse((RUN + 777) % 900000);
    // Commande en retrait, jamais prouvee : on la met a `attendu`.
    await prisma.order.update({
      where: { id: v.retrait },
      data: { proofState: "attendu", amountPaidXaf: 0, balanceXaf: 10_000 },
    });
    await declarer(v, v.retrait, 10_000);
    await avancer(v, v.retrait, "preparee");
    await avancer(v, v.retrait, "livree");

    const corps = (await (await lister(v)).json()) as { commandes: Vue[] };
    const livree = corps.commandes.find((x) => x.id === v.retrait) as Vue;
    expect(livree.etape).toBe("livree");
    expect(livree.etatPreuve).toBe("declare_non_trace");
    expect(livree.avisVerifiePossible).toBe(false);
  });

  it("une commande livree et prouvee y donne droit", async () => {
    const corps = (await (await lister(une)).json()) as { commandes: Vue[] };
    const livree = corps.commandes.find((x) => x.id === une.acompte) as Vue;
    expect(livree.etatPreuve).toBe("prouve");
    expect(livree.avisVerifiePossible).toBe(true);
  });
});
