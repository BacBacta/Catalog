/**
 * Les numeros du banc d'essai — ADR 0058. ABSENT PAR DEFAUT.
 *
 * Le produit est camerounais : chaque porte de connexion valide un +237, et
 * c'est une regle de `packages/contracts` qu'on ne rouvre pas. Mais le banc
 * d'essai du 10/08/2026 se tient depuis la Belgique, et il a montre ceci :
 * une vendeuse nee dans le fil avec un numero etranger EXISTE — le bot ne
 * refuse pas son numero — mais ne peut JAMAIS entrer dans son espace : ni
 * l'OTP (validateur +237), ni la connexion par WhatsApp (`normalizePhone`
 * rend null, « ignore » silencieux). Toute la moitie paiement du banc —
 * reversement, rampe, preuve — etait donc injouable.
 *
 * D'ou cette liste : `BANC_ESSAI_NUMEROS_HORS_CM`, des numeros NOMMES UN A
 * UN, hors Cameroun, autorises a se connecter et a servir de reversement.
 * Sans la variable, rien ne change nulle part — le meme regime que
 * `PAYMENT_AGGREGATOR_ENABLED` (AGENTS.md §5) : la production ne la pose
 * jamais, et l'oter ramene exactement le comportement d'avant.
 *
 * Leur code de connexion ne peut pas suivre le canal normal : en preprod
 * l'OTP part en SMS par l'API d'Orange Cameroun, qui ne livre pas en
 * Belgique. Il part donc par le WhatsApp du bot, en texte libre — le banc
 * converse deja avec le bot, la fenetre de 24 h est ouverte.
 */

/** Analyse la liste — pure, testable : « +32 466 45.72.81, 32484… » etc. */
export function lireNumerosBanc(valeur: string | undefined): Set<string> {
  const nums = new Set<string>();
  for (const brut of (valeur ?? "").split(",")) {
    const chiffres = brut.replace(/\D/g, "");
    /* Un +237 n'a rien a faire ici : il passe deja par la vraie porte, et
       l'y lister masquerait une regression du chemin normal. */
    if (chiffres.length >= 8 && !chiffres.startsWith("237")) nums.add(`+${chiffres}`);
  }
  return nums;
}

/** Le numero canonique s'il est au banc, sinon null. */
export function numeroDuBancParmi(brut: string, liste: Set<string>): string | null {
  const chiffres = String(brut).replace(/\D/g, "");
  if (!chiffres) return null;
  const canonique = `+${chiffres}`;
  return liste.has(canonique) ? canonique : null;
}

/** La meme lecture, depuis l'environnement — hors domaine, donc permise. */
export function numeroDuBanc(brut: string): string | null {
  return numeroDuBancParmi(brut, lireNumerosBanc(process.env.BANC_ESSAI_NUMEROS_HORS_CM));
}

/**
 * Envoie un code a un numero du banc par le WhatsApp du bot, en texte libre.
 * Volontairement independant de `SmsSender` : le canal normal (Orange, Mboa)
 * est celui de la production, et on ne le detourne pas — on passe a cote,
 * uniquement pour des numeros nommes dans la variable.
 */
export async function envoyerCodeBanc(vers: string, texte: string): Promise<void> {
  const base = (process.env.WABOT_BASE_URL ?? "").replace(/\/$/, "");
  const jeton = process.env.WABOT_API_KEY;
  const idNumero = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!base || !jeton || !idNumero) {
    throw new Error("banc d'essai : canal WhatsApp non configure pour l'envoi du code");
  }
  const r = await fetch(`${base}/${idNumero}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: vers.replace(/^\+/, ""),
      type: "text",
      text: { body: texte },
    }),
  });
  if (!r.ok) {
    /* Sans une lettre du contenu : le code n'entre jamais au journal. */
    throw new Error(`banc d'essai : envoi du code refuse (HTTP ${r.status})`);
  }
}
