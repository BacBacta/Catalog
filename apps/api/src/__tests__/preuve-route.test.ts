import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChiffreurAesGcm, ChiffreurInerte } from "../adapters/sms-chiffre.ts";
import { preuveRoutes } from "../routes/preuve.ts";
import { MTN_RECEPTION, ORANGE_RECEPTION_RECONSTITUE, TEXTE_LIBRE } from "./fixtures-sms.ts";

/**
 * La soumission de preuve, contre une VRAIE base.
 *
 * Deux criteres de la definition de terminé du lot 8 se jouent ici, et aucun ne
 * peut se verifier sans base :
 *
 * 1. **le meme identifiant soumis par DEUX VENDEUSES DIFFERENTES est refuse.**
 *    Le controle n° 5 est reseau-large : c'est la contrainte
 *    `UNIQUE(operator, operator_tx_id)` qui tranche, a l'INSERT, jamais un SELECT
 *    suivi d'un `if` ;
 * 2. **le SMS brut n'apparait dans aucun log** — ni en base en clair, ni dans une
 *    reponse, ni dans une trace.
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
const RUN = 146 * 1000 + (Date.now() % 1000);

/** L'horloge est figee : les fixtures portent des dates de juin 2026. */
const NOW = new Date("2026-06-23T10:00:00+01:00");
const CREEE = new Date("2026-06-23T09:00:00+01:00");

const chiffreur = new ChiffreurInerte({ NODE_ENV: "test" });

/**
 * Identifiant d'operateur UNIQUE par execution.
 *
 * `payment_proof` porte la contrainte `UNIQUE(operator, operator_tx_id)` et n'est
 * jamais purgee — c'est tout l'objet du controle n° 5. Reutiliser l'identifiant
 * de la fixture ferait echouer la deuxieme execution de la suite pour la bonne
 * raison, au mauvais endroit.
 */
const TX = `176${RUN.toString().padStart(8, "0")}`;

/**
 * Compte les preuves DE CETTE COMMANDE, jamais de toute la table.
 *
 * Un `count()` global est une course entre fichiers de test : Vitest les execute
 * en parallele contre la MEME base, et une preuve ecrite par un autre fichier
 * entre la mesure et l'assertion fait echouer celle-ci pour une raison etrangere
 * a ce qu'elle verifie. Ce que le test veut dire est « rien n'a ete ecrit POUR
 * CETTE COMMANDE » — c'est desormais ce qu'il mesure.
 */
const comptePour = (v: Vendeuse) => prisma.paymentProof.count({ where: { orderId: v.orderId } });
const MTN_UNIQUE = MTN_RECEPTION.replace("17600000002", TX);

interface Vendeuse {
  userId: string;
  sellerId: string;
  orderId: string;
  app: ReturnType<typeof preuveRoutes>;
}

/** Code de verification valide au sens de la contrainte de base. */
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

async function creerVendeuse(suffixe: number, totalXaf: number): Promise<Vendeuse> {
  const n = (base: string) => `+237${base}${suffixe.toString().padStart(7, "0").slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Preuve ${suffixe}`,
      email: `preuve-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n("67"),
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique preuve ${suffixe}`,
      slug: `boutique-preuve-${suffixe}`,
      city: "Douala",
      payoutPhone: n("69"),
      payoutPhoneVerifiedAt: CREEE,
    },
  });
  const o = await prisma.order.create({
    data: {
      ref: `CT-${(700000 + suffixe) % 99999999}`,
      sellerId: v.id,
      // Le numero de l'acheteuse est celui du SMS de reception MTN.
      buyerPhone: "+237652000001",
      items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: totalXaf }],
      totalXaf,
      amountPaidXaf: 0,
      balanceXaf: totalXaf,
      payMode: "integral",
      delivery: { mode: "retrait", pickupPoint: "Carrefour Elf", phone: "+237652000001" },
      /**
       * Le code suit l'alphabet non ambigu et la forme XXXX-XXXX, imposes par la
       * contrainte `order_verification_code_shape`. On l'engendre depuis
       * `CODE_ALPHABET` plutot que d'ecrire des lettres au hasard : un `B` ou un
       * `0` feraient echouer l'insertion pour une raison sans rapport avec ce
       * qu'on teste.
       */
      verificationCode: codeDeTest(suffixe),
      createdAt: CREEE,
      expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
    },
  });
  return {
    userId: u.id,
    sellerId: v.id,
    orderId: o.id,
    app: preuveRoutes({
      prisma,
      chiffreur,
      maintenant: () => NOW,
      session: { prisma, session: async () => ({ user: { id: u.id, phoneNumber: null } }) },
    }),
  };
}

let une: Vendeuse;
let autre: Vendeuse;

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  une = await creerVendeuse(RUN, 26800);
  autre = await creerVendeuse((RUN + 4321) % 900000, 26800);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const coller = (v: Vendeuse, sms: string, orderId = v.orderId) =>
  v.app.fetch(
    new Request(`http://x/${orderId}/preuve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sms }),
    }),
  );

describeDb("soumission d'une preuve", () => {
  it("accepte un SMS de reception MTN conforme", async () => {
    const r = await coller(une, MTN_UNIQUE);
    expect(r.status).toBe(200);
    const corps = (await r.json()) as {
      verdict: string;
      checks: Array<{ n: number; state: string }>;
      resume: { operatorTxId: string; montantXaf: number };
    };
    expect(corps.verdict).toBe("accepte");
    expect(corps.resume.operatorTxId).toBe(TX);
    expect(corps.resume.montantXaf).toBe(26800);
    // Le controle 5 a ete tranche par la base : il n'est plus « pending ».
    expect(corps.checks.find((c) => c.n === 5)?.state).toBe("pass");
  });

  it("le SMS est stocke CHIFFRE, et le solde n'apparait pas en clair", async () => {
    const p = await prisma.paymentProof.findFirst({
      where: { orderId: une.orderId },
      select: { rawSms: true, patternId: true, patternAConfirmer: true },
    });
    expect(p?.patternId).toBe("mtn.entrant");
    expect(p?.patternAConfirmer).toBe(false);
    // « Votre nouveau solde est de 29398 FCFA » ne doit pas etre lisible.
    expect(p?.rawSms).not.toContain("29398");
    expect(p?.rawSms).not.toContain("Vous avez recu");
    // Et il se relit.
    expect(chiffreur.dechiffrer(p?.rawSms as string)).toBe(MTN_UNIQUE);
  });

  it("aucune colonne de SOLDE n'existe sur la preuve", async () => {
    // Le lot 3 ne lui en donne aucune, deliberement. Un test le verifie parce
    // que c'est le genre de colonne qu'on ajoute « pour le diagnostic ».
    const colonnes = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_proof'`,
    );
    const noms = colonnes.map((c) => c.column_name).join(" ");
    expect(noms).not.toMatch(/solde|balance/i);
  });
});

describeDb("controle n° 5 — l'unicite est RESEAU-LARGE", () => {
  it("le MEME identifiant soumis par une AUTRE vendeuse est refuse", async () => {
    // C'est le critere central du lot. La premiere vendeuse a deja pris cet
    // identifiant ; la seconde colle exactement le meme SMS.
    const r = await coller(autre, MTN_UNIQUE);
    expect(r.status).toBe(409);
    const corps = (await r.json()) as {
      verdict: string;
      checks: Array<{ n: number; state: string; explanation: string }>;
    };
    expect(corps.verdict).toBe("refuse");
    const cinq = corps.checks.find((c) => c.n === 5);
    expect(cinq?.state).toBe("fail");
    expect(cinq?.explanation).toMatch(/déjà servi/i);
  });

  it("c'est la CONTRAINTE qui a refuse, pas un SELECT — une seule ligne existe", async () => {
    // Deux vendeuses qui collent a la meme seconde passeraient toutes les deux
    // un SELECT. La preuve que la contrainte a tranche : il n'y a qu'une ligne.
    const lignes = await prisma.paymentProof.count({
      where: { operator: "mtn", operatorTxId: TX },
    });
    expect(lignes).toBe(1);
  });

  it("la contrainte porte bien sur (operator, operator_tx_id)", async () => {
    const idx = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'payment_proof'`,
    );
    const def = idx.map((i) => i.indexdef).join(" ");
    expect(def).toMatch(/UNIQUE.*operator.*operator_tx_id/is);
  });
});

describeDb("ce qui est refuse SANS rien ecrire", () => {
  it("un texte libre est refuse, et n'ecrit aucune ligne", async () => {
    const avant = await comptePour(autre);
    const r = await coller(autre, TEXTE_LIBRE);
    expect(r.status).toBe(422);
    const corps = (await r.json()) as { checks: Array<{ n: number; state: string }> };
    expect(corps.checks[0]).toMatchObject({ n: 1, state: "fail" });
    expect(await comptePour(autre)).toBe(avant);
  });

  it("un montant qui ne correspond pas n'ecrit rien — l'identifiant reste libre", async () => {
    // Reserver un identifiant pour une preuve refusee empecherait la vraie
    // preuve de passer plus tard.
    const avant = await comptePour(autre);
    const r = await coller(autre, ORANGE_RECEPTION_RECONSTITUE);
    expect(r.status).toBe(422);
    expect(await comptePour(autre)).toBe(avant);
    expect(
      await prisma.paymentProof.count({
        where: { orderId: autre.orderId, operatorTxId: "MP260623.1403.C73941" },
      }),
    ).toBe(0);
  });

  it("une commande d'une AUTRE vendeuse est introuvable, pas interdite", async () => {
    const r = await coller(autre, MTN_RECEPTION, une.orderId);
    // 404 et non 403 : un 403 apprendrait que l'identifiant de commande est valide.
    expect(r.status).toBe(404);
  });

  it("sans session, tout est refuse en 401", async () => {
    const nu = preuveRoutes({
      prisma,
      chiffreur,
      session: { prisma, session: async () => null },
    });
    const r = await nu.fetch(
      new Request(`http://x/${une.orderId}/preuve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sms: MTN_RECEPTION }),
      }),
    );
    expect(r.status).toBe(401);
  });
});

describeDb("le SMS brut ne fuit nulle part", () => {
  it("n'apparait dans AUCUN log pendant tout le parcours", async () => {
    // Le SMS porte le solde du compte de la vendeuse. Il ne doit apparaitre ni
    // dans un log, ni dans une trace, ni dans un message d'erreur.
    const capture: string[] = [];
    const espions = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        capture.push(args.map((a) => String(a)).join(" "));
      }),
    );

    try {
      const troisieme = await creerVendeuse((RUN + 8765) % 900000, 26800);
      // Un cas accepte, un refuse, un non reconnu : les trois chemins.
      await coller(troisieme, MTN_UNIQUE.replace(TX, `${TX.slice(0, -2)}91`));
      await coller(troisieme, TEXTE_LIBRE);
      await coller(troisieme, MTN_UNIQUE);
    } finally {
      for (const e of espions) e.mockRestore();
    }

    const tout = capture.join("\n");
    // Ni le texte, ni le solde, ni un fragment reconnaissable.
    expect(tout).not.toContain("Vous avez recu");
    expect(tout).not.toContain("29398");
    expect(tout).not.toContain("ALPHA TRADING SARL");
  });

  it("la reponse HTTP ne renvoie jamais le texte ni le solde", async () => {
    const quatrieme = await creerVendeuse((RUN + 13579) % 900000, 26800);
    for (const sms of [MTN_UNIQUE.replace(TX, `${TX.slice(0, -2)}92`), TEXTE_LIBRE]) {
      const corps = await (await coller(quatrieme, sms)).text();
      expect(corps).not.toContain("Vous avez recu");
      expect(corps).not.toContain("29398");
    }
  });
});

describe("le chiffrement au repos", () => {
  const cle = "une-cle-de-test-de-plus-de-32-caracteres";

  it("chiffre puis dechiffre a l'identique", () => {
    const c = new ChiffreurAesGcm(cle);
    const stocke = c.chiffrer(MTN_RECEPTION);
    expect(stocke).not.toContain("29398");
    expect(c.dechiffrer(stocke)).toBe(MTN_RECEPTION);
  });

  it("produit un chiffre DIFFERENT a chaque appel — sel et nonce par message", () => {
    const c = new ChiffreurAesGcm(cle);
    expect(c.chiffrer(MTN_RECEPTION)).not.toBe(c.chiffrer(MTN_RECEPTION));
  });

  it("REFUSE un texte chiffre modifie — GCM authentifie", () => {
    // Sans authentification, un texte modifie se dechiffrerait en donnees
    // quelconques et l'analyse repartirait sur un message fabrique.
    const c = new ChiffreurAesGcm(cle);
    const stocke = c.chiffrer(MTN_RECEPTION);
    const parts = stocke.split(".");
    const altere = [...parts.slice(0, 4), `${(parts[4] as string).slice(0, -4)}AAAA`].join(".");
    expect(() => c.dechiffrer(altere)).toThrow();
  });

  it("REFUSE une cle differente", () => {
    const stocke = new ChiffreurAesGcm(cle).chiffrer(MTN_RECEPTION);
    expect(() => new ChiffreurAesGcm(`${cle}-autre`).dechiffrer(stocke)).toThrow();
  });

  it("refuse de se construire sans cle, ou avec une cle trop courte", () => {
    expect(() => new ChiffreurAesGcm(undefined)).toThrow(/SMS_ENCRYPTION_KEY/);
    expect(() => new ChiffreurAesGcm("court")).toThrow(/32/);
  });

  it("le chiffreur INERTE refuse de se construire en production", () => {
    expect(() => new ChiffreurInerte({ NODE_ENV: "production" })).toThrow(/clair/);
  });

  it("le message d'erreur ne porte rien du contenu", () => {
    const c = new ChiffreurAesGcm(cle);
    try {
      c.dechiffrer("v9.a.b.c.d");
      throw new Error("aurait du lever");
    } catch (e) {
      expect((e as Error).message).not.toContain("a.b.c.d");
    }
  });
});
