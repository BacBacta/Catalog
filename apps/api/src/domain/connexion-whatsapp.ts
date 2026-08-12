/**
 * Connexion par WhatsApp ENTRANT — regles pures. Voir l'ADR 0027.
 *
 * Le sens est inverse par rapport a l'OTP : la vendeuse ENVOIE un message
 * pre-rempli au numero WhatsApp de Catalog, et le webhook Meta nous livre son
 * numero, atteste par Meta. Aucun SMS sortant, donc aucune liste blanche
 * d'expediteur — le mur sur lequel l'API Orange s'est arretee.
 *
 * Ce module est du texte vers des donnees, comme `domain/proof` : pas de base,
 * pas de reseau, pas d'horloge implicite. Le temps et l'aleatoire arrivent en
 * parametre.
 *
 * ── Les trois cles, et pourquoi trois ──────────────────────────────────────
 *
 * `code`   voyage DANS le message WhatsApp. Public des l'envoi.
 * `jeton`  reste dans le navigateur qui a demande le defi, et voyage
 *          UNIQUEMENT en corps de requete. Lui seul echange contre une
 *          session — c'est le `buyer_token` de ce flux (ADR 0021 : deux cles,
 *          deux pouvoirs).
 * `suivi`  sert au sondage d'attente, en GET. Il ne revele qu'un statut et
 *          n'autorise rien : il peut apparaitre dans une URL, donc dans un
 *          journal d'acces, sans que cela donne quoi que ce soit.
 *
 * La separation jeton/suivi n'est pas un ornement : le sondage passe en GET
 * (famille `lecture` du limiteur de debit, 3 s d'intervalle), et un jeton en
 * URL serait un jeton dans les journaux — le meme interdit que pour
 * `buyerToken` (ADR 0023).
 */

/** Duree de vie d'un defi, creation → echange. */
export const DUREE_DEFI_S = 300;

/**
 * Alphabet de Crockford reduit : ni 0/O, ni 1/I/L, ni U. Un code se dicte a
 * voix haute et se retape sans ambiguite — meme regle que le code de
 * verification des recus.
 */
export const ALPHABET_DEFI = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** `AAAA-BB` : six caracteres utiles, un tiret pour la lisibilite. */
export function composerCodeDefi(octets: Uint8Array): string {
  if (octets.length < 6) throw new Error("il faut au moins six octets d'aleatoire");
  const c = (i: number) => ALPHABET_DEFI[(octets[i] as number) % ALPHABET_DEFI.length];
  return `${c(0)}${c(1)}${c(2)}${c(3)}-${c(4)}${c(5)}`;
}

/**
 * Le texte du message pre-rempli.
 *
 * Il se defend seul contre le relais social : il dit ce qu'il fait, et dit de
 * ne pas l'envoyer pour un tiers. C'est la premiere defense contre « envoie ce
 * message pour moi » — la deuxieme est que la session n'est remise qu'au
 * navigateur porteur du jeton, jamais a WhatsApp.
 */
export function texteMessageDefi(code: string): string {
  return (
    `Connexion Catalog : ${code}. ` +
    "Si on vous a demande d'envoyer ce message pour quelqu'un d'autre, ne l'envoyez pas."
  );
}

/** `https://wa.me/<numero>?text=…` — le numero WABA, chiffres seuls. */
export function construireLienWa(numeroWaba: string, code: string): string {
  const chiffres = numeroWaba.replace(/\D/g, "");
  return `https://wa.me/${chiffres}?text=${encodeURIComponent(texteMessageDefi(code))}`;
}

/**
 * Retrouve un code de defi dans un texte libre.
 *
 * Tolerant sur la casse et sur ce qui entoure : la vendeuse peut avoir modifie
 * le message, l'avoir retape, ou l'avoir colle dans une phrase. Le format
 * `AAAA-BB` sur l'alphabet reduit est assez distinctif pour ne pas ramasser de
 * faux positifs dans du texte ordinaire.
 */
export function extraireCodeDefi(texte: string): string | null {
  const motif = new RegExp(`\\b([${ALPHABET_DEFI}]{4}-[${ALPHABET_DEFI}]{2})\\b`, "i");
  const m = motif.exec(texte.toUpperCase());
  return m ? (m[1] as string) : null;
}

/* ────────────────── le webhook Meta, du JSON vers des messages ─────────── */

export interface MessageEntrant {
  /** Le `wa_id` Meta : le numero, chiffres seuls, sans `+`. */
  de: string;
  texte: string;
}

/**
 * Extrait les messages texte d'une livraison de webhook Meta.
 *
 * La forme est `entry[].changes[].value.messages[]`, et TOUT y est optionnel :
 * les livraisons de statut (`statuses`) n'ont pas de `messages`, et Meta ajoute
 * des champs sans preavis. On ne valide pas ce qu'on n'utilise pas — on cueille
 * ce qu'on connait et on ignore le reste, comme pour l'accuse de livraison.
 */
export function lireMessagesEntrants(corps: unknown): MessageEntrant[] {
  const sortie: MessageEntrant[] = [];
  const entrees = (corps as { entry?: unknown } | null)?.entry;
  if (!Array.isArray(entrees)) return sortie;
  for (const entree of entrees) {
    const changements = (entree as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changements)) continue;
    for (const changement of changements) {
      const messages = (changement as { value?: { messages?: unknown } } | null)?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const m = message as {
          from?: unknown;
          type?: unknown;
          text?: { body?: unknown };
        } | null;
        if (m?.type !== "text") continue;
        if (typeof m.from !== "string" || typeof m.text?.body !== "string") continue;
        sortie.push({ de: m.from, texte: m.text.body });
      }
    }
  }
  return sortie;
}

/* ────────────────── le cycle de vie d'un defi ──────────────────────────── */

/** Ce qui vit dans le magasin, sous la cle du jeton. */
export interface EtatDefi {
  statut: "en_attente" | "verifie";
  /** Pose par le webhook, en E.164. Present ssi `verifie`. */
  numero?: string;
}

export type DecisionEchange =
  | { decision: "en_attente" }
  | { decision: "inconnu" }
  | { decision: "verifie"; numero: string };

/**
 * Ce qu'un sondage ou un echange doit conclure d'un enregistrement.
 *
 * `inconnu` couvre a dessein l'expire, le consomme et le jamais-cree : les
 * distinguer cote client n'apporterait rien, et cote attaquant cela dirait
 * quels jetons ont existe.
 */
export function decisionEchange(
  enregistrement: { valeur: EtatDefi; expireA: Date } | null,
  maintenant: Date,
): DecisionEchange {
  if (!enregistrement) return { decision: "inconnu" };
  if (maintenant.getTime() >= enregistrement.expireA.getTime()) return { decision: "inconnu" };
  if (enregistrement.valeur.statut === "verifie" && enregistrement.valeur.numero) {
    return { decision: "verifie", numero: enregistrement.valeur.numero };
  }
  return { decision: "en_attente" };
}
