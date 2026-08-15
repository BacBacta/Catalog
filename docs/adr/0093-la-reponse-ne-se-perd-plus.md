# ADR 0093 — La réponse ne se perd plus

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constat
B5 (sévérité 24, silence) — un 5xx Meta transitoire perdait définitivement
une réponse de conversation, et aucun ADR n'actait ce choix.

## Contexte — trois mécanismes, aucun ne rattrapait

Quand `EnvoyeurWhatsappBot.envoyer` échoue, la levée est journalisée
(`bot : entree non traitee`) et c'est tout :

- **pas de retry** — l'adaptateur tentait une fois ;
- **pas de file** — pg-boss est réservé aux notifications différées, et une
  bulle de conversation n'a de sens que tout de suite ;
- **pas de relivraison** — `termineLe` (ADR 0040) est posé même quand l'envoi
  a échoué, parce que les EFFETS (commande créée, article publié) ont déjà eu
  lieu : rejouer le message entrant les doublerait.

Le compromis de l'ADR 0040 — « on préfère perdre un message plutôt que d'en
traiter un deux fois » — reste juste pour le TRAITEMENT. Mais il avait
absorbé en silence un cas qu'il ne visait pas : l'échec du seul ENVOI, après
un traitement réussi. L'acheteuse a une commande, et pas de bulle.

## Décision — UN réessai, dans l'adaptateur, sur transitoire seulement

Le réessai vit dans `EnvoyeurWhatsappBot.envoyer`, le seul endroit qui sait
distinguer le transitoire du définitif :

- **HTTP 5xx** → un réessai, après une pause courte (400 ms par défaut,
  configurable). C'est l'état de Meta, pas le nôtre : la seconde tentative a
  une vraie chance.
- **Panne réseau** (fetch qui lève, délai de `fetchBorne`) → un réessai
  aussi, au **risque assumé d'une bulle en double** : la première requête a
  pu aboutir sans qu'on voie la réponse. Une bulle doublée gêne ; un bot
  muet fait fuir — et ne double jamais un EFFET, seulement un texte.
- **HTTP 4xx** → définitif, aucun second appel : le même corps échouerait
  pareil (numéro invalide, fenêtre fermée, gabarit refusé).
- **200 sans identifiant** → définitif : le message est peut-être PARTI, et
  le rejouer serait fabriquer le double qu'on vient de refuser.

Un seul réessai, pas une boucle : au-delà, on retarde toutes les bulles
suivantes de la séquence pour une conversation dont l'interlocutrice est
peut-être déjà partie. Chaque réessai se nomme au journal — un réessai qui
répare à chaque fois masquerait sinon une dégradation de Meta jusqu'à la
panne complète. Les statuts d'envoi (ADR 0091) sont l'autre moitié du
signal : ce qui échoue APRÈS le 200 se voit là.

## Ce qu'on ne fait PAS, et pourquoi

- **Ne pas poser `termineLe` sur échec d'envoi** a été examiné et rejeté :
  la relivraison Meta rejouerait le traitement entier, donc les effets —
  exactement ce que l'ADR 0040 interdit. Le compromis de 0040 est confirmé,
  pas amendé.
- **Pas de file de réessais différés** : une réponse de conversation servie
  dix minutes plus tard est plus déroutante que son absence — l'acheteuse a
  déjà réécrit, et la bulle tardive répondrait à côté.
- `accuser` (l'accusé de lecture) ne réessaie pas : il est de confort, son
  échec est déjà ignoré.

## Preuves

`apps/api/src/__tests__/whatsapp-transport.test.ts`, bloc « le reessai
borne » : le 5xx passager aboutit en deux appels, la panne réseau aussi, le
4xx et le 200-sans-identifiant n'ont aucun second appel, et deux 5xx
d'affilée remontent l'échec sans troisième tentative.
