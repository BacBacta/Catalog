import { deliverySchema, splitDeposit } from "@catalog/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.ts";

/**
 * Les invariants d'argent et de preuve ne sont pas verifies par du code
 * applicatif : ils vivent en base. Ces tests le PROUVENT contre un vrai
 * PostgreSQL — un CHECK jamais applique est un invariant qui n'existe pas, et
 * c'est exactement ce qui s'etait produit avant le lot 3, ou le script
 * d'application des contraintes echouait en silence sur l'URL de Prisma.
 *
 * Ils exigent une base accessible. `DATABASE_URL` absent = tests ignores, avec
 * un message : mieux vaut un saut visible qu'un faux vert.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

if (!URL) {
  console.warn(
    "\n⚠ DATABASE_URL absent : les tests de contraintes sont IGNORES.\n" +
      "  docker compose up -d && pnpm --filter @catalog/db migrate && … constraints\n",
  );
}

let prisma: PrismaClient;

/** Prefixe unique par execution : les tests n'entrent pas en collision. */
const TAG = `T${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const suivant = () => `${TAG}${(n++).toString().padStart(3, "0")}`;

/**
 * Compteur DEDIE aux commandes. Il ne partage pas `n` : deux commandes creees
 * a la suite sans appel a `suivant()` recevraient la meme reference, et le test
 * echouerait sur une contrainte qu'il ne cherchait pas a eprouver.
 */
let nCmd = 0;

/**
 * Decalage propre a l'execution. `payment_proof` et `ledger_entry` sont en
 * AJOUT SEUL : les lignes d'une execution precedente ne peuvent pas etre
 * supprimees, donc references et codes doivent etre uniques d'un run a l'autre,
 * sinon le test echoue sur une contrainte qu'il ne cherchait pas a eprouver.
 */
const RUN = Date.now() % 90000;

/**
 * Code de verification valide pour les tests : encodage BIJECTIF de
 * (execution, index) en base 25 sur l'alphabet non ambigu. Bijectif compte —
 * une formule affine « qui a l'air de melanger » produit des collisions, et le
 * test echoue alors sur l'unicite du code au lieu de la contrainte visee.
 *
 * Ce n'est PAS le generateur de production : celui-la est cryptographique et
 * vit dans apps/api/src/domain/verification-code.ts (ADR 0013).
 */
const CODES = "ACDEFGHJKMNPQRTUVWXY34679";
function codeValide(i: number): string {
  let v = RUN * 100 + i;
  const out: string[] = [];
  for (let k = 0; k < 8; k++) {
    out.push(CODES[v % CODES.length] as string);
    v = Math.floor(v / CODES.length);
  }
  const s = out.join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const DELIVERY = deliverySchema.parse({
  mode: "retrait",
  pickupPoint: "Marche Akwa, entree principale",
  phone: "+237677000118",
});

async function creerVendeuse(suffixe: string) {
  return prisma.seller.create({
    data: {
      phone: `+2376770${suffixe}`,
      businessName: `Vendeuse ${suffixe}`,
      slug: `vendeuse-${suffixe.toLowerCase()}`,
      city: "Douala",
    },
  });
}

async function creerCommande(
  sellerId: string,
  opts: { total?: number; paid?: number; balance?: number } = {},
) {
  const total = opts.total ?? 17000;
  const paid = opts.paid ?? total;
  const balance = opts.balance ?? total - paid;
  const i = nCmd++;
  return prisma.order.create({
    data: {
      ref: `CT-${RUN}${i.toString().padStart(2, "0")}`,
      sellerId,
      buyerPhone: "+237655000111",
      items: [{ productId: "p", name: "Article", unitPriceXaf: total, quantity: 1 }],
      totalXaf: total,
      amountPaidXaf: paid,
      balanceXaf: balance,
      payMode: "integral",
      delivery: DELIVERY,
      verificationCode: codeValide(i + 1),
      expiresAt: new Date(Date.now() + 48 * 3_600_000),
    },
  });
}

const CHECKS_OK = [
  { n: 1, id: "format", state: "pass", explanation: "Format reconnu." },
  { n: 2, id: "montant", state: "pass", explanation: "Montant conforme." },
];

async function creerPreuve(orderId: string, operator: "mtn" | "orange", txId: string) {
  return prisma.paymentProof.create({
    data: {
      orderId,
      operator,
      operatorTxId: txId,
      amountXaf: 17000,
      counterpartyPhone: "655000111",
      counterpartyName: null,
      occurredAt: new Date(),
      patternId: "mtn.entrant",
      patternAConfirmer: false,
      rawSms: "[TEST] texte factice",
      checks: CHECKS_OK,
      verdict: "accepte",
    },
  });
}

beforeAll(() => {
  if (URL) prisma = createPrismaClient(URL);
});
afterAll(async () => {
  await prisma?.$disconnect();
});

/* ══════════════ contrôle n° 5 : unicité réseau-large ══════════════ */

describeDb("controle n° 5 — un identifiant d'operateur ne vaut qu'une fois", () => {
  it("REJETTE le meme operator_tx_id soumis par DEUX VENDEUSES DIFFERENTES", async () => {
    // L'identifiant porte `suivant()` ENTIER, pas ses quatre derniers
    // caracteres : la colonne est UNIQUE et la base n'est pas remise a zero
    // entre deux executions. Un suffixe court finit par se repeter, et le test
    // echoue alors sur une collision avec sa propre execution precedente.
    //
    // C'est tout l'enjeu : l'unicite est reseau-large, pas commande-large.
    // Deux vendeuses qui n'ont aucun lien entre elles ne peuvent pas reclamer
    // le meme paiement.
    const a = await creerVendeuse(suivant());
    const b = await creerVendeuse(suivant());
    const cmdA = await creerCommande(a.id);
    const cmdB = await creerCommande(b.id);

    const txId = `1760000${suivant()}`;
    await creerPreuve(cmdA.id, "mtn", txId);

    await expect(creerPreuve(cmdB.id, "mtn", txId)).rejects.toThrow();
  });

  it("le meme identifiant chez DEUX OPERATEURS differents reste possible", async () => {
    // La cle est (operator, operator_tx_id) : MTN et Orange numerotent
    // independamment, et rien ne dit que leurs espaces ne se croisent jamais.
    const v = await creerVendeuse(suivant());
    const c1 = await creerCommande(v.id);
    const c2 = await creerCommande(v.id);
    const txId = `ID${suivant()}`;
    await creerPreuve(c1.id, "mtn", txId);
    await expect(creerPreuve(c2.id, "orange", txId)).resolves.toBeTruthy();
  });

  it("refuse un identifiant en minuscules — sinon le controle se contourne", async () => {
    // Sans la contrainte CHECK, `mp2607…` et `MP2607…` cohabiteraient dans la
    // colonne UNIQUE et il suffirait d'une touche majuscule pour reclamer deux
    // fois le meme paiement.
    const v = await creerVendeuse(suivant());
    const c = await creerCommande(v.id);
    await expect(creerPreuve(c.id, "orange", "mp260729.1716.c73941")).rejects.toThrow();
  });
});

/* ══════════════ ajout seul ══════════════ */

describeDb("les journaux sont en ajout seul", () => {
  it("UPDATE sur payment_proof echoue — une preuve ne se corrige pas", async () => {
    const v = await creerVendeuse(suivant());
    const c = await creerCommande(v.id);
    const p = await creerPreuve(c.id, "mtn", `1760001${suivant()}`);

    await expect(
      prisma.paymentProof.update({ where: { id: p.id }, data: { amountXaf: 1 } }),
    ).rejects.toThrow();
  });

  it("DELETE sur payment_proof echoue aussi", async () => {
    const v = await creerVendeuse(suivant());
    const c = await creerCommande(v.id);
    const p = await creerPreuve(c.id, "mtn", `1760002${suivant()}`);

    await expect(prisma.paymentProof.delete({ where: { id: p.id } })).rejects.toThrow();
  });

  it("UPDATE sur ledger_entry echoue — le grand livre ne se reecrit pas", async () => {
    const v = await creerVendeuse(suivant());
    const c = await creerCommande(v.id);
    const l = await prisma.ledgerEntry.create({
      data: { orderId: c.id, direction: "in", amountXaf: 17000, reason: "paiement_prouve" },
    });

    await expect(
      prisma.ledgerEntry.update({ where: { id: l.id }, data: { amountXaf: 0 } }),
    ).rejects.toThrow();
    await expect(prisma.ledgerEntry.delete({ where: { id: l.id } })).rejects.toThrow();
  });

  it("UPDATE sur order_event echoue — le journal d'audit non plus", async () => {
    const v = await creerVendeuse(suivant());
    const c = await creerCommande(v.id);
    const e = await prisma.orderEvent.create({
      data: { orderId: c.id, kind: "commande_creee", actor: "systeme" },
    });

    await expect(
      prisma.orderEvent.update({ where: { id: e.id }, data: { kind: "autre" } }),
    ).rejects.toThrow();
  });
});

/* ══════════════ cohérence comptable ══════════════ */

describeDb("coherence comptable de la commande", () => {
  it("REJETTE une commande dont les montants ne s'additionnent pas", async () => {
    const v = await creerVendeuse(suivant());
    // 10 000 payes + 5 000 de solde ne font pas 17 000.
    await expect(
      creerCommande(v.id, { total: 17000, paid: 10000, balance: 5000 }),
    ).rejects.toThrow();
  });

  it("accepte la repartition exacte de splitDeposit, franc pour franc", async () => {
    // 50 % de 7 501 F donne 3 750 F d'acompte et 3 751 F de solde. Le franc
    // perdu a l'arrondi n'existe pas : c'est ce que la contrainte verifie.
    const { deposit, balance } = splitDeposit(7501, 50);
    expect(deposit + balance).toBe(7501);
    const v = await creerVendeuse(suivant());
    await expect(
      creerCommande(v.id, { total: 7501, paid: deposit, balance }),
    ).resolves.toBeTruthy();
  });

  it("refuse un montant negatif", async () => {
    const v = await creerVendeuse(suivant());
    await expect(creerCommande(v.id, { total: 1000, paid: -500, balance: 1500 })).rejects.toThrow();
  });

  it("refuse un code de verification hors alphabet", async () => {
    const v = await creerVendeuse(suivant());
    await expect(
      prisma.order.create({
        data: {
          ref: `CT-${RUN}9${(nCmd++).toString().padStart(2, "0")}`,
          sellerId: v.id,
          buyerPhone: "+237655000111",
          items: [{ productId: "p", name: "x", unitPriceXaf: 1000, quantity: 1 }],
          totalXaf: 1000,
          amountPaidXaf: 0,
          balanceXaf: 1000,
          payMode: "integral",
          delivery: DELIVERY,
          // O et 0 sont ambigus : l'alphabet les exclut.
          verificationCode: "OOOO-0000",
          expiresAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});

/* ══════════════ ce que le schéma ne doit PAS porter ══════════════ */

describeDb("le modele de donnees reste celui de la v1", () => {
  it("payment_proof n'a aucune colonne de solde", async () => {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_proof'`,
    );
    const noms = cols.map((c) => c.column_name);
    expect(noms.length).toBeGreaterThan(5);
    for (const c of noms) {
      expect(c).not.toMatch(/solde|balance/i);
    }
  });

  it("les colonnes de payment_proof portent EXACTEMENT les noms attendus", async () => {
    // Ils viennent de docs/formats-sms-operateurs.md §4. Toute divergence casse
    // la transposition du lot 8.
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_proof'`,
    );
    const noms = new Set(cols.map((c) => c.column_name));
    for (const attendu of [
      "order_id",
      "operator",
      "operator_tx_id",
      "amount_xaf",
      "counterparty_phone",
      "counterparty_name",
      "occurred_at",
      "pattern_id",
      "pattern_a_confirmer",
      "raw_sms",
      "checks",
      "verdict",
      "countersigned_at",
    ]) {
      expect(noms.has(attendu), `colonne manquante : ${attendu}`).toBe(true);
    }
  });

  it("il n'existe ni table payment_event ni colonne provider_tx_id", async () => {
    const t = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(t.map((x) => x.table_name)).not.toContain("payment_event");

    const c = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    expect(c.map((x) => x.column_name)).not.toContain("provider_tx_id");
  });

  it("aucune colonne de montant n'est en flottant", async () => {
    const c = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%_xaf'`,
    );
    expect(c.length).toBeGreaterThan(3);
    for (const col of c) {
      expect(col.data_type, `${col.column_name} n'est pas entier`).toBe("integer");
    }
  });
});
