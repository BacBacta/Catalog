# 0035 — La cible bot premium est validée ; le P0 la construit

Date : 02/08/2026 · Statut : accepté · Complète : 0031 à 0034

## Contexte

La maquette cliquable `docs/maquettes/bot-cible.html` (six chapitres, légende
🟢 fenêtre libre / 🟣 gabarit WABA / ✦ Flow / ⚖️ décision porteur) a été
parcourue et **validée intégralement par le porteur du produit** — y compris
les points marqués ⚖️. Cet ADR transforme cette validation en décisions, et
délimite ce que le P0 construit maintenant.

## Décision 1 — les arbitrages ⚖️ sont tranchés

Validés tels que la maquette les montre :

- **Paliers de réputation** : « Boutique Or » à 50 ventes prouvées. Les seuils
  restent de la configuration, jamais des constantes.
- **Délégation bornée** (chapitre 6) : une déléguée peut marquer livré,
  répondre, ajouter des articles ; **jamais** toucher au reversement ni voir
  les totaux. L'implémentation attend son propre ADR de modèle.
- **Diffusion au coût dit** : les relances marketing se paient à l'unité,
  hors abonnement, toujours sur opt-in des clientes. Gabarits WABA — P2.
- **Catalog Pro** (étage 3) : numéro dédié sous le WABA Catalog, en palier
  d'abonnement. Pricing à l'ADR au moment du WABA.
- **L'identité du fil** (contre-signature et avis dans la conversation,
  autorisés par `derniereCommandeId`, jamais par relecture du jeton) : le
  principe est validé ; l'ADR dédié et l'implémentation sont en P1.
- **`Review.productId`** : la colonne naît MAINTENANT (décision 4) — chaque
  jour de paniers multi-articles sans elle rend l'avis par article
  irrécupérable.

## Décision 2 — le P0 répare d'abord le maillon manquant de la preuve

Le repérage du P0 a mis au jour un défaut que toutes les analyses avaient
manqué : **une preuve SMS acceptée n'était jamais appliquée à la commande.**
`POST /api/commandes/:id/preuve` créait la ligne `payment_proof` puis rendait
son verdict — sans faire avancer `proofState`, sans appliquer le versement.
Or le reçu (`emettreRecu`) et la contre-signature exigent `proofState ≥
prouve` : la chaîne verdict → reçu → contre-signature → avis vérifié était
**structurellement morte**. Les tests de route ne vérifiaient que le verdict
HTTP, jamais l'état de la commande après coup.

La réparation, dans la MÊME transaction que l'INSERT qui tranche le
contrôle n° 5 :

- `appliquerEvenement(sms_analyse)` décide de la transition — la machine du
  lot 7 savait déjà tout faire (y compris `declare_non_trace → prouve`,
  ADR 0018) ; il ne manquait que l'appel ;
- quand la transition avance **depuis `attendu`**, le versement s'applique
  (`appliquerVersement`) et le journal comptable reçoit son entrée
  (`paiement_prouve`) ;
- quand elle avance **depuis `declare_non_trace`**, la preuve monte SANS
  ré-appliquer l'argent : le SMS prouve un paiement déjà déclaré, il ne le
  double pas ;
- un verdict « accepté sous réserve » (motif Orange à confirmer, message
  sortant) écrit la preuve mais ne touche NI l'état NI l'argent — conformément
  à AGENTS.md : seul le SMS entrant accepté prouve ;
- le refus de transition est journalisé, comme partout (une transition arrière
  est journalisée puis ignorée).

La réparation a mis au jour un second défaut du même maillon : le contrôle
n° 2 comparait le SMS au **solde entier** (`balanceXaf`) en égalité stricte —
le SMS d'un acompte de 8 000 F sur une commande de 16 000 F aurait été
refusé « il en manque 8 000 ». Or c'est Catalog lui-même qui demande ce
montant. Le montant attendu devient : **l'acompte tant que rien n'est
arrivé, le solde ensuite** (`planDePaiement`, la même règle que le récap).
La tolérance reste zéro (question ouverte du lot 7, inchangée) ; le
sur-paiement reste un écart dit, jamais un rejet silencieux.

## Décision 3 — le P0 « fenêtre libre » (tout 🟢, rien qui n'attende le WABA)

1. **Le bloc paiement en texte brut dans le fil.** La confirmation d'une
   commande à acompte porte : montant, numéro de reversement de la vendeuse,
   opérateur et code d'entrée **lus de la configuration de la rampe**
   (`rampeDepuisEnv`, jamais une constante — AGENTS.md), et le lien `/payer`
   en confort, jamais en porteur unique. Boutique `sans_prepaiement` : rien ne
   change.
2. **Les notifications en fenêtre ouverte, avec file d'attente.**
   - nouvelle commande → la vendeuse (« un SMS de X F devrait arriver —
     collez-le ici ») ;
   - paiement prouvé → l'acheteuse (reçu émis ; le lien de suivi n'est PAS
     re-projeté — garde du lot 10 — la réponse renvoie au message de
     confirmation) ;
   - « livrée » → l'acheteuse, avec l'invitation à noter.
   La livraison est immédiate si la conversation a été active sous 24 h
   (approximation honnête de la fenêtre de service : notre bot n'initie
   jamais) ; sinon la notification attend en base (`bot_notification`,
   ajout seul) et part à la prochaine interaction.
3. **Les messages image.** `MessageSortant` gagne le genre `image` (photo
   pleine largeur + légende, plafond API 1024). La fiche article part
   image d'abord ; « Voir en photos » envoie la rafale des articles
   illustrés. Toute URL est vérifiée avant d'être promise (règle ADR 0032).
4. **« livrée CT-XXXXXX » dans le fil vendeuse** : la commande avance par la
   MÊME machine que la route (`avancerEtape`), même journal, même refus
   journalisé — et l'acheteuse est prévenue.
5. **Les correctifs de couture** : « menu » garde le panier (changer de
   boutique le vide en le disant) ; wa.me de la vendeuse après la
   confirmation ; « hors livraison » sur les totaux en mode livraison ;
   l'URL de l'espace vendeuse dans le message de bienvenue ; le routage
   vendeuse reconnaît aussi `seller.phone` (une vendeuse née de la cérémonie
   Google n'a pas de `authUser.phoneNumber` — ADR 0029).
6. **La relance reversement à ~20 h** (pg-boss, dans la fenêtre des 24 h) :
   une boutique née dans le fil sans reversement reçoit UN rappel, re-décidé
   à l'exécution sur l'état réel — le patron exact de la relance d'acompte.

## Décision 4 — `Review.productId`, en expand

Colonne nullable + index, écrite quand la commande ne porte qu'un seul
article (l'écrasante majorité aujourd'hui). Aucune lecture par article
encore — l'interface viendra en P1. C'est la décision « qui ne se rattrape
pas » : un avis déposé aujourd'hui sans la colonne est perdu pour toujours
pour la fiche article.

## Ce que le P0 ne fait PAS (vu, décidé, remis)

- Tout ce qui exige un gabarit ou le WABA : carrousels, Flows, relances
  au-delà de 24 h, notification hors fenêtre, vCard générée, réactions —
  l'architecture des messages les accueillera sans casse (P2).
- La contre-signature et l'avis DANS le fil : après l'ADR « identité du
  fil » (P1).
- La réservation de stock à rebours, le demi-gros, la carte-vitrine générée,
  la photo légendée → article, les photos multiples, la recherche pg_trgm,
  le digest du matin, le mode congés, la délégation : P1, chacun avec son
  morceau d'ADR quand un modèle est en jeu.
- Le pidgin reste soumis à relecture par une locutrice (ADR 0033, §7.7).

## Conséquences

- `payment_proof` reste en ajout seul ; c'est la COMMANDE qui bouge, dans la
  transaction de l'INSERT.
- Deux nouvelles files pg-boss nommées (`bot-relance-reversement`) et une
  table `bot_notification` (ajout seul, remise datée).
- `BotConversation.derniereCommandeId` gagne un index : c'est désormais un
  chemin de lecture (notification acheteuse).
- Les textes acheteuse gagnent leurs clés bilingues (parité tenue par le
  typage) ; le fil vendeuse reste en français (ADR 0033).
