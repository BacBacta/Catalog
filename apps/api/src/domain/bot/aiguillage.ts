import { extraireSlugBoutique } from "./conversation.ts";
import { demandeAjoutArticle, demandeEspaceVendeuse, demandeInscription } from "./inscription.ts";

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
}

export interface EntreeAiguillee {
  genre: "texte" | "bouton" | "liste" | "image";
  texte?: string | undefined;
  id?: string | undefined;
}

export function aiguiller(entree: EntreeAiguillee, ctx: ContexteAiguillage): Fil {
  const t = entree.genre === "texte" ? (entree.texte ?? "") : "";

  /* 1. Une inscription commencee se termine. Rien ne la detourne — sinon un
     nom de boutique qui ressemble a un slug renverrait la personne au
     catalogue au milieu de son inscription. */
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
     message de publication : il enchaine sans qu'elle ait a taper. */
  if (ctx.estVendeuse) {
    if (entree.genre === "bouton" && (entree.id === "article" || entree.id === "ma_boutique")) {
      return entree.id === "article" ? "inscription" : "vendeuse";
    }
    if (entree.genre === "texte" && demandeAjoutArticle(t)) return "inscription";
    if (entree.genre === "texte" && demandeEspaceVendeuse(t)) return "vendeuse";
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
