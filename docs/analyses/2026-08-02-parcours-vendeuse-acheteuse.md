# Les deux parcours — de l'ouverture de la boutique au paiement, pas à pas, contre le standard 2026

Date : 02/08/2026 · Format : le PARCOURS, étape par étape — la vendeuse
(partie A), l'acheteuse (partie B), puis l'architecture du catalogue
individuel par boutique (partie C) et la feuille de route consolidée
(partie D) · Chaque étape suit le même gabarit : **ce qui se passe
aujourd'hui** (mesuré dans le code, message par message) → **le standard
2026** → **l'écart, et sa gravité**.

Ce document intègre et remplace les priorisations des trois analyses
précédentes. Trois faits nouveaux, vérifiés pour celui-ci, changent des
conclusions antérieures :

1. **Le catalogue natif Meta est lié au WABA et plafonné à 500 produits par
   WABA.** Sur un numéro partagé, c'est un plafond de ~25-30 boutiques
   (moyenne mesurée du seed : 6 articles/boutique ; terrain probable :
   15-20). Le « catalogue individuel par boutique » a donc un mur
   structurel — et des issues, voir partie C.
2. **`Review` n'a pas de `productId`.** L'avis au niveau article — le levier
   de conversion n°1 du commerce 2026 (+8-15 % sur fiche) — est
   structurellement impossible avec le modèle actuel.
3. **Je corrige une erreur répétée dans mes analyses : les notifications
   vendeuse ne sont PAS toutes « post-WABA ».** Une vendeuse qui a écrit au
   bot il y a moins de 24 h a une fenêtre de service OUVERTE : un message
   libre lui est permis. « Nouvelle commande CT-x » est donc possible dès
   aujourd'hui pour toute vendeuse active — c'est la file d'attente pour les
   inactives qui attend les gabarits.

---

# PARTIE A — Le parcours de la vendeuse

## A1. La découverte et l'entrée

**Aujourd'hui.** Trois portes : taper « vendre » (qui le sait ?), le lien de
parrainage « vendre avec ‹slug› » (bien : attribution propre), le bouton
« Vendre avec Catalog » sur l'aide acheteuse. C'est tout.

**Standard 2026.** L'acquisition d'un produit WhatsApp-first est elle-même
WhatsApp-native : QR code imprimable (l'étal du marché est un lieu physique),
carte-visite image prête à partager, lien court mémorisable. Le parrainage
est mesuré en taux (invitées → ouvertes → actives), pas seulement attribué.

**Écart.** Aucun support physique ni visuel — pour des vendeuses dont le
lieu de vente est un étal et le canal un Statut, c'est l'essentiel qui
manque. Le parrainage attribue mais ne se mesure pas (aucun compteur).
*Gravité : moyenne aujourd'hui, haute au lancement réel.*

## A2. L'ouverture de la boutique

**Aujourd'hui.** « vendre » → nom → ville → boutique ouverte, ~40 secondes,
zéro navigateur, numéro attesté par le message même (équivalent OTP, ADR
0034). **C'est au-dessus du standard en friction — peu d'acteurs font
mieux.**

**Mais la boutique naît sans identité.** Vérifié au modèle : `Seller` n'a
AUCUN champ visuel — ni photo de vitrine, ni logo. Le `quartier` existe en
base et n'est pas demandé. La « vitrine » qu'une acheteuse verra à l'accueil
est la photo du premier article — par accident de tri, pas par choix de la
vendeuse.

**Standard 2026.** Un profil marchand riche : visuel de vitrine, quartier,
description courte de la boutique, horaires. Chez les concurrents à numéro
dédié, le profil WhatsApp Business porte tout cela nativement ; nous avons
choisi le numéro partagé (ADR 0034, assumé : le numéro du notaire) — donc
**tout ce que le profil aurait porté doit être compensé dans le contenu**,
et rien ne l'est.

**Écart.** Il manque une 3ᵉ question facultative (« une photo pour votre
vitrine ? ») et le quartier. *Gravité : haute — c'est l'identité de marque
de chaque boutique qui est en jeu, voir B2.*

## A3. La construction du catalogue — le cœur, et le plus gros écart vendeuse

**Aujourd'hui.** Par article : « ajouter » → nom → prix → photo → publié.
~45 secondes par article, robuste (prix « 15 000 FCFA » compris, photo par
le pipeline complet — EXIF purgé, 100 Ko). Mais :

- **La légende de la photo est captée par le parseur et JAMAIS exploitée.**
  `entrees.ts` lit `image.caption` ; la machine l'ignore. Or LE geste
  naturel du terrain — celui que la vendeuse fait déjà dans son Statut —
  est d'envoyer une photo légendée « Pagne wax 6 yards 15 000 ». **Un seul
  message devrait créer l'article entier** (nom et prix extraits de la
  légende, photo attachée). On tient la donnée, on ne s'en sert pas.
- **Une photo par article** (`imageKey` unique) — le Statut d'une vendeuse
  en montre 3 à 5.
- **Le fil est en ajout seul** : impossible d'y VOIR son catalogue, de
  modifier un prix, d'archiver, de réordonner, de poser une description.
  Une vendeuse née du fil gère un catalogue qu'elle n'a jamais vu.
- **Aucune prévisualisation** : « voici votre boutique telle que vos
  clientes la voient » n'existe pas — c'est pourtant la boucle de
  motivation la plus simple du commerce.
- Pas de saisie en rafale (5 photos d'affilée → 5 brouillons à confirmer).

**Standard 2026.** L'import par photo légendée est exactement ce que font
les meilleurs bots de catalogue ; la gestion complète (liste, édition,
aperçu) est le minimum ; l'import en lot est courant.

*Gravité : haute — c'est la promesse centrale faite à la vendeuse.*

## A4. Le partage — la mise en vente réelle

**Aujourd'hui.** Un lien `wa.me` nu avec texte pré-rempli. Point.

**Standard 2026.** Le canal de vente n°1 d'une vendeuse camerounaise est son
**Statut WhatsApp** — un média visuel. Le standard : une carte-vitrine
IMAGE générée (nom, 2-3 produits, le lien, un QR), prête à poster en Statut
et à imprimer pour l'étal. Le lien `wa.me` n'a pas d'aperçu riche (pas de
vignette produit dans le partage) : l'image générée est LA compensation.

**Écart.** Rien n'existe. La vendeuse doit rédiger elle-même son propre
marketing. *Gravité : haute — c'est l'acquisition d'acheteuses de CHAQUE
boutique qui dépend de ce maillon.*

## A5. La première commande arrive — le moment de vérité

**Aujourd'hui.** **Rien.** La commande est créée, la vendeuse n'apprend son
existence que si elle ouvre l'app (dont l'URL ne lui a jamais été donnée —
trou déjà acté) ou écrit « solde » au bot.

**Standard 2026.** Notification instantanée, systématique, avec le détail et
l'action suivante. C'est LE moment où le produit prouve sa valeur.

**Écart — et correction de mes analyses précédentes.** J'ai répété que
c'était « structurel pré-WABA ». C'est faux pour les vendeuses ACTIVES : une
vendeuse qui a interagi avec le bot il y a moins de 24 h a une fenêtre de
service ouverte — le message libre « 🛍️ Nouvelle commande CT-104312 —
Sac × 2, Huile × 1 — 19 500 F — livraison Bonapriso » est PERMIS et
GRATUIT. La règle honnête : notifier si la fenêtre est ouverte ; sinon,
mettre en file et dire à la prochaine interaction « pendant votre absence :
2 commandes ». Les gabarits (WABA) ne sont nécessaires que pour réveiller
les inactives. *Gravité : critique, et corrigeable en partie MAINTENANT.*

## A6. L'encaissement et la preuve

**Aujourd'hui.** Acompte attendu → l'acheteuse paie (si elle y arrive, voir
B7) → le SMS arrive sur le téléphone de la vendeuse → elle doit d'elle-même
penser à le coller → dans le fil, on lui répond d'aller le RE-coller dans
l'app (double collage, dette ADR 0031) → verdict → reçu. Sans reversement
(toutes les boutiques nées du fil) : espèces à la livraison, non tracé,
pas de reçu.

**Ce qui manque au-delà du déjà-dit :** la vendeuse n'est jamais prévenue
qu'un paiement est EN ROUTE. Le rapprochement n'est pas préparé (« un SMS
de 9 500 F devrait arriver pour CT-104312 — collez-le ici dès réception ») ;
c'est pourtant le prompt qui transformerait le réflexe SMS en réflexe
Catalog.

**Standard 2026.** Confirmation de paiement instantanée côté marchand (PSP).
Notre modèle sans custody ne l'aura jamais en temps réel — mais l'annonce
« paiement en route » et le rapprochement préparé sont notre équivalent, et
ils n'existent pas. *Gravité : haute.*

## A7. Après la vente

Étapes de commande (« préparée », « livrée ») : app seulement. Avis : jamais
sollicités. Statistiques : app seulement. La vendeuse du fil vit dans le
noir post-vente — déjà acté dans l'analyse transversale, inchangé.

**Scorecard vendeuse** — ouverture : A ; identité de boutique : D ;
catalogue : C− ; partage : D ; notification de commande : F (corrigeable en
B+ dès maintenant pour les actives) ; encaissement-preuve : C ;
post-vente : D.

---

# PARTIE B — Le parcours de l'acheteuse

## B1. L'entrée

**Aujourd'hui.** Elle clique le lien (Statut, groupe, message transféré) →
WhatsApp s'ouvre avec « Voir la boutique chez-amina » pré-rempli → **elle
doit encore appuyer Envoyer** → l'accueil arrive. Deux gestes, un doute
(« pourquoi j'envoie ça ? »).

**Standard 2026.** Le pré-rempli est le standard wa.me — incompressible.
Ce qui se compense : un lien SANS aperçu riche doit être porté par le
visuel qui l'entoure (la carte-vitrine de A4 — la même pièce manquante,
vue de l'autre bout).

## B2. L'accueil de LA boutique — l'identité individuelle

**Aujourd'hui.** Trois lignes de texte (« *Chez Amina* — Douala », ★ si des
avis vérifiés existent, le pitch reçu vérifiable) + bannière SI le premier
article a un JPEG + deux boutons. Le fil, lui, s'appelle Catalog, avec la
photo de profil de Catalog.

**Le problème structurel : la boutique n'a pas de lieu, elle n'a qu'un
contexte.** Chez un concurrent à numéro dédié, « la boutique » est un
CONTACT — nom, photo, catalogue natif dans le profil, historique de
conversation qui lui appartient. Chez nous, chez-amina et chez-bea vivent
dans le même fil, se remplacent l'une l'autre dans l'état, et l'acheteuse
qui compare deux boutiques les fait se chasser mutuellement (panier vidé
au passage — T7). Le choix du numéro partagé est défendu et maintenu (ADR
0034 : le notaire) ; mais **son coût — l'identité diluée — n'est compensé
nulle part** : pas de carte-vitrine en tête d'accueil, pas de quartier, pas
d'ancienneté, pas de « 12 articles · 8 ventes prouvées » quand il n'y a pas
encore d'avis (démarrage à froid : la réputation se tait, rien ne la
remplace).

**Standard 2026.** Identité marchande immédiate et différenciée dès le
premier écran ; à défaut de profil, par le contenu.

*Gravité : haute — c'est LA conséquence UX du choix mono-WABA, et elle
n'est traitée par rien.*

## B3. Le catalogue individuel, vu par l'acheteuse

**Aujourd'hui.** Une liste texte : 8 articles + « voir la suite », titres
tronqués à 24 caractères, prix — **aucune vignette** (plafond de l'API des
listes). Une boutique de 40 articles = 5 pages plates, sans sections ni
catégories. Aucune recherche (« vous avez des pagnes ? » tombe dans la FAQ
générique). La fiche s'ouvre article par article, en bannière recadrée —
jamais une photo plein format (aucun constructeur de message image,
vérifié).

**Standard 2026.** Message multi-produits : jusqu'à 30 produits en sections
AVEC vignettes, panier natif — le client feuillette dans l'interface. En
pré-WABA, les meilleurs font de l'image-first : rafales d'images légendées
(album), qui est EXACTEMENT ce que le Statut d'une vendeuse fait déjà.

**Écart.** Notre catalogue conversationnel est **moins visuel que le Statut
gratuit de la vendeuse** — l'acheteuse quitte un média riche (le Statut qui
l'a attirée) pour un média pauvre (la liste texte). C'est l'inversion
exacte de la promesse. *Gravité : critique. Palliatif immédiat : fiches en
message image plein format + « voir en photos » (rafale). Résolution :
partie C.*

## B4. La fiche article

**Aujourd'hui.** Bannière + nom + prix + stock (s'il est suivi — champ que
personne ne peut saisir, trou déjà acté) + description (si posée — depuis le
web seulement) + [Commander] [Retour].

**Standard 2026.** Photo(s) plein format, variantes, **avis au niveau
article** (8-15 % de conversion en plus), produits liés.

**Écart nouveau et structurel : `Review` n'a pas de `productId`.** L'avis
est par commande/boutique — jamais rattachable à un article. Une commande
panier (ADR 0033) contient plusieurs articles : même rétroactivement,
l'attribution serait ambiguë. Si l'avis par article est voulu un jour, c'est
une décision de modèle À PRENDRE MAINTENANT (expand : `productId` nullable +
sollicitation par ligne de panier), pas un rattrapage possible plus tard.
*Gravité : moyenne aujourd'hui, structurante à terme.*

## B5. Le panier

**Aujourd'hui.** Multi-articles, fusion des doublons, borné par le stock,
récap complet — **au niveau du marché** depuis l'ADR 0033. Restent : pas de
« voir mon panier » (les lignes ne se montrent qu'au récap), « menu » qui le
vide en silence, et un panier par conversation (changer de boutique =
perdre — cohérent une-commande-une-vendeuse, mais silencieux).

**Standard 2026.** Panier natif du client WhatsApp (post-WABA), persistant
par conversation — Meta le fait persister nativement ; d'ici là, le nôtre
fait le travail.

## B6. Le checkout

**Aujourd'hui.** Mode → détails en grammaire à virgule (aide-pas-erreur,
tolérante, mais grammaire quand même) → récap → Confirmer. Solide depuis
les sprints A/B, SAUF un angle mort de fond : **le total ne dit rien de la
livraison.** `totalXaf` = les articles, point. Le récap affiche
« Total : 19 500 F » — l'acheteuse comprend « tout compris », puis les
frais de course se négocient après coup avec la vendeuse. Dans un produit
dont la raison d'être est de PRÉVENIR les litiges, l'ambiguïté du total est
la source de litige n°1 laissée ouverte. Le modèle n'a AUCUNE notion de
frais de livraison — même pas « à convenir ».

**Standard 2026.** Frais affichés avant confirmation, ou à défaut
l'honnêteté explicite (« hors livraison — la vendeuse vous dira le prix de
la course »). Flows pour la saisie structurée (post-WABA).

*Gravité : haute, et la moitié se corrige par UNE ligne de copie.*

## B7. Le paiement — déjà jugé, complété d'un angle mort

**Aujourd'hui.** « Pour payer l'acompte, ouvrez ‹lien› » → page de suivi qui
ne sait pas payer (impasse T9) ; le bloc paiement en texte brut d'AGENTS.md
jamais branché — analyse doctrine, inchangée. S'y ajoute : **l'attente
aveugle.** Une fois qu'elle a payé, l'acheteuse n'a AUCUN retour tant que
la vendeuse n'a pas collé son SMS — des heures, parfois plus. Sa fenêtre de
service est pourtant ouverte : le verdict de preuve peut lui être poussé en
message libre (« ✅ Votre paiement de 9 500 F est prouvé — votre reçu :
‹/v/…› ») dès que la preuve passe. Rien n'est branché.

**Standard 2026.** Confirmation instantanée (PSP). Notre équivalent
asynchrone honnête : dire l'attente (« la vendeuse confirme dès réception de
son SMS — vous serez prévenue ici »), puis tenir parole. *Gravité :
critique — c'est le moment de plus forte anxiété du parcours, et le seul
où le produit se tait.*

**Scorecard acheteuse** — entrée : B ; identité boutique : D ; catalogue :
D ; fiche : C− ; panier : B+ ; checkout : B− (frais : D) ; paiement : F
(bloc texte brut : 1 jour de travail) ; post-paiement : F (notification
possible dès maintenant).

---

# PARTIE C — Le « catalogue individuel par boutique » : l'architecture, ses murs, ses issues

## C1. Aujourd'hui : un catalogue individuel qui n'est qu'un état

Le catalogue « de la boutique » n'existe que comme `slug` dans l'état de
conversation. Conséquences précises : une seule boutique visible à la fois ;
l'identité portée par le seul texte ; le lien d'entrée comme unique espace
de nommage ; la comparaison entre boutiques destructrice (état + panier).
C'est fonctionnel et pauvre — le plancher, pas le plafond.

## C2. Post-WABA : le mur des 500

Fait vérifié : **le catalogue natif Meta est rattaché au WABA — un par
compte, 500 produits maximum** — et c'est LUI qui alimente vignettes,
messages produit et panier natif. Trois conséquences pour une place de
marché sur numéro partagé :

1. **Le plafond arithmétique.** À 15-20 articles par boutique active, 500
   produits ≈ **25 à 30 boutiques**. Le catalogue natif partagé ne passe
   pas l'échelle du produit — il ne peut être qu'un outil d'affichage
   curaté, pas le miroir du parc.
2. **L'onglet catalogue du profil montrerait TOUTES les boutiques
   mélangées.** Assumable en « marché Catalog » vitrine, ou à désactiver ;
   dans les deux cas, ce n'est PAS le catalogue individuel demandé.
3. **Les messages multi-produits, eux, se scopent** : 30 produits max en
   sections, choisis par nous — donc « le catalogue de chez-amina » en MPM
   vignettes est possible pour toute boutique ≤ 30 articles référencés au
   catalogue partagé. C'est l'issue de milieu de gamme.

## C3. L'issue que l'ADR 0034 n'interdit pas : des numéros sous NOTRE WABA

L'ADR 0034 a écarté « un WABA par vendeuse » (RCCM, numéro personnel,
économie) — et il a raison. Mais **un WABA porte plusieurs NUMÉROS : 2 dès
le départ, jusqu'à 20 après vérification de l'entreprise** — la nôtre, avec
NOTRE RCCM. Un numéro dédié sous le WABA Catalog n'exige RIEN de la
vendeuse : c'est notre entité, notre vérification, son numéro applicatif.
Chaque numéro a son profil (nom, photo = SA vitrine) et son propre catalogue
natif de 500 produits.

**L'architecture cible se dessine donc en trois étages :**

- **Étage 1 — toutes les boutiques** (aujourd'hui) : catalogue
  conversationnel scopé par slug sur le numéro partagé, fiches image plein
  format, rafales « voir en photos », carte-vitrine générée. Le numéro
  partagé reste le notaire et l'entrée de gamme.
- **Étage 2 — post-WABA** : catalogue Meta partagé alimenté par flux
  (500 produits curatés — les meilleures ventes du réseau), MPM scopés par
  boutique (vignettes, panier natif) pour les boutiques référencées.
- **Étage 3 — premium** : un NUMÉRO dédié sous le WABA Catalog pour les
  boutiques qui le justifient — profil à leur nom, photo à elles, catalogue
  natif à elles, vrai « contact boutique » dans le téléphone des clientes.
  Coût réel par numéro (hébergement BSP) → c'est un palier d'abonnement,
  pas un droit — **et c'est un modèle économique à décider par le porteur
  du produit (ADR), pas par cette analyse.**

Le point clé : ces trois étages sont CUMULATIFS et le travail de l'étage 1
(JPEG, flux produit, descriptions) est la fondation des deux autres. Rien
n'est jetable.

---

# PARTIE D — Feuille de route consolidée (remplace les précédentes)

## P0 — les deux moments de vérité (≈ 5 j)

1. **Payer dans le fil** : bloc texte brut (numéro, montant, code d'entrée
   par opérateur depuis `/api/rampe`), lien `/payer` en confort. ~1 j.
2. **Être payée, le savoir** : notification vendeuse en fenêtre ouverte
   (« nouvelle commande », « SMS de X F attendu pour CT-x — collez-le
   ici ») + file d'attente pour inactives ; notification acheteuse au
   verdict de preuve (reçu + lien `/v/`). ~1,5 j.
3. **Voir les produits** : message image plein format (constructeur),
   fiche image-first, « voir en photos » (rafale). ~1,5 j.
4. **L'honnêteté du total** : « hors livraison — le prix de la course se
   convient avec la vendeuse » dans récap et confirmation. ~0,25 j.
5. Les correctifs déjà actés : URL de l'app, relance reversement J+1,
   routage `seller.phone`, « menu » garde le panier, wa.me vendeuse
   post-confirmation. ~1 j.

## P1 — l'identité et le catalogue vivant (≈ 6 j + 3 ADR)

- **Photo légendée = article créé** (nom + prix extraits de la légende,
  confirmation avant publication — §7.7 : on confirme, on ne devine pas en
  silence).
- **Carte-vitrine générée** (image : nom, produits, lien, QR) — le maillon
  partagé des deux parcours (A4/B1).
- **Vitrine de boutique** : photo choisie par la vendeuse (3ᵉ question
  facultative de l'inscription + app) — ADR modèle (`Seller.imageKey`).
- **« ma boutique » montre le catalogue** (lecture, puis édition simple :
  prix, retrait).
- **Photos multiples par article** — ADR modèle.
- **`Review.productId`** (expand, nullable) — la décision qui ne se
  rattrape pas plus tard.
- « livrée CT-x » dans le fil → sollicitation d'avis in-thread ; ADR
  identité du fil (contre-signature) — inchangés de l'analyse doctrine.

## P2 — WABA et étages 2-3

Flux catalogue Meta (500 curatés) + MPM par boutique + panier natif ;
gabarits pour réveiller les inactives ; **ADR de l'offre par étages**
(numéros dédiés sous le WABA Catalog — pricing du porteur du produit) ;
ADR du rôle de la boutique web (repli sur `/v/` + `/payer` + `/suivi`).

---

## Sources

[Chatarmin — WhatsApp Catalog : limites, sync, MPM (2026)](https://chatarmin.com/en/blog/whatsapp-business-catalog) ·
[Meta — Catalogs overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/) ·
[Blueticks — WhatsApp Business multiple numbers (2026)](https://blueticks.co/blog/whatsapp-business-multiple-numbers) ·
[go4whatsup — WhatsApp Commerce 2026](https://www.go4whatsup.com/guides/whatsapp-commerce/) ·
et les sources des trois analyses précédentes (activation Mirakl/WC Vendors,
post-achat Bloomreach, Flows, acteurs africains TechTrendsKE).
