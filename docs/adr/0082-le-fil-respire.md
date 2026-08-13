# 0082 — Le fil respire : la confirmation en deux messages, le suivi qui redit l'état

- **Statut** : accepté
- **Date** : 13/08/2026
- **Révise** : l'ADR 0035 (P0, bloc paiement et suites) sur la FORME des
  messages de confirmation, et le comportement du mot « suivi » ; ne touche
  ni au contenu canonique (AGENTS.md) ni à la garde du jeton (lot 10).

## Ce que le banc du 12/08 a montré

Le porteur du produit, en test réel : « le bot envoie plusieurs liens à la
fois, ce qui est confus — et ces liens sont dans la conversation et se
perdent sur le long. » La cartographie du 13/08 a précisé le diagnostic : le
parcours est discipliné (zéro lien pendant tout le shopping), mais la
confirmation partait en **salve de quatre messages** — commande, bloc
paiement, suivi, contact vendeuse — portant à eux seuls les 4 à 5 liens du
parcours. WhatsApp n'a ni épinglage ni hiérarchie : quatre messages
consécutifs ont le même poids visuel, et le seul geste attendu — payer — se
noyait dans sa propre annonce.

Second constat, même racine : trois réponses (« suivi », notification de
paiement prouvé, relance d'acompte) renvoyaient à un message « plus haut
dans ce fil ». La raison de sécurité est bonne — le jeton de suivi ne se
re-projette jamais (lot 10) — mais la réponse au mot « suivi » ne disait
presque rien d'autre : une fouille archéologique était la seule voie.

## Décision 1 — la confirmation tient en DEUX messages

Le découpage suit l'usage, pas la technique :

- **le document** : la commande (contenu canonique intégral — articles,
  quantités, prix, total, référence, code de vérification, livraison
  relue) ET, en dessous, le bloc paiement quand un acompte est attendu.
  C'est le message que l'acheteuse garde ; quand elle cherchera « combien,
  à quel numéro », tout est au même endroit ;
- **le carnet d'adresses** : le lien de suivi et le wa.me de la vendeuse.
  C'est le message qu'elle rouvre plus tard.

Rien n'est retiré : mêmes textes, mêmes liens, même autosuffisance en texte
brut. Seul le nombre d'enveloppes change — quatre coups de cloche
deviennent deux.

## Décision 2 — « suivi » redit l'ÉTAT, le jeton reste tu

La réponse au mot « suivi » dessine désormais ce que la page de suivi
montre : le chemin complet (`✓` fait, `➔` en cours, `○` à venir — les
libellés du cycle de vie du lot 11, aucune règle redite), le reste à payer,
et le sort de la preuve quand il mérite une ligne (prouvée — reçu émis ;
contestée — commande gelée ; déclarée non tracée — pas de reçu). La ligne
« votre lien est dans le message de confirmation » demeure, mais comme
confort de fin, plus comme toute la réponse.

L'état n'est pas un secret — il s'affiche à qui possède le fil WhatsApp de
la commande. Le jeton, si : il autorise la contre-signature, et il ne
traverse toujours aucune réponse.

## Ce qu'on ne fait PAS, et pourquoi

**Le Flow de livraison reste EN PLUS de la question, jamais à sa place.**
L'analyse du 13/08 proposait de remplacer la question ville par le
formulaire quand il est configuré. C'est l'ADR 0055 qui tient : un Flow ne
s'affiche pas sur un WhatsApp ancien, et la question texte est le message
qui reste visible sur l'Android bas de gamme qu'on ne peut pas se permettre
de perdre. Deux messages à cette étape sont le prix de ne perdre personne —
la salve qui coûtait était celle de la confirmation, pas celle-ci.
