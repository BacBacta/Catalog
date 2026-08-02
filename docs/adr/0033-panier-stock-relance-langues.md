# 0033 — Panier multi-articles, stock, description, relance d'acompte, langues

Date : 02/08/2026 · Statut : accepté · Complète : 0031, 0032

## Contexte

Le sprint B de l'analyse critique (`docs/analyses/2026-08-02-analyse-critique-bot.md`).
Le sprint A a corrigé la conversation ; celui-ci corrige ce qu'elle **vend** :
un seul article par commande, aucun stock, aucune description, aucune relance,
une seule langue.

## Décisions

### 1. Le panier — plusieurs articles, UNE commande

Les états de la machine portent un `panier: LignePanier[]`. Après la
quantité, une étape `ajout` demande « et ensuite ? » : passer commande,
ajouter un autre article (retour catalogue, panier conservé), ou annuler.
Le récapitulatif liste toutes les lignes ; la confirmation aussi.

La raison n'est pas cosmétique : deux articles en deux commandes, c'était
**deux acomptes, deux paiements USSD, deux SMS à coller** — le coût de preuve
doublait avec le panier. Une commande, un acompte, une preuve.

Les états persistés du sprint A (`articleId`/`quantite` à plat) sont relus par
`normaliserEtat`, qui les convertit en panier d'une ligne — et fait retomber
tout état illisible sur l'accueil au lieu de lever. « Corriger » au récap
revient à l'étape panier (la livraison se redemande) ; le retrait d'une ligne
isolée n'existe pas encore — « annuler » vide tout.

### 2. Le stock suivi borne, le stock non suivi n'existe pas

`stock = 0` veut dire « non suivi » — même sémantique que la boutique
publique. Quand il est suivi : la fiche l'affiche (« Plus que 2 en stock ! »
sous 4), la question de quantité le rappelle et n'offre pas de bouton
au-delà, la saisie au-delà reçoit le maximum restant **panier déduit**, et la
création REVÉRIFIE — la vendeuse a pu vendre au comptoir entre-temps ; le
refus est alors global et expliqué.

**Le stock n'est PAS décrémenté à la commande.** La vendeuse le tient à la
main, comme aujourd'hui : un décrément automatique exigerait de le
ré-incrémenter sur annulation et expiration, et ferait du chiffre une
promesse que le produit ne peut pas tenir. Le stock borne, il ne comptabilise
pas.

### 3. La description d'article — facultative, repliée

`product.description` (300 caractères, migration en expand). Elle existe pour
la **fiche du bot**, où nom et prix ne vendent pas un pagne. L'écran Articles
la propose derrière un disclosure replié : la règle du lot 5 — « trois
champs, pas un de plus » — reste vraie pour le chemin obligé, et cet ADR
assume l'écart pour le champ facultatif. La boutique publique ne l'affiche
pas encore (cap bot-first).

### 4. La relance d'acompte — pg-boss entre en service

Première utilisation réelle de pg-boss (prévu par AGENTS.md depuis le début,
jamais câblé). La file vit dans le schéma `pgboss` de la même base ; le
travailleur tourne dans le processus de l'API et ne démarre qu'avec le bot.
Une panne de la file laisse le bot vivre sans relance.

Une seule relance, ~1 h après la création (`RELANCE_APRES_S`), et la
**décision se reprend à l'exécution** sur l'état réel (`decisionRelance`,
domaine pur) : acompte attendu, zéro franc reçu, commande vivante, et dans la
fenêtre de service sûre (20 h — marge sur les 24 h, dont l'horloge exacte
dépend du dernier message de l'acheteuse). Un franc reçu vaut silence : un
robot ne réclame pas à qui a déjà payé. Dans la fenêtre, la relance est
**gratuite** ; c'est le levier au meilleur ratio du canal (15-30 % de
récupération mesurés sur le marché).

### 5. Les langues — extraction faite, FR et EN complets, pidgin signalé

Toute la copie du fil acheteuse vit dans `textes.ts`, typée : une clé
manquante dans une langue ne compile pas. « english » bascule le fil,
« français » le ramène ; la langue persiste sur `bot_conversation.langue` et
suit la conversation entière, relance comprise.

**Le pidgin est reporté, pas oublié** : l'écrire sans relecture par un
locuteur serait inventer une langue plausible (AGENTS.md §7.7). L'ajouter
sera un membre d'union et un objet de plus. Le fil vendeuse reste en
français — l'app vendeuse entière l'est.

### 6. Les questions en langage libre — des mots-clés, pas de l'IA

Hors flux de commande, trois thèmes reçoivent une réponse préparée avec les
deux boutons de sortie (articles, vendeuse) : prix, photo,
taille/couleur/modèle. Le troisième oriente vers la vendeuse — c'est aussi le
**palliatif assumé de l'absence de variantes** (voir ci-dessous).

## Ce qui est vu et NON fait

- **`product.variants` reste une colonne morte.** Aucune forme définie, aucun
  chemin d'écriture, aucune interface — la vendre par le bot exigerait
  d'inventer le modèle (tailles ? couleurs ? écarts de prix ? stock par
  variante ?). C'est une décision produit à prendre, pas un champ à remplir
  en silence (§7.7). D'ici là : la FAQ « tailles » renvoie à la vendeuse.
- **Le retrait d'une ligne du panier** : « annuler » vide tout, « corriger »
  revient au panier. La gestion ligne à ligne attendra un besoin constaté.
- **La description sur la boutique publique** : à faire quand la boutique
  redeviendra le front principal, avec son instantané et ses tests.
- Relances suivantes (24 h, post-expiration) : exigent des gabarits
  utilitaires — post-WABA.

## Conséquences

- `EtatConv` change de forme ; `normaliserEtat` absorbe les deux générations
  précédentes. `reagirAcheteuse` prend un objet contexte.
- `bot_conversation.langue` et `product.description` en expand ; pg-boss crée
  son schéma au premier démarrage (la sauvegarde du lot 14 l'emporte).
- `pg-boss@12` entre dans les dépendances de l'API — il était déjà dans la
  table de stack d'AGENTS.md.
- La confirmation et le récap savent parler anglais ; le contenu canonique
  (article, quantité, prix unitaire, total, boutique, référence, code) est
  identique dans les deux langues.
