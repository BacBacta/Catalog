# ADR 0092 — La chaîne média se voit, et se dit

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constats
D4 (sévérité 30, silence) et D3 (sévérité 18, devinette) — la couche média du
bot était la seule couche sans aucun signal, et la vendeuse dont la photo
était refusée lisait la même phrase que si elle n'en avait pas envoyé.

## Contexte — deux défauts, une même couche

**D4.** Aucun compteur, aucun span sur `lire`, `lireCdn`, le déchiffrement,
le ré-encodage. Une panne du CDN Meta produit des articles sans photo **en
série**, et l'agrégat ne distingue pas cette panne de vendeuses qui
n'envoient simplement pas de photos. La leçon de la panne muette du
07/08/2026 (envois morts sur #131037, rien au journal) vaut pour les médias.

**D3.** Quand un refus survient dans le fil — fichier vide, trop gros, GIF,
corps corrompu — la vendeuse lisait « Sans photo pour l'instant — envoyez-la
quand vous voulez ». Elle renvoyait la même photo, échouait pareil, et
concluait que ça ne marche pas. Les messages exacts existaient
(`MESSAGE_REFUS_IMAGE`) et n'étaient servis que par le chemin HTTP
(`products.ts`).

## Décision 1 — un compteur, quatre étapes, étiquettes fermées

`catalog.bot.media`, étiqueté `etape` × `issue` :

- `lecture` (`ok`/`echec`) — le média classique, mesuré DANS l'adaptateur
  (`LecteurMediaWhatsapp`), au retour de `lire` ;
- `lecture_cdn` (`ok`/`echec`) et `dechiffrement` (`ok`/`echec`) — la forme
  CDN chiffrée des Flows, **séparées** : une série d'échecs du
  téléchargement est une panne CDN, une série d'échecs du déchiffrement des
  clés fausses — deux enquêtes qui n'ont rien à voir ;
- `reencodage` (`ok`, une raison de `RefusImage`, ou `illisible`) — mesuré
  au site d'appel (`creerArticleDepuisFil`), seul endroit qui voit le
  verdict.

Cardinalité fermée partout : jamais un message, un identifiant de média, un
numéro ni un octet du fichier — même règle que toutes les mesures du lot 14
(ADR 0023). Pas de span : la trace du traitement du message englobe déjà la
chaîne ; c'est le comptage par étape qui manquait, pas la nomenclature.

## Décision 2 — la cause du refus se DIT dans le fil

`creerArticleDepuisFil` retient désormais **pourquoi** la photo demandée
manque (`photoRefus`) : une raison de `RefusImage`, `illisible` (signature
valide, corps corrompu — la levée sharp du constat D2), ou `introuvable`
(WhatsApp n'a pas fourni le média : expiré, panne, ou lecteur absent — le
sandbox n'a pas de médias). `messageArticlePublie` la dit avec les messages
du chemin HTTP — ceux qui disent quoi faire — et garde « Sans photo pour
l'instant » pour le seul cas où rien n'était demandé.

L'invariant du constat D2 est inchangé : **une photo illisible ne fait
jamais échouer l'article**. Elle le fait naître sans photo, et maintenant en
le disant.

## Ce que ce lot NE fait pas

- Aucune nouvelle tentative automatique de téléchargement : un média expiré
  chez Meta le reste, et la vendeuse sait quoi faire.
- Aucune alerte câblée sur le compteur : le seuil se choisit en exploitation,
  comme pour les quatre mesures du lot 14.

## Preuves

- `apps/api/src/__tests__/media-mesures.test.ts` — un vrai lecteur de
  métriques en mémoire : `lecture/echec` sur panne, `lecture/ok`,
  `lecture_cdn/ok` + `dechiffrement/echec` sur clés fausses, raison fermée
  au ré-encodage.
- `apps/api/src/__tests__/bot-flux-article.test.ts` — le JPEG tronqué dit
  « abîmée », le GIF dit le message du refus, l'article naît quand même.
- `apps/api/src/domain/bot/__tests__/inscription.test.ts` — les quatre
  variantes de la phrase, et la phrase d'origine quand rien n'était demandé.
