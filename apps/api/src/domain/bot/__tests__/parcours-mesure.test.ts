import { afterAll, describe, expect, it } from "vitest";
import type { BoutiqueBot, ContexteAcheteuse } from "../conversation.ts";
import {
  autre,
  b,
  couverture,
  flux,
  fluxTronque,
  type Geste,
  img,
  l,
  loc,
  piloterAcheteuse,
  piloterInscription,
  piloterVendeuse,
  reinitialiserCouverture,
  silence,
  t,
  tAnglais,
  tableauCouverture,
  tFaute,
  transcrire,
  tSansAccents,
} from "./harnais.ts";

/**
 * ── LA MESURE — phase 3 de l'audit du pipeline ────────────────────────────
 *
 * Ce fichier EXECUTE les machines. Il ne les lit pas.
 *
 * Chaque scenario joue une suite de gestes et rend une transcription ; les
 * assertions portent sur ce qui est SORTI, jamais sur ce que le code semble
 * promettre. La couverture se calcule a la fin, et le tableau est le chiffre
 * que le rapport porte — l'audit precedent avait ecrit « couvert » sans
 * compter, et s'etait trompe.
 *
 * Un scenario qui laisse un pas MUET est un defaut, meme si rien ne leve :
 * c'est exactement la forme des trois defauts du banc du 13/08.
 */

/* ── Les genres attendus par etape — le DENOMINATEUR, fixe d'avance ────────
 *
 * C'est ce qui fait la difference entre « on a tout essaye » et « on a
 * essaye ce qui nous arrangeait ». Un genre retire d'ici pour faire monter le
 * pourcentage est une triche visible en diff.
 */
const GESTES_CONVERSATION = [
  "texte",
  "texte-sans-accents",
  "texte-faute",
  "texte-anglais",
  "bouton",
  "liste",
  "image",
  "image-legendee",
  "flux",
  "flux-tronque",
  "localisation",
  "forme-vocal",
  "forme-sticker",
  "forme-document",
  "silence",
] as const;

const ATTENDUS: Record<string, readonly string[]> = {
  "acheteuse/accueil": GESTES_CONVERSATION,
  "acheteuse/catalogue": GESTES_CONVERSATION,
  "vendeuse/installee": GESTES_CONVERSATION,
  "vendeuse/inscription-nom": GESTES_CONVERSATION,
  "vendeuse/article-nom": GESTES_CONVERSATION,
};

/** La rafale complète, sur une étape donnée. Un seul appel, quinze cases. */
function rafale(sujet: string): Geste[] {
  return [
    t(sujet),
    tSansAccents("évidemment"),
    tFaute("boutique"),
    tAnglais("how much is it"),
    b("inconnu"),
    l("inconnu"),
    img("media-1"),
    img("media-2", "Pagne 15000"),
    flux('{"jeton":"x"}'),
    fluxTronque('{"jeton":"x","nom":"Pagne"}'),
    loc(4.05, 9.7),
    autre("vocal"),
    autre("sticker"),
    autre("document"),
    silence(),
  ];
}

const BOUTIQUE: BoutiqueBot = {
  id: "s1",
  slug: "chez-bea",
  nom: "Chez Bea",
  ville: "Douala",
  whatsappVendeuse: "237600000001",
  reversementPose: true,
  articles: [
    { id: "a1", nom: "Pagne wax", prixXaf: 15000, stock: null },
    { id: "a2", nom: "Sac", prixXaf: 8000, stock: 2 },
  ],
};

const CTX: ContexteAcheteuse = { vers: "237600000000", boutique: BOUTIQUE };

describe("le fil acheteuse, exercé", () => {
  it("répond à CHAQUE forme d'entrée à l'accueil — aucun pas muet", () => {
    const p = piloterAcheteuse("accueil, rafale", "acheteuse/accueil", rafale("bonjour"), CTX);
    /* Le silence de la personne ne compte pas : c'est le silence du SYSTEME
       qu'on traque. `aUnPasMuet` ignore les gestes sans entree. */
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
  });

  it("répond à CHAQUE forme d'entrée sur un catalogue ouvert", () => {
    const p = piloterAcheteuse(
      "catalogue, rafale",
      "acheteuse/catalogue",
      rafale("boutique chez-bea"),
      CTX,
    );
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
  });

  it("une boutique inconnue le DIT, au lieu de laisser deviner", () => {
    const p = piloterAcheteuse("slug inconnu", "acheteuse/accueil", [t("boutique nexistepas")], {
      ...CTX,
      boutique: null,
    });
    const dit = p.pas[0]?.messages.join(" ") ?? "";
    expect(dit.length, transcrire(p)).toBeGreaterThan(0);
  });
});

describe("le fil vendeuse installée, exercé", () => {
  it("répond à CHAQUE forme d'entrée — aucun pas muet", () => {
    const p = piloterVendeuse("vendeuse, rafale", "vendeuse/installee", rafale("ma boutique"), {
      boutique: {
        nom: "Chez Bea",
        nbArticles: 2,
        lienBoutique: "https://wa.me/237600?text=boutique%20chez-bea",
        lienEspace: null,
        chaine: null,
      },
    });
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
  });
});

describe("le tunnel d'inscription, exercé", () => {
  it("ne laisse aucun pas muet sur la question du nom de boutique", () => {
    const p = piloterInscription("nom, rafale", "vendeuse/inscription-nom", rafale("Chez Bea"), {
      nom: "inscription_nom",
    });
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
  });

  it("ne laisse aucun pas muet sur la question du nom d'article", () => {
    const p = piloterInscription("article, rafale", "vendeuse/article-nom", rafale("Pagne wax"), {
      nom: "article_nom",
    });
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
  });

  it("« annuler » sort du tunnel, depuis n'importe quelle question", () => {
    for (const depart of [{ nom: "inscription_nom" } as const, { nom: "article_nom" } as const]) {
      const p = piloterInscription(
        `annuler depuis ${depart.nom}`,
        "vendeuse/inscription-nom",
        [t("annuler")],
        depart,
      );
      expect(p.etatFinal, transcrire(p)).toBe("∅");
    }
  });
});

/**
 * ── LES PAS DIFFÉRÉS — trouvés en exécutant, pas en lisant ────────────────
 *
 * Une machine peut ne rien dire ET ne pas être muette : elle DÉLÈGUE au
 * service, par un effet. C'est le cas du geste le plus important du produit —
 * coller un SMS de paiement.
 *
 * Ce n'est pas un défaut en soi. C'est une **dette de vérification** : la
 * réponse existe peut-être, hors de portée du harnais. Un test qui compterait
 * ce cas comme « répond » rendrait la mesure fausse dans le sens le plus
 * dangereux — rassurante.
 */
describe("ce que les machines délèguent", () => {
  it("le SMS de paiement ne produit AUCUN message de la machine", () => {
    const p = piloterVendeuse("sms collé", "vendeuse/installee", [t("SMS de paiement")], {
      smsReconnu: true,
    });
    /* Muet : non. Différé : oui, et c'est ce qu'il faut savoir. */
    expect(p.aUnPasMuet, transcrire(p)).toBe(false);
    expect(p.pasDifferes.join(" "), transcrire(p)).toContain("verifier_sms");
  });

  it("sans identifiant de message, il n'y a même pas d'accusé de lecture", () => {
    /* `reaction()` exige le wamid du message entrant. Absent — et il est
       facultatif dans le type d'entrée —, la vendeuse ne voit RIEN partir
       tant que le service n'a pas répondu. Le fait est mesuré ici pour qu'un
       futur changement de la chaîne d'envoi ne le rende pas silencieux. */
    const p = piloterVendeuse("sms sans wamid", "vendeuse/installee", [t("SMS")], {
      smsReconnu: true,
    });
    expect(p.pas[0]?.messages, transcrire(p)).toEqual([]);
  });
});

/**
 * Le tableau de couverture — §7 du prompt d'audit.
 *
 * Il s'imprime a la fin de l'execution : c'est la sortie que le rapport
 * recopie, et elle est CALCULEE. Le seuil vit dans un test, pas dans une
 * intention : sous 80 %, la suite echoue et le rapport ne peut pas mentir.
 */
describe("la couverture, mesurée", () => {
  it("atteint le seuil de 80 % sur chaque étape du parcours principal", () => {
    const lignes = couverture(ATTENDUS);
    const tableau = tableauCouverture(lignes);
    const sous = lignes.filter((l) => l.pourcent < 80);
    expect(
      sous.map((l) => `${l.etape} ${l.pourcent}%`),
      tableau,
    ).toEqual([]);
  });

  afterAll(() => {
    /* La sortie que le rapport recopie. `console.log` est ici volontaire :
       c'est un instrument de mesure, pas de la journalisation applicative. */
    console.log(`\n${tableauCouverture(couverture(ATTENDUS))}\n`);
    reinitialiserCouverture();
  });
});
