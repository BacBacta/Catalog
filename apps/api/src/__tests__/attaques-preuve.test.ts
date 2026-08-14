import type { CheckResult, Verdict } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChiffreurInerte } from "../adapters/sms-chiffre.ts";
import { RAMPE_DEFAUT } from "../domain/ramp/config.ts";
import { LONGUEUR_JETON } from "../domain/receipt/jeton.ts";
import { preuveRoutes } from "../routes/preuve.ts";
import { recuRoutes, suiviRoutes } from "../routes/recu.ts";
import { describeDb } from "./_base.ts";
import { identifiants, selExecution } from "./_identifiants.ts";
import {
  MTN_PAIEMENT_SORTANT,
  MTN_RECEPTION,
  MTN_TRANSFERT_SORTANT,
  ORANGE_RECEPTION_RECONSTITUE,
  ORANGE_RECHARGEMENT,
} from "./fixtures-sms.ts";

/**
 * **La revue de securite de la preuve, ecrite comme des attaques.**
 *
 * Le lot 15 demande quatre tentatives, et exige que **chacune ait un test qui
 * prouve son echec** :
 *
 * 1. rejouer un identifiant deja reclame ;
 * 2. soumettre un SMS forge, POUR CHAQUE MOTIF ;
 * 3. contresigner sans le lien de suivi ;
 * 4. faire passer un motif `aConfirmer` pour confirme.
 *
 * Ces tests tournent contre une VRAIE base, et il n'y a pas d'alternative : le
 * controle n° 5 est tranche par une contrainte `UNIQUE`, pas par du code, et une
 * simulation de la base testerait la simulation.
 *
 * ── Ce que cette suite etablit, et ce qu'elle ne peut pas etablir ──────────
 *
 * Une precision qui vaut mieux qu'un faux sentiment de securite : **rien ici ne
 * detecte un SMS MTN bien forme dont l'identifiant est invente.** Onze chiffres
 * opaques ne se contredisent pas — c'est pour cela que le controle n° 6 n'existe
 * que chez Orange. Ce qui protege dans ce cas n'est aucun des six controles
 * purs, c'est le n° 7 : la contre-signature de l'acheteuse. Le test
 * « une preuve fabriquee n'atteint jamais la contre-signature toute seule »
 * ci-dessous est donc la piece maitresse de cette suite, pas un complement.
 */

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 446 * 1000 + selExecution();

/** Horloge figee : les fixtures portent des dates de juin 2026. */
const NOW = new Date("2026-06-23T15:00:00+01:00");
const CREEE = new Date("2026-06-23T09:00:00+01:00");

const chiffreur = new ChiffreurInerte({ NODE_ENV: "test" });

/**
 * Identifiants uniques par execution.
 *
 * `payment_proof` n'est JAMAIS purgee — c'est tout l'objet du controle n° 5.
 * Reutiliser l'identifiant d'une fixture ferait echouer la deuxieme execution
 * pour la bonne raison, au mauvais endroit.
 */
/* Le PAS arithmetique — `RUN + compteur * 7` — etait le defaut : il etalait les
   identifiants sur ~273 des 1 000 valeurs de la tranche, si bien que deux
   executions se recouvraient des que l'ecart de leurs sels etait un multiple de
   7. Mesure : ~7 %, et la CI enchaine `test` puis `test:coverage` sur la MEME
   base. Le compteur a maintenant ses propres chiffres — voir `_identifiants.ts`. */
const ids = identifiants("attaques-preuve");
const { txMtn, txOrange } = ids;

/**
 * Un jeton de test, unique par graine et bien forme.
 *
 * Volontairement LISIBLE et non aleatoire : `buyer_token` est UNIQUE en base, et
 * un generateur congruentiel ecrit vite fait produit des collisions en virgule
 * flottante — ce qui fait echouer la creation de la scene, pas le test.
 */
function jetonDeTest(graine: number): string {
  return `t${graine}_`.padEnd(LONGUEUR_JETON, "x").slice(0, LONGUEUR_JETON);
}

interface Scene {
  sellerId: string;
  orderId: string;
  jeton: string;
  code: string;
  ref: string;
  preuve: ReturnType<typeof preuveRoutes>;
}

/** Une vendeuse, une commande, un lien de suivi. */
async function scene(
  suffixe: number,
  options: { totalXaf?: number; payoutPhone?: string; payMode?: "integral" | "acompte" } = {},
): Promise<Scene> {
  const totalXaf = options.totalXaf ?? 26800;
  const n = (base: string) => `+237${base}${suffixe.toString().padStart(7, "0").slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Attaque ${suffixe}`,
      email: `attaque-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n("67"),
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique attaque ${suffixe}`,
      slug: `boutique-attaque-${suffixe}`,
      city: "Douala",
      // Le numero vers lequel part le transfert du SMS d'emission MTN.
      payoutPhone: options.payoutPhone ?? "+237688000001",
      payoutPhoneVerifiedAt: CREEE,
    },
  });
  const code = ids.codeVerification();
  const jeton = jetonDeTest(suffixe);
  const ref = `CT-${(800000 + suffixe) % 99999999}`;
  const o = await prisma.order.create({
    data: {
      ref,
      sellerId: v.id,
      // Le numero de l'expediteur du SMS de reception MTN.
      buyerPhone: "+237652000001",
      buyerToken: jeton,
      items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: totalXaf }],
      totalXaf,
      amountPaidXaf: 0,
      balanceXaf: totalXaf,
      payMode: options.payMode ?? "integral",
      delivery: { mode: "retrait", pickupPoint: "Carrefour Elf", phone: "+237652000001" },
      verificationCode: code,
      createdAt: CREEE,
      expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
    },
  });

  return {
    sellerId: v.id,
    orderId: o.id,
    jeton,
    code,
    ref,
    preuve: preuveRoutes({
      prisma,
      chiffreur,
      maintenant: () => NOW,
      session: { prisma, session: async () => ({ user: { id: u.id, phoneNumber: null } }) },
    }),
  };
}

const poster = (s: Scene, sms: string, orderId = s.orderId) =>
  s.preuve.request(`/${orderId}/preuve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sms }),
  });

type Reponse = { verdict?: Verdict; checks?: CheckResult[]; erreur?: string };

/** Le controle qui a refuse, ou `null` si aucun. */
const controleEnEchec = (corps: Reponse): number | null =>
  corps.checks?.find((x) => x.state === "fail")?.n ?? null;

let graine = 0;
const suivant = () => {
  graine += 1;
  return graine + RUN * 100;
};

describeDb("attaques sur la preuve (lot 15)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /* ═════════════ 1. rejouer un identifiant ═════════════ */

  describe("rejouer un identifiant deja reclame", () => {
    /**
     * Le scenario reel du rejeu chez soi (ADR 0035) : l'acompte est prouve,
     * puis le MEME SMS est recolle pour reclamer le solde — le montant
     * correspond a nouveau (l'acompte de 50 % egale le solde), tous les
     * controles purs passent, et c'est l'INSERT qui tranche : controle n° 5.
     */
    it("chez la MEME vendeuse : refuse par le controle n° 5", async () => {
      const s = await scene(suivant(), { totalXaf: 53600, payMode: "acompte" });
      const sms = MTN_RECEPTION.replace("17600000002", txMtn());

      expect((await poster(s, sms)).status).toBe(200);

      const rejeu = await poster(s, sms);
      expect(rejeu.status).toBe(409);
      const corps = (await rejeu.json()) as Reponse;
      expect(corps.verdict).toBe("refuse");
      expect(controleEnEchec(corps)).toBe(5);
    });

    /**
     * Depuis l'ADR 0035, une preuve acceptee FAIT AVANCER la commande. Le
     * rejeu sur une commande soldee meurt donc des le controle n° 2 : le
     * montant ne correspond plus a rien d'attendu. C'est une defense de plus,
     * pas une de moins — l'unicite reste derriere.
     */
    it("chez la MEME vendeuse, commande soldee : le montant ne correspond plus (controle n° 2)", async () => {
      const s = await scene(suivant());
      const sms = MTN_RECEPTION.replace("17600000002", txMtn());

      expect((await poster(s, sms)).status).toBe(200);

      const rejeu = await poster(s, sms);
      expect(rejeu.status).toBe(422);
      const corps = (await rejeu.json()) as Reponse;
      expect(corps.verdict).toBe("refuse");
      expect(controleEnEchec(corps)).toBe(2);
    });

    /**
     * **La reparation du maillon manquant (ADR 0035), attestee sur la base :**
     * une preuve acceptee ecrit `prouve`, applique le versement et journalise
     * l'entree comptable. C'est ce qui rend le recu emissible — avant cette
     * transaction, la chaine verdict → recu → contre-signature etait morte.
     */
    it("une preuve acceptee applique l'argent et l'etat a la commande", async () => {
      const s = await scene(suivant());
      const sms = MTN_RECEPTION.replace("17600000002", txMtn());

      expect((await poster(s, sms)).status).toBe(200);

      const commande = await prisma.order.findUniqueOrThrow({
        where: { id: s.orderId },
        select: { proofState: true, amountPaidXaf: true, balanceXaf: true },
      });
      expect(commande.proofState).toBe("prouve");
      expect(commande.amountPaidXaf).toBe(26800);
      expect(commande.balanceXaf).toBe(0);

      const comptable = await prisma.ledgerEntry.findFirst({
        where: { orderId: s.orderId, reason: "paiement_prouve" },
        select: { amountXaf: true, direction: true },
      });
      expect(comptable).toMatchObject({ amountXaf: 26800, direction: "entree" });
    });

    /**
     * L'acompte est le paiement que Catalog lui-meme demande : son SMS passe
     * le controle n° 2 (l'attendu est l'ACOMPTE tant que rien n'est arrive),
     * et le solde reste ouvert — exactement ce que le recap a annonce.
     */
    it("le SMS de l'acompte est accepte, le solde reste ouvert", async () => {
      const s = await scene(suivant(), { totalXaf: 53600, payMode: "acompte" });
      const sms = MTN_RECEPTION.replace("17600000002", txMtn());

      expect((await poster(s, sms)).status).toBe(200);

      const commande = await prisma.order.findUniqueOrThrow({
        where: { id: s.orderId },
        select: { proofState: true, amountPaidXaf: true, balanceXaf: true },
      });
      expect(commande.proofState).toBe("prouve");
      expect(commande.amountPaidXaf).toBe(26800);
      expect(commande.balanceXaf).toBe(26800);
    });

    /**
     * **Le controle n° 5 est RESEAU-LARGE, pas commande-large.** Un identifiant
     * d'operateur ne vaut qu'une fois, chez toutes les vendeuses. C'est la
     * contrainte `UNIQUE(operator, operator_tx_id)` qui tranche, et c'est ce que
     * ce test verifie — jamais un SELECT suivi d'un `if`, que deux vendeuses
     * collant a la meme seconde passeraient toutes les deux.
     */
    it("chez une AUTRE vendeuse : refuse aussi", async () => {
      const a = await scene(suivant());
      const b = await scene(suivant());
      const sms = MTN_RECEPTION.replace("17600000002", txMtn());

      expect((await poster(a, sms)).status).toBe(200);
      const chezB = await poster(b, sms);
      expect(chezB.status).toBe(409);
      expect(controleEnEchec((await chezB.json()) as Reponse)).toBe(5);
    });

    /**
     * Le rejeu ne se contourne pas d'une touche majuscule : tout identifiant est
     * mis en capitales avant controle ET avant ecriture. Sans cela,
     * `mp260729…` et `MP260729…` coexisteraient dans une colonne UNIQUE.
     */
    it("ne se contourne pas en changeant la casse de l'identifiant", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      const id = txOrange();
      const sms = ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", id);
      expect((await poster(s, sms)).status).toBe(200);

      const minuscules = ORANGE_RECEPTION_RECONSTITUE.replace(
        "MP260623.1403.C73941",
        id.toLowerCase(),
      );
      const rejeu = await poster(s, minuscules);
      expect(rejeu.status).toBe(409);
      expect(controleEnEchec((await rejeu.json()) as Reponse)).toBe(5);
    });

    /**
     * Une preuve REFUSEE ne reserve pas l'identifiant. C'est deliberé : reserver
     * un identifiant sur un refus empecherait la vraie preuve de passer plus
     * tard, et transformerait un controle en denegation de service contre la
     * vendeuse honnete.
     */
    it("un refus ne consomme pas l'identifiant", async () => {
      const s = await scene(suivant());
      const id = txMtn();
      // Montant qui ne correspond pas : refus par le controle n° 2.
      const faux = MTN_RECEPTION.replace("17600000002", id).replace("26800 XAF", "26000 XAF");
      expect((await poster(s, faux)).status).toBe(422);

      const vrai = MTN_RECEPTION.replace("17600000002", id);
      expect((await poster(s, vrai)).status).toBe(200);
    });
  });

  /* ═════════════ 2. un SMS forge, pour chaque motif ═════════════ */

  /**
   * Une forgerie par motif, et le controle qui l'attrape.
   *
   * Les cinq forgeries ne sont pas des variations arbitraires : chacune est ce
   * qu'un fraudeur tenterait **contre ce motif-la**.
   */
  describe("un SMS forge, motif par motif", () => {
    const forgeries: Array<{
      motif: string;
      quoi: string;
      sms: () => string;
      totalXaf?: number;
      controle: number;
    }> = [
      {
        motif: "mtn.entrant",
        quoi: "le message retape de memoire, sans identifiant de transaction",
        sms: () =>
          "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32.",
        controle: 1,
      },
      {
        motif: "mtn.entrant",
        quoi: "le montant gonfle pour couvrir une commande plus chere",
        sms: () => MTN_RECEPTION.replace("17600000002", txMtn()).replace("26800 XAF", "12000 XAF"),
        controle: 2,
      },
      {
        motif: "mtn.sortant.transfert",
        quoi: "un transfert parti vers un AUTRE numero que le reversement",
        sms: () =>
          MTN_TRANSFERT_SORTANT.replace("17600000001", txMtn()).replace(
            "au 688000001",
            "au 699111222",
          ),
        totalXaf: 17000,
        controle: 3,
      },
      {
        motif: "mtn.sortant.paiement",
        quoi: "un paiement d'hier recycle sur la commande d'aujourd'hui",
        sms: () =>
          MTN_PAIEMENT_SORTANT.replace("17600000001", txMtn()).replace(
            "2026-06-23 14:03:21",
            "2026-06-20 14:03:21",
          ),
        totalXaf: 17000,
        controle: 4,
      },
      {
        motif: "om.entrant",
        quoi: "un identifiant Orange fabrique, dont le mois n'existe pas",
        sms: () =>
          ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", "MP269932.1403.C73941"),
        totalXaf: 17000,
        // L'identifiant porte sa propre date : elle est impossible, donc le n° 4
        // n'a rien a lire et le n° 6 constate la contradiction.
        controle: 4,
      },
    ];

    for (const f of forgeries) {
      it(`${f.motif} — ${f.quoi} → controle n° ${f.controle}`, async () => {
        const s = await scene(suivant(), f.totalXaf === undefined ? {} : { totalXaf: f.totalXaf });
        const r = await poster(s, f.sms());
        expect(r.status).toBe(422);
        const corps = (await r.json()) as Reponse;
        expect(corps.verdict).toBe("refuse");
        expect(controleEnEchec(corps)).toBe(f.controle);
      });
    }

    /**
     * `om.rechargement` n'est pas dans la table ci-dessus, parce que son echec
     * n'est pas un refus : un rechargement de son PROPRE compte ne designe
     * personne, donc il ne prouve aucune vente. Le controle n° 3 le dit en
     * avertissement, et le verdict plafonne. Le presenter comme preuve d'une
     * vente ne produit donc jamais « accepte ».
     */
    it("om.rechargement — un rechargement de son propre compte ne prouve aucune vente", async () => {
      const s = await scene(suivant(), { totalXaf: 650 });
      const sms = ORANGE_RECHARGEMENT.replace(
        "RC241204.1533.B00001",
        `RC241204.1533.B${RUN % 100000}`.padEnd(21, "0").slice(0, 21),
      );
      const r = await poster(s, sms);
      const corps = (await r.json()) as Reponse;
      expect(corps.verdict).not.toBe("accepte");
      expect(corps.checks?.find((x) => x.n === 3)?.state).toBe("warn");
    });

    /**
     * **Le SMS d'emission de l'acheteuse est une CORROBORATION, jamais une
     * preuve** (AGENTS.md §2). Meme parfait — bon montant, bon destinataire,
     * bonne date, identifiant libre — il plafonne a « accepte sous reserve ».
     *
     * Ce test est ne d'un DEFAUT REEL trouve par cette revue : avant le lot 15,
     * ce message produisait « accepte », c'est-a-dire l'interdit « faire passer
     * une commande en prouve sur le seul SMS d'emission de l'acheteuse ». Voir
     * l'ADR 0024.
     */
    it("un SMS d'emission parfait ne depasse pas « accepte sous reserve »", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      const sms = MTN_TRANSFERT_SORTANT.replace("17600000001", txMtn());
      const r = await poster(s, sms);
      expect(r.status).toBe(200);
      const corps = (await r.json()) as Reponse;
      expect(corps.verdict).toBe("accepte_sous_reserve");
      expect(corps.checks?.find((x) => x.n === 7)?.state).toBe("warn");
    });

    it("du texte libre invente n'est reconnu par aucun motif", async () => {
      const s = await scene(suivant());
      const r = await poster(
        s,
        "bonjour tantine jai envoye les 26800 francs ce matin par momo merci",
      );
      expect(r.status).toBe(422);
      const corps = (await r.json()) as Reponse;
      expect(corps.erreur).toBe("aucun_motif");
      // Aucun fragment du texte recu ne revient dans la reponse : elle
      // atterrirait dans le journal du navigateur.
      expect(JSON.stringify(corps)).not.toContain("tantine");
    });

    /**
     * Une capture d'ecran n'est PAS une preuve et ne doit jamais etre acceptee
     * comme telle : elle ne porte aucun identifiant controlable. Ici, le texte
     * qu'on obtiendrait en la retapant.
     */
    it("une capture retapee sans identifiant est refusee", async () => {
      const s = await scene(suivant());
      const r = await poster(
        s,
        "Vous avez recu 26800 XAF de ALPHA TRADING SARL. Solde: 29398 FCFA",
      );
      expect(r.status).toBe(422);
      expect(((await r.json()) as Reponse).verdict).toBe("refuse");
    });

    it("la preuve d'une commande qui n'est pas la sienne est introuvable, pas interdite", async () => {
      const a = await scene(suivant());
      const b = await scene(suivant());
      // 404 et non 403 : un 403 apprendrait qu'un identifiant est valide.
      const r = await poster(a, MTN_RECEPTION.replace("17600000002", txMtn()), b.orderId);
      expect(r.status).toBe(404);
    });
  });

  /* ═════════════ 3. contresigner sans le lien de suivi ═════════════ */

  describe("contresigner sans le lien de suivi", () => {
    /**
     * **Deux cles, deux pouvoirs** (ADR 0021). Le code de verification IDENTIFIE
     * et devient public des qu'un recu est montre ; le jeton AUTORISE. Ouvrir la
     * contre-signature par la reference ou par le code suffirait a valider le
     * paiement d'autrui apres avoir simplement vu un recu.
     */
    let s: Scene;
    let suivi: ReturnType<typeof suiviRoutes>;

    beforeAll(async () => {
      s = await scene(suivant());
      suivi = suiviRoutes({ prisma, rampe: RAMPE_DEFAUT, maintenant: () => NOW });
    });

    const contresigner = (cle: string) => suivi.request(`/${cle}/contresigner`, { method: "POST" });

    it("avec la REFERENCE de commande : lien inconnu", async () => {
      const r = await contresigner(s.ref);
      expect(r.status).toBe(404);
      expect(((await r.json()) as { erreur: string }).erreur).toBe("lien_inconnu");
    });

    it("avec le CODE DE VERIFICATION, qui est public : lien inconnu", async () => {
      expect((await contresigner(s.code)).status).toBe(404);
      expect((await contresigner(s.code.replace("-", ""))).status).toBe(404);
    });

    it("avec l'identifiant interne de la commande : lien inconnu", async () => {
      expect((await contresigner(s.orderId)).status).toBe(404);
    });

    /**
     * Un jeton BIEN FORME mais faux rend exactement la meme reponse qu'un jeton
     * mal forme. Un 403 sur l'un et un 404 sur l'autre apprendraient qu'un jeton
     * existe, ce qui est la moitie du travail d'un attaquant.
     */
    it("avec un jeton bien forme mais faux : meme reponse qu'un jeton mal forme", async () => {
      const faux = jetonDeTest(88_888_888);
      const malForme = await contresigner("pas-un-jeton");
      const bienForme = await contresigner(faux);
      expect(bienForme.status).toBe(malForme.status);
      expect(await bienForme.json()).toEqual(await malForme.json());
    });

    it("avec une tentative d'injection : lien inconnu, sans exception", async () => {
      for (const essai of ["' OR 1=1 --", "../../api/recu", "%00", "a".repeat(500)]) {
        const r = await contresigner(encodeURIComponent(essai));
        expect(r.status).toBe(404);
      }
    });

    it("le vrai jeton, lui, ouvre la contre-signature", async () => {
      // Sans preuve acceptee, la machine refuse la transition — mais avec un
      // 409 « refuse », pas un 404 « lien inconnu ». La distinction est ce qui
      // prouve que le jeton a bien ete reconnu.
      const r = await contresigner(s.jeton);
      expect([200, 409]).toContain(r.status);
      expect(r.status).not.toBe(404);
    });

    /**
     * Le suivi non plus ne s'ouvre pas par le code. Sinon il suffirait de
     * connaitre un recu pour lire le numero de reversement de la vendeuse et le
     * detail de la commande d'une inconnue.
     */
    it("le suivi ne s'ouvre pas non plus par le code de verification", async () => {
      expect((await suivi.request(`/${s.code}`)).status).toBe(404);
      expect((await suivi.request(`/${s.jeton}`)).status).toBe(200);
    });

    /** Et le recu, lui, n'expose jamais le jeton — c'est ce qui le garde secret. */
    it("le recu public ne laisse jamais filtrer le jeton", async () => {
      const recu = recuRoutes({ prisma, rampe: RAMPE_DEFAUT, maintenant: () => NOW });
      const corps = await (await recu.request(`/${s.code}`)).text();
      expect(corps).not.toContain(s.jeton);
    });
  });

  /* ═════════════ 4. promouvoir un motif `aConfirmer` ═════════════ */

  describe("faire passer un motif aConfirmer pour confirme", () => {
    /**
     * Le drapeau `aConfirmer` n'est pas un commentaire : il plafonne le verdict,
     * il est persiste avec la preuve, et il ressort dans le recu. Trois endroits,
     * **meme nom, meme polarite**, jamais inverse.
     */
    it("le verdict plafonne meme quand tout le reste passe", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      const sms = ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", txOrange());
      const r = await poster(s, sms);
      expect(r.status).toBe(200);
      const corps = (await r.json()) as Reponse & { resume?: { aConfirmer?: boolean } };
      expect(corps.checks?.some((x) => x.state === "fail")).toBe(false);
      expect(corps.verdict).toBe("accepte_sous_reserve");
      expect(corps.resume?.aConfirmer).toBe(true);
      expect(corps.checks?.find((x) => x.n === 1)?.state).toBe("warn");
    });

    it("le drapeau est persiste, et pas seulement affiche", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      const id = txOrange();
      await poster(s, ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", id));
      const ligne = await prisma.paymentProof.findFirst({
        where: { operatorTxId: id.toUpperCase() },
        select: { patternAConfirmer: true, patternId: true, verdict: true },
      });
      expect(ligne?.patternAConfirmer).toBe(true);
      expect(ligne?.patternId).toBe("om.entrant");
      expect(ligne?.verdict).toBe("accepte_sous_reserve");
    });

    /**
     * **Aucun champ de la requete ne promeut un motif.** Le drapeau vient du
     * motif, jamais du corps : le poser depuis l'exterieur reviendrait a laisser
     * la vendeuse declarer son propre format verifie.
     */
    it("aucun champ envoye par la vendeuse ne retire le drapeau", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      const id = txOrange();
      const r = await s.preuve.request(`/${s.orderId}/preuve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sms: ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", id),
          aConfirmer: false,
          patternAConfirmer: false,
          verdict: "accepte",
          checks: [],
        }),
      });
      expect(((await r.json()) as Reponse).verdict).toBe("accepte_sous_reserve");
      const ligne = await prisma.paymentProof.findFirst({
        where: { operatorTxId: id.toUpperCase() },
        select: { patternAConfirmer: true, verdict: true },
      });
      expect(ligne?.patternAConfirmer).toBe(true);
      expect(ligne?.verdict).toBe("accepte_sous_reserve");
    });

    /**
     * Le recu public dit la reserve, en toutes lettres. C'est ce qui empeche
     * qu'un format reconstitue soit « promu silencieusement » : la promotion
     * devrait etre visible par l'acheteuse, donc elle ne peut pas etre discrete.
     */
    it("le recu public porte la reserve, en langue simple", async () => {
      const s = await scene(suivant(), { totalXaf: 17000 });
      await poster(s, ORANGE_RECEPTION_RECONSTITUE.replace("MP260623.1403.C73941", txOrange()));
      await prisma.order.update({ where: { id: s.orderId }, data: { proofState: "prouve" } });

      const recu = recuRoutes({ prisma, rampe: RAMPE_DEFAUT, maintenant: () => NOW });
      const corps = (await (await recu.request(`/${s.code}`)).json()) as {
        recu?: { aConfirmer?: boolean };
        portee?: string;
      };
      expect(corps.recu?.aConfirmer).toBe(true);
      expect(corps.portee).toMatch(/n'a pas encore été confronté/);
      // Et jamais un mot qui laisserait croire a une garantie.
      expect(corps.portee).not.toMatch(/garanti|certifié/i);
    });

    /**
     * **La piece maitresse.** Aucun des six controles purs ne detecte un SMS MTN
     * bien forme dont l'identifiant est invente : onze chiffres opaques ne se
     * contredisent pas. Ce qui protege alors est le controle n° 7, et lui seul —
     * une preuve fabriquee reste `prouve`, elle n'atteint jamais `contresigne`
     * sans un geste de l'acheteuse, et le recu affiche la difference.
     */
    it("une preuve fabriquee n'atteint jamais la contre-signature toute seule", async () => {
      const s = await scene(suivant());
      const fabrique = MTN_RECEPTION.replace("17600000002", txMtn());
      const r = await poster(s, fabrique);
      expect(r.status).toBe(200);
      // Elle est acceptee : c'est le constat honnete, pas un echec du test.
      expect(((await r.json()) as Reponse).verdict).toBe("accepte");

      await prisma.order.update({ where: { id: s.orderId }, data: { proofState: "prouve" } });
      const recu = recuRoutes({ prisma, rampe: RAMPE_DEFAUT, maintenant: () => NOW });
      const corps = (await (await recu.request(`/${s.code}`)).json()) as {
        recu?: { etat?: string; contresigneA?: string | null };
        portee?: string;
      };
      expect(corps.recu?.etat).toBe("prouve");
      expect(corps.recu?.contresigneA).toBeNull();
      // Le recu le DIT, plutot que de laisser croire a deux voix.
      expect(corps.portee).toMatch(/ne l'a pas encore confirmé/);
    });
  });
});
