import { randomBytes } from "node:crypto";
import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAMPE_DEFAUT } from "../domain/ramp/config.ts";
import { genererJetonSuivi } from "../domain/receipt/jeton.ts";
import { normaliserCode, recuRoutes, suiviRoutes } from "../routes/recu.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le recu public et la contre-signature, contre une VRAIE base.
 *
 * Quatre criteres de la definition de terminé du lot 10 se jouent ici, et aucun
 * ne se verifie sans base :
 *
 * 1. un code inexistant produit un **refus explicite**, jamais une page vide ;
 * 2. un paiement `declare_non_trace` n'a **pas** de recu ;
 * 3. une contestation **ne supprime pas** la preuve ;
 * 4. la reference et le code de verification n'ouvrent **pas** la
 *    contre-signature — seul le jeton du lien de suivi l'ouvre.
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
const RUN = 275 * 1000 + (Date.now() % 1000);

/* Les fixtures se numerotaient `RUN + 1` … `RUN + 16`. Deux executions se
   recouvraient donc des que l'ecart de leurs sels etait inferieur a seize —
   ~3 %, et la CI enchaine `test` puis `test:coverage` sur la MEME base. Le
   defaut s'est vu trois fois le 11/08, en doublon d'adresse. Les numeros ont
   maintenant leurs propres chiffres : voir `_identifiants.ts`. */
const ids = identifiants("recu-route");
const NOW = new Date("2026-06-23T12:00:00+01:00");
const CREEE = new Date("2026-06-23T09:00:00+01:00");

/**
 * Alea REEL, et non un generateur deterministe.
 *
 * `buyer_token` est UNIQUE et la base n'est pas purgee entre deux executions.
 * Un alea deterministe seme sur `RUN = Date.now() % 90000` se repete toutes les
 * quatre-vingt-dix secondes : deux executions rapprochees entrent alors en
 * collision avec les lignes laissees par la precedente. Le determinisme du
 * generateur est verifie ailleurs — `jeton-suivi.test.ts` —, il n'a rien a faire
 * ici.
 */
const alea = () => (n: number) => new Uint8Array(randomBytes(n));

/** Code de verification valide au sens de la contrainte de base. */
function codeDeTest(graine: number): string {
  let n = graine;
  const car = () => {
    n = (n * 31 + 17) % 1_000_003;
    return CODE_ALPHABET[n % CODE_ALPHABET.length] as string;
  };
  const bloc = () => Array.from({ length: 4 }, car).join("");
  return `${bloc()}-${bloc()}`;
}

interface Jeu {
  orderId: string;
  code: string;
  jeton: string;
  ref: string;
}

async function creer(
  suffixe: number,
  options: { proofState?: string; avecPreuve?: boolean } = {},
): Promise<Jeu> {
  const { proofState = "prouve", avecPreuve = true } = options;
  const n = (base: string) => `+237${base}${suffixe.toString().padStart(7, "0").slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Recu ${suffixe}`,
      email: `recu-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n("67"),
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique recu ${suffixe}`,
      slug: `boutique-recu-${suffixe}`,
      city: "Douala",
      payoutPhone: n("69"),
      payoutPhoneVerifiedAt: CREEE,
    },
  });
  const code = codeDeTest(suffixe);
  const jeton = genererJetonSuivi(alea());
  const ref = `CT-${(800000 + suffixe) % 99999999}`;
  const o = await prisma.order.create({
    data: {
      ref,
      sellerId: v.id,
      buyerPhone: "+237652000001",
      items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: 26800 }],
      totalXaf: 26800,
      amountPaidXaf: avecPreuve ? 26800 : 0,
      balanceXaf: avecPreuve ? 0 : 26800,
      payMode: "integral",
      proofState: proofState as never,
      delivery: { mode: "point_de_retrait", city: "Douala", landmark: "Carrefour", phone: n("67") },
      verificationCode: code,
      buyerToken: jeton,
      createdAt: CREEE,
      expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
    },
  });
  if (avecPreuve) {
    await prisma.paymentProof.create({
      data: {
        orderId: o.id,
        operator: "mtn",
        operatorTxId: `176${suffixe.toString().padStart(8, "0")}`,
        amountXaf: 26800,
        counterpartyPhone: "652000001",
        occurredAt: new Date("2026-06-23T09:50:32+01:00"),
        patternId: "mtn.entrant",
        patternAConfirmer: false,
        rawSms: "chiffre-de-test",
        checks: [],
        verdict: "accepte",
      },
    });
  }
  return { orderId: o.id, code, jeton, ref };
}

const app = () =>
  new Hono()
    .route("/api/recu", recuRoutes({ prisma, rampe: RAMPE_DEFAUT }))
    .route("/api/suivi", suiviRoutes({ prisma, rampe: RAMPE_DEFAUT, maintenant: () => NOW }));

describeDb("le recu public", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rend le recu, avec l'identifiant de l'operateur", async () => {
    const j = await creer(ids.suivant());
    const r = await app().request(`/api/recu/${j.code}`);
    expect(r.status).toBe(200);
    const corps = (await r.json()) as { recu: Record<string, unknown>; portee: string };
    expect(corps.recu.reference).toBe(j.ref);
    expect(String(corps.recu.operatorTxId)).toMatch(/^176/);
    expect(corps.portee).toMatch(/l'opérateur peut confirmer/i);
  });

  it("un code INEXISTANT produit un refus explicite, pas une page vide", async () => {
    // On CHERCHE un code absent plutot que d'en supposer un : la base n'est pas
    // purgee entre deux executions, et un code ecrit en dur finirait par exister.
    let code = "";
    for (let i = 0; i < 50 && !code; i++) {
      const candidat = codeDeTest(RUN * 7 + i * 101);
      const pris = await prisma.order.findFirst({ where: { verificationCode: candidat } });
      if (!pris) code = candidat;
    }
    expect(code).not.toBe("");

    const r = await app().request(`/api/recu/${code}`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ refus: "code_inconnu" });
  });

  it("un code MAL FORME est refuse de la meme facon", async () => {
    // Ne pas distinguer evite d'apprendre a un curieux qu'un code a la bonne
    // forme sans exister.
    for (const mauvais of ["pas-un-code", "AAAA", "IIII-OOOO"]) {
      const r = await app().request(`/api/recu/${encodeURIComponent(mauvais)}`);
      expect(r.status, mauvais).toBe(404);
    }
  });

  it("tolere un code recopie a la main : minuscules, sans tiret", async () => {
    // Une acheteuse le dicte au telephone. Refuser sur la forme serait refuser
    // des gens qui ont le bon code.
    const j = await creer(ids.suivant());
    const brut = j.code.replace("-", "").toLowerCase();
    expect((await app().request(`/api/recu/${brut}`)).status).toBe(200);
  });

  it("un depot DECLARE A LA MAIN n'a pas de page de recu", async () => {
    const j = await creer(ids.suivant(), { proofState: "declare_non_trace", avecPreuve: false });
    const r = await app().request(`/api/recu/${j.code}`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ refus: "declare_non_trace", etat: "declare_non_trace" });
  });

  it("ne divulgue NI le SMS, NI le solde, NI le jeton de suivi", async () => {
    const j = await creer(ids.suivant());
    const texte = await (await app().request(`/api/recu/${j.code}`)).text();
    expect(texte).not.toContain("chiffre-de-test");
    expect(texte).not.toContain(j.jeton);
    expect(texte.toLowerCase()).not.toContain("solde");
  });

  it("ne se met pas en cache : il change quand l'acheteuse contresigne", async () => {
    const j = await creer(ids.suivant());
    const r = await app().request(`/api/recu/${j.code}`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describeDb("le suivi et la contre-signature", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("le lien de suivi ouvre la coquille : reference, montant, recu", async () => {
    const j = await creer(ids.suivant());
    const r = await app().request(`/api/suivi/${j.jeton}`);
    expect(r.status).toBe(200);
    const corps = (await r.json()) as Record<string, unknown>;
    expect(corps.reference).toBe(j.ref);
    expect(corps.totalXaf).toBe(26800);
    expect((corps.actions as Record<string, boolean>).contresigner).toBe(true);
  });

  it("un tap contresigne, et la preuve porte la date", async () => {
    const j = await creer(ids.suivant());
    const r = await app().request(`/api/suivi/${j.jeton}/contresigner`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ etat: "contresigne" });

    const commande = await prisma.order.findFirst({ where: { id: j.orderId } });
    expect(commande?.proofState).toBe("contresigne");

    // La date vient du JOURNAL : `payment_proof` est en ajout seul, un
    // declencheur de base refuse l'UPDATE, et on ne desserre pas cette garantie
    // pour une date. La colonne heritee du lot 3 reste donc vide. ADR 0021.
    const preuve = await prisma.paymentProof.findFirst({ where: { orderId: j.orderId } });
    expect(preuve?.countersignedAt).toBeNull();

    const recu = (await (await app().request(`/api/recu/${j.code}`)).json()) as {
      recu: { contresigneA: string };
    };
    expect(new Date(recu.recu.contresigneA)).toEqual(NOW);
  });

  it("NI la reference NI le code de verification n'ouvrent la contre-signature", async () => {
    // C'est tout l'enjeu : le code est public des qu'un recu est montre, et la
    // reference se devine. Si l'un des deux autorisait, il suffirait d'avoir vu
    // un recu pour valider le paiement de quelqu'un d'autre.
    const j = await creer(ids.suivant());
    for (const cle of [j.ref, j.code, j.code.replace("-", "")]) {
      const r = await app().request(`/api/suivi/${encodeURIComponent(cle)}/contresigner`, {
        method: "POST",
      });
      expect(r.status, cle).toBe(404);
    }
    const commande = await prisma.order.findFirst({ where: { id: j.orderId } });
    expect(commande?.proofState).toBe("prouve");
  });

  it("une contestation NE SUPPRIME PAS la preuve", async () => {
    const j = await creer(ids.suivant());
    const r = await app().request(`/api/suivi/${j.jeton}/contester`, {
      method: "POST",
      body: JSON.stringify({ motif: "Je n'ai jamais recu l'article" }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ etat: "conteste" });

    // La piece est toujours la, entiere.
    const preuve = await prisma.paymentProof.findFirst({ where: { orderId: j.orderId } });
    expect(preuve).toBeTruthy();
    expect(preuve?.operatorTxId).toBeTruthy();

    // Mais le recu ne s'affiche plus.
    const recu = await app().request(`/api/recu/${j.code}`);
    expect(recu.status).toBe(404);
    expect(await recu.json()).toEqual({ refus: "conteste", etat: "conteste" });
  });

  it("le motif de contestation est journalise, sans le SMS", async () => {
    const j = await creer(ids.suivant());
    await app().request(`/api/suivi/${j.jeton}/contester`, {
      method: "POST",
      body: JSON.stringify({ motif: "Article jamais recu" }),
      headers: { "content-type": "application/json" },
    });
    const evenements = await prisma.orderEvent.findMany({ where: { orderId: j.orderId } });
    expect(evenements).toHaveLength(1);
    expect(JSON.stringify(evenements[0]?.payload)).toContain("Article jamais recu");
    expect(JSON.stringify(evenements[0]?.payload)).not.toContain("chiffre-de-test");
  });

  it("une contre-signature REFUSEE laisse quand meme une trace", async () => {
    // Le contrat de la machine du lot 7 : une transition ignoree sans trace est
    // une anomalie invisible.
    const j = await creer(ids.suivant(), { proofState: "attendu", avecPreuve: false });
    const r = await app().request(`/api/suivi/${j.jeton}/contresigner`, { method: "POST" });
    expect(r.status).toBe(409);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      refuse: "contresignature_sans_preuve",
      etat: "attendu",
    });
    const evenements = await prisma.orderEvent.findMany({ where: { orderId: j.orderId } });
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.kind).toBe("preuve_refusee");
  });

  it("un jeton inconnu ou mal forme repond pareil", async () => {
    for (const mauvais of ["court", "Z".repeat(32), "../../etc/passwd"]) {
      const r = await app().request(`/api/suivi/${encodeURIComponent(mauvais)}`);
      expect(r.status, mauvais).toBe(404);
    }
  });
});

describe("normaliserCode", () => {
  it("met en forme XXXX-XXXX", () => {
    expect(normaliserCode("acde4679")).toBe("ACDE-4679");
    expect(normaliserCode(" ACDE 4679 ")).toBe("ACDE-4679");
  });

  it("refuse ce qui sort de l'alphabet non ambigu", () => {
    // B, I, L, O, S et Z n'en font pas partie : ils se confondent a l'oral.
    expect(normaliserCode("IIII-OOOO")).toBeNull();
    expect(normaliserCode("ACDE-467")).toBeNull();
  });
});

/**
 * Le depot d'avis (lot 12).
 *
 * Deux criteres de la definition de terminé s'y jouent, et aucun ne peut se
 * verifier sans base :
 *
 * 1. un paiement NON TRACE produit un avis NON verifie, qui ne modifie pas la
 *    note — la note ne compte que les avis verifies ;
 * 2. un DEUXIEME avis sur la meme commande est rejete, par la contrainte
 *    `UNIQUE(order_id)` et non par un `if`.
 */
describeDb("depot d'un avis", () => {
  /** `creer` produit une commande a l'etape `recue` : on la livre ici. */
  async function livree(suffixe: number, proofState: string, etape = "livree") {
    const jeu = await creer(suffixe, { proofState, avecPreuve: proofState === "prouve" });
    await prisma.order.update({
      where: { id: jeu.orderId },
      data: { step: etape as never },
    });
    const o = await prisma.order.findUnique({
      where: { id: jeu.orderId },
      select: { sellerId: true },
    });
    return { ...jeu, sellerId: o?.sellerId as string };
  }

  const deposer = (jeton: string, note: unknown, texte?: string) =>
    app().fetch(
      new Request(`http://x/api/suivi/${jeton}/avis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(texte === undefined ? { note } : { note, texte }),
      }),
    );

  it("refuse une note hors echelle plutot que de la ramener au bord", async () => {
    const v = await livree(ids.suivant(), "prouve");
    for (const note of [0, 6, 4.5, "5"]) {
      expect((await deposer(v.jeton, note)).status).toBe(400);
    }
  });

  it("une commande non livree n'ouvre pas le depot", async () => {
    const v = await livree(ids.suivant(), "prouve", "preparee");
    expect((await deposer(v.jeton, 5)).status).toBe(409);
  });

  it("une commande livree et prouvee produit un avis VERIFIE", async () => {
    const v = await livree(ids.suivant(), "prouve");
    const r = await deposer(v.jeton, 5, "Tres bonne vendeuse");
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ depose: true, verifie: true });

    const avis = await prisma.review.findUnique({ where: { orderId: v.orderId } });
    expect(avis?.verified).toBe(true);
    expect(avis?.rating).toBe(5);
  });

  /** LE critere : non trace → avis publie, mais NON verifie. */
  it("un paiement declare a la main produit un avis NON verifie", async () => {
    const v = await livree(ids.suivant(), "declare_non_trace");
    const r = await deposer(v.jeton, 5);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ depose: true, verifie: false });
    const avis = await prisma.review.findUnique({ where: { orderId: v.orderId } });
    expect(avis?.verified).toBe(false);
  });

  /** Et il n'entre PAS dans la note : c'est ce que lit l'instantane public. */
  it("un avis non verifie n'entre PAS dans la note de la boutique", async () => {
    const v = await livree(ids.suivant(), "declare_non_trace");
    await deposer(v.jeton, 1);
    const comptees = await prisma.review.count({
      where: { sellerId: v.sellerId, verified: true },
    });
    expect(comptees).toBe(0);
  });

  it("un DEUXIEME avis sur la meme commande est rejete", async () => {
    const v = await livree(ids.suivant(), "prouve");
    expect((await deposer(v.jeton, 5)).status).toBe(201);
    const second = await deposer(v.jeton, 1);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ erreur: "avis_deja_depose" });

    // La premiere note est intacte : le second envoi n'a rien ecrase.
    const avis = await prisma.review.findUnique({ where: { orderId: v.orderId } });
    expect(avis?.rating).toBe(5);
  });

  it("un jeton inconnu ne dit RIEN de la commande", async () => {
    const r = await deposer("jeton-qui-nexiste-pas-du-tout-1234567890", 5);
    expect(r.status).toBe(404);
  });
});
