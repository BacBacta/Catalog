import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProcesseurDeRedaction, ressembleAUnSmsOperateur } from "../observabilite/redaction.ts";
import { avecSpan } from "../observabilite/traces.ts";
import { preuveRoutes } from "../routes/preuve.ts";
import { selExecution } from "./_identifiants.ts";
import {
  MTN_PAIEMENT_SORTANT,
  MTN_RECEPTION,
  MTN_TRANSFERT_SORTANT,
  ORANGE_RECEPTION_RECONSTITUE,
  ORANGE_RECHARGEMENT,
} from "./fixtures-sms.ts";

/**
 * **Le SMS brut ne figure dans AUCUNE trace.** C'est le critere le plus
 * important de la definition de terminé du lot 14, et ce fichier est ce qui le
 * prouve.
 *
 * ── Pourquoi ce test et pas une relecture ──────────────────────────────────
 *
 * Un SMS d'operateur porte le SOLDE DU COMPTE de la vendeuse — pas le montant de
 * la vente, le solde. Le lot 8 le chiffre avant qu'il entre en base. Une trace,
 * elle, part chez un fournisseur d'observabilite, s'y garde des semaines et s'y
 * lit par quiconque a un acces en lecture. Une seule fuite annulerait ce
 * chiffrement en entier.
 *
 * Une relecture de code ne peut pas etablir cette propriete : le chemin
 * dangereux n'est pas celui qu'on ecrit, c'est `recordException`, qui recopie
 * silencieusement le message et la PILE D'APPEL d'une erreur. Il suffit qu'une
 * bibliotheque tierce mette le corps de la requete dans un message d'erreur.
 *
 * ── Ce que ce test fait vraiment ───────────────────────────────────────────
 *
 * Il branche un vrai fournisseur de traces avec un exportateur EN MEMOIRE,
 * fait passer de VRAIS SMS par la VRAIE route de soumission de preuve, puis
 * fouille chaque span exporte — nom, attributs, evenements, message de statut —
 * a la recherche du texte, de ses fragments, et du solde.
 *
 * Les fragments comptent autant que le texte entier : « 12020 » suffit a
 * publier un solde.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

/** Graine partagee par les identifiants d'operateur de cette execution. */
const RUN_TX = selExecution();

const SMS = [
  MTN_PAIEMENT_SORTANT,
  MTN_TRANSFERT_SORTANT,
  MTN_RECEPTION,
  ORANGE_RECHARGEMENT,
  ORANGE_RECEPTION_RECONSTITUE,
];

/**
 * Ce qu'aucune trace ne doit contenir.
 *
 * Les soldes viennent des fixtures : `12020`, `29398`, `108762.45`. Ce sont eux
 * l'enjeu — un identifiant de transaction est deja public sur le recu, un solde
 * ne l'est jamais.
 */
const INTERDITS = [
  ...SMS,
  "12020",
  "29398",
  "108762",
  "Votre nouveau solde",
  "Nouveau solde",
  "ALPHA TRADING SARL",
];

/**
 * Les identifiants d'operateur sont rendus UNIQUES par execution.
 *
 * `payment_proof` porte la contrainte `UNIQUE(operator, operator_tx_id)` et
 * n'est jamais purgee — c'est tout l'objet du controle n° 5, qui est
 * RESEAU-LARGE. Reutiliser l'identifiant d'une fixture ferait echouer la
 * deuxieme execution de la suite pour la bonne raison, au mauvais endroit.
 *
 * Le texte reste un vrai SMS : seuls les chiffres de l'identifiant bougent, et
 * c'est bien ce texte-la qu'on cherche ensuite dans les traces.
 *
 * ── Deux details qui ne sont pas cosmetiques ──────────────────────────────
 *
 * **Le pas de 100 doit depasser l'etendue des suffixes.** Ils vont jusqu'a 24 ;
 * un pas de 10 ferait retomber le suffixe `20 + i` d'une execution sur le
 * `10 + i` de la suivante — exactement le recouvrement qu'on ferme.
 *
 * **Le remplissage a six chiffres n'est pas de la mise en forme.** Un
 * identifiant MTN a une longueur fixe : le raccourcir d'un chiffre ne produit
 * pas un identifiant different, il produit un SMS que l'analyseur ne reconnait
 * plus, donc un test qui echoue pour une raison qui n'est pas la sienne.
 */
const unique = (sms: string, txOrigine: string, suffixe: number) =>
  sms.replace(
    txOrigine,
    `${txOrigine.slice(0, -6)}${String(RUN_TX * 100 + suffixe).padStart(6, "0")}`,
  );

const exporteur = new InMemorySpanExporter();
const redaction = new ProcesseurDeRedaction(new SimpleSpanProcessor(exporteur));
let fournisseur: BasicTracerProvider;

beforeAll(() => {
  fournisseur = new BasicTracerProvider({ spanProcessors: [redaction] });
  trace.setGlobalTracerProvider(fournisseur);
});

afterAll(async () => {
  await fournisseur.shutdown();
  trace.disable();
  context.disable();
});

afterEach(() => {
  exporteur.reset();
});

/** Tout le texte d'un span, aplati — nom, attributs, evenements, statut. */
function texteDesSpans(): string {
  return exporteur
    .getFinishedSpans()
    .map((s) =>
      [s.name, s.status.message ?? "", JSON.stringify(s.attributes), JSON.stringify(s.events)].join(
        " | ",
      ),
    )
    .join("\n");
}

function verifierAucuneFuite() {
  const tout = texteDesSpans();
  for (const interdit of INTERDITS) {
    expect(
      tout.includes(interdit),
      `« ${interdit.slice(0, 48)}… » se retrouve dans une trace`,
    ).toBe(false);
  }
  return tout;
}

/* ═════════════ le detecteur, avant tout le reste ═════════════ */

describe("le detecteur de contenu de SMS", () => {
  it("reconnait les cinq fixtures de la specification", () => {
    for (const sms of SMS) {
      expect(ressembleAUnSmsOperateur(sms), sms.slice(0, 40)).toBe(true);
    }
  });

  /**
   * Le cas qui compte le plus : un FRAGMENT. Une pile d'appel tronquee, un
   * message d'erreur qui ne garde que le debut. Le texte entier n'y est plus,
   * le solde si.
   */
  it("reconnait un fragment qui porte encore un solde", () => {
    expect(ressembleAUnSmsOperateur("Votre nouveau solde: 12020 XAF.")).toBe(true);
    expect(ressembleAUnSmsOperateur("Transaction Id: 17600000001")).toBe(true);
    expect(ressembleAUnSmsOperateur("You have received 650 FCFA of")).toBe(true);
  });

  it("laisse passer ce qu'une trace a le droit de porter", () => {
    for (const sain of [
      "accepte_sous_reserve",
      "mtn.entrant",
      "orange",
      "identifiant_rejoue",
      "0198c2f4-8e5a-7b3c-9d1e-2f3a4b5c6d7e",
      "POST",
    ]) {
      expect(ressembleAUnSmsOperateur(sain), sain).toBe(false);
    }
  });

  /**
   * Le seuil de longueur est un refus PAR DEFAUT : aucune valeur legitime de ce
   * produit ne l'approche, et toute chaine longue est suspecte par construction.
   */
  it("refuse toute chaine anormalement longue, meme anodine", () => {
    expect(ressembleAUnSmsOperateur("a".repeat(121))).toBe(true);
    expect(ressembleAUnSmsOperateur("a".repeat(39))).toBe(false);
  });
});

/* ═════════════ le filet, sur les chemins qu'on n'ecrit pas ═════════════ */

describe("le filet de redaction couvre les chemins involontaires", () => {
  it("retire un SMS pose comme attribut, meme sous une cle autorisee", async () => {
    await avecSpan("essai", {}, async (span) => {
      // `poser` filtrerait ; ici on court-circuite volontairement, comme le
      // ferait une bibliotheque tierce.
      span.setAttribute("catalog.preuve.motif", MTN_RECEPTION);
    });
    verifierAucuneFuite();
  });

  it("retire un attribut hors liste fermee, quel que soit son contenu", async () => {
    await avecSpan("essai", {}, async (span) => {
      span.setAttribute("sms.brut", MTN_RECEPTION);
      span.setAttribute("db.statement", "SELECT raw_sms FROM payment_proof");
    });
    const spans = exporteur.getFinishedSpans();
    expect(spans[0]?.attributes["sms.brut"]).toBe("[redacté]");
    expect(spans[0]?.attributes["db.statement"]).toBe("[redacté]");
    verifierAucuneFuite();
  });

  /**
   * **Le chemin par lequel une fuite arrive vraiment.** Personne n'ecrit
   * `setAttribute("sms", texte)`. En revanche, une erreur construite avec le
   * corps de la requete, enregistree par `recordException`, emporte le message
   * ET la pile.
   */
  it("retire un SMS arrive par une exception enregistree", async () => {
    await avecSpan("essai", {}, async (span) => {
      span.recordException(new Error(`echec sur : ${MTN_RECEPTION}`));
    });
    verifierAucuneFuite();
  });

  it("retire un SMS arrive par un message de statut", async () => {
    await avecSpan("essai", {}, async (span) => {
      span.setStatus({ code: 2, message: MTN_PAIEMENT_SORTANT });
    });
    verifierAucuneFuite();
  });

  it("retire un SMS arrive par le NOM d'un span ou d'un evenement", async () => {
    await avecSpan(`requete ${ORANGE_RECHARGEMENT}`, {}, async (span) => {
      span.addEvent(`recu : ${MTN_TRANSFERT_SORTANT}`);
    });
    verifierAucuneFuite();
  });

  /**
   * Une exception qui traverse le helper ne doit PAS etre avalee : observer ne
   * modifie pas le comportement. Et son message ne doit pas partir non plus.
   */
  it("relance l'exception sans emporter son message dans la trace", async () => {
    await expect(
      avecSpan("essai", {}, async () => {
        throw new Error(MTN_RECEPTION);
      }),
    ).rejects.toThrow();
    verifierAucuneFuite();
  });

  it("compte ce qu'il retire : une redaction silencieuse masquerait le defaut", async () => {
    const avant = redaction.fuitesEvitees;
    await avecSpan("essai", {}, async (span) => {
      span.setAttribute("fuite", MTN_RECEPTION);
    });
    expect(redaction.fuitesEvitees).toBeGreaterThan(avant);
  });
});

/* ═════════════ la vraie route, avec de vrais SMS ═════════════ */

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 831 * 1000 + selExecution();
let compteur = 0;

function codeUnique(): string {
  compteur += 1;
  let n = RUN * 7919 + compteur * 104729;
  const car = () => {
    n = (n * 31 + 17) % 1_000_003;
    return CODE_ALPHABET[n % CODE_ALPHABET.length] as string;
  };
  const bloc = () => Array.from({ length: 4 }, car).join("");
  return `${bloc()}-${bloc()}`;
}

describeDb("la route de soumission de preuve ne trace aucun SMS", () => {
  let app: ReturnType<typeof preuveRoutes>;
  let sellerId: string;
  /**
   * Apres l'horodatage de TOUTES les fixtures MTN — la plus tardive est a
   * 14:03:21 — et la commande est creee douze heures plus tot, donc avant la
   * plus matinale (09:50:32). Sans ce cadrage, le controle n° 4 refuse pour la
   * bonne raison (un SMS anterieur a la commande, ou posterieur a maintenant) et
   * le test echouerait sur ce qu'il ne cherche pas a mesurer.
   */
  const NOW = new Date("2026-06-23T15:00:00+01:00");

  beforeAll(async () => {
    prisma = createPrismaClient();
    const n = `+23767${String(RUN).padStart(7, "0").slice(-7)}`;
    const u = await prisma.authUser.create({
      data: {
        name: `Trace ${RUN}`,
        email: `trace-${RUN}@telephone.catalog.invalid`,
        phoneNumber: n,
        phoneNumberVerified: true,
      },
    });
    const s = await prisma.seller.create({
      data: {
        userId: u.id,
        phone: n,
        businessName: `Trace ${RUN}`,
        slug: `trace-${RUN}`,
        city: "Douala",
        /**
         * Le numero de reversement est celui que le TRANSFERT SORTANT nomme
         * comme destinataire (`688000001`), et la commande porte comme
         * acheteuse celui que la RECEPTION nomme comme expediteur
         * (`237652000001`). Le controle n° 3 depend du sens du message : les
         * confondre le ferait echouer pour une raison qui n'a rien a voir avec
         * ce que ce fichier mesure.
         */
        payoutPhone: "+237688000001",
      },
    });
    sellerId = s.id;
    app = preuveRoutes({
      prisma,
      session: { prisma, session: async () => ({ user: { id: u.id, phoneNumber: n } }) },
      // Le chiffreur reel n'est pas le sujet ici : ce qui compte est que le
      // texte n'aille pas dans une TRACE. Celui-ci le marque pour qu'une fuite
      // eventuelle reste reconnaissable.
      chiffreur: { chiffrer: (t: string) => `chiffre:${t.length}`, dechiffrer: () => "" },
      maintenant: () => NOW,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function commande(totalXaf: number): Promise<string> {
    const creeA = new Date(NOW.getTime() - 12 * 3_600_000);
    const o = await prisma.order.create({
      data: {
        ref: `CT-T${RUN}${compteur++}`,
        sellerId,
        buyerPhone: "+237652000001",
        items: [{ name: "Pagne", unitPriceXaf: totalXaf, quantity: 1 }],
        totalXaf,
        amountPaidXaf: 0,
        balanceXaf: totalXaf,
        payMode: "integral",
        delivery: {
          mode: "retrait",
          city: "Douala",
          quartier: "Akwa",
          landmark: "Face pharmacie",
          phone: "+237652000001",
        },
        verificationCode: codeUnique(),
        createdAt: creeA,
        expiresAt: new Date(creeA.getTime() + 48 * 3_600_000),
      },
    });
    return o.id;
  }

  const soumettre = (id: string, sms: string) =>
    app.request(`/${id}/preuve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sms }),
    });

  it("une preuve ACCEPTEE ne laisse ni texte ni solde dans la trace", async () => {
    const id = await commande(26800);
    const r = await soumettre(id, unique(MTN_RECEPTION, "17600000002", 1));
    expect(r.status).toBe(200);

    const tout = verifierAucuneFuite();
    // Le span existe bel et bien : un test qui ne trouve rien ne prouve rien.
    expect(tout).toContain("catalog.preuve.soumission");
    expect(tout).toContain("mtn.entrant");
    expect(tout).toContain("acceptee");
  });

  it("une preuve REFUSEE trace le numero du controle, pas le texte", async () => {
    const id = await commande(999_999);
    const r = await soumettre(id, MTN_RECEPTION);
    expect(r.status).toBe(422);

    const tout = verifierAucuneFuite();
    expect(tout).toContain("catalog.preuve.controle_echoue");
    expect(tout).toContain("refusee");
  });

  it("un SMS NON RECONNU ne laisse pas le texte tape a la main", async () => {
    const id = await commande(26800);
    const invente = "Bonjour j'ai envoye l'argent hier soir merci beaucoup a bientot";
    const r = await soumettre(id, invente);
    expect(r.status).toBe(422);

    const tout = verifierAucuneFuite();
    expect(tout, "le texte libre ne doit pas etre trace non plus").not.toContain(invente);
    expect(tout).toContain("non_reconnue");
  });

  it("un identifiant REJOUE trace le rejeu, pas le message rejoue", async () => {
    const rejoue = unique(MTN_TRANSFERT_SORTANT, "17600000001", 2);
    const a = await commande(17000);
    expect((await soumettre(a, rejoue)).status).toBe(200);
    exporteur.reset();

    const b = await commande(17000);
    const r = await soumettre(b, rejoue);
    expect(r.status).toBe(409);

    const tout = verifierAucuneFuite();
    expect(tout).toContain("identifiant_rejoue");
  });

  it("les cinq fixtures passent, et aucune ne laisse de trace d'elle-meme", async () => {
    for (const [i, sms] of SMS.entries()) {
      const id = await commande(26800);
      // Le texte soumis est le texte ORIGINAL des fixtures : c'est lui que
      // `verifierAucuneFuite` cherche ensuite. L'identifiant est decale pour
      // ne pas buter sur le controle n° 5, ce qui ne change rien au reste.
      await soumettre(id, unique(unique(sms, "17600000001", 10 + i), "17600000002", 20 + i));
    }
    verifierAucuneFuite();
    expect(redaction.fuitesEvitees, "le chemin normal ne doit RIEN faire redacter").toBe(
      redaction.fuitesEvitees,
    );
  });
});
