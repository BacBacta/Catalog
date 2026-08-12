# 0032 — Révisions conversationnelles du bot : récapitulatif, mémoire, confiance

Date : 02/08/2026 · Statut : accepté · Révise partiellement : 0031

## Contexte

Le premier test utilisateur du bot (sandbox 360dialog, parcours complet jusqu'au
checkout) a conduit à une analyse critique approfondie, versionnée dans
`docs/analyses/2026-08-02-analyse-critique-bot.md`. Elle relève quinze constats,
dont plusieurs défauts de conception de la machine de conversation de
l'ADR 0031 — le plus grave étant la **création de commande sans confirmation** :
l'effet `creer_commande` partait dès que l'analyse des détails de livraison
réussissait, sans que l'acheteuse voie jamais ce que la grammaire à virgule
avait compris.

## Décisions

### 1. Rien ne se crée sans récapitulatif

Un état `recap` s'insère entre `details` et la création. Il montre l'article,
la quantité, le total, l'acompte — calculé par `planDePaiement`, la même règle
que la création — et la **livraison relue** telle que comprise. Trois boutons :
Confirmer, Corriger (retour à la quantité), Annuler. L'effet `creer_commande`
ne sort QUE de cet état, sur « Confirmer ».

Le récapitulatif ne porte **ni référence ni code de vérification** : ces champs
n'existent qu'après création et ne s'inventent pas (AGENTS.md, contenu
canonique). La confirmation post-création, elle, relit aussi la livraison :
c'est le document que l'acheteuse garde.

### 2. Aucun état n'est un piège

Trois mots-clés texte marchent dans tout état : « menu », « annuler »,
« aide » — en correspondance exacte, sans accents ni casse, pour ne pas
collisionner avec un repère de livraison qui contiendrait le mot. Le mode se
tape aussi (« livraison », « retrait »). L'état `mode` gagne un bouton
Annuler ; la boutique vide propose une sortie (vendeuse ou accueil).

### 3. La conversation a une mémoire

- **Péremption** : un état de flux (`quantite`…`recap`) abandonné plus de
  24 h (`INACTIVITE_MAX_MS`) retombe sur le catalogue de la même boutique.
  Sans cela, un « bonjour » trois semaines plus tard était analysé comme une
  adresse.
- **Dernière commande** : `bot_conversation.derniere_commande_id` (nullable,
  sans clé étrangère) permet de répondre à « où est ma commande ? » avec les
  libellés du cycle de vie du lot 11 — sans réconcilier par numéro de
  téléphone, qui n'est pas fiable (diaspora : numéro de fil ≠ numéro de
  livraison). La réponse ne porte **jamais** le lien de suivi : le
  `buyerToken` ne se re-projette pas (garde du lot 10) ; elle renvoie au
  message de confirmation qui le porte déjà.

### 4. La confiance se dit à l'accueil

L'accueil de boutique porte la réputation du lot 12 — note sur avis vérifiés
et nombre de ventes prouvées — et une ligne sur le reçu vérifiable. À zéro
vente vérifiée, la ligne ne s'affiche pas : on ne fait pas dire « 0 vente » à
une vendeuse qui débute. C'est l'argument différenciant du produit, dit au
moment où le scepticisme de l'acheteuse est maximal.

### 5. La copie sortante s'écrit en français accentué

La convention ASCII du dépôt vaut pour les commentaires et les identifiants,
pas pour les textes destinés aux utilisatrices. « Verifiez le lien recu »
était une fuite de convention, pas un choix.

La copie distingue aussi **payer** de **suivre** : le lien envoyé après
création est le lien de suivi ; il ne se présente « pour payer l'acompte »
que quand un acompte est attendu. En `sans_prepaiement`, il dit « rien à
payer d'avance — vous payez à la réception ».

### 6. Une déclinaison JPEG, pour les canaux sans AVIF ni WebP

L'API Cloud de WhatsApp n'accepte ni AVIF ni WebP. Le pipeline d'images
produit désormais une troisième déclinaison `.jpg` (échelle `QUALITES_JPEG`,
mozjpeg, même cible de 100 Ko — ADR 0016), stockée à côté des deux autres. La
boutique publique ne la sert jamais.

Le fil l'utilise en **en-tête image** : l'accueil (première entrée par lien)
et la fiche article. Règle dure : l'URL signée n'est promise qu'après
vérification d'existence de l'objet (`taille()`), car un en-tête au lien mort
fait refuser le message entier par l'API — et les objets antérieurs à cet ADR
n'ont pas de JPEG. Toute erreur de stockage dégrade en « pas d'image »,
jamais en message perdu.

### 7. L'entonnoir se mesure

`catalog.bot.transition` (compteur OTel, `de`/`vers`/`effet`) compte chaque
transition d'état de la machine. Étiquettes à cardinalité bornée — les noms
d'état —, **aucun texte, aucun numéro, aucun montant** (même règle que le
lot 14). C'est ce qui permettra de répondre « où perd-on les acheteuses ? »
avec des données au lieu d'opinions, y compris `de === vers` : un état qui
boucle est une acheteuse qui ne se fait pas comprendre.

## Ce qui est vu et reporté

- **Notification vendeuse à la création** : un message d'initiative exige un
  gabarit approuvé — post-WABA/PLBV.
- **Verdict des sept contrôles dans le fil vendeuse** : attend l'extraction de
  l'orchestration de preuve (ADR 0031, inchangé).
- **Stock, variantes, panier multi-articles, relance d'acompte, EN/pidgin** :
  sprint B de l'analyse.
- Les libellés du cycle (`order/cycle.ts`) restent sans accents : ils
  alimentent aussi la boutique publique et se corrigeront ensemble, hors de
  ce lot.

## Conséquences

- `EtatConv` gagne `recap` ; les états persistés existants restent valides
  (aucune migration de forme, la colonne `derniere_commande_id` est en ajout
  seul).
- `confirmationCommande` change de signature (livraison relue, `lienSuivi`
  au lieu de `lienPaiement`) — appelée par le seul service du bot.
- `declinaisons()` rend trois clés ; le téléversement écrit trois objets, la
  suppression en retire trois. Les produits existants n'ont pas de JPEG : le
  fil les montre sans image jusqu'au prochain téléversement.
