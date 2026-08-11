import { CODE_ALPHABET, statsVendeuseSchema } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fenetreDemandee, statsRoutes } from "../routes/stats.ts";

/**
 * L'ecran statistiques, contre une VRAIE base.
 *
 * Ce que ce fichier verifie et qu'aucun test de domaine ne peut verifier :
 *
 * 1. **une vendeuse ne voit que ses propres chiffres** — les commandes et les
 *    vues d'une voisine n'entrent nulle part, meme en connaissant sa boutique ;
 * 2. **la fenetre borne vraiment** : ce qui precede la periode reste dehors ;
 * 3. **les jours creux sont combles a zero et la serie est continue**, ce qui
 *    est la difference entre une courbe honnete et une droite inventee ;
 * 4. **la reponse est conforme au schema partage**, donc l'app vendeuse peut la
 *    lire sans redeclarer un type de son cote ;
 * 5. **une boutique vide ne renvoie pas zero pour cent**, mais `null` — « on n'a
 *    rien a mesurer » et « personne ne colle ses SMS » ne sont pas la meme
 *    phrase.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `Date.now() % 90000` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 803 * 1000 + (Date.now() % 1000);

/** Midi a Douala, le 30 juillet 2026. La fenetre de 30 jours part du 1er. */
const MAINTENANT = new Date("2026-07-30T11:00:00Z");
const jourAvant = (n: number) => new Date(MAINTENANT.getTime() - n * 86_400_000);

interface Vendeuse {
  sellerId: string;
  app: ReturnType<typeof statsRoutes>;
}

async function creerVendeuse(suffixe: number): Promise<Vendeuse> {
  const n = `+23767${String(RUN * 10 + suffixe)
    .padStart(7, "0")
    .slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Stats ${suffixe}`,
      email: `stats-${RUN}-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n,
      phoneNumberVerified: true,
    },
  });
  const s = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: n,
      businessName: `Stats ${RUN}-${suffixe}`,
      slug: `stats-${RUN}-${suffixe}`,
      city: "Douala",
    },
  });
  return {
    sellerId: s.id,
    app: statsRoutes({
      prisma,
      session: { prisma, session: async () => ({ user: { id: u.id, phoneNumber: n } }) },
      maintenant: () => MAINTENANT,
    }),
  };
}

let code = 0;
/**
 * Le code de verification suit un ALPHABET non ambigu, garanti par une
 * contrainte SQL. Un code fabrique avec des chiffres est refuse par la base —
 * ce qui est le comportement voulu, et la raison pour laquelle ce test le
 * fabrique correctement plutot que de desactiver la contrainte.
 */
function codeUnique(): string {
  code += 1;
  let n = RUN * 7919 + code * 104729;
  const car = () => {
    n = (n * 31 + 17) % 1_000_003;
    return CODE_ALPHABET[n % CODE_ALPHABET.length] as string;
  };
  const bloc = () => Array.from({ length: 4 }, car).join("");
  return `${bloc()}-${bloc()}`;
}

async function creerCommande(
  sellerId: string,
  opts: {
    creeeIlYA: number;
    etatPreuve: "attendu" | "declare_non_trace" | "prouve" | "contresigne" | "conteste";
    paye?: number;
  },
) {
  const total = 10_000;
  const paye = opts.paye ?? 0;
  const creeA = jourAvant(opts.creeeIlYA);
  return prisma.order.create({
    data: {
      ref: `CT-${RUN}${code++}`,
      sellerId,
      buyerPhone: "+237690000001",
      items: [{ name: "Pagne", unitPriceXaf: total, quantity: 1 }],
      totalXaf: total,
      amountPaidXaf: paye,
      balanceXaf: total - paye,
      payMode: "integral",
      proofState: opts.etatPreuve,
      delivery: {
        mode: "retrait",
        city: "Douala",
        quartier: "Akwa",
        landmark: "Face pharmacie",
        phone: "+237690000001",
      },
      verificationCode: codeUnique(),
      createdAt: creeA,
      expiresAt: new Date(creeA.getTime() + 48 * 3_600_000),
    },
  });
}

async function creerVues(sellerId: string, nom: string, vues: Array<[string, number]>) {
  const p = await prisma.product.create({
    data: { sellerId, name: nom, priceXaf: 5000, stock: 3 },
  });
  for (const [jour, count] of vues) {
    await prisma.productView.create({
      data: { productId: p.id, day: new Date(`${jour}T00:00:00Z`), count },
    });
  }
  return p;
}

const lire = async (v: Vendeuse, requete = "/") => {
  const r = await v.app.request(requete);
  return { statut: r.status, corps: (await r.json()) as Record<string, unknown> };
};

/* ────────────────────────── choix de fenetre ────────────────────────── */

describe("la fenetre demandee est une liste fermee", () => {
  it("accepte les trois valeurs proposees", () => {
    expect(fenetreDemandee("7")).toBe(7);
    expect(fenetreDemandee("30")).toBe(30);
    expect(fenetreDemandee("90")).toBe(90);
  });

  /**
   * `?jours=100000` n'est pas une periode, c'est une requete qui balaie la table
   * entiere. Une valeur hors liste retombe sur le defaut plutot que d'etre
   * refusee : l'ecran doit s'afficher meme si un lien a ete recopie de travers.
   */
  it("ramene tout le reste au defaut de trente jours", () => {
    for (const brut of [undefined, "", "0", "-1", "1000000", "trente", "30.5"]) {
      expect(fenetreDemandee(brut), `pour ${brut}`).toBe(30);
    }
  });
});

describeDb("GET /api/statistiques", () => {
  let alice: Vendeuse;
  let voisine: Vendeuse;

  beforeAll(async () => {
    prisma = createPrismaClient();
    alice = await creerVendeuse(1);
    voisine = await creerVendeuse(2);

    // Dans la fenetre de trente jours : deux prouvees, une contresignee, une
    // non tracee, une en attente, une contestee.
    await creerCommande(alice.sellerId, { creeeIlYA: 1, etatPreuve: "prouve", paye: 10_000 });
    await creerCommande(alice.sellerId, { creeeIlYA: 2, etatPreuve: "prouve", paye: 10_000 });
    await creerCommande(alice.sellerId, { creeeIlYA: 3, etatPreuve: "contresigne", paye: 10_000 });
    await creerCommande(alice.sellerId, {
      creeeIlYA: 4,
      etatPreuve: "declare_non_trace",
      paye: 5_000,
    });
    await creerCommande(alice.sellerId, { creeeIlYA: 5, etatPreuve: "attendu" });
    await creerCommande(alice.sellerId, { creeeIlYA: 6, etatPreuve: "conteste", paye: 10_000 });
    // HORS fenetre : quarante jours en arriere.
    await creerCommande(alice.sellerId, { creeeIlYA: 40, etatPreuve: "prouve", paye: 10_000 });

    await creerVues(alice.sellerId, "Pagne wax", [
      ["2026-07-28", 12],
      ["2026-07-30", 20],
    ]);
    await creerVues(alice.sellerId, "Foulard", [["2026-07-28", 5]]);
    // Hors fenetre, et chez la voisine : ni l'un ni l'autre ne doit apparaitre.
    await creerVues(alice.sellerId, "Ancien", [["2026-05-01", 999]]);
    await creerVues(voisine.sellerId, "Chez la voisine", [["2026-07-29", 777]]);
    await creerCommande(voisine.sellerId, { creeeIlYA: 1, etatPreuve: "prouve", paye: 10_000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuse sans session", async () => {
    const nu = statsRoutes({
      prisma,
      session: { prisma, session: async () => null },
      maintenant: () => MAINTENANT,
    });
    expect((await nu.request("/")).status).toBe(401);
  });

  it("la reponse est conforme au schema partage", async () => {
    const { corps } = await lire(alice);
    expect(statsVendeuseSchema.safeParse(corps).success, JSON.stringify(corps)).toBe(true);
  });

  it("la periode annoncee est celle des chiffres rendus", async () => {
    const { corps } = await lire(alice);
    expect(corps.periode).toEqual({ du: "2026-07-01", au: "2026-07-30", jours: 30 });
  });

  /* ── part des ventes prouvees ── */

  it("repartit en trois, et laisse dehors l'attente et le litige", async () => {
    const { corps } = await lire(alice);
    expect(corps.partVentesProuvees).toEqual({
      prouve: 2,
      contresigne: 1,
      nonTrace: 1,
      total: 4,
      pourcent: 75,
    });
  });

  it("la commande hors fenetre ne gonfle pas la part", async () => {
    // Sept commandes existent, six sont dans la fenetre, quatre au denominateur.
    const { corps } = await lire(alice);
    const part = corps.partVentesProuvees as { total: number };
    expect(part.total).toBe(4);
  });

  it("une vendeuse sans vente lit `null`, jamais zero pour cent", async () => {
    const neuve = await creerVendeuse(3);
    const { corps } = await lire(neuve);
    expect(corps.partVentesProuvees).toEqual({
      prouve: 0,
      contresigne: 0,
      nonTrace: 0,
      total: 0,
      pourcent: null,
    });
  });

  /* ── series ── */

  it("la serie des vues couvre chaque jour de la periode, trous combles a zero", async () => {
    const { corps } = await lire(alice);
    const serie = corps.vuesParJour as Array<{ jour: string; valeur: number }>;
    expect(serie).toHaveLength(30);
    expect(serie[0]?.jour).toBe("2026-07-01");
    expect(serie[29]?.jour).toBe("2026-07-30");
    // Un jour sans vue vaut zero et EXISTE : c'est ce qui empeche la courbe de
    // relier deux jours pleins par une droite qui n'a pas eu lieu.
    expect(serie.find((p) => p.jour === "2026-07-15")).toEqual({ jour: "2026-07-15", valeur: 0 });
    // Deux articles vus le meme jour s'additionnent.
    expect(serie.find((p) => p.jour === "2026-07-28")).toEqual({ jour: "2026-07-28", valeur: 17 });
    expect(serie.find((p) => p.jour === "2026-07-30")).toEqual({ jour: "2026-07-30", valeur: 20 });
  });

  it("les vues de la voisine et celles d'avant la periode restent dehors", async () => {
    const { corps } = await lire(alice);
    const total = (corps.vuesParJour as Array<{ valeur: number }>).reduce(
      (s, p) => s + p.valeur,
      0,
    );
    expect(total).toBe(37); // 12 + 20 + 5, ni 999 ni 777
  });

  it("les commandes par jour sont comptees en jours de Douala", async () => {
    const { corps } = await lire(alice);
    const serie = corps.commandesParJour as Array<{ jour: string; valeur: number }>;
    expect(serie).toHaveLength(30);
    expect(serie.reduce((s, p) => s + p.valeur, 0)).toBe(6);
    expect(serie.find((p) => p.jour === "2026-07-29")).toEqual({ jour: "2026-07-29", valeur: 1 });
  });

  it("une fenetre de sept jours rend sept points", async () => {
    const { corps } = await lire(alice, "/?jours=7");
    expect(corps.periode).toEqual({ du: "2026-07-24", au: "2026-07-30", jours: 7 });
    expect(corps.vuesParJour).toHaveLength(7);
  });

  /* ── entonnoir ── */

  it("l'entonnoir descend, et chaque taux se rapporte a l'etape PRECEDENTE", async () => {
    const { corps } = await lire(alice);
    const etapes = corps.entonnoir as Array<{
      cle: string;
      valeur: number;
      pourcentPrecedent: number | null;
    }>;
    expect(etapes.map((e) => e.cle)).toEqual(["vues", "commandes", "payees", "prouvees"]);
    expect(etapes[0]).toMatchObject({ valeur: 37, pourcentPrecedent: null });
    expect(etapes[1]).toMatchObject({ valeur: 6, pourcentPrecedent: 16 });
    // Cinq commandes portent un versement ; l'attente n'en a pas.
    expect(etapes[2]).toMatchObject({ valeur: 5, pourcentPrecedent: 83 });
    expect(etapes[3]).toMatchObject({ valeur: 3, pourcentPrecedent: 60 });
  });

  /* ── articles ── */

  it("classe les articles les plus vus, et n'en garde que cinq", async () => {
    const { corps } = await lire(alice);
    const articles = corps.articlesLesPlusVus as ArticleLu[];
    expect(articles.length).toBeLessThanOrEqual(5);
    expect(articles[0]).toMatchObject({ nom: "Pagne wax", vues: 32 });
    expect(articles[1]).toMatchObject({ nom: "Foulard", vues: 5 });
    expect(articles.map((a) => a.nom)).not.toContain("Ancien");
    expect(articles.map((a) => a.nom)).not.toContain("Chez la voisine");
  });

  /* ── ce que la mesure ne sait pas ── */

  it("dit que les vues ne sont pas encore instrumentees", async () => {
    const { corps } = await lire(alice);
    expect(corps.instrumentation).toEqual({ vuesInstrumentees: false });
  });
});

interface ArticleLu {
  id: string;
  nom: string;
  vues: number;
}
