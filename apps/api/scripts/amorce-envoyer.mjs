#!/usr/bin/env node
/**
 * Envoyer l'AMORCE a un numero — instrument de terrain, lecture de copie.
 *
 * ── Pourquoi ce script existe ──────────────────────────────────────────────
 *
 * L'accueil froid et le « Comment ça marche ? » sont les deux messages que
 * voit une personne qui ecrit au numero sans lien de boutique — l'entonnoir
 * vendeur/se de l'ADR 0034, reecrit par l'ADR 0108. Ils changent souvent,
 * parce que c'est de la copie, et une copie ne se relit pas dans un diff :
 * elle se relit sur un telephone, dans une bulle, a la bonne largeur.
 *
 * Jusqu'ici il fallait effacer la conversation et rouvrir le fil pour les
 * revoir — un geste manuel, qui depend en plus d'un evenement Meta dont on a
 * mesure qu'il n'arrive PAS a la reouverture (ADR 0106, quatrieme dementi).
 * Ce script livre les deux messages a la demande.
 *
 * ── Ce qu'il n'est PAS ─────────────────────────────────────────────────────
 *
 * Ce n'est pas un envoi de masse et il ne peut pas le devenir : UN numero par
 * appel, et le contenu n'est pas un parametre. On ne peut pas lui faire dire
 * autre chose que ce que le bot dit deja — les messages sont CONSTRUITS par
 * le domaine (`TEXTES`, `boutons`), pas recopies ici. Une copie recopiee
 * derive au premier changement, et l'instrument mentirait exactement quand on
 * s'en sert pour verifier.
 *
 * ── La fenetre de 24 h ─────────────────────────────────────────────────────
 *
 * Ces messages sont du texte LIBRE : Meta ne les delivre que si la personne a
 * ecrit au numero dans les 24 h. Hors fenetre, l'envoi est refuse et l'erreur
 * de Meta est affichee telle quelle — on ne la traduit pas en « ca a marche ».
 * Le repli serait un gabarit approuve, et il n'en existe pas pour de l'accueil.
 *
 * Usage, DANS la machine (seule a detenir la cle) :
 *   node /app/apps/api/scripts/amorce-envoyer.mjs <numero> [fr|en]
 *
 * `<numero>` est le wa_id, sans « + » (ex. : 32466457281).
 */

import { EnvoyeurWhatsappBot } from "../src/adapters/whatsapp-bot.ts";
import { resoudreTransport } from "../src/adapters/whatsapp-transport.ts";
import { boutons } from "../src/domain/bot/messages.ts";
import { TEXTES } from "../src/domain/bot/textes.ts";

const [numero, langueBrute = "fr"] = process.argv.slice(2);

if (!numero || !/^\d{8,15}$/.test(numero)) {
  console.error(
    [
      "Usage : node apps/api/scripts/amorce-envoyer.mjs <numero> [fr|en]",
      "  <numero> : le wa_id, chiffres seuls, sans « + » (ex. : 32466457281)",
    ].join("\n"),
  );
  process.exit(1);
}

/* Le pidgin est ECRIT et NON SERVI (ADR 0034) : le proposer ici ouvrirait par
   la bande une langue que personne n'a relue. */
if (langueBrute !== "fr" && langueBrute !== "en") {
  console.error("Langue inconnue. Deux valeurs : fr, en.");
  process.exit(1);
}

const cle = process.env.WABOT_API_KEY?.trim();
const base = process.env.WABOT_BASE_URL?.trim();
if (!cle || !base) {
  console.error(
    "WABOT_API_KEY et WABOT_BASE_URL sont requis. Ce script tourne DANS la machine,\n" +
      "qui les detient — pas depuis un poste de developpement.",
  );
  process.exit(1);
}

const envoyeur = new EnvoyeurWhatsappBot({
  apiKey: cle,
  baseUrl: base,
  transport: resoudreTransport(process.env.WABOT_TRANSPORT, base),
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
});

const t = TEXTES[langueBrute];

/**
 * Les deux messages, dans l'ordre ou le produit les donne : l'accueil a trois
 * portes, puis la reponse au bouton « Comment ça marche ? ».
 *
 * Les listes de boutons sont celles de `conversation.ts` — trois portes a
 * l'accueil (maximum de l'API), deux apres l'explication, parce que celui qui
 * vient de comprendre n'a plus besoin qu'on lui propose de comprendre.
 */
const messages = [
  boutons(numero, t.aideAcheteuse, [
    { id: "vendre", titre: t.btnVendre },
    { id: "suivi", titre: t.btnSuivre },
    { id: "comment", titre: t.btnComment },
  ]),
  boutons(numero, t.commentCaMarche, [
    { id: "vendre", titre: t.btnVendre },
    { id: "suivi", titre: t.btnSuivre },
  ]),
];

let rang = 0;
for (const message of messages) {
  rang += 1;
  try {
    await envoyeur.envoyer(message);
    console.log(`  ${rang}/${messages.length} parti`);
  } catch (e) {
    /* L'erreur de Meta est affichee TELLE QUELLE : c'est elle qui dit si la
       fenetre de 24 h est fermee, et la reformuler ferait perdre le seul
       renseignement utile. */
    console.error(`  ${rang}/${messages.length} REFUSE — ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

console.log(`\nAmorce envoyee a ${numero} en « ${langueBrute} ».`);
console.log("Si rien n'arrive : la fenetre de 24 h est fermee — ecrire au numero, puis relancer.");
