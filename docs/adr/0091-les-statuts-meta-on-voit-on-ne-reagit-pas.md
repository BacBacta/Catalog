# ADR 0091 — Les statuts Meta : on voit, on ne réagit pas

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constat
B4 (sévérité 45) — un envoi du bot accepté en HTTP 200 pouvait mourir **après
coup**, et Catalog ne le savait pas.

## Contexte — le webhook parlait, personne n'écoutait

Meta livre sur le même webhook deux choses distinctes : les **messages
entrants** (`value.messages[]`, lus par `lireEntreesBot` depuis l'ADR 0031)
et les **statuts des envois sortants** (`value.statuses[]`) — `sent`,
`delivered`, `read`, `failed`, avec sur les `failed` un code d'erreur entier.
Les seconds n'étaient cueillis nulle part.

Or le HTTP 200 de l'API d'envoi ne dit pas « livré », il dit « accepté ».
L'échec réel arrive plus tard, par le statut : numéro qui a bloqué le bot,
fenêtre de 24 h fermée constatée côté Meta (code 131047), compte en
dégradation de qualité. Toutes ces pannes étaient invisibles — et sur
WhatsApp, personne ne se plaint à un numéro qui ne répond plus : la panne
muette du 07/08/2026 (tous les envois mourant sur #131037) n'a été vue que
par hasard. C'est la définition du défaut « muet » du protocole d'audit.

## Décision 1 — on LIT les statuts, dans le parseur défensif

`lireStatutsEnvoi` rejoint `lireEntreesBot` dans `domain/bot/entrees.ts`,
avec la même posture : un corps difforme rend une liste vide, jamais une
levée — une livraison qui plante est relivrée, et une relivraison en boucle
est une panne. Les deux formes de livraison sont lues, par parité avec les
messages : l'enveloppe Cloud API et la forme plate du sandbox 360dialog.

Le parseur ne retient que trois choses : le wamid du message sortant, le
statut **s'il fait partie des quatre connus** (un statut inédit est ignoré,
ce qui garde fermées les étiquettes de mesure), et les codes d'erreur
**entiers**. Jamais le contenu, jamais le destinataire.

## Décision 2 — ce qu'on en fait : un compteur, un journal, rien d'autre

`traiterLivraisonBot` cueille les statuts avant les messages :

- **un compteur** `catalog.bot.envoi_statut`, étiqueté par le statut et,
  sur les `failed`, par le code entier de Meta. La cardinalité est bornée :
  quatre statuts, et le catalogue public des codes d'erreur Meta. Aucun
  texte, aucun numéro, aucun wamid — même règle que toutes les mesures du
  lot 14. C'est ce compteur qui, un jour de panne, distingue « le bot
  n'envoie plus » de « le bot envoie et Meta refuse », et dit le code ;
- **une ligne de journal** par `failed`, portant les seuls codes entiers.

## Décision 3 — on ne RÉAGIT pas, et c'est la décision

Voir est la décision de la v1 ; réagir en serait une autre, et elle reste
**volontairement non prise**. Réagir voudrait dire, au choix : réémettre
(mais un `failed` 131047 se réémet par gabarit utilitaire — bloqué au WABA,
ADR 0033), marquer la conversation fermée (une machine d'état de plus),
prévenir la vendeuse (la liste des gabarits est fermée, ADR 0054). Chacune
de ces branches est une décision produit avec son ADR à elle. Câbler une
réaction « évidente » ici serait précisément la dérive silencieuse que le
§7.7 d'`AGENTS.md` interdit.

Corollaire assumé : le statut n'est **pas persisté** — pas de colonne, pas
de table. Une métrique et un journal suffisent à répondre à la question de
la panique (« nos envois partent-ils ? ») ; une table de statuts ne servirait
qu'une réaction qu'on a décidé de ne pas construire.

## Preuves

- `apps/api/src/domain/bot/__tests__/entrees.test.ts` — enveloppe Cloud API,
  forme plate, extraction des codes entiers, statut inconnu ignoré, corps
  difforme, et l'étanchéité messages/statuts dans les deux sens.
- Le simulateur de terrain n'envoie pas de statuts : rien ne change pour lui.
