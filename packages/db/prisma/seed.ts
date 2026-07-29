import {
  type Delivery,
  deliverySchema,
  itemsTotalXaf,
  type OrderItem,
  type OrderStep,
  orderRefSchema,
  type PayMode,
  type ProofState,
  splitDeposit,
  verificationCodeSchema,
} from "@catalog/contracts";
import { createPrismaClient } from "../src/index.ts";

/**
 * Seed de developpement.
 *
 * **Deterministe, exprès.** Aucun tirage aleatoire : ni identifiant, ni code de
 * verification, ni date relative a l'heure d'execution. Un seed qui change a
 * chaque appel rend les tests non reproductibles et les captures d'ecran
 * inutilisables comme reference.
 *
 * **Identifiants de transaction pseudonymises.** Ils ont la forme exacte des
 * vrais — 11 chiffres chez MTN, `XX AAMMJJ.HHMM.Lnnnnn` chez Orange — mais pas
 * leurs chiffres. La regle de `docs/formats-sms-operateurs.md` s'applique ici :
 * aucun identifiant reel n'entre dans le depot.
 *
 * Couverture exigee par le lot 3 : les trois modes de paiement, au moins trois
 * preuves validees, deux paiements non traces, une contestation, et une
 * commande a chacune des quatre etapes.
 */

const prisma = createPrismaClient();

/** Ancre temporelle fixe. Toutes les dates du seed en decoulent. */
const T0 = new Date("2026-07-20T09:00:00.000Z");
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);

/* ────────────────────────── vendeuses ────────────────────────── */

const SELLERS = [
  {
    id: "01919000-0000-7000-8000-000000000001",
    phone: "+237677000101",
    businessName: "Chez Maman Jeanne",
    slug: "chez-maman-jeanne",
    city: "Douala",
    quartier: "Bonamoussadi",
    pickupPoint: "Carrefour Bonamoussadi, devant la pharmacie",
    // Double SIM : connexion MTN, encaissement Orange. C'est la norme.
    payoutPhone: "+237699000101",
    payoutOperator: "orange" as const,
  },
  {
    id: "01919000-0000-7000-8000-000000000002",
    phone: "+237699000202",
    businessName: "Boutique Adama",
    slug: "boutique-adama",
    city: "Yaounde",
    quartier: "Bastos",
    pickupPoint: null,
    payoutPhone: "+237677000202",
    payoutOperator: "mtn" as const,
  },
  {
    id: "01919000-0000-7000-8000-000000000003",
    phone: "+237677000303",
    businessName: "Sandra Couture",
    slug: "sandra-couture",
    city: "Douala",
    quartier: "Akwa",
    pickupPoint: "Marche Akwa, entree principale",
    // Numero de reversement pas encore verifie : cas reel a l'inscription.
    payoutPhone: null,
    payoutOperator: null,
  },
];

/* ────────────────────────── articles : 6 par vendeuse ────────────────────────── */

const PRODUCT_NAMES: Record<number, Array<[string, number, number]>> = {
  0: [
    ["Robe wax grande taille", 18500, 4],
    ["Ensemble pagne 6 yards", 12000, 7],
    ["Foulard assorti", 3500, 20],
    ["Sac raphia tresse", 9000, 3],
    ["Sandales cuir", 15000, 2],
    ["Boubou brode", 27000, 1],
  ],
  1: [
    ["Chemise homme pagne", 11000, 9],
    ["Cravate wax", 4500, 15],
    ["Costume enfant", 16500, 5],
    ["Casquette brodee", 5000, 12],
    ["Ceinture cuir", 7500, 8],
    ["Chaussures ville", 32000, 2],
  ],
  2: [
    ["Retouche ourlet", 2000, 99],
    ["Jupe sur mesure", 14000, 0],
    ["Blouse coton", 8500, 6],
    ["Tenue traditionnelle", 45000, 1],
    ["Masque tissu (lot de 5)", 2500, 30],
    ["Nappe brodee", 19000, 2],
  ],
};

/* ────────────────────────── commandes ────────────────────────── */

type SeedOrder = {
  ref: string;
  seller: number;
  buyerPhone: string;
  buyerName: string | null;
  items: Array<[number, number]>; // [index produit, quantite]
  payMode: PayMode;
  step: OrderStep;
  proofState: ProofState;
  code: string;
  delivery: Delivery;
  /** Identifiant pseudonymise de la preuve, quand il y en a une. */
  proof?: {
    operator: "mtn" | "orange";
    txId: string;
    verdict: "accepte" | "accepte_sous_reserve";
    patternId: string;
    patternAConfirmer: boolean;
    countersigned?: boolean;
    /** Sens du message : un `sortant` ne peut pas prouver seul. */
    sens: "entrant" | "sortant";
  };
  review?: { rating: number; body: string };
};

const LIVRAISON = (quartier: string, landmark: string, phone: string): Delivery => ({
  mode: "livraison",
  city: "Douala",
  quartier,
  landmark,
  phone,
});

const RETRAIT = (pickupPoint: string, phone: string): Delivery => ({
  mode: "retrait",
  pickupPoint,
  phone,
});

const ORDERS: SeedOrder[] = [
  {
    ref: "CT-1001",
    seller: 0,
    buyerPhone: "+237655000111",
    buyerName: "Awa N.",
    items: [[0, 1]],
    payMode: "integral",
    step: "livree",
    proofState: "prouve",
    code: "ACDE-4679",
    delivery: LIVRAISON("Makepe", "Immeuble bleu derriere la station Tradex", "+237655000111"),
    proof: {
      operator: "mtn",
      txId: "17600000001",
      verdict: "accepte",
      patternId: "mtn.entrant",
      patternAConfirmer: false,
      sens: "entrant",
    },
    review: { rating: 5, body: "Livraison rapide, tissu conforme." },
  },
  {
    ref: "CT-1002",
    seller: 0,
    buyerPhone: "+237677000112",
    buyerName: "Brigitte T.",
    items: [
      [1, 1],
      [2, 2],
    ],
    payMode: "integral",
    step: "livree",
    proofState: "contresigne",
    code: "CDEF-4679",
    delivery: RETRAIT("Carrefour Bonamoussadi, devant la pharmacie", "+237677000112"),
    proof: {
      operator: "orange",
      txId: "MP260720.1042.C10002",
      verdict: "accepte_sous_reserve",
      patternId: "om.entrant",
      // Motif RECONSTITUE : le SMS Orange de reception n'est pas confirme.
      patternAConfirmer: true,
      countersigned: true,
      sens: "entrant",
    },
    review: { rating: 5, body: "Deuxieme commande, toujours nickel." },
  },
  {
    ref: "CT-1003",
    seller: 0,
    buyerPhone: "+237699000113",
    buyerName: null,
    items: [[5, 1]],
    payMode: "acompte",
    step: "chez_le_livreur",
    proofState: "prouve",
    code: "DEFG-4679",
    delivery: LIVRAISON("Deido", "En face de l'ecole publique de Deido", "+237699000113"),
    proof: {
      operator: "mtn",
      txId: "17600000003",
      verdict: "accepte",
      patternId: "mtn.entrant",
      patternAConfirmer: false,
      sens: "entrant",
    },
  },
  {
    ref: "CT-1004",
    seller: 1,
    buyerPhone: "+237655000114",
    buyerName: "Cedric M.",
    items: [[2, 1]],
    payMode: "acompte",
    step: "preparee",
    // Depot direct non prouve : la vendeuse dit avoir recu, sans SMS colle.
    proofState: "declare_non_trace",
    code: "EFGH-4679",
    delivery: LIVRAISON("Bepanda", "Apres le pont, boutique au coin", "+237655000114"),
  },
  {
    ref: "CT-1005",
    seller: 1,
    buyerPhone: "+237677000115",
    buyerName: "Divine K.",
    items: [
      [0, 2],
      [1, 1],
    ],
    payMode: "sans_prepaiement",
    step: "recue",
    proofState: "attendu",
    code: "FGHJ-4679",
    delivery: LIVRAISON("Bonapriso", "Villa a portail vert, rue des Manguiers", "+237677000115"),
  },
  {
    ref: "CT-1006",
    seller: 1,
    buyerPhone: "+237699000116",
    buyerName: "Eric B.",
    items: [[5, 1]],
    payMode: "integral",
    step: "livree",
    // Contestation : la preuve reste, elle n'est pas effacee.
    proofState: "conteste",
    code: "GHJK-4679",
    delivery: RETRAIT("Gare routiere de Yaounde, guichet 3", "+237699000116"),
    proof: {
      operator: "mtn",
      txId: "17600000006",
      verdict: "accepte",
      patternId: "mtn.entrant",
      patternAConfirmer: false,
      sens: "entrant",
    },
  },
  {
    ref: "CT-1007",
    seller: 2,
    buyerPhone: "+237655000117",
    buyerName: null,
    items: [[1, 1]],
    payMode: "acompte",
    step: "recue",
    proofState: "attendu",
    code: "HJKM-4679",
    delivery: LIVRAISON("Kotto", "Derriere le carrefour Kotto, portail rouge", "+237655000117"),
  },
  {
    ref: "CT-1008",
    seller: 2,
    buyerPhone: "+237677000118",
    buyerName: "Francine O.",
    items: [[0, 3]],
    payMode: "integral",
    step: "livree",
    proofState: "declare_non_trace",
    code: "JKMN-4679",
    delivery: RETRAIT("Marche Akwa, entree principale", "+237677000118"),
    // Avis NON verifie : un paiement non trace n'ouvre pas droit au label.
    review: { rating: 4, body: "Bon travail, un peu de retard." },
  },
  {
    ref: "CT-1009",
    seller: 2,
    buyerPhone: "+237699000119",
    buyerName: "Ghislain P.",
    items: [[3, 1]],
    payMode: "sans_prepaiement",
    step: "preparee",
    proofState: "attendu",
    code: "KMNP-4679",
    delivery: LIVRAISON("Logbaba", "Pres du chateau d'eau", "+237699000119"),
  },
  {
    ref: "CT-1010",
    seller: 0,
    buyerPhone: "+237655000120",
    buyerName: "Helene A.",
    items: [
      [2, 3],
      [3, 1],
    ],
    payMode: "integral",
    step: "preparee",
    proofState: "prouve",
    code: "MNPQ-4679",
    delivery: LIVRAISON("Bali", "Face au dispensaire", "+237655000120"),
    proof: {
      operator: "orange",
      txId: "MP260721.0915.C10010",
      verdict: "accepte_sous_reserve",
      patternId: "om.entrant",
      patternAConfirmer: true,
      sens: "entrant",
    },
  },
  {
    ref: "CT-1011",
    seller: 1,
    buyerPhone: "+237677000121",
    buyerName: "Ibrahim S.",
    items: [[4, 2]],
    payMode: "acompte",
    step: "chez_le_livreur",
    proofState: "contresigne",
    code: "NPQR-4679",
    delivery: LIVRAISON("Ndokotti", "Carrefour Ndokotti, kiosque a journaux", "+237677000121"),
    proof: {
      operator: "mtn",
      txId: "17600000011",
      verdict: "accepte",
      patternId: "mtn.entrant",
      patternAConfirmer: false,
      countersigned: true,
      sens: "entrant",
    },
  },
  {
    ref: "CT-1012",
    seller: 2,
    buyerPhone: "+237699000122",
    buyerName: null,
    items: [[4, 4]],
    payMode: "sans_prepaiement",
    step: "recue",
    proofState: "attendu",
    code: "PQRT-4679",
    delivery: RETRAIT("Marche Akwa, entree principale", "+237677000118"),
  },
];

/**
 * Repartition des montants selon le mode. `splitDeposit` fait foi : 50 % de
 * 7 501 F donne 3 750 F d'acompte et 3 751 F de solde. On ne le « corrige » pas.
 */
function amounts(total: number, mode: PayMode): { paid: number; balance: number } {
  if (mode === "integral") return { paid: total, balance: 0 };
  if (mode === "sans_prepaiement") return { paid: 0, balance: total };
  const { deposit, balance } = splitDeposit(total, 50);
  return { paid: deposit, balance };
}

async function main() {
  // Ordre inverse des dependances. Les tables en ajout seul se vident par
  // TRUNCATE : les triggers portent sur UPDATE et DELETE, pas sur TRUNCATE.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "review", "order_event", "ledger_entry", "payment_proof",
                   "product_view", "order", "product", "seller" CASCADE;
  `);

  for (const [i, s] of SELLERS.entries()) {
    await prisma.seller.create({
      data: {
        id: s.id,
        phone: s.phone,
        businessName: s.businessName,
        slug: s.slug,
        city: s.city,
        quartier: s.quartier,
        pickupPoint: s.pickupPoint,
        payoutPhone: s.payoutPhone,
        payoutOperator: s.payoutOperator,
        payoutPhoneVerifiedAt: s.payoutPhone ? h(i) : null,
        subscriptionStatus: i === 2 ? "trial" : "active",
        createdAt: h(i),
        products: {
          create: (PRODUCT_NAMES[i] ?? []).map(([name, priceXaf, stock], p) => ({
            id: `01919000-0000-7000-9000-${String(i * 10 + p).padStart(12, "0")}`,
            name,
            priceXaf,
            stock,
            position: p,
            createdAt: h(i),
          })),
        },
      },
    });
  }

  const productsBySeller = new Map<number, Array<{ id: string; name: string; priceXaf: number }>>();
  for (const [i, s] of SELLERS.entries()) {
    productsBySeller.set(
      i,
      await prisma.product.findMany({
        where: { sellerId: s.id },
        orderBy: { position: "asc" },
        select: { id: true, name: true, priceXaf: true },
      }),
    );
  }

  for (const [n, o] of ORDERS.entries()) {
    orderRefSchema.parse(o.ref);
    verificationCodeSchema.parse(o.code);
    deliverySchema.parse(o.delivery);

    const catalogue = productsBySeller.get(o.seller) ?? [];
    const items: OrderItem[] = o.items.map(([idx, quantity]) => {
      const p = catalogue[idx];
      if (!p) throw new Error(`produit ${idx} absent chez la vendeuse ${o.seller}`);
      return { productId: p.id, name: p.name, unitPriceXaf: p.priceXaf, quantity };
    });

    const total = itemsTotalXaf(items);
    const { paid, balance } = amounts(total, o.payMode);
    const createdAt = h(24 + n * 3);

    const order = await prisma.order.create({
      data: {
        ref: o.ref,
        sellerId: SELLERS[o.seller]?.id as string,
        buyerPhone: o.buyerPhone,
        buyerName: o.buyerName,
        items,
        totalXaf: total,
        amountPaidXaf: paid,
        balanceXaf: balance,
        payMode: o.payMode,
        step: o.step,
        proofState: o.proofState,
        delivery: o.delivery,
        verificationCode: o.code,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 48 * 3_600_000),
        deliveredAt: o.step === "livree" ? new Date(createdAt.getTime() + 30 * 3_600_000) : null,
        events: {
          create: [
            { kind: "commande_creee", actor: "acheteuse", at: createdAt },
            ...(o.proofState === "declare_non_trace"
              ? [
                  {
                    kind: "paiement_declare_non_trace",
                    actor: "vendeuse",
                    at: new Date(createdAt.getTime() + 3_600_000),
                    payload: { note: "declare a la main, aucun SMS colle" },
                  },
                ]
              : []),
          ],
        },
      },
    });

    if (o.proof) {
      const p = o.proof;
      await prisma.paymentProof.create({
        data: {
          orderId: order.id,
          operator: p.operator,
          operatorTxId: p.txId.toUpperCase(),
          amountXaf: paid,
          counterpartyPhone: o.buyerPhone.replace("+237", ""),
          counterpartyName: o.buyerName,
          occurredAt: new Date(createdAt.getTime() + 1_800_000),
          patternId: p.patternId,
          patternAConfirmer: p.patternAConfirmer,
          rawSms: `[SEED — texte factice, aucun SMS reel] preuve ${p.txId}`,
          checks: [
            {
              n: 1,
              id: "format",
              state: p.patternAConfirmer ? "warn" : "pass",
              explanation: p.patternAConfirmer
                ? "Motif reconstitue : verdict plafonne a « accepte sous reserve »."
                : "Format operateur reconnu.",
            },
            {
              n: 2,
              id: "montant",
              state: "pass",
              explanation: "Le montant correspond a ce qui est attendu.",
            },
            {
              n: 3,
              id: "contrepartie",
              state: "pass",
              explanation: "Le numero correspond a celui de la commande.",
            },
            {
              n: 4,
              id: "horodatage",
              state: "pass",
              explanation: "Le paiement est posterieur a la commande, sous 48 h.",
            },
            {
              n: 5,
              id: "unicite",
              state: "pass",
              explanation: "Cet identifiant n'a ete reclame nulle part ailleurs.",
            },
            {
              n: 6,
              id: "auto_coherence",
              state: p.operator === "orange" ? "pass" : "pending",
              explanation:
                p.operator === "orange"
                  ? "La date inscrite dans l'identifiant est coherente."
                  : "Ne s'applique qu'a Orange Money.",
            },
            {
              n: 7,
              id: "contre_signature",
              state: p.countersigned ? "pass" : "pending",
              explanation: p.countersigned
                ? "L'acheteuse a confirme."
                : "En attente de la confirmation de l'acheteuse.",
            },
          ],
          verdict: p.verdict,
          countersignedAt: p.countersigned ? new Date(createdAt.getTime() + 7_200_000) : null,
          createdAt: new Date(createdAt.getTime() + 2_000_000),
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          orderId: order.id,
          direction: "in",
          amountXaf: paid,
          reason: o.payMode === "acompte" ? "acompte_prouve" : "paiement_prouve",
          recordedAt: new Date(createdAt.getTime() + 2_100_000),
        },
      });
    }

    if (o.review) {
      // « achat verifie » uniquement si la preuve est prouve ou contresigne.
      const verified = o.proofState === "prouve" || o.proofState === "contresigne";
      await prisma.review.create({
        data: {
          orderId: order.id,
          sellerId: SELLERS[o.seller]?.id as string,
          rating: o.review.rating,
          body: o.review.body,
          verified,
          createdAt: new Date(createdAt.getTime() + 40 * 3_600_000),
        },
      });
    }
  }

  // Quelques vues d'articles, pour que l'ecran statistiques du lot 13 ait de quoi.
  const first = productsBySeller.get(0) ?? [];
  for (const [d, p] of first.slice(0, 3).entries()) {
    await prisma.productView.create({
      data: { productId: p.id, day: new Date(`2026-07-2${5 + d}`), count: 12 + d * 7 },
    });
  }

  const counts = {
    vendeuses: await prisma.seller.count(),
    articles: await prisma.product.count(),
    commandes: await prisma.order.count(),
    preuves: await prisma.paymentProof.count(),
    avis: await prisma.review.count(),
  };
  console.log("seed applique :", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
