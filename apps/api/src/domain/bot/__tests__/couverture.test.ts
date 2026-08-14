import { describe, expect, it } from "vitest";
import type { BoutiqueBot, ContexteAcheteuse, EtatConv } from "../conversation.ts";
import {
  confirmationCommande,
  ETAT_INITIAL,
  etatApresInactivite,
  lireDetailsLivraison,
  messageVerdict,
  normaliserEtat,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";
import { langueDemandee, PIDGIN_RELU, TEXTES } from "../textes.ts";

/**
 * Le balayage systematique — deux objectifs, distincts des tests de
 * comportement de `conversation.test.ts` :
 *
 * 1. **Chaque texte des trois catalogues est produit et non vide.** La parite
 *    des cles est tenue par le typage ; celle du CONTENU (une fonction qui
 *    rendrait une chaine vide) ne peut l'etre que par execution.
 * 2. **Les chemins defensifs de la machine** — etats persistes difformes,
 *    identifiants inconnus, boutique degradee — repondent tous quelque chose
 *    au lieu de lever : une conversation ne meurt jamais sur une exception.
 */

const BOUTIQUE: BoutiqueBot = {
  id: "s1",
  slug: "chez-amina",
  nom: "Chez Amina",
  ville: "Douala",
  whatsappVendeuse: "+237677123456",
  reversementPose: true,
  articles: [
    { id: "a1", nom: "Pagne", prixXaf: 15000, stock: null },
    { id: "a2", nom: "Sac", prixXaf: 8000, stock: 1 },
  ],
};
const VERS = "237690112233";
const ctx = (s: Partial<ContexteAcheteuse> = {}): ContexteAcheteuse => ({
  vers: VERS,
  boutique: BOUTIQUE,
  ...s,
});
const corpsTexte = (m: unknown) => (m as MessageTexte).text.body;
/* Depuis l'ADR 0053, une aide du tunnel porte ses sorties : elle est
   interactive, plus un texte nu. */
const corpsBoutons = (m: unknown) => (m as MessageBoutons).interactive.body.text;
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);
/* L'accueil froid est une LISTE depuis l'ADR 0109 : ses portes sont des
   lignes, pas des boutons. */
const lignesListe = (m: unknown) =>
  (m as MessageListe).interactive.action.sections.flatMap((s) => s.rows);
const idsListe = (m: unknown) => lignesListe(m).map((r) => r.id);

describe("textes — les trois catalogues produisent, en entier", () => {
  it("chaque entree des trois langues rend une chaine non vide", () => {
    for (const [langue, t] of Object.entries(TEXTES)) {
      const produits: string[] = [
        t.boutiqueIntrouvable,
        t.aideAcheteuse,
        t.btnVendre,
        t.btnSuivre,
        t.btnComment,
        t.commentCaMarche,
        t.aideGestes,
        t.annule,
        t.langueChangee,
        t.accueilReputation("4,8", 12),
        t.accueilReputation(null, 1),
        t.accueilPitch,
        t.btnVoirArticles,
        t.btnParlerVendeuse,
        t.parlerVendeuse("Chez Amina", "https://wa.me/237677123456"),
        t.catalogueVide,
        t.btnAccueil,
        t.listeTitre("Chez Amina", 1),
        t.listeTitre("Chez Amina", 4),
        t.voirLaSuite,
        t.stockRestant(2),
        t.stockRestant(9),
        t.btnCommander,
        t.btnRetourCatalogue,
        t.questionQuantite("Pagne", null),
        t.questionQuantite("Pagne", 4),
        t.btnAutreNombre,
        t.quantiteAutre,
        t.quantiteIncomprise,
        t.quantiteTropHaute(2),
        t.plusDeStock("Pagne"),
        t.ajout("Pagne", 2),
        t.panierCorps(["Pagne × 2 : 15 000 F l'unité"], 30000),
        t.panierVide,
        t.btnMonPanier,
        t.btnPasserCommande,
        t.btnAutreArticle,
        t.btnAnnuler,
        t.questionMode(30000),
        t.btnLivraison,
        t.btnRetrait,
        t.modeParBoutons,
        t.questionDetailsLivraison,
        t.questionDetailsRetrait,
        t.detailsParTexte,
        t.aideSansTelephone,
        t.aideSansLieu,
        t.aideSansRepere,
        t.recapTitre("Chez Amina"),
        t.ligneArticle("Pagne", 2, 15000),
        t.ligneTotal(30000),
        t.ligneAcompte(15000),
        t.ligneLivraison("Bafoussam", "Bonapriso", "en face de la pharmacie"),
        t.ligneRetrait("Marché central"),
        t.ligneTelephone("690 11 22 33"),
        t.recapRien,
        t.btnConfirmer,
        t.btnCorriger,
        t.recapParBoutons,
        t.confirmationTitre("CT-104312", "Chez Amina"),
        t.ligneCode("ACDE-4679"),
        t.suiteAcompte("https://x.test/s"),
        t.suiteSansAcompte("https://x.test/s"),
        t.commandeRatee,
        t.stockInsuffisant("Pagne"),
        t.statutAucune,
        t.statutResteAPayer(7500),
        t.statutRegle,
        t.statutOuEstLeLien,
        t.faqPrix,
        t.faqPhoto,
        t.faqVariante,
        t.relanceAcompte("CT-104312", 7500),
        t.btnVoirPhotos,
        t.rafaleAucunePhoto,
        t.panierAbandonneAilleurs,
        t.ligneHorsLivraison,
        t.apresConfirmation("Chez Amina", "https://wa.me/237677123456"),
        t.suiteSuivi("https://x.test/s"),
        t.blocPaiement({
          montantXaf: 8000,
          numeroAffiche: "6 56 74 62 15",
          operateurNom: "Orange Money",
          codeEntree: "#150*50#",
          lienPayer: "https://x.test/payer",
        }),
        t.blocPaiement({
          montantXaf: 8000,
          numeroAffiche: "6 56 74 62 15",
          operateurNom: null,
          codeEntree: null,
          lienPayer: null,
        }),
        t.notifPaiementProuve("CT-104312", 7500),
        t.notifPaiementProuve("CT-104312", 0),
        t.notifLivree("CT-104312", "Chez Amina"),
        t.btnContresigner,
        t.btnPasMoi,
        t.btnDonnerAvis,
        t.contresigneMerci("CT-104312"),
        t.contresigneImpossible,
        t.contesterConfirmation("CT-104312"),
        t.btnContesterOui,
        t.contesteEnregistre("CT-104312"),
        t.avisInvitation("Chez Amina"),
        t.btnNoter,
        t.avisLigne(5),
        t.avisLigne(1),
        t.avisNoteEnregistree(true),
        t.avisNoteEnregistree(false),
        t.btnSansMot,
        t.avisMotMerci,
        t.avisImpossible,
        t.avisDejaDepose,
        t.apresAchatSansCommande,
        t.boutiqueFermeeAccueil,
        t.boutiqueFermee("Chez Amina"),
      ];
      for (const p of produits) {
        expect(p, langue).toBeTypeOf("string");
        expect(p.length, langue).toBeGreaterThan(0);
      }
    }
  });

  it("langueDemandee comprend les deux sens, accents compris, et rien d'autre", () => {
    expect(langueDemandee("English")).toBe("en");
    expect(langueDemandee("ANGLAIS")).toBe("en");
    expect(langueDemandee("français")).toBe("fr");
    expect(langueDemandee("francais")).toBe("fr");
    expect(langueDemandee("french")).toBe("fr");
    expect(langueDemandee("bonjour")).toBeNull();
    /* Le pidgin est RECONNU mais pas rendu tant qu'il n'est pas relu — c'est
       `pidgin.test.ts` qui tient les deux cotes de cette bascule. */
    expect(langueDemandee("pidgin")).toBe(PIDGIN_RELU ? "wes" : null);
  });
});

describe("normaliserEtat — les formes difformes ne levent jamais", () => {
  it("nettoie les paniers douteux : quantites negatives, lignes sans identifiant", () => {
    expect(
      normaliserEtat({
        nom: "catalogue",
        slug: "s",
        page: -3,
        panier: [
          { articleId: "a", quantite: 2.9 },
          { articleId: "b", quantite: -1 },
          { pas: "une ligne" },
          null,
        ],
      }),
    ).toEqual({ nom: "catalogue", slug: "s", page: 0, panier: [{ articleId: "a", quantite: 2 }] });
  });

  it("les etats de flux sans leur necessaire retombent a l'accueil", () => {
    for (const brut of [
      { nom: "catalogue" }, // sans slug
      { nom: "quantite", slug: "s" }, // sans articleId
      { nom: "ajout", slug: "s", panier: [] }, // panier vide
      { nom: "mode", slug: "s" }, // ni panier ni ancienne forme
      { nom: "details", slug: "s", panier: [{ articleId: "a", quantite: 1 }] }, // sans mode
      { nom: "recap", slug: "s", panier: [{ articleId: "a", quantite: 1 }], mode: "livraison" }, // sans livraison
      { nom: "accueil" },
      { nom: "inconnu" },
    ]) {
      expect(normaliserEtat(brut)).toEqual(ETAT_INITIAL);
    }
  });

  it("relit mode et recap du sprint A comme un panier d'une ligne", () => {
    expect(normaliserEtat({ nom: "mode", slug: "s", articleId: "a1", quantite: 3 })).toEqual({
      nom: "mode",
      slug: "s",
      panier: [{ articleId: "a1", quantite: 3 }],
    });
    const livraison = { mode: "retrait", pickupPoint: "Marche", phone: "+237690112233" };
    expect(
      normaliserEtat({
        nom: "recap",
        slug: "s",
        articleId: "a1",
        quantite: 1,
        mode: "retrait",
        livraison,
      }),
    ).toEqual({
      nom: "recap",
      slug: "s",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "retrait",
      livraison,
    });
  });
});

describe("les chemins defensifs de la machine", () => {
  it("un identifiant d'article inconnu retombe sans lever — fiche, commande, quantite", () => {
    const art = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:fantome" },
      ctx(),
    );
    expect(art.etat).toMatchObject({ nom: "catalogue" });

    const cmd = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "cmd:fantome" },
      ctx(),
    );
    expect(cmd.messages.length).toBeGreaterThan(0);

    const qte = reagirAcheteuse(
      { nom: "quantite", slug: "chez-amina", articleId: "fantome", panier: [] },
      { genre: "texte", texte: "2" },
      ctx(),
    );
    expect(qte.messages.length).toBeGreaterThan(0);
  });

  it("« cat: » illisible vaut page zero, et un etat de flux inconnu vaut accueil", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "cat:xyz" },
      ctx(),
    );
    expect(r.etat).toMatchObject({ nom: "catalogue", page: 0 });
  });

  it("l'accueil sans boutique OFFRE les trois services — jamais un cul-de-sac", () => {
    /* ADR 0034 : c'est ici que l'entonnoir vendeuse fuyait. ADR 0103 : il
       fuyait aussi pour les deux autres publics — celle qui attend sa commande
       devait DEVINER le mot « suivi », celle qui ne connait pas le produit
       n'avait rien a lire. ADR 0109 : les trois portes sont des LIGNES. */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "bonjour" },
      ctx({ boutique: null }),
    );
    expect(r.messages).toHaveLength(1);
    expect(idsListe(r.messages[0])).toEqual(["vendre", "suivi", "comment"]);
  });

  it("chaque porte de l'accueil PORTE SA DESCRIPTION — le menu se lit avant de se toucher", () => {
    /**
     * ADR 0109. Trois boutons ne portaient que trois libelles nus : ce qu'ils
     * font ne tenait nulle part, donc l'explication retombait dans la bulle
     * suivante, et cette bulle reposait les memes boutons. La description
     * n'est pas un ornement — c'est ce qui rend la deuxieme bulle inutile.
     */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "bonjour" },
      ctx({ boutique: null }),
    );
    for (const ligne of lignesListe(r.messages[0])) {
      expect(ligne.description, `${ligne.id} : ligne sans description`).toBeTruthy();
    }
    /* Le pied porte la consigne qui ne tient dans aucune ligne : quoi faire
       quand on a DEJA le lien d'une boutique. */
    expect((r.messages[0] as MessageListe).interactive.footer?.text).toBe(TEXTES.fr.piedAccueil);
  });

  it("une ligne du menu vaut le meme geste que le bouton d'hier — sinon le menu est muet", () => {
    /**
     * Le piege de l'ADR 0088, cote acheteur/se : une reponse de liste arrive
     * en `genre === "liste"`, jamais `"bouton"`. Ne router que les boutons
     * rendrait chaque ligne MUETTE — pas d'erreur, pas de trace, un menu mort.
     */
    for (const id of ["suivi", "comment"] as const) {
      const parBouton = reagirAcheteuse(
        ETAT_INITIAL,
        { genre: "bouton", id },
        ctx({ boutique: null }),
      );
      const parListe = reagirAcheteuse(
        ETAT_INITIAL,
        { genre: "liste", id },
        ctx({ boutique: null }),
      );
      expect(parListe.messages, `${id} : la ligne ne rend pas ce que le bouton rendait`).toEqual(
        parBouton.messages,
      );
    }
  });

  it("le bouton « suivi » rend le MEME statut que le mot tapé", () => {
    /* Le geste existait deja et marchait sans boutique : il fallait le taper
       pour le trouver. Le bouton ne cree pas un second chemin, il rend le
       premier visible — les deux passent par `messageStatut`. */
    const boutonSuivi = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "suivi" },
      ctx({ boutique: null }),
    );
    const motSuivi = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "ma commande" },
      ctx({ boutique: null }),
    );
    expect(boutonSuivi.messages).toEqual(motSuivi.messages);
  });

  it("« comment ça marche » explique, et ne REDONNE pas les gestes déjà offerts", () => {
    /**
     * ADR 0109 — la redondance mesuree sur la capture du 14/08. La reponse
     * reposait « Vendre avec Catalog » et « Suivre ma commande », deja poses
     * trois lignes plus haut : le meme libelle apparaissait deux fois a
     * l'ecran, et les anciens boutons restent touchables (c'est pour cela que
     * `boutiqueFermee` existe). La copie NOMME desormais le geste au lieu de
     * le dupliquer.
     */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "comment" },
      ctx({ boutique: null }),
    );
    expect(r.messages).toHaveLength(1);
    expect(corpsTexte(r.messages[0])).toBe(TEXTES.fr.commentCaMarche);
    expect(r.messages[0]).not.toHaveProperty("interactive");
  });

  it("l'explication tient SOUS LE PLI — mesure du 14/08, coupe a ~776 caracteres", () => {
    /**
     * Le defaut que cet ADR corrige, et il ne se voyait dans aucun test :
     * le corps faisait 957 caracteres, WhatsApp l'a coupe par « Voir plus »
     * apres ~776 sur le telephone du porteur du produit. Les 181 caracteres
     * caches portaient le premier pas (« nom de boutique, ville ») et la
     * sortie de secours — les deux lignes que l'ADR 0108 avait ecrites
     * precisement pour fermer sur un geste.
     *
     * Le pli se calcule en LIGNES RENDUES, pas en caracteres : ce plafond est
     * un substitut calibre sur une mesure, pas une constante documentee par
     * Meta. D'ou la marge — 640 pour 776 mesures —, qui tient une police plus
     * grande ou un ecran plus etroit.
     */
    const ACCROCHE_MAX = 640;
    for (const langue of ["fr", "en"] as const) {
      expect(
        TEXTES[langue].commentCaMarche.length,
        `${langue} : l'accroche repasse sous « Voir plus »`,
      ).toBeLessThanOrEqual(ACCROCHE_MAX);
    }
  });

  it("l'explication s'adresse au VENDEUR — c'est lui qui écrit au numéro sans lien", () => {
    /**
     * ADR 0108. Qui touche « Comment ça marche ? » depuis l'accueil froid ?
     * Quelqu'un qui a écrit au numéro SANS lien de boutique — donc une
     * prospect vendeur/se (l'entonnoir de l'ADR 0034). Une acheteuse, elle,
     * arrive par le lien d'une boutique et ne voit jamais cet accueil.
     *
     * La première version répondait depuis le siège de l'acheteuse
     * (« l'argent va directement de vous à elle ») et se fermait sur un
     * négatif — « il n'y a pas d'annuaire ici ». Pour un vendeur qui découvre
     * le produit, c'était un cul-de-sac : du churn au premier message.
     */
    expect(TEXTES.fr.commentCaMarche).toMatch(/vous vendez déjà sur whatsapp/i);
    expect(TEXTES.en.commentCaMarche).toMatch(/you already sell on whatsapp/i);
  });

  it("elle lève les deux peurs qui font partir : le coût et le changement", () => {
    /* AGENTS.md §2 : les fonds ne transitent jamais par un compte a nous, et
       aucune commission n'est prelevee. Dites a une inconnue, ces deux phrases
       sont ce qui la fait rester — et la premiere ligne repond a l'autre peur :
       elle ne change rien a sa facon de vendre. */
    expect(TEXTES.fr.commentCaMarche).toMatch(/n'y touche jamais/i);
    expect(TEXTES.fr.commentCaMarche).toMatch(/aucune commission/i);
    expect(TEXTES.fr.commentCaMarche).toMatch(/VOTRE Mobile Money/);
    expect(TEXTES.fr.commentCaMarche).toMatch(/ne change pas ça/i);
    expect(TEXTES.en.commentCaMarche).toMatch(/never touches it/i);
    expect(TEXTES.en.commentCaMarche).toMatch(/no commission/i);
  });

  it("elle met en avant la boutique ouverte 24h/24 — le bénéfice qui ne coûte rien au vendeur", () => {
    /**
     * Demande du porteur du produit, 14/08/2026 : « la boutique est ouverte
     * 24h/24, tu dors, pas de problème, ta boutique reçoit toujours des
     * commandes ».
     *
     * C'est le seul bénéfice qui ne demande AUCUN effort en echange : le lien
     * demande de le partager, le reçu demande de coller un SMS, celui-ci
     * arrive tout seul. Il tient parce que le fil acheteur/se mene la commande
     * de bout en bout — catalogue, panier, livraison, rampe de paiement —
     * sans qu'aucune main de vendeur/se soit necessaire.
     *
     * La borne, et elle est volontaire : le mode conges (ADR 0039) FERME la
     * boutique aux nouvelles commandes. Ce n'est pas une contradiction — c'est
     * un geste que le vendeur/se pose lui-meme. La copie dit l'etat par
     * defaut, elle ne promet pas qu'on ne puisse jamais s'arreter.
     */
    expect(TEXTES.fr.commentCaMarche).toMatch(/24h\/24/);
    expect(TEXTES.fr.commentCaMarche).toMatch(/vous dormez/i);
    expect(TEXTES.en.commentCaMarche).toMatch(/24\/7/);
    expect(TEXTES.en.commentCaMarche).toMatch(/asleep/i);
  });

  it("la derniere ligne nomme une porte QUI EXISTE dans la meme langue", () => {
    /**
     * L'ADR 0108 ferme l'explication sur un GESTE et non sur un manque. Le
     * geste n'est plus un bouton pose dessous (ADR 0109 : il faisait doublon)
     * mais la ligne du menu juste au-dessus — donc le nom cite doit etre
     * exactement celui que la personne lit dans ce menu.
     *
     * Mesure du 14/08/2026 : l'anglais disait « Tap « Suivre ma commande » »
     * alors que son bouton porte « Track my order ». La phrase envoyait
     * chercher un libelle qui n'existe nulle part a l'ecran — le cul-de-sac
     * que cette ligne existe precisement pour eviter. Les deux bouts etaient
     * corrects separement ; c'est leur jonction qui ne l'etait pas.
     */
    for (const langue of ["fr", "en"] as const) {
      const t = TEXTES[langue];
      expect(t.commentCaMarche, `${langue} : la derniere ligne ne cite pas son bouton`).toContain(
        t.btnSuivre,
      );
    }
  });

  it("elle dit le premier pas, et ne promet AUCUN annuaire", () => {
    /* Un onboarding qui explique sans dire quoi faire ensuite laisse devant un
       fait, pas devant un geste. Et l'annuaire n'existe pas, par construction :
       ne pas le promettre suffit — l'ancienne version le NIAIT, ce qui mettait
       un negatif en derniere ligne. */
    expect(TEXTES.fr.commentCaMarche).toMatch(/deux minutes/i);
    expect(TEXTES.en.commentCaMarche).toMatch(/two minutes/i);
    for (const t of [TEXTES.fr, TEXTES.en]) {
      expect(t.commentCaMarche).not.toMatch(/annuaire|directory/i);
    }
  });

  it("changer de langue sans boutique en contexte marche aussi", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "english" },
      ctx({ boutique: null }),
    );
    expect(r.langue).toBe("en");
    /* Deux messages depuis l'ADR 0111 : la confirmation, puis l'accueil froid
       dans la langue demandee — la bascule ne ferme plus en muet. */
    expect(r.messages).toHaveLength(2);
    // et redemander la MEME langue ne bascule rien
    const rien = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "english" },
      ctx({ boutique: null, langue: "en" }),
    );
    expect(rien.langue).toBeUndefined();
  });

  it("le bouton vendeuse sans numero personnel retombe sur l'accueil", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "vendeuse" },
      ctx({ boutique: { ...BOUTIQUE, whatsappVendeuse: null } }),
    );
    expect(idsBoutons(r.messages[0])).toEqual(["catalogue"]);
  });

  it("stock epuise panier vide : retour au catalogue, pas a l'etape panier", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0, panier: [{ articleId: "a2", quantite: 1 }] },
      { genre: "bouton", id: "cmd:a2" },
      ctx(),
    );
    // a2 a un stock de 1, deja au panier : plus rien a commander.
    expect(corpsTexte(r.messages[0])).toContain("plus d'exemplaire");
  });

  it("l'etape ajout re-propose ses trois sorties, dont la vendeuse — ADR 0053", () => {
    const etat: EtatConv = {
      nom: "ajout",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
    };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "hmm" }, ctx());
    expect(r.etat).toEqual(etat);
    /* La troisieme sortie est « Parler a la vendeuse » quand la boutique est
       joignable : AGENTS.md §1 veut que les deux continuent de se parler, et
       l'invariant etait suspendu pendant tout le tunnel. Sans numero, c'est
       « Annuler » — jamais rien. */
    expect(idsBoutons(r.messages[0])).toEqual(["commander", "catalogue", "vendeuse"]);
  });

  it("le mode tape en anglais est compris ; l'incomprehensible re-propose les boutons", () => {
    const etat: EtatConv = {
      nom: "mode",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
    };
    const en = reagirAcheteuse(etat, { genre: "texte", texte: "delivery" }, ctx({ langue: "en" }));
    expect(en.etat).toMatchObject({ nom: "ville" });
    const pickup = reagirAcheteuse(etat, { genre: "texte", texte: "pickup" }, ctx());
    expect(pickup.etat).toMatchObject({ nom: "details", mode: "retrait" });
    const rate = reagirAcheteuse(etat, { genre: "bouton", id: "id:inconnu" }, ctx());
    expect(rate.etat).toEqual(etat);
  });

  it("l'etape details refuse un bouton et aide en anglais aussi", () => {
    const etat: EtatConv = {
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "retrait",
    };
    const bouton = reagirAcheteuse(etat, { genre: "bouton", id: "id:inconnu" }, ctx());
    expect(bouton.etat).toEqual(etat);
    const en = reagirAcheteuse(
      etat,
      { genre: "texte", texte: "x, 690112233" },
      ctx({ langue: "en" }),
    );
    /* L'aide de `details` porte desormais ses SORTIES (ADR 0053) : c'est un
       message a boutons, plus un texte nu. Le contenu, lui, ne change pas. */
    expect(corpsBoutons(en.messages[0])).toContain("meet");
    expect(idsBoutons(en.messages[0])).toContain("vendeuse");
  });

  it("l'aide de details en anglais pour la livraison sans repere", () => {
    const r = lireDetailsLivraison("Bonapriso 690112233", "livraison", "Douala", TEXTES.en);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.aide).toContain("landmark");
    const sansTel = lireDetailsLivraison(
      "Bonapriso, la pharmacie",
      "livraison",
      "Douala",
      TEXTES.en,
    );
    expect(sansTel.ok).toBe(false);
  });

  it("la FAQ photo repond, et la boutique sans numero n'offre que le catalogue", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "vous avez des photos ?" },
      ctx({ boutique: { ...BOUTIQUE, whatsappVendeuse: null } }),
    );
    expect(idsBoutons(r.messages[0])).toEqual(["catalogue"]);
  });

  it("le statut d'une commande reglee dit « réglé », pas un reste a payer", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "suivi" },
      ctx({
        boutique: null,
        derniereCommande: { reference: "CT-1", boutique: "B", libelle: "Livree", resteXaf: 0 },
      }),
    );
    expect(corpsTexte(r.messages[0])).toContain("Tout est réglé");
  });

  it("un etat accueil sur une entree bouton inconnue re-ouvre l'accueil", () => {
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "bouton", id: "mystere" }, ctx());
    expect(r.etat).toMatchObject({ nom: "catalogue" });
  });

  it("l'inactivite laisse l'accueil tranquille", () => {
    expect(etatApresInactivite(ETAT_INITIAL, Number.MAX_SAFE_INTEGER)).toEqual(ETAT_INITIAL);
  });

  it("la confirmation sans lien rend UN message ; le verdict accepte sans reference reste net", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1",
      codeVerification: "ACDE-4679",
      boutique: "B",
      lignes: [{ nom: "A", quantite: 1, prixUnitaireXaf: 100 }],
      totalXaf: 100,
      duAvantXaf: 0,
      livraison: { mode: "retrait", pickupPoint: "Marché", phone: "+237690112233" },
      lienSuivi: null,
    });
    expect(messages).toHaveLength(1);
    expect(corpsTexte(messageVerdict(VERS, { verdict: "accepte", reference: null }))).toContain(
      "✅",
    );
  });

  it("le fil vendeuse repond au bouton comme au texte inconnu", () => {
    const r = reagirVendeuse({ genre: "bouton", id: "x" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [],
      soldesXaf: 0,
    });
    expect(corpsTexte(r.messages[0])).toMatch(/Collez/);
    const soldes = reagirVendeuse({ genre: "texte", texte: "soldes" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [{ id: "c", reference: "CT-9", resteXaf: 5 }],
      soldesXaf: 5,
    });
    expect(corpsTexte(soldes.messages[0])).toContain("CT-9");
  });
});

describe("la réponse qui clôt porte ses gestes — ADR 0111", () => {
  /* Le strict necessaire d'une commande d'apres-achat ; chaque cas ajuste. */
  const COMMANDE = {
    reference: "CT-104312",
    boutique: "Chez Amina",
    libelle: "Payée",
    resteXaf: 0,
  };

  it("un refus d'apres-achat AVEC boutique offre la vitrine et l'humaine", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      ctx({ derniereCommande: { ...COMMANDE, contresignable: false } }),
    );
    expect(corpsBoutons(r.messages[0])).toBe(TEXTES.fr.contresigneImpossible);
    expect(idsBoutons(r.messages[0])).toEqual(["catalogue", "vendeuse"]);
  });

  it("un refus d'apres-achat SANS boutique offre les portes de l'accueil", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      ctx({ boutique: null }),
    );
    expect(corpsBoutons(r.messages[0])).toBe(TEXTES.fr.apresAchatSansCommande);
    expect(idsBoutons(r.messages[0])).toEqual(["suivi", "comment"]);
  });

  it("le merci de la contre-signature INVITE a l'avis — les deux gestes de confiance", () => {
    /* ADR 0072 : la contre-signature puis l'avis verifie. Le bouton `avis`
       est l'identifiant que `veutNoter` route deja. */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      ctx({ derniereCommande: { ...COMMANDE, contresignable: true } }),
    );
    expect(r.effet).toEqual({ type: "contresigner" });
    expect(idsBoutons(r.messages[0])).toEqual(["avis"]);
  });

  it("la contestation enregistree met l'HUMAINE en premier", () => {
    /* Le geste utile d'un litige est de parler a la vendeuse (ADR 0078),
       pas de retourner au catalogue. */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contester:oui" },
      ctx({ derniereCommande: COMMANDE }),
    );
    expect(idsBoutons(r.messages[0])).toEqual(["vendeuse", "catalogue"]);
  });

  it("« english » sans boutique enchaine l'accueil froid dans la langue demandee", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "english" },
      ctx({ boutique: null }),
    );
    expect(r.langue).toBe("en");
    expect(r.messages).toHaveLength(2);
    expect(idsListe(r.messages[1])).toEqual(["vendre", "suivi", "comment"]);
  });

  it("la boutique introuvable garde ses deux portes ouvertes", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "boutique inconnue-xyz" },
      ctx({ boutique: null }),
    );
    expect(corpsBoutons(r.messages[0])).toBe(TEXTES.fr.boutiqueIntrouvable);
    expect(idsBoutons(r.messages[0])).toEqual(["suivi", "comment"]);
  });

  it("une forme non lue au repos vendeuse porte les deux gestes de tous les jours", () => {
    const r = reagirVendeuse({ genre: "autre", forme: "vocal" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [],
      soldesXaf: 0,
    });
    expect(idsBoutons(r.messages[0])).toEqual(["article", "ma_boutique"]);
  });
});

describe("l'ouverture du fil rend l'accueil — ADR 0106", () => {
  it("sans boutique : les trois portes, comme si la personne avait écrit", () => {
    /* C'est le SEUL chemin où le bot parle le premier sans gabarit : la
       personne vient d'ouvrir la conversation, la fenêtre est à elle. */
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "ouverture_fil" }, ctx({ boutique: null }));
    expect(idsListe(r.messages[0])).toEqual(["vendre", "suivi", "comment"]);
  });

  it("avec une boutique en contexte : l'accueil de la boutique, panier gardé", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0, panier: [{ articleId: "a1", quantite: 2 }] },
      { genre: "ouverture_fil" },
      ctx(),
    );
    expect(r.messages.length).toBeGreaterThan(0);
    /* Le panier survit : une ouverture de fil n'est pas un « annuler ». */
    expect(JSON.stringify(r.etat)).toContain("panier");
  });
});
