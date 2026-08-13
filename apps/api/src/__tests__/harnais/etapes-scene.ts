import type { GenreFlux } from "../../domain/bot/flux.ts";
import type { Geste } from "./gestes.ts";
import * as g from "./gestes.ts";
import type { Scene } from "./pilote.ts";

/**
 * Comment AMENER une personne a chaque etape, et quels gestes y sont plausibles
 * — audit de pipeline, phase 3.
 *
 * ── Pourquoi cette table existe ───────────────────────────────────────────
 *
 * Le balayage joue vingt-deux gestes sur chaque etape. Si le geste « bouton
 * attendu » etait partout le meme identifiant inconnu, le balayage ne mesurerait
 * qu'une chose : que le bot encaisse les identifiants inconnus. C'est utile, et
 * c'est ce que fait `bouton_ancien`. Mais `bouton_attendu` doit etre le bouton
 * que l'etape PROPOSE reellement, sinon la case est exercee sans rien prouver.
 *
 * Chaque ligne dit donc : l'etat a poser, qui le porte, et ce que « la bonne
 * reponse » veut dire ici. Les variantes fautives, sans accents, anglaises et
 * pidgin derivent de la bonne reponse — ce sont les memes mots, ecrits comme on
 * les ecrit vraiment sur un clavier de telephone.
 *
 * Module PUR : il decrit, il ne joue rien.
 */

export interface RecetteEtape {
  cle: string;
  /** Qui occupe l'etape : la vendeuse de la scene, ou une acheteuse tierce. */
  qui: "vendeuse" | "acheteuse";
  /**
   * L'etat a poser. `null` : aucune ligne de conversation — le premier contact,
   * qui n'est pas un etat mais une absence.
   */
  etat(scene: Scene): unknown | null;
  /** La bonne reponse a la question de l'etape, si elle attend du texte. */
  juste: string;
  /** La meme, mal orthographiee — ce qu'un pouce produit vraiment. */
  faute: string;
  sansAccents: string;
  anglais: string;
  pidgin: string;
  /** Le bouton que l'etape propose. Vide : elle n'en propose aucun. */
  boutonAttendu: string;
  /** La ligne de liste que l'etape propose. Vide : aucune liste. */
  ligneAttendue: string;
  /** Le genre de formulaire qui a un sens ici. */
  fluxGenre: GenreFlux;
  /** La charge d'un formulaire COMPLET pour ce genre. */
  fluxCharge(scene: Scene): Record<string, unknown>;
  /** Le mot de retour en arriere qui a un sens a cette etape. */
  retour: string;
}

const PANIER = (scene: Scene) => [{ articleId: scene.articles[0]?.id ?? "a1", quantite: 1 }];

const LIVRAISON_FAITE = {
  mode: "retrait",
  pickupPoint: "Carrefour Warda",
  phone: "+237690112233",
};

/** Les valeurs par defaut : ce qu'on dit quand l'etape n'attend rien de precis. */
const DEFAUTS = {
  juste: "bonjour",
  faute: "bonjor",
  sansAccents: "bonjour ca va",
  anglais: "hello",
  pidgin: "how you dey",
  boutonAttendu: "",
  ligneAttendue: "",
  fluxGenre: "livraison" as GenreFlux,
  fluxCharge: () => ({
    ville: "Douala",
    quartier: "Bonapriso",
    repere: "en face de la pharmacie",
    telephone: "690112233",
  }),
  retour: "retour",
};

export const RECETTES: readonly RecetteEtape[] = [
  {
    ...DEFAUTS,
    cle: "aucun_prospect",
    qui: "acheteuse",
    etat: () => null,
    juste: "je veux vendre",
    faute: "je ve vandre",
    sansAccents: "je veux vendre mes habits",
    anglais: "I want to sell",
    pidgin: "I wan sell my things",
    boutonAttendu: "vendre",
    fluxGenre: "ouverture",
    fluxCharge: () => ({ boutique: "Chez Test", ville: "Douala" }),
  },
  {
    ...DEFAUTS,
    cle: "inscription_nom",
    qui: "acheteuse",
    etat: () => ({ nom: "inscription_nom" }),
    juste: "Chez Mireille",
    faute: "Chez Mireile",
    sansAccents: "Chez Mireille Douala",
    anglais: "Mireille Shop",
    pidgin: "Mireille shop for Douala",
    fluxGenre: "ouverture",
    fluxCharge: () => ({ boutique: "Chez Mireille", ville: "Douala" }),
    retour: "annuler",
  },
  {
    ...DEFAUTS,
    cle: "inscription_ville",
    qui: "acheteuse",
    etat: () => ({ nom: "inscription_ville", nomBoutique: "Chez Mireille" }),
    juste: "Douala",
    faute: "Douala ",
    sansAccents: "douala",
    anglais: "Douala",
    pidgin: "na Douala",
    fluxGenre: "ouverture",
    fluxCharge: () => ({ boutique: "Chez Mireille", ville: "Yaoundé" }),
    retour: "annuler",
  },
  {
    ...DEFAUTS,
    cle: "inscription_confirme",
    qui: "acheteuse",
    etat: () => ({
      nom: "inscription_confirme",
      nomBoutique: "Chez Mireille",
      ville: "Douala",
    }),
    juste: "oui",
    faute: "wi",
    sansAccents: "oui c est bon",
    anglais: "yes",
    pidgin: "yes na so",
    boutonAttendu: "ouvrir",
    fluxGenre: "ouverture",
    fluxCharge: () => ({ boutique: "Chez Mireille", ville: "Douala" }),
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "aucun_vendeuse",
    qui: "vendeuse",
    etat: () => null,
    juste: "ma boutique",
    faute: "ma boutiqe",
    sansAccents: "ma boutique",
    anglais: "my shop",
    pidgin: "my shop",
    boutonAttendu: "article",
    ligneAttendue: "ma_boutique",
    fluxGenre: "article",
    fluxCharge: () => ({ nom: "Chemise", prix: "9000", stock: "3" }),
  },
  {
    ...DEFAUTS,
    cle: "article_nom",
    qui: "vendeuse",
    etat: () => ({ nom: "article_nom" }),
    juste: "Robe wax grande taille",
    faute: "Robe wacks grande taile",
    sansAccents: "Robe wax grande taille",
    anglais: "Wax dress",
    pidgin: "Fine wax dress",
    fluxGenre: "article",
    fluxCharge: () => ({ nom: "Chemise", prix: "9000", stock: "3" }),
    retour: "annuler",
  },
  {
    ...DEFAUTS,
    cle: "article_prix",
    qui: "vendeuse",
    etat: () => ({ nom: "article_prix", nomArticle: "Robe wax" }),
    juste: "12500",
    faute: "12 500 frs",
    sansAccents: "12500 fcfa",
    anglais: "12500 francs",
    pidgin: "na 12500",
    fluxGenre: "article",
    fluxCharge: () => ({ nom: "Chemise", prix: "9000", stock: "3" }),
    retour: "annuler",
  },
  {
    ...DEFAUTS,
    cle: "article_photo",
    qui: "vendeuse",
    etat: () => ({ nom: "article_photo", nomArticle: "Robe wax", prixXaf: 12500 }),
    juste: "je n'ai pas de photo",
    faute: "pa de foto",
    sansAccents: "pas de photo",
    anglais: "no photo",
    pidgin: "I no get photo",
    boutonAttendu: "sans_photo",
    fluxGenre: "article",
    fluxCharge: () => ({ nom: "Chemise", prix: "9000", stock: "3" }),
    retour: "annuler",
  },
  {
    ...DEFAUTS,
    cle: "article_confirme",
    qui: "vendeuse",
    etat: () => ({
      nom: "article_confirme",
      nomArticle: "Robe wax",
      prixXaf: 12500,
      mediaId: "media-scene",
    }),
    juste: "oui c'est bon",
    faute: "wi cé bon",
    sansAccents: "oui c est bon",
    anglais: "yes that's right",
    pidgin: "yes na so",
    boutonAttendu: "publier",
    fluxGenre: "article",
    fluxCharge: () => ({ nom: "Chemise", prix: "9000", stock: "3" }),
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "comptoir:article",
    qui: "vendeuse",
    etat: () => ({ nom: "comptoir", comptoir: { pas: "article" } }),
    juste: "Sac en cuir",
    faute: "Sak en kuir",
    sansAccents: "Sac en cuir marron",
    anglais: "Leather bag",
    pidgin: "Leather bag",
    boutonAttendu: "annuler",
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "comptoir:prix",
    qui: "vendeuse",
    etat: () => ({ nom: "comptoir", comptoir: { pas: "prix", article: "Sac en cuir" } }),
    juste: "20000",
    faute: "20 000f",
    sansAccents: "20000 fcfa",
    anglais: "20000",
    pidgin: "na 20000",
    boutonAttendu: "annuler",
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "comptoir:cliente",
    qui: "vendeuse",
    etat: () => ({
      nom: "comptoir",
      comptoir: { pas: "cliente", article: "Sac en cuir", prixXaf: 20000 },
    }),
    juste: "677 00 11 22",
    faute: "677001122 ",
    sansAccents: "677 00 11 22",
    anglais: "677 00 11 22",
    pidgin: "677 00 11 22",
    boutonAttendu: "annuler",
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "comptoir:remise",
    qui: "vendeuse",
    etat: () => ({
      nom: "comptoir",
      comptoir: {
        pas: "remise",
        article: "Sac en cuir",
        prixXaf: 20000,
        cliente: "+237677001122",
      },
    }),
    juste: "Carrefour Warda",
    faute: "Carefour Ouarda",
    sansAccents: "Carrefour Warda",
    anglais: "Warda junction",
    pidgin: "Warda junction",
    boutonAttendu: "annuler",
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "comptoir:recap",
    qui: "vendeuse",
    etat: () => ({
      nom: "comptoir",
      comptoir: {
        pas: "recap",
        article: "Sac en cuir",
        prixXaf: 20000,
        cliente: "+237677001122",
        remise: "Carrefour Warda",
      },
    }),
    juste: "confirmer",
    faute: "confirmé",
    sansAccents: "confirmer",
    anglais: "confirm",
    pidgin: "confirm am",
    boutonAttendu: "confirmer",
    retour: "corriger",
  },

  /* ── acheteuse ── */
  {
    ...DEFAUTS,
    cle: "accueil",
    qui: "acheteuse",
    etat: () => ({ nom: "accueil" }),
    juste: "bonjour",
    faute: "bonjor",
    sansAccents: "bonjour",
    anglais: "hello",
    pidgin: "how far",
    boutonAttendu: "vendre",
  },
  {
    ...DEFAUTS,
    cle: "catalogue",
    qui: "acheteuse",
    etat: (s) => ({ nom: "catalogue", slug: s.slug, page: 0 }),
    juste: "je veux le premier article",
    faute: "je ve le premié articl",
    sansAccents: "je veux le premier article",
    anglais: "I want the first item",
    pidgin: "I wan the first one",
    boutonAttendu: "photos",
    ligneAttendue: "art:PREMIER",
  },
  {
    ...DEFAUTS,
    cle: "quantite",
    qui: "acheteuse",
    etat: (s) => ({
      nom: "quantite",
      slug: s.slug,
      articleId: s.articles[0]?.id ?? "a1",
      panier: [],
    }),
    juste: "2",
    faute: "deux",
    sansAccents: "2 svp",
    anglais: "two",
    pidgin: "gimme two",
    boutonAttendu: "qte:autre",
    ligneAttendue: "qte:2",
    retour: "catalogue",
  },
  {
    ...DEFAUTS,
    cle: "ajout",
    qui: "acheteuse",
    etat: (s) => ({ nom: "ajout", slug: s.slug, panier: PANIER(s) }),
    juste: "c'est tout",
    faute: "cé tou",
    sansAccents: "c est tout",
    anglais: "that's all",
    pidgin: "na all",
    boutonAttendu: "commander",
    retour: "catalogue",
  },
  {
    ...DEFAUTS,
    cle: "mode",
    qui: "acheteuse",
    etat: (s) => ({ nom: "mode", slug: s.slug, panier: PANIER(s) }),
    juste: "livraison",
    faute: "livrezon",
    sansAccents: "livraison",
    anglais: "delivery",
    pidgin: "make you bring am",
    boutonAttendu: "mode:retrait",
    retour: "catalogue",
  },
  {
    ...DEFAUTS,
    cle: "ville",
    qui: "acheteuse",
    etat: (s) => ({ nom: "ville", slug: s.slug, panier: PANIER(s) }),
    juste: "Bafoussam",
    faute: "Bafousam",
    sansAccents: "bafoussam",
    anglais: "Bafoussam",
    pidgin: "Bafoussam side",
    retour: "catalogue",
  },
  {
    ...DEFAUTS,
    cle: "ville_doute",
    qui: "acheteuse",
    etat: (s) => ({
      nom: "ville_doute",
      slug: s.slug,
      panier: PANIER(s),
      propose: "est-ce que vous vendez des chaussures pour bébé ?",
    }),
    juste: "Bafoussam",
    faute: "Bafousam",
    sansAccents: "bafoussam",
    anglais: "Bafoussam",
    pidgin: "Bafoussam side",
    boutonAttendu: "ville:oui",
    /* Revenir en arriere ICI, c'est retaper la bonne ville : la correction est
       un bouton, et `retourArriere` envoie du texte. Y mettre « ville:non »
       ferait taper l'identifiant du bouton, qui deviendrait la ville. */
    retour: "Douala",
  },
  {
    ...DEFAUTS,
    cle: "details",
    qui: "acheteuse",
    etat: (s) => ({
      nom: "details",
      slug: s.slug,
      panier: PANIER(s),
      mode: "livraison",
      ville: "Douala",
    }),
    juste: "Bonapriso, en face de la pharmacie Bleue, 690112233",
    faute: "Bonapriso, an face de la farmacie, 690112233",
    sansAccents: "Bonapriso, en face de la pharmacie Bleue, 690112233",
    anglais: "Bonapriso, opposite the Blue pharmacy, 690112233",
    pidgin: "Bonapriso, for front of Blue pharmacy, 690112233",
    boutonAttendu: "vendeuse",
    retour: "catalogue",
  },
  {
    ...DEFAUTS,
    cle: "recap",
    qui: "acheteuse",
    etat: (s) => ({
      nom: "recap",
      slug: s.slug,
      panier: PANIER(s),
      mode: "retrait",
      livraison: LIVRAISON_FAITE,
    }),
    juste: "confirmer",
    faute: "confirmé",
    sansAccents: "confirmer",
    anglais: "confirm",
    pidgin: "confirm am",
    boutonAttendu: "confirmer",
    retour: "corriger",
  },
  {
    ...DEFAUTS,
    cle: "avis_mot",
    qui: "acheteuse",
    etat: () => ({ nom: "avis_mot" }),
    juste: "Très bonne vendeuse, livraison rapide",
    faute: "tré bone vandeuse",
    sansAccents: "Tres bonne vendeuse",
    anglais: "Very good seller",
    pidgin: "The seller correct well well",
    boutonAttendu: "avis:sans_mot",
  },
];

/**
 * Les vingt-deux gestes, instancies pour UNE etape.
 *
 * L'ordre suit `FAMILLES` : le tableau de couverture se lit dans le meme ordre
 * que le balayage, ce qui rend un trou reperable a l'oeil.
 */
export function gestesDeLEtape(r: RecetteEtape, scene: Scene): Geste[] {
  const article = scene.articles[0]?.id ?? "a1";
  const ligne = r.ligneAttendue.replace("PREMIER", article);
  return [
    g.texteJuste(r.juste),
    g.texteFaute(r.faute),
    g.texteSansAccents(r.sansAccents),
    g.anglais(r.anglais),
    g.pidgin(r.pidgin),
    /* Sans bouton propre, l'etape recoit celui du menu vendeuse : c'est un
       bouton REEL du produit, arrivant la ou il n'est pas attendu. */
    g.bouton(r.boutonAttendu || "ma_boutique"),
    /* Le bouton d'un message ancien : celui de l'etape PRECEDENTE du tunnel. */
    g.boutonAncien("commander"),
    g.ligneListe(ligne || "art:inconnu"),
    g.fluxValide(r.fluxGenre, r.fluxCharge(scene)),
    g.fluxTronque(r.fluxGenre),
    g.photo(),
    g.photoLegendee("Chemise 9000"),
    g.vocal(),
    g.sticker(),
    g.document(),
    g.localisation(),
    g.horsSujet("est-ce que vous vendez des chaussures pour bébé ?"),
    g.silence(30),
    g.doubleEnvoi(),
    g.retourArriere(r.retour),
    g.abandon("annuler"),
    g.reprise25h(),
  ];
}
