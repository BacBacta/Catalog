import { normalizePhone } from "@catalog/contracts/phone";
import { villeAcceptable } from "@catalog/contracts/villes";
import type { MessageFlux } from "./messages.ts";

/**
 * Le Flow de livraison — ADR 0055.
 *
 * ── ⚠️ CE QUI EST VERIFIE, ET CE QUI NE L'EST PAS ──────────────────────────
 *
 * L'API de notre cle 360dialog n'expose QUE deux points d'entree — les
 * gabarits et la configuration de reception. Mesure le 08/08/2026 : `/v1/configs/flows`,
 * `/v2/flows`, `/v1/flows` rendent tous 404. **Un Flow ne peut donc etre ni
 * cree ni teste depuis le depot.**
 *
 * Ce module est donc au meme regime que les raccourcis USSD (AGENTS.md §2) et
 * que l'adaptateur agregateur (§5) : le DOMAINE est ecrit et teste — la forme
 * du message, la lecture d'une reponse —, la jonction avec un Flow reel reste
 * a confirmer sur un telephone. Rien ne l'appelle tant que
 * `WABOT_FLUX_LIVRAISON_ID` est absent, et il l'est par defaut.
 *
 * ── Pourquoi le chemin question-par-question RESTE ────────────────────────
 *
 * Ce n'est pas une precaution transitoire. Un Flow exige un WhatsApp recent ;
 * sur un Android bas de gamme a Douala, il ne s'affiche pas. La saisie libre
 * est le seul chemin qui marche partout, et l'audit du 07/08/2026 le dit
 * explicitement. Le Flow est un RACCOURCI, jamais un remplacement.
 */

/**
 * Les noms de champs du Flow. Ils sont le CONTRAT avec la definition deposee
 * chez Meta (`docs/flux-livraison.md`) : les changer ici sans la redeployer
 * casse la lecture en silence.
 *
 * Aucun ne s'appelle « adresse » — il n'en existe pas au Cameroun (ADR 0005).
 */
export const CHAMPS_FLUX = {
  ville: "ville",
  quartier: "quartier",
  repere: "repere",
  telephone: "telephone",
} as const;

/** Ce que le Flow rend, une fois relu — la meme forme que la saisie libre. */
export interface LivraisonLue {
  mode: "livraison";
  city: string;
  quartier: string;
  landmark: string;
  phone: string;
}

/**
 * Lit la reponse d'un Flow. Rend `null` des qu'un champ obligatoire manque ou
 * qu'une valeur ne passe pas — **on ne fabrique jamais une livraison
 * partielle** : le repere et le telephone sont ce qui remplace l'adresse, et
 * une livraison sans eux n'est pas livrable.
 */
export function lireReponseFlux(brut: string): LivraisonLue | null {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) return null;
  const d = donnees as Record<string, unknown>;

  const texte = (cle: string): string =>
    typeof d[cle] === "string" ? (d[cle] as string).trim() : "";

  const city = texte(CHAMPS_FLUX.ville);
  const quartier = texte(CHAMPS_FLUX.quartier);
  const landmark = texte(CHAMPS_FLUX.repere);
  const phone = normalizePhone(texte(CHAMPS_FLUX.telephone));

  /* Les memes bornes que `deliverySchema`, pour qu'un Flow ne puisse pas
     faire entrer ce que la saisie libre refuse. */
  if (!villeAcceptable(city)) return null;
  if (quartier.length < 2) return null;
  if (landmark.length < 5) return null;
  if (!phone) return null;

  return { mode: "livraison", city, quartier, landmark, phone };
}

/**
 * Le message qui ouvre le Flow. `flow_token` est jetable et propre a cet
 * envoi : le jeton acheteuse (`buyerToken`, ADR 0021) autorise la
 * contre-signature et ne voyage jamais dans un message que WhatsApp renverra.
 */
export function messageFlux(
  vers: string,
  fluxId: string,
  libelleBouton: string,
  jeton: string,
  corps = "Remplissez vos informations de livraison.",
): MessageFlux {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: corps },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: fluxId,
          flow_cta: libelleBouton,
          flow_action: "navigate",
          flow_token: jeton,
        },
      },
    },
  };
}
