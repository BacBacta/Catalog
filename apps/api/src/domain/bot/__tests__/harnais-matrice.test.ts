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
  it("C-01 · les mots du mode d'emploi ne deviennent JAMAIS un nom d'article (non-retour)", () => {
    const p = new Pilote({
      estVendeuse: true,
      vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
    });
    /* À froid : la garde du service protège — la question part, rien n'est lu
       comme un nom. (La première version de ce test affirmait l'inverse : le
       harnais était infidèle à bot.ts:614-637 — faux constat D6, réfuté par
       la vérification adverse.) */
    const froid = p.jouer({ genre: "texte", texte: "ajouter" });
    expect(p.etatVendeuse()?.nom).toBe("article_nom");
    expect(JSON.stringify(froid.messages)).toContain("nom de l'article");
    /* DANS le formulaire : avant le correctif, « vendu » (annoncé par le mode
       d'emploi) devenait le nom de l'article — famille ADR 0048 « Hi ».
       Désormais le mot est NOMMÉ comme commande et la question se repose. */
    const dedans = p.jouer({ genre: "texte", texte: "vendu" });
    expect(p.etatVendeuse()?.nom).toBe("article_nom");
    expect(JSON.stringify(dedans.messages)).toContain("mot du menu");
    expect(JSON.stringify(dedans.messages)).toContain("nom de l'article");
    /* Un vrai nom, lui, passe toujours. */
    p.jouer({ genre: "texte", texte: "Pagne wax" });
    expect(p.etatVendeuse()).toMatchObject({ nom: "article_prix", nomArticle: "Pagne wax" });
  });

  it("C-02 · dans avis_mot, « menu » et « annuler » ne deviennent PAS le commentaire (non-retour D7)", () => {
    /* Avant le correctif D7, reagirApresAchat courait avant motCleGlobal et
       « menu » partait en commentaire d'avis, irréversiblement — alors que le
       commentaire du code affirmait l'inverse. Ce test est le non-retour. */
    for (const mot of ["menu", "annuler", "aide"]) {
      const p = amenerAcheteuse("avis_mot");
      const pas = p.jouer({ genre: "texte", texte: mot });
      expect(pas.effet, `« ${mot} » ne doit pas compléter l'avis`).toBeUndefined();
      expect(pas.messages.length).toBeGreaterThan(0);
    }
    /* Un vrai mot d'avis, lui, complète toujours. */
    const p = amenerAcheteuse("avis_mot");
    expect(p.jouer({ genre: "texte", texte: "Sac solide, livraison rapide" }).effet).toMatchObject({
      type: "completer_avis",
    });
  });

  it("C-03 · sous arbitrage (enPause), « menu » re-pose la question — DÉCIDÉ (ADR 0052)", () => {
    const p = amenerInscription("article_prix");
    p.jouer({ genre: "texte", texte: "boutique chez-amina" });
    expect(p.etatVendeuse()).toMatchObject({
      nom: "article_prix",
      enPause: { slug: "chez-amina" },
    });
    const pas = p.jouer({ genre: "texte", texte: "menu" });
    /* Requalifié par la vérification adverse : « En pause, tout autre message
       re-pose la question. annuler sort, comme partout » est acté MOT POUR
       MOT par l'ADR 0052 — postérieur et plus spécifique que la promesse
       générale de l'ADR 0051. Ce test épingle la tension sans la trancher ;
       le seul manque dicible est la copie de l'arbitrage, qui n'annonce pas
       « annuler ». */
    expect(p.etatVendeuse()).toMatchObject({ enPause: { slug: "chez-amina" } });
    expect(pas.messages.length).toBeGreaterThan(0);
  });

  it("C-04 · au comptoir, « corriger » au récap GARDE les quatre faits (non-retour)", () => {
    const p = amenerInscription("comptoir");
    p.jouer({ genre: "texte", texte: "Robe wax négociée" });
    p.jouer({ genre: "texte", texte: "12000" });
    p.jouer({ genre: "texte", texte: "690112233" });
    p.jouer({ genre: "texte", texte: "Marché Sandaga, entrée B" });
    p.jouer({ genre: "texte", texte: "corriger" });
    /* Avant le correctif : retour à COMPTOIR_DEPART — article, prix, cliente,
       remise, tout était à retaper (défaut corrigé côté acheteuse par
       l'ADR 0053, subsistant ici). Les quatre faits VOYAGENT désormais. */
    expect(p.etatVendeuse()).toMatchObject({
      nom: "comptoir",
      comptoir: { pas: "choix", article: "Robe wax négociée", prixXaf: 12000 },
    });
    /* On corrige LE prix, le reste ne se retape pas, et le récap se re-montre. */
    p.jouer({ genre: "texte", texte: "prix" });
    const recap = p.jouer({ genre: "texte", texte: "11000" });
    expect(p.etatVendeuse()).toMatchObject({
      nom: "comptoir",
      comptoir: {
        pas: "recap",
        article: "Robe wax négociée",
        prixXaf: 11000,
        remise: "Marché Sandaga, entrée B",
      },
    });
    expect(JSON.stringify(recap.messages)).toContain("Récapitulatif");
  });

  it("C-05 · stock tombé à zéro APRÈS l'entrée en quantité : dit et rendu au catalogue (non-retour)", () => {
    /* Avant le correctif, la garde n'existait qu'à l'entrée de l'état : tout
       nombre tapé recevait « Écrivez un nombre jusqu'à 0 » en boucle. */
    const f = fixtures();
    const p = amenerAcheteuse("quantite", f);
    const article = f.boutiques?.["chez-bintou"]?.articles.find((a) => a.id === "a-sac-000001");
    if (article) article.stock = 0;
    const pas = p.jouer({ genre: "texte", texte: "1" });
    expect(JSON.stringify(pas.messages)).not.toContain("jusqu");
    expect(p.etatConv().nom).toBe("catalogue");
  });

  it("C-06 · un SMS TRONQUÉ dans le fil vendeuse reçoit une explication (non-retour)", () => {
    /* Avant le correctif : smsReconnu faux → carte générique qui invitait… à
       coller un SMS, sans dire que celui-ci n'a pas été reconnu. La route
       HTTP expliquait déjà (422 + contrôle 1) ; le fil dit la même chose. */
    const p = new Pilote({
      estVendeuse: true,
      vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
    });
    const pas = p.jouer({ genre: "texte", texte: "You have received 650 FCFA of" });
    expect(pas.effet).toBeUndefined();
    expect(JSON.stringify(pas.messages)).toMatch(/n'a pas été reconnu/);
    expect(JSON.stringify(pas.messages)).toContain("ENTIER");
    /* Et le texte collé n'est jamais recopié dans la réponse. */
    expect(JSON.stringify(pas.messages)).not.toContain("650 FCFA");
  });

  it("C-07 · une réponse de Flow livraison HORS de l'état ville se DIT, ou se LIT (non-retour)", () => {
    /* Hors des états qui la lisent : elle se DIT au lieu de tomber sur
       l'accueil sans un mot — et l'état ne bouge pas. */
    const p = amenerAcheteuse("catalogue");
    const pas = p.jouer({ genre: "flux", reponse: FLUX_LIVRAISON_OK });
    expect(pas.effet).toBeUndefined();
    expect(JSON.stringify(pas.messages)).toMatch(/formulaire/i);
    expect(p.etatConv().nom).toBe("catalogue");
    /* Dans `details` — elle a tapé la ville PENDANT que le formulaire était
       ouvert — la réponse porte les quatre champs : elle se LIT et va droit
       au récapitulatif, comme depuis `ville` (ADR 0055). */
    const q = amenerAcheteuse("details");
    const recap = q.jouer({ genre: "flux", reponse: FLUX_LIVRAISON_OK });
    expect(q.etatConv().nom).toBe("recap");
    expect(JSON.stringify(recap.messages)).toContain("Bonapriso");
  });

  it("C-08 · l'instantané des pièges reste lisible en diff", async () => {
    const p = amenerAcheteuse("avis_mot");
    p.jouer({ genre: "texte", texte: "menu" }, { etiquette: "C-02 · « menu » dans avis_mot" });
    await expect(instantane(p)).toMatchFileSnapshot("__instantanes__/piege-avis-mot.txt");
  });
});
