/**
 * La matrice exhaustive étape × geste — audit pipeline 2026-08, §4 phase 3.
 *
 * Chaque cellule est EXERCÉE, pas lue : un pilote neuf est amené à l'état,
 * reçoit le geste, et le comportement observé est enregistré. Le tableau de
 * couverture en bas de fichier est CALCULÉ par le harnais (§7) — c'est lui
 * que le rapport cite, jamais une déclaration.
 *
 * Le fichier porte aussi les REPRODUCTIONS des pièges trouvés en exécutant :
 * chacune documente le comportement OBSERVÉ aujourd'hui. Corriger un piège
 * DOIT faire échouer sa reproduction — c'est le signal de mettre à jour le
 * test en test de non-retour.
 */

import { describe, expect, it } from "vitest";
import type { Entree } from "../conversation.ts";
import type { FixturesHarnais } from "./harnais.ts";
import {
  COUVERTURE,
  ETATS_MACHINE,
  GENRES_JOUABLES,
  instantane,
  Pilote,
  tableauCouverture,
} from "./harnais.ts";

const SMS_MTN_RECU =
  "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32. Message de l'expediteur:. Votre nouveau solde est de 29398 FCFA. Frais: 0 XAF. Transaction ID: 17600000002.Prix Cassés chez MoMo pour tout le monde !";

/** Réponse de Flow livraison VALIDE (contrat ADR 0055). */
const FLUX_LIVRAISON_OK = JSON.stringify({
  ville: "Douala",
  quartier: "Bonapriso",
  repere: "En face de la pharmacie du Rail",
  telephone: "652000001",
});

function fixtures(): FixturesHarnais {
  return {
    estVendeuse: false,
    boutiques: {
      "chez-bintou": {
        id: "seller-1",
        slug: "chez-bintou",
        nom: "Chez Bintou",
        ville: "Douala",
        whatsappVendeuse: "237699887712",
        reversementPose: true,
        aDesPhotos: false,
        articles: [
          { id: "a-sac-000001", nom: "Sac tressé", prixXaf: 8500, stock: 2 },
          { id: "a-huile-0003", nom: "Huile de palme 5 L", prixXaf: 4500, stock: null },
        ],
      },
    },
  };
}

/** Amène un pilote acheteuse NEUF jusqu'à l'état voulu, par le chemin nominal. */
function amenerAcheteuse(etat: string, f: FixturesHarnais = fixtures()): Pilote {
  const p = new Pilote(f);
  const chemin: Record<string, Entree[]> = {
    accueil: [],
    catalogue: [{ genre: "texte", texte: "boutique chez-bintou" }],
    quantite: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
    ],
    ajout: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
      { genre: "liste", id: "qte:1" },
    ],
    mode: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
      { genre: "liste", id: "qte:1" },
      { genre: "bouton", id: "commander" },
    ],
    ville: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
      { genre: "liste", id: "qte:1" },
      { genre: "bouton", id: "commander" },
      { genre: "bouton", id: "mode:livraison" },
    ],
    details: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
      { genre: "liste", id: "qte:1" },
      { genre: "bouton", id: "commander" },
      { genre: "bouton", id: "mode:livraison" },
      { genre: "texte", texte: "Douala" },
    ],
    recap: [
      { genre: "texte", texte: "boutique chez-bintou" },
      { genre: "bouton", id: "cmd:a-sac-000001" },
      { genre: "liste", id: "qte:1" },
      { genre: "bouton", id: "commander" },
      { genre: "bouton", id: "mode:livraison" },
      { genre: "texte", texte: "Douala" },
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rail, 652000001" },
    ],
    avis_mot: [{ genre: "liste", id: "note:5" }],
  };
  if (etat === "avis_mot") {
    (f as { derniereCommande?: unknown }).derniereCommande = {
      reference: "CT-104312",
      boutique: "Chez Bintou",
      libelle: "Livrée",
      resteXaf: 0,
      avisPossible: true,
      avisVerifie: true,
    };
  }
  for (const e of chemin[etat] ?? []) p.jouer(e);
  return p;
}

/** Amène un pilote vendeuse (fil inscription) à l'état voulu. */
function amenerInscription(etat: string): Pilote {
  const installee: FixturesHarnais = {
    estVendeuse: true,
    vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
  };
  const prospect: FixturesHarnais = { estVendeuse: false };
  switch (etat) {
    case "inscription_nom": {
      const p = new Pilote(prospect);
      p.jouer({ genre: "texte", texte: "vendre" });
      return p;
    }
    case "inscription_ville": {
      const p = new Pilote(prospect);
      p.jouer({ genre: "texte", texte: "vendre" });
      p.jouer({ genre: "texte", texte: "Chez Bintou" });
      return p;
    }
    case "article_nom": {
      const p = new Pilote(installee);
      p.jouer({ genre: "image", mediaId: "m-1" });
      return p;
    }
    case "article_prix": {
      const p = new Pilote(installee);
      p.jouer({ genre: "image", mediaId: "m-1" });
      p.jouer({ genre: "texte", texte: "Pagne wax 6 yards" });
      return p;
    }
    case "article_photo": {
      const p = new Pilote(installee);
      p.jouer({ genre: "image", mediaId: "m-1" });
      p.jouer({ genre: "texte", texte: "Pagne wax 6 yards" });
      p.jouer({ genre: "texte", texte: "15000" });
      return p;
    }
    case "article_confirme": {
      const p = new Pilote(installee);
      p.jouer({ genre: "image", mediaId: "m-1", legende: "Pagne wax 6 yards 15 000" });
      return p;
    }
    case "comptoir": {
      const p = new Pilote(installee);
      p.jouer({ genre: "texte", texte: "vendu" });
      return p;
    }
    default:
      return new Pilote(installee);
  }
}

/** Les gestes joués sur CHAQUE cellule, l'étiquette d'abord. */
const GESTES: Array<[string, Entree]> = [
  ["texte hors-sujet", { genre: "texte", texte: "bonjour docteur" }],
  ["texte sans accents", { genre: "texte", texte: "ca va" }],
  ["anglais", { genre: "texte", texte: "how much is this" }],
  ["bouton périmé", { genre: "bouton", id: "publier" }],
  ["ligne de liste périmée", { genre: "liste", id: "qte:2" }],
  ["photo sans légende", { genre: "image", mediaId: "m-x" }],
  ["photo légendée", { genre: "image", mediaId: "m-x", legende: "Sac raphia 8 500" }],
  ["vocal", { genre: "autre", forme: "vocal" }],
  ["sticker", { genre: "autre", forme: "sticker" }],
  ["localisation", { genre: "localisation", lat: 4.05, lng: 9.7 }],
  ["réponse de Flow valide", { genre: "flux", reponse: FLUX_LIVRAISON_OK }],
  ["Flow tronqué", { genre: "flux", reponse: "{" }],
  ["mot-clé menu", { genre: "texte", texte: "menu" }],
  ["mot-clé annuler", { genre: "texte", texte: "annuler" }],
];

describe("la matrice étape × geste, exercée cellule par cellule", () => {
  const lignes: string[] = [];

  it("aucune cellule ne fait lever la machine, et chaque cellule est enregistrée", () => {
    for (const etat of ETATS_MACHINE.acheteuse) {
      for (const [nom, geste] of GESTES) {
        const p = amenerAcheteuse(etat);
        const pas = p.jouer(structuredClone(geste), { etiquette: nom });
        const forme =
          pas.messages.length === 0 && !pas.effet
            ? "⚠ MUET"
            : pas.messages.length === 0
              ? "effet seul"
              : pas.messages.some((m) => m.type === "interactive")
                ? "répond (interactif)"
                : "répond (texte nu)";
        lignes.push(
          `acheteuse/${etat} × ${nom} → ${forme}` +
            (pas.effet ? ` · effet ${(pas.effet as { type: string }).type}` : "") +
            (pas.etatApres !== etat ? ` · état→${pas.etatApres}` : ""),
        );
      }
    }
    for (const etat of ETATS_MACHINE.inscription) {
      for (const [nom, geste] of GESTES) {
        const p = amenerInscription(etat);
        const pas = p.jouer(structuredClone(geste), { etiquette: nom });
        const forme =
          pas.messages.length === 0 && !pas.effet
            ? "⚠ MUET"
            : pas.messages.length === 0
              ? "effet seul"
              : "répond";
        lignes.push(
          `inscription/${etat} × ${nom} → ${forme}` +
            (pas.effet ? ` · effet ${(pas.effet as { type: string }).type}` : "") +
            (pas.etatApres !== etat ? ` · état→${pas.etatApres}` : ""),
        );
      }
    }
    /* Le fil vendeuse au repos — une ligne, tous les gestes + les siens. */
    const vendeuseFixtures: FixturesHarnais = {
      estVendeuse: true,
      vendeuse: {
        commandesOuvertes: [{ id: "o-1", reference: "CT-104312", resteXaf: 10750 }],
        soldesXaf: 10750,
        boutique: {
          nom: "Chez Bintou",
          nbArticles: 2,
          lienBoutique: "https://boutique.catalog.cm/chez-bintou",
          lienEspace: null,
        },
      },
    };
    const gestesVendeuse: Array<[string, Entree]> = [
      ...GESTES.filter(([, g]) => g.genre !== "image"),
      ["solde", { genre: "texte", texte: "solde" }],
      ["congés", { genre: "texte", texte: "congés" }],
      ["livrée CT", { genre: "texte", texte: "livrée CT-104312" }],
      ["SMS opérateur", { genre: "texte", texte: SMS_MTN_RECU }],
      ["SMS TRONQUÉ", { genre: "texte", texte: "You have received 650 FCFA of" }],
    ];
    for (const [nom, geste] of gestesVendeuse) {
      const p = new Pilote(vendeuseFixtures);
      const pas = p.jouer(structuredClone(geste), { etiquette: nom });
      const forme = pas.messages.length === 0 && !pas.effet ? "⚠ MUET" : "répond/agit";
      lignes.push(
        `vendeuse/(repos) × ${nom} → ${forme}` +
          (pas.effet ? ` · effet ${(pas.effet as { type: string }).type}` : ""),
      );
    }

    const muettes = lignes.filter((l) => l.includes("⚠ MUET"));
    /* Le domaine ne doit plus rien avoir de muet depuis l'ADR 0049. Toute
       cellule muette est un constat — elle apparaît nommée ici. */
    expect(muettes).toEqual([]);
  });

  it("écrit la matrice observée en instantané lisible", async () => {
    await expect(`${lignes.join("\n")}\n`).toMatchFileSnapshot("__instantanes__/matrice.txt");
  });

  it("la couverture est CALCULÉE, et le parcours principal dépasse 80 %", async () => {
    const tableau = tableauCouverture();
    const rendu = tableau
      .map(
        (l) =>
          `${l.machine} : ${l.exercees}/${l.possibles} (${l.pourcent} %)` +
          (l.manquantes.length ? `\n  non exercées : ${l.manquantes.join(", ")}` : ""),
      )
      .join("\n");
    await expect(`${rendu}\n`).toMatchFileSnapshot("__instantanes__/couverture.txt");
    for (const l of tableau) {
      expect(l.pourcent, `couverture ${l.machine}`).toBeGreaterThanOrEqual(80);
    }
    expect(COUVERTURE.size).toBeGreaterThan(80);
  });
});

describe("les pièges, reproduits en exécution (constats de l'audit)", () => {
  it("C-01 · « ajouter » devient un NOM D'ARTICLE — le mot du mode d'emploi est avalé", () => {
    const p = new Pilote({
      estVendeuse: true,
      vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
    });
    const pas = p.jouer({ genre: "texte", texte: "ajouter" });
    /* COMPORTEMENT OBSERVÉ (défaut, famille ADR 0048 « Hi ») : le mot
       déclencheur entre dans la machine comme réponse à « quel est le nom ? »
       et l'état saute à article_prix avec nomArticle="ajouter". */
    expect(p.etatVendeuse()).toMatchObject({ nom: "article_prix", nomArticle: "ajouter" });
    expect(JSON.stringify(pas.messages)).toContain("son prix");
  });

  it("C-02 · dans avis_mot, « menu » et « annuler » deviennent le COMMENTAIRE de l'avis", () => {
    const p = amenerAcheteuse("avis_mot");
    const pas = p.jouer({ genre: "texte", texte: "menu" });
    /* COMPORTEMENT OBSERVÉ : reagirApresAchat court avant motCleGlobal — le
       commentaire du code (conversation.ts:1189) affirme l'inverse. */
    expect(pas.effet).toMatchObject({ type: "completer_avis", texte: "menu" });
  });

  it("C-03 · sous arbitrage (enPause), « menu » ne libère PAS la pause", () => {
    const p = amenerInscription("article_prix");
    p.jouer({ genre: "texte", texte: "boutique chez-amina" });
    expect(p.etatVendeuse()).toMatchObject({
      nom: "article_prix",
      enPause: { slug: "chez-amina" },
    });
    const pas = p.jouer({ genre: "texte", texte: "menu" });
    /* COMPORTEMENT OBSERVÉ : la question d'arbitrage est re-posée, la pause
       reste — contrairement à la promesse du vocabulaire commun (ADR 0051). */
    expect(p.etatVendeuse()).toMatchObject({ enPause: { slug: "chez-amina" } });
    expect(pas.messages.length).toBeGreaterThan(0);
  });

  it("C-04 · au comptoir, « corriger » au récap PERD les quatre faits", () => {
    const p = amenerInscription("comptoir");
    p.jouer({ genre: "texte", texte: "Robe wax négociée" });
    p.jouer({ genre: "texte", texte: "12000" });
    p.jouer({ genre: "texte", texte: "690112233" });
    p.jouer({ genre: "texte", texte: "Marché Sandaga, entrée B" });
    p.jouer({ genre: "texte", texte: "corriger" });
    /* COMPORTEMENT OBSERVÉ : retour à COMPTOIR_DEPART — article, prix,
       cliente, remise, tout est à retaper (défaut corrigé côté acheteuse par
       l'ADR 0053, subsistant ici). */
    expect(p.etatVendeuse()).toMatchObject({ nom: "comptoir", comptoir: { pas: "article" } });
  });

  it("C-05 · stock tombé à zéro APRÈS l'entrée en quantité : « un nombre jusqu'à 0 »", () => {
    const f = fixtures();
    const p = amenerAcheteuse("quantite", f);
    const article = f.boutiques?.["chez-bintou"]?.articles.find((a) => a.id === "a-sac-000001");
    if (article) article.stock = 0;
    const pas = p.jouer({ genre: "texte", texte: "1" });
    /* COMPORTEMENT OBSERVÉ : la garde n'existe qu'à l'entrée de l'état. */
    expect(JSON.stringify(pas.messages)).toContain("jusqu");
    expect(p.etatConv().nom).toBe("quantite");
  });

  it("C-06 · un SMS TRONQUÉ dans le fil vendeuse ne reçoit AUCUN verdict de preuve", () => {
    const p = new Pilote({
      estVendeuse: true,
      vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
    });
    const pas = p.jouer({ genre: "texte", texte: "You have received 650 FCFA of" });
    /* COMPORTEMENT OBSERVÉ : smsReconnu est faux, le texte retombe dans les
       mots-clés ordinaires — la réponse est la carte générique du fil
       vendeuse, qui invite… à coller un SMS. Rien ne dit que ce qu'elle
       VIENT de coller n'a pas été reconnu, ni qu'il faut le message entier.
       La route HTTP, elle, explique (422 + contrôle 1 en échec). */
    expect(pas.effet).toBeUndefined();
    expect(JSON.stringify(pas.messages)).not.toMatch(/entier|reconnu|contr[ôo]le/);
  });

  it("C-07 · une réponse de Flow livraison HORS de l'état ville est perdue sans un mot", () => {
    const p = amenerAcheteuse("catalogue");
    const pas = p.jouer({ genre: "flux", reponse: FLUX_LIVRAISON_OK });
    /* COMPORTEMENT OBSERVÉ : le switch tombe sur default → accueil de la
       boutique ; la livraison remplie n'est ni utilisée ni mentionnée. */
    expect(pas.effet).toBeUndefined();
    expect(JSON.stringify(pas.messages)).not.toMatch(/livraison|formulaire/i);
  });

  it("C-08 · l'instantané des pièges reste lisible en diff", async () => {
    const p = amenerAcheteuse("avis_mot");
    p.jouer({ genre: "texte", texte: "menu" }, { etiquette: "C-02 · « menu » dans avis_mot" });
    await expect(instantane(p)).toMatchFileSnapshot("__instantanes__/piege-avis-mot.txt");
  });
});
