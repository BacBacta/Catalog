import { demandeComptoir } from "./comptoir-vendeuse.ts";
import { demandeRemise, extraireSlugBoutique } from "./conversation.ts";
import {
  demandeAjoutArticle,
  demandeCarteVitrine,
  demandeConges,
  demandeEspaceVendeuse,
  demandeInscription,
  demandeSoldes,
} from "./inscription.ts";

/**
 * Vers quel fil part un message — ADR 0034.
 *
 * ── Le defaut que ce module corrige ────────────────────────────────────────
 *
 * Jusqu'ici, l'aiguillage se faisait sur l'IDENTITE : « cette personne est
 * vendeuse, donc tout ce qu'elle ecrit va au fil vendeuse ». Deux
 * consequences, toutes deux fausses :
 *
 * 1. **Une vendeuse ne pouvait pas acheter.** Or les vendeuses s'achetent
 *    entre elles — le demi-gros est la norme sur ce marche. Une vendeuse qui
 *    ouvrait le lien d'une consoeur recevait « Collez ici le SMS de votre
 *    operateur ».
 * 2. **Une prospect tombait dans le fil acheteuse** et s'entendait repondre
 *    d'ouvrir le lien d'une boutique qu'elle n'a pas. L'entonnoir fuyait au
 *    premier message.
 *
 * On aiguille donc sur le GESTE. L'ordre des regles est le contrat :
 * l'inscription en cours prime sur tout, puis les gestes vendeuse explicites,
 * puis l'achat, puis le defaut selon ce qu'on est.
 *
 * Module PUR, et volontairement minuscule : c'est une decision, elle se lit
 * d'un coup d'oeil et se teste cas par cas.
 */

export type Fil = "inscription" | "vendeuse" | "acheteuse";

export interface ContexteAiguillage {
  /** Un compte vendeuse existe deja pour ce numero. */
  estVendeuse: boolean;
  /** Une inscription ou un ajout d'article est en cours. */
  etatVendeuseEnCours: boolean;
  /** Le texte a ete reconnu comme un SMS d'operateur — geste vendeuse s'il en est. */
  smsReconnu: boolean;
  /** Une conversation d'achat est en cours (panier, quantite, details…). */
  achatEnCours: boolean;
  /**
   * La reponse d'un formulaire VENDEUSE (jeton `article`) — tache #62.
   *
   * Calcule par le service (le jeton vit dans la charge utile, que ce module
   * ne lit pas). Sans cette regle, une vendeuse dont l'etat a expire — le
   * formulaire reste ouvert sur son telephone aussi longtemps qu'elle veut —
   * verrait sa reponse partir au fil acheteuse des qu'un panier est ouvert,
   * et son article se perdre.
   */
  formulaireArticle?: boolean;
  /**
   * La reponse du formulaire de REVERSEMENT (jeton `reversement`) — ADR 0097.
   * Meme regle et meme raison que le formulaire d'article : le formulaire
   * reste ouvert sur le telephone aussi longtemps qu'on veut, et sa reponse
   * ne doit jamais partir au fil acheteuse parce qu'un panier est ouvert.
   */
  formulaireReversement?: boolean;
}

export interface EntreeAiguillee {
  genre: "texte" | "bouton" | "liste" | "image" | "autre" | "flux" | "localisation";
  texte?: string | undefined;
  id?: string | undefined;
}

export function aiguiller(entree: EntreeAiguillee, ctx: ContexteAiguillage): Fil {
  const t = entree.genre === "texte" ? (entree.texte ?? "") : "";

  /* 0. Les gestes NON AMBIGUS traversent tout — ADR 0052.

     Aucun d'eux n'est une reponse plausible a « quel est le nom de
     l'article ? » ou « son prix, en francs ? », et les avaler coutait cher :
      - un SMS d'operateur colle est la VALEUR N°1 du produit (AGENTS.md §2) ;
        il devenait un nom d'article ou un prix ;
      - « livree CT-522801 » publiait un article a 522 801 F, parce que
        `lirePrix` colle tous les chiffres du message.
     Le formulaire n'est pas detruit pour autant : l'etat vendeuse reste en
     base, et le service repose la question apres le verdict. */
  if (ctx.smsReconnu) return "vendeuse";
  if (ctx.estVendeuse && entree.genre === "texte" && demandeRemise(t)) return "vendeuse";

  /* 1. Une inscription commencee se termine. Rien ne la detourne — sinon un
     nom de boutique qui ressemble a un slug renverrait la personne au
     catalogue au milieu de son inscription.

     Un LIEN DE BOUTIQUE y arrive aussi, volontairement : c'est la MACHINE qui
     arbitre (ADR 0052), parce qu'elle seule sait ce qui est en cours et peut
     donc poser la question au lieu de choisir a la place de la personne. */
  if (ctx.etatVendeuseEnCours) return "inscription";

  /* 2. Ouvrir une boutique : le geste d'une prospect, tape ou pris au bouton
     que le fil acheteuse propose. Une vendeuse deja installee qui l'ecrit
     n'ouvre pas une seconde boutique — un numero, une boutique
     (`Seller.phone` est UNIQUE) —, elle part au fil vendeuse. */
  const veutVendre =
    (entree.genre === "texte" && demandeInscription(t) !== null) ||
    (entree.genre === "bouton" && entree.id === "vendre");
  if (veutVendre) {
    return ctx.estVendeuse ? "vendeuse" : "inscription";
  }

  /* 3. Les gestes de vendeuse installee. Le bouton « article » vient du
     message de publication : il enchaine sans qu'elle ait a taper. Une PHOTO
     d'une vendeuse au repos est un article qui arrive (ADR 0035) — c'est le
     geste le plus naturel du canal, il part a l'inscription qui sait le lire. */
  if (ctx.estVendeuse) {
    if (entree.genre === "image") return "inscription";
    /* La reponse du formulaire d'article — un geste vendeuse s'il en est :
       elle ne peut venir QUE d'un message que le fil inscription a envoye. */
    if (entree.genre === "flux" && ctx.formulaireArticle) return "inscription";
    /* Celle du formulaire de reversement aussi — ADR 0097 : le fil
       inscription porte les gardes et l'etat d'attente du code. */
    if (entree.genre === "flux" && ctx.formulaireReversement) return "inscription";
    /**
     * Le menu d'ouverture est une LISTE — ADR 0088. Une reponse de liste
     * arrive en `genre === "liste"`, pas `"bouton"` : ne router que les
     * boutons rendait chaque ligne du menu MUETTE, sans erreur ni trace.
     * Les deux formes portent le meme identifiant et valent le meme geste.
     */
    if (
      (entree.genre === "bouton" || entree.genre === "liste") &&
      (entree.id === "article" || entree.id === "ma_boutique")
    ) {
      return entree.id === "article" ? "inscription" : "vendeuse";
    }
    /* « Ma carte » vient du meme menu, et part au fil vendeuse qui la sait
       fabriquer (`conversation.ts`, id « carte »). */
    if ((entree.genre === "bouton" || entree.genre === "liste") && entree.id === "carte") {
      return "vendeuse";
    }
    if (entree.genre === "texte" && demandeAjoutArticle(t)) return "inscription";
    /* « vendu » : le comptoir (rang 1, ADR 0061). Il vit dans la machine
       vendeuse, donc au fil inscription — comme « ajouter ». */
    if (entree.genre === "texte" && demandeComptoir(t)) return "inscription";
    if (entree.genre === "texte" && demandeEspaceVendeuse(t)) return "vendeuse";
    /* « solde » et « ma carte » sont du meme regime que « ma boutique » :
       aucun n'est une reponse plausible dans un tunnel d'achat, et les
       laisser filer a la regle 4 les faisait avaler des qu'un catalogue
       etait ouvert — vu au banc du 10/08/2026, juste apres une commande. */
    if (entree.genre === "texte" && demandeSoldes(t)) return "vendeuse";
    if (entree.genre === "texte" && demandeCarteVitrine(t)) return "vendeuse";
    /* Fermer ou rouvrir sa boutique — ADR 0039. Ce geste doit passer AVANT la
       regle 4 : une vendeuse qui teste sa propre boutique, ou qui achete a une
       consoeur, a un achat en cours, et son « congés » partirait au fil
       acheteuse ou il ne veut rien dire. */
    if (entree.genre === "texte" && demandeConges(t) !== null) return "vendeuse";
    if (entree.genre === "bouton" && (entree.id === "conges" || entree.id === "rouvrir")) {
      return "vendeuse";
    }
    if (ctx.smsReconnu) return "vendeuse";
  }

  /* 4. L'achat. Le lien d'une boutique prime sur le statut de vendeuse :
     c'est le geste, pas l'identite, qui decide. */
  if (entree.genre === "texte" && extraireSlugBoutique(t)) return "acheteuse";
  if (ctx.achatEnCours) return "acheteuse";

  /* 5. Le defaut. Une vendeuse au repos retrouve son fil ; toute autre
     personne va au fil acheteuse, qui sait proposer d'ouvrir une boutique. */
  return ctx.estVendeuse ? "vendeuse" : "acheteuse";
}
