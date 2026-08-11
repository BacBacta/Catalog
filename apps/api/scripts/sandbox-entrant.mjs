#!/usr/bin/env node
/**
 * Simulateur d'entrant sandbox — instrument de terrain.
 *
 * Quand le relais ENTRANT du sandbox 360dialog fait defaut (session expiree,
 * panne), ce script joue son role — il livre a la route entrante ce que le
 * telephone aurait envoye. Les reponses, elles, partent en VRAI vers WhatsApp : le
 * telephone enregistre au sandbox les recoit. On simule donc le pouce, on
 * observe l'ecran.
 *
 * Les deux valeurs sensibles arrivent par l'environnement, jamais par le
 * depot ni par l'historique du shell d'un CI :
 *
 *   ENTRANT_URL   https://<api>/api/whatsapp/entrant/<WHATSAPP_ENTRANT_SECRET>
 *   ENTRANT_AUTH  la valeur de WABOT_WEBHOOK_AUTH
 *
 * Usage :
 *   node apps/api/scripts/sandbox-entrant.mjs <numero> texte "boutique chez-amina"
 *   node apps/api/scripts/sandbox-entrant.mjs <numero> bouton confirmer
 *   node apps/api/scripts/sandbox-entrant.mjs <numero> liste "art:<id>"
 *   node apps/api/scripts/sandbox-entrant.mjs <numero> image <mediaId> "legende"
 *
 * `<numero>` est le wa_id, sans « + » (ex. : 32466457281). Le guide des
 * scenarios vit dans `docs/terrain/test-bot-sandbox.md`.
 */

const url = process.env.ENTRANT_URL?.trim();
const auth = process.env.ENTRANT_AUTH?.trim();
const [de, genre, valeur, legende] = process.argv.slice(2);

if (!url || !auth || !de || !genre || !valeur) {
  console.error(
    [
      "Il manque quelque chose. Requis :",
      "  env  ENTRANT_URL, ENTRANT_AUTH",
      "  args <numero> texte|bouton|liste|image <valeur> [legende]",
    ].join("\n"),
  );
  process.exit(1);
}

/** La forme PLATE v1 du sandbox — celle que `lireEntreesBot` lit deja. */
function message() {
  switch (genre) {
    case "texte":
      return { from: de, type: "text", text: { body: valeur } };
    case "bouton":
      return {
        from: de,
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: valeur } },
      };
    case "liste":
      return {
        from: de,
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: valeur } },
      };
    case "image":
      return {
        from: de,
        type: "image",
        image: { id: valeur, ...(legende ? { caption: legende } : {}) },
      };
    default:
      console.error(`genre inconnu : ${genre} (texte|bouton|liste|image)`);
      process.exit(1);
  }
}

const reponse = await fetch(url, {
  method: "POST",
  headers: { authorization: auth, "content-type": "application/json" },
  body: JSON.stringify({ messages: [message()] }),
});
console.log(`${reponse.status} ${genre} → ${de}`);
if (!reponse.ok) process.exit(1);
