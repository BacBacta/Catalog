# 0108 — Le catalogue natif Meta : photos et prix rendus par WhatsApp

Date : 2026-08-16
Statut : accepté
Révise : 0107 (le catalogue de la vendeuse — la liste reste, elle cesse d'être le plafond)
Câble : 0017 (les photos de catalogue sont publiques), 0046 (transport Meta direct)

## Constat

Le porteur du produit a montré, capture à l'appui, le catalogue d'une
boutique tenue sur un autre compte WhatsApp : photos pleine largeur, prix,
« Ajouter au panier ». Et il a raison sur le fond : nos listes interactives
ne peuvent pas porter d'images — c'est une borne de l'API — mais ce
qu'il montre n'est **ni une liste, ni un Flow**. C'est le **catalogue
Commerce Manager**, attaché au numéro, rendu par WhatsApp lui-même.

Cette voie était vue et reportée (« catalogue natif : attend le WABA »).
Or le WABA existe, le jeton Graph existe, et l'infrastructure de dépôt des
Flows (`depots-meta.yml`, scripts dans l'image Fly) est exactement celle
qu'un dépôt de catalogue demande. Le report n'a plus son motif ; le porteur
demande explicitement la réouverture. C'est cet ADR.

## La contrainte qui commande tout : le catalogue appartient au NUMÉRO

La boutique de la capture a **son propre numéro** WhatsApp Business. Nos
vendeuses partagent le numéro du bot. Il n'existe donc pas de « catalogue de
la vendeuse » chez Meta — il existe **un catalogue du numéro**, un seul.

Décisions qui en découlent :

1. **Un catalogue Commerce Manager unique**, contenant les articles de
   toutes les boutiques. L'identifiant produit chez Meta
   (`retailer_id`) est **l'identifiant de l'article en base** — aucune
   table de correspondance, aucune seconde vérité.
2. **Le bot envoie des messages `product_list` filtrés par boutique** :
   l'acheteuse qui consulte « Chez Amina » ne voit que les articles
   d'Amina, avec photos et prix rendus nativement. La borne Meta est de
   **30 produits par message** ; au-delà, les plus récents d'abord — même
   logique que la carte-vitrine (ADR 0106), c'est là que sont les photos.
3. **Effet de bord assumé** : l'onglet catalogue du **profil** du bot
   montre toutes les boutiques mélangées. On ne peut pas le filtrer — il
   appartient au numéro. Le parcours que Catalog construit passe par la
   conversation, pas par le profil ; si ce mélange devient un problème
   mesuré, la réponse sera un catalogue par vendeuse le jour où les
   vendeuses ont leur numéro — hors de portée v1.
4. **Le panier natif revient en commande** : quand l'acheteuse touche
   « Ajouter au panier » puis envoie, Meta livre un message de genre
   `order` portant les `retailer_id` et quantités. Le bot le convertit en
   panier interne et rejoint le parcours EXISTANT au récapitulatif — mêmes
   contrôles de stock, même acompte, même machine. **Les prix viennent de
   la base, jamais du message** : un catalogue en retard d'une
   synchronisation ne fixe pas le prix d'une commande.

## Ce que ça ne change pas

- **La liste interactive de l'ADR 0107 reste entière**, côté vendeuse
  (« mes articles ») comme côté acheteuse sans catalogue déposé. Sans
  `WABOT_CATALOGUE_ID`, rien ne change nulle part — même règle de dormance
  que les Flows.
- **La rafale « Voir en photos » reste** : elle marche sur tous les
  WhatsApp, le catalogue natif exige un client récent.
- **Catalog n'encaisse toujours rien** (ADR 0009). Le panier natif ne
  déclenche aucun paiement Meta : il compose une commande, et le paiement
  reste le dépôt direct prouvé par SMS.

## La synchronisation

- À chaque publication d'article, le service pousse la fiche vers le
  catalogue (`items_batch`) — en décoration, après la confirmation, jamais
  avant : l'échec de synchronisation se journalise et ne bloque rien
  (même règle que la carte-vitrine).
- `catalogue.mjs --synchroniser` repousse tout depuis la base — l'outil de
  rattrapage, idempotent par construction (`UPDATE` sur `retailer_id`).
- Les photos sont les URL publiques de l'ADR 0017 (`MEDIA_PUBLIC_BASE`),
  déclinaison JPEG. Un article sans photo se synchronise quand même :
  Meta accepte une fiche sans image de moins bonne qualité qu'il en
  refuserait l'absence — à confirmer au premier dépôt, et si l'image est
  obligatoire, l'article sans photo reste hors catalogue et la liste 0107
  le porte.

## Ce qui n'est pas vérifié, et se mesure avant de se croire

Trois inconnues, chacune mesurée par `catalogue.mjs --etat` avant tout
dépôt — la leçon de la sonde de stockage (ADR 0105) :

1. **La portée du jeton.** Les Flows demandent
   `whatsapp_business_management` ; le catalogue demande
   `catalog_management` et `business_management`. Le script lit les
   portées réelles et refuse d'aller plus loin si elles manquent —
   l'erreur dit alors quoi ajouter dans la console Meta.
2. **Le format exact des fiches `items_batch`** (champs obligatoires,
   format du prix en XAF — devise sans sous-unité). Le script lit le
   rapport d'erreurs par fiche que Meta rend après chaque lot.
3. **La disponibilité du commerce sur ce WABA** (politique commerce,
   vérification d'entreprise). Mesurée, pas supposée.

## Séquencement

- **Phase 1 (ce lot)** : le catalogue se VOIT — dépôt, synchronisation,
  `product_list` par boutique, commande native convertie en panier.
- **Hors lot** : le retrait d'articles archivés du catalogue en continu
  (le `--synchroniser` les retire déjà au passage), les sections par
  catégorie, le catalogue dans la carte-vitrine.
