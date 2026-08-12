# Analyse critique approfondie — le bot au checkout, face à l'état de l'art 2026

Date : 02/08/2026 · Périmètre : le parcours acheteuse et le fil vendeuse du bot
WhatsApp (ADR 0031), tels que testés en sandbox jusqu'au checkout · Méthode :
relecture message par message du code réel (`apps/api/src/domain/bot/`,
`apps/api/src/bot.ts`), évaluation heuristique adaptée au conversationnel,
comparaison sourcée avec les acteurs 2026 (mondiaux et africains), économie des
conversations Meta face à l'abonnement à 2 500 F.

Ce document ne remplace aucun ADR. Il constate ; les décisions qui en sortiront
auront leurs propres ADR.

---

## 1. Le verdict en une phrase

Le squelette est sain — machine pure, menu déterministe, contenu canonique,
création de commande réelle — mais le bot vend aujourd'hui **sans images, sans
confiance affichée, sans confirmation, sans mémoire et avec deux boutons
cassés ou piégés** ; l'écart avec les meilleurs n'est pas d'abord structurel
(WABA, Flows), il est pour l'essentiel **dans notre propre copie d'écran**, et
la majorité se corrige cette semaine, en sandbox.

---

## 2. Le parcours réel, message par message

Ce que l'acheteuse a vu, dans l'ordre, avec ce que chaque étape coûte en
conversion.

### 2.1 Entrée — « boutique chez-amina »

> *Chez Amina* — Douala
> Commandez ici, la vendeuse vous repond sur son WhatsApp.
> [Voir les articles] [Parler a la vendeuse]

- **Aucune image d'en-tête.** Les messages à boutons acceptent un en-tête
  image ; c'est la vitrine de la boutique et elle est vide. Première impression
  = deux lignes de texte.
- **Aucun signal de confiance.** Le lot 12 (avis vérifiés, réputation) existe
  côté serveur et n'apparaît nulle part. Dans un marché où l'arnaque à la
  fausse capture MoMo est la fraude dominante — c'est la raison d'être du
  produit —, l'accueil ne dit ni « N ventes prouvées », ni « note X/5 sur M
  avis vérifiés », ni « reçu vérifiable inclus ». **Notre différenciateur
  numéro un est invisible au moment où le scepticisme est maximal.**
- **Un tap de taxe.** L'état passe déjà à `catalogue` ; le bouton « Voir les
  articles » ne fait que retarder la liste d'un tap sans rien apprendre.
  Fusionner accueil et première liste (le corps de la liste porte le nom, la
  ville, la réputation) économise une étape sur cinq.
- **« Parler à la vendeuse » est un bouton mort.** L'identifiant `vendeuse`
  est émis (`conversation.ts:242`) et n'est traité nulle part : l'appui
  retombe dans le `switch` puis le `default`, qui renvoie… l'accueil. La
  personne qui veut un humain — le geste de réassurance le plus important du
  canal — tourne en boucle. C'est un défaut de tests (le test vérifie que le
  bouton est émis, pas qu'il fait quelque chose).

### 2.2 Catalogue — la liste

> *Chez Amina* — 4 articles
> [Voir les articles] → lignes : nom + prix

- Le prix en description de ligne est bien. Mais **titres tronqués à 24
  caractères**, pas d'images (limite du format liste — structurel), pas de
  regroupement, et la position de page se perd au retour de la fiche
  (`ficheArticle` remet `page: 0`).
- Boutique vide → un texte sans aucun bouton (`pageCatalogue`, cas
  `tranche.length === 0`) : cul-de-sac.

### 2.3 Fiche article

> *Pagne wax 6 yards*
> 15 000 F CFA
> [Commander] [Retour au catalogue]

C'est **le point de perte principal**, et il est triplement à nous :

- **Pas de photo.** La chaîne d'images (lot 5) stocke AVIF et WebP ; l'API
  Cloud n'accepte que JPEG/PNG. Il manque une déclinaison JPEG — une évolution
  de pipeline, pas une refonte. Vendre du pagne sans photo, c'est vendre à
  l'aveugle : le textile est précisément la catégorie la plus difficile du
  commerce WhatsApp africain (voir sources), celle où l'image et la variante
  font la vente.
- **Pas de description.** Le modèle `Product` n'a d'ailleurs **aucun champ
  description** — la fiche dit tout ce que la base sait. C'est un manque de
  modèle de données, pas seulement de bot.
- **Stock et variantes existent en base et sont ignorés**
  (`schema.prisma:104-105` ; `chargerBoutique` ne sélectionne que
  id/nom/prix). La boutique web affiche le stock suivi (« plus que 3 ») ;
  le bot, non — il perd l'effet de rareté ET laisse commander 10 unités d'un
  article suivi à 2. Les variantes (tailles !) sont invendables par le bot.

### 2.4 Quantité

> Combien de « Pagne wax 6 yards » voulez-vous ?
> [1] [2] [Un autre nombre]

- Le choix est bon. Mais **l'état est un piège** : le message n'offre que
  `qte:*` ; écrire « retour », « annuler » ou « menu » tombe dans
  l'analyse numérique et répond « Je n'ai pas compris le nombre ». Il n'existe
  **aucun mot-clé texte global** — `menu` n'existe que comme identifiant de
  bouton, et le bouton n'est plus à l'écran. Les seules issues : un nombre
  valide, ou repartir du lien de la boutique.
- Après le choix, **aucun écho de sous-total** (« 2 × 15 000 = 30 000 F »).
  L'acheteuse avance sans jamais voir le montant se construire.

### 2.5 Mode puis détails de livraison

> Votre quartier, un repere, puis le numero a appeler — en un seul message.

- Trois informations en un message, avec une **grammaire à virgule** (quartier
  avant la première virgule, repère après, téléphone camerounais en fin). Les
  messages d'aide en cas d'échec sont une vraie qualité (aide, pas erreur,
  exemple concret) — mais l'aide est statique : au deuxième échec, on répète
  le même texte au lieu de basculer en une-question-à-la-fois.
- **Aucun coût de livraison n'existe dans le produit.** Les frais cachés sont
  la première cause d'abandon du commerce en ligne ; ici ils ne sont même pas
  cachés, ils sont indicibles. À défaut d'un modèle de frais, la fiche ou le
  mode devrait au moins dire « frais de livraison à convenir avec la
  vendeuse ».
- **État sans péremption** : `BotConversation` n'a pas de TTL. Un « bonjour »
  envoyé trois semaines plus tard dans un état `details` oublié est analysé
  comme une adresse (« Il me manque le numero… »). Déroutant et évitable.

### 2.6 La création — le défaut le plus grave

Dès que l'analyse des détails réussit, **la commande est créée
immédiatement** (`conversation.ts:218-231`) : pas de récapitulatif, pas de
« Confirmer / Modifier / Annuler ». Trois conséquences :

1. **L'acheteuse ne voit jamais ce que la grammaire à virgule a compris.** Un
   repère mal découpé (quartier avalé, repère tronqué) entre tel quel dans la
   commande — et la confirmation n'affiche PAS la livraison (ni quartier, ni
   repère, ni numéro) : l'erreur est invisible jusqu'à la livraison ratée.
2. Une commande à corriger n'a **aucun chemin dans le fil** : pas de mot-clé
   « annuler », alors que le cycle de vie du lot 11 sait annuler côté app.
3. Chaque essai maladroit crée une commande réelle avec échéance à 48 h chez
   la vendeuse.

Un point de conformité pour la correction : le récapitulatif AVANT création ne
doit porter **ni référence ni code** — AGENTS.md est explicite, ces champs
n'existent qu'après création et ne s'inventent pas. Récap = article, quantité,
total, acompte, livraison relue ; référence et code arrivent après, comme
aujourd'hui.

### 2.7 La confirmation et « Pour payer »

Le contenu canonique est respecté (référence, article × quantité, total,
code) — c'est bien. Trois défauts :

- **« Pour payer : <lien> » même quand il n'y a rien à payer d'avance.** Le
  lien est en réalité la page de SUIVI (`lienDeSuivi`), envoyé dès que
  `baseBoutique` est posée — y compris en `sans_prepaiement` (acompte 0). Le
  libellé ment sur la nature du lien et sur l'obligation de payer.
- En `sans_prepaiement`, **aucune instruction de suite** (« vous payerez à la
  livraison ; la vendeuse vous écrit sur son WhatsApp »).
- La phrase « votre code secret ne se tape QUE sur l'écran de votre
  opérateur — jamais ici » est excellente. Elle mérite d'être accompagnée du
  pitch du reçu : « après paiement, vous recevrez un reçu vérifiable » — la
  contre-signature (contrôle 7) a besoin que l'acheteuse comprenne pourquoi
  ouvrir ce lien.

### 2.8 Après l'achat — l'amnésie

L'état repasse à `ETAT_INITIAL`. « Où est ma commande ? » le lendemain reçoit
l'aide générique « Je suis le catalogue Catalog… ». Le fil oublie l'achat à la
seconde où il se conclut :

- pas de mémoire du dernier ordre (une colonne dans `BotConversation` suffit) ;
- pas de réponse d'état (« CT-123456 : acompte reçu, en préparation ») alors
  que le cycle de vie du lot 11 a toutes les données ;
- pas de relance d'acompte avant l'échéance de 48 h, alors que pg-boss est là
  ET que la relance dans les 24 h de la fenêtre de service est **gratuite** ;
- pas de « commander à nouveau » pour l'acheteuse qui revient.

Le taux de récupération de panier par WhatsApp se mesure entre 15 et 30 %
(contre 2 à 5 % par e-mail) ; la séquence courte (rappel à ~1 h, relance
à 24 h) est le standard. Nous avons zéro message de relance.

---

## 3. Synthèse des constats, ancrés dans le code

| # | Constat | Où | Gravité |
|---|---|---|---|
| 1 | Bouton « Parler à la vendeuse » sans gestionnaire — boucle sur l'accueil | `conversation.ts:242`, aucun `id === "vendeuse"` | Bloquant UX |
| 2 | Commande créée sans récapitulatif ni confirmation | `conversation.ts:218-231` | Bloquant UX |
| 3 | La confirmation n'affiche pas la livraison analysée | `confirmationCommande` (347-381) | Haute |
| 4 | « Pour payer » sur un lien de suivi, même sans acompte | `bot.ts:137-141` | Haute |
| 5 | États-pièges : pas de mot-clé texte global (menu/annuler), boutons de sortie absents en `quantite`/`mode` | `conversation.ts:127,148-179` | Haute |
| 6 | Pas de TTL d'état de conversation | `bot.ts:100-101,146-150` | Moyenne |
| 7 | Amnésie post-achat, pas de statut de commande dans le fil | `conversation.ts:219`, `bot.ts` | Haute |
| 8 | Stock et variantes en base, ignorés par le bot | `schema.prisma:104-105`, `bot.ts:158-162` | Haute |
| 9 | Aucune image (accueil, fiche) ; pipeline sans déclinaison JPEG | `image-pipeline.ts`, `messages.ts` | Haute |
| 10 | Réputation vérifiée (lot 12) invisible dans le fil | `accueilBoutique` | Haute |
| 11 | Copie sortante SANS ACCENTS (« Verifiez », « Ecrivez », « Code de verification ») — la convention ASCII des commentaires a fui dans les textes utilisateur | tout `domain/bot` | Moyenne, mais partout |
| 12 | Boutique vide = message sans bouton (cul-de-sac) | `conversation.ts:253-257` | Basse |
| 13 | Position de pagination perdue au retour de fiche | `conversation.ts:285` | Basse |
| 14 | La vendeuse n'est pas notifiée d'une nouvelle commande | `filAcheteuse` n'écrit qu'à l'acheteuse | Haute (structurel pré-WABA, voir §6) |
| 15 | Aucune instrumentation d'entonnoir : on ne mesure aucun taux de passage entre états | — | Haute pour piloter la suite |

Sur le 15 : compter les **transitions d'état** (accueil→catalogue→fiche→
quantité→mode→détails→commande) est compatible ADR 0023 — aucun texte, aucun
SMS, seulement des compteurs. Sans cela, tout ce document reste de l'opinion ;
avec, chaque correction ci-dessus devient une hypothèse mesurable.

---

## 4. Évaluation heuristique (Nielsen, adapté au conversationnel)

| Heuristique | État | Preuve |
|---|---|---|
| Visibilité de l'état du système | ✗ | Pas d'écho de sous-total, pas de récap, pas de réorientation après absence |
| Correspondance avec le monde réel | ~ | Bon français simple, vouvoiement constant ; mais sans accents, et ni anglais ni pidgin (AGENTS.md exige les variantes pour les messages sortants — dette actée, pas oubli) |
| Contrôle et liberté | ✗ | Pas d'annulation, pas de retour texte, états-pièges |
| Cohérence et standards | ✓ | Identifiants stables, routage par id et non par libellé — solide |
| Prévention des erreurs | ✗ | Création sans confirmation ; quantité non bornée par le stock suivi |
| Reconnaissance plutôt que rappel | ~ | Exemples concrets dans les questions (bien) ; grammaire à virgule à mémoriser (mal) |
| Flexibilité et efficacité | ✗ | Aucun raccourci de rachat, aucune reconnaissance du client qui revient |
| Esthétique et minimalisme | ✓/✗ | Concision admirable ; mais la fiche article est minimale au point de ne pas vendre |
| Aide à la récupération d'erreur | ~ | Aide-pas-erreur, la meilleure décision copy du bot ; mais statique au 2ᵉ échec |
| Aide et documentation | ✗ | Pas de mot-clé « aide » en cours de flux |

Deux vraies forces à préserver : le **routage par identifiant** (jamais par
libellé) et la **posture aide-pas-erreur**. Elles sont au niveau de l'état de
l'art.

---

## 5. Face aux meilleurs de 2026 — structurel ou de notre fait ?

### Ce que font les leaders

- **Catalogues natifs Meta** (messages multi-produits avec vignettes, panier
  dans le client WhatsApp) — le standard des plateformes Shopify-first (Zoko,
  WatEase) et des acteurs africains.
- **WhatsApp Flows** : le checkout en formulaire structuré DANS le fil —
  validation native, listes déroulantes, pas de redirection. Taux de réponse
  mesurés ~4× supérieurs aux formulaires externes. Notre étape « détails de
  livraison » à grammaire de virgule est exactement le cas d'usage pour lequel
  Flows a été construit.
- **Paiement dans le fil** : Inde, Brésil, Singapour seulement. **Pas
  disponible au Cameroun** — notre rampe USSD + preuve SMS est l'équivalent
  local, et c'est un choix, pas un retard (voir plus bas).
- **Récupération de panier** : séquences de 2-3 messages, 15-30 % de
  récupération, le levier au meilleur ratio effort/revenu du canal.
- **Couche IA de découverte** : les leaders mettent un modèle de langage sur
  la découverte produit. Notre ADR 0031 a choisi le menu déterministe — coût
  nul, prévisibilité totale, testabilité — et ce choix reste défendable. Le
  point faible réel n'est pas l'absence d'IA : c'est que **tout texte libre
  hors slug reçoit une aide générique**. Un petit aiguillage par mots-clés
  (« prix », « livraison », « taille », « photo » → réponse préparée ou
  passage à la vendeuse) absorberait l'essentiel des questions humaines sans
  une ligne d'IA.

### Les acteurs africains, et notre asymétrie stratégique

Chpter et Flowcart (Kenya), Vendy (Nigeria) : leur proposition est
l'encaissement mobile money DANS le fil, via agrégateurs — donc détention du
flux et commission par transaction. Catalog a explicitement refusé cette voie
(ADR 0009) : pas de custody, 0 % de commission, abonnement — et à la place, la
**preuve opposable**. C'est une asymétrie, pas un manque : eux vendent la
fluidité du paiement, nous vendons la vérité du paiement. Le coût de notre
position est le collage manuel du SMS ; son bénéfice — le reçu vérifiable dans
le marché de la fausse capture — est précisément ce que le bot **ne dit
jamais** (constat 10). La position est bonne ; sa mise en scène est absente.

### Le partage honnête

| Manque perçu | Structurel (sandbox / pré-WABA / marché) | De notre fait, corrigeable maintenant |
|---|---|---|
| Pas de vignettes dans les listes | ✓ (format Meta) | en-têtes image sur boutons + fiche : à nous |
| Pas de catalogue natif / panier client | ✓ (WABA + catalogue Meta requis) | — |
| Pas de Flows | ✓ (WABA requis) | la grammaire à virgule reste améliorable sans Flows |
| Pas de paiement in-chat | ✓ (pays non couvert) | assumé (ADR 0009) — à raconter, pas à copier |
| Notification vendeuse à la commande | ✓ pré-WABA (message d'initiative = gabarit) | — (P0 dès le WABA) |
| Images, confirmation, mémoire, confiance, accents, boutons morts | — | **✓ tout est à nous** |
| Relance d'acompte < 24 h | — | ✓ gratuite dans la fenêtre de service |

Et une part du « très basique » ressenti vient du sandbox lui-même : numéro
générique, pas de profil d'entreprise, relais entrant cassé (ticket 360dialog
en cours). Le PLBV changera la texture perçue indépendamment de notre code.

---

## 6. L'économie des conversations face aux 2 500 F/mois

Depuis juillet 2025, Meta facture **par message de gabarit** délivré
(marketing, utilitaire, authentification), selon le pays. Les réponses libres
dans la fenêtre de service de 24 h ouverte par le client sont gratuites — et le
resteront après le changement d'octobre 2026 (qui touche les gabarits
utilitaires hors fenêtre).

Conséquences pour notre modèle :

- **Tout le parcours d'achat actuel coûte ≈ 0 F** : c'est l'acheteuse qui
  initie, tout se répond dans la fenêtre. Le checkout est structurellement
  gratuit. La relance d'acompte à ~1 h l'est aussi.
- **Les gabarits utilitaires** (statut de commande, notification vendeuse,
  relance après 24 h) coûtent de l'ordre du centime de dollar — quelques
  francs par message. À l'échelle d'une vendeuse active, quelques centaines de
  francs par mois : absorbable dans les 2 500 F.
- **Le marketing est le poste dangereux** : de l'ordre de 10-20 F par message
  en Afrique. Une campagne de 200 messages consomme l'ARPU entier du mois.
  Si un jour on offre des diffusions, elles devront être **comptées et
  facturées à part** — les inclure dans l'abonnement serait structurellement
  perdant. À modéliser AVANT de promettre la fonctionnalité.
- La fenêtre gratuite de 72 h des publicités click-to-WhatsApp est le levier
  d'acquisition le moins cher du canal — pertinent post-WABA.

---

## 7. Le fil vendeuse — plus court, mais pas moins critiquable

- **La double saisie du SMS est assumée en v1** (l'orchestration de preuve
  vit dans sa route ; la dupliquer serait une seconde source de vérité sur de
  l'argent). Mais l'expérience réelle est : coller le SMS dans le fil → se
  faire dire d'aller le coller AILLEURS. Le prochain pas de code du produit
  reste l'extraction de l'orchestration pour rendre le verdict des sept
  contrôles dans le fil (déjà noté à l'ADR 0031).
- **« solde » est bien** ; il manque son symétrique « commandes » (les N
  ouvertes avec liens profonds), et toute aide contextuelle listant les
  mots-clés disponibles.
- **Aucune notification de nouvelle commande** (constat 14) : la vendeuse
  découvre ses commandes en ouvrant l'app. Pré-WABA c'est structurel (message
  d'initiative = gabarit approuvé). Dès le WABA : gabarit utilitaire
  « nouvelle commande CT-… — article × n — total » ; c'est LE gabarit qui
  fera vivre le produit au quotidien.

---

## 8. Localisation et ton

- **Les accents d'abord** (constat 11) : « Verifiez le lien recu », « Ecrivez
  le nombre voulu », « Code de verification » — toute la copie sortante est en
  ASCII. Lisible, mais télégraphique ; pour un produit qui se veut premium,
  c'est la première chose à corriger, et la moins chère.
- **Anglais et pidgin** : AGENTS.md les exige « dès la conception » pour les
  messages sortants. Le bot n'a aucune structure de variante linguistique —
  chaque chaîne est en dur dans `conversation.ts`. Avant que le volume de
  copie grossisse (récap, statuts, relances), extraire les chaînes vers un
  module de messages par langue coûtera un jour ; après, une semaine.
- Le ton (vouvoiement, phrases courtes, zéro jargon, émojis limités au
  verdict ✅/🟡) est juste. À garder tel quel.

---

## 9. Feuille de route priorisée

Efforts en jours-dev, séquencés pour être testables en sandbox dès maintenant.

### Sprint A — cette semaine, sandbox (≈ 6,5 j)

| Action | Constats couverts | Effort |
|---|---|---|
| Récap + Confirmer/Modifier/Annuler avant création (sans réf ni code), livraison relue dans le récap ET la confirmation | 2, 3 | 1,5 j |
| Réparer « Parler à la vendeuse » (lien wa.me du numéro perso) | 1 | 0,25 j |
| Mots-clés texte globaux (menu, annuler, aide) + boutons de sortie en quantité/mode + boutique vide avec bouton | 5, 12 | 0,75 j |
| Accents sur toute la copie sortante | 11 | 0,25 j |
| Mémoire post-achat (dernière commande dans l'état) + réponse de statut + copie « Pour payer »/« Suivre » selon le plan | 4, 7 | 1 j |
| TTL d'état (24 h) avec message de réorientation | 6 | 0,5 j |
| Réputation lot 12 + pitch du reçu à l'accueil | 10 | 0,5 j |
| Déclinaison JPEG dans le pipeline + en-tête image fiche/accueil | 9 | 1,5 j |
| Compteurs de transitions d'entonnoir (sans texte, ADR 0023-compatible) | 15 | 0,5 j |

### Sprint B — modèle et rétention (≈ 5 j)

Stock affiché et quantité bornée quand suivi ; variantes vendables (le JSON
existe) ; relance d'acompte à ~1 h via pg-boss (fenêtre gratuite) ; écho de
sous-total ; aiguillage par mots-clés vers la vendeuse ; champ description
produit (migration expand) ; extraction des chaînes par langue (FR d'abord,
EN/pidgin ensuite).

### Post-PLBV (dépend du WABA, pas de nous)

Gabarits utilitaires : notification vendeuse de nouvelle commande, statuts de
commande, relance post-24 h. Flows pour le checkout (remplace la grammaire à
virgule). Catalogue natif Meta (vignettes, panier). Click-to-WhatsApp.
Verdict des sept contrôles dans le fil vendeuse (extraction de
l'orchestration de preuve — indépendant du WABA, mais du même horizon).

---

## 10. Sources

- Plateformes et pratiques 2026 : [Wati alternatives](https://www.flowcart.ai/blog/wati-alternatives) · [Zoko / Interakt vs Wati](https://www.zoko.io/post/interakt-vs-wati-comparison) · [BSP 2026](https://siteti.com/blog/the-2025-whatsapp-business-solution-provider-bsp-ecosystem-a-comprehensive-guide/) · [WatEase](https://watease.com/blog/best-whatsapp-business-platform-for-ecommerce-india)
- Afrique : [Databook social commerce Afrique 2026](https://uk.finance.yahoo.com/news/africa-social-commerce-market-databook-094100110.html) · [TechTrendsKE — commerce WhatsApp](https://techtrendske.co.ke/2026/03/11/africa-whatsapp-commerce/) · [AVODA — stack Afrique de l'Est](https://avodagroup.org/conversational-commerce-stack-east-africa/) · [PC Tech — vendre du textile sur WhatsApp](https://pctechmag.com/2026/07/why-clothing-is-the-hardest-thing-to-sell-over-whatsapp-in-africa/) · [Realdata](https://realdataintl.com/articles/whatsapp-commerce)
- Flows : [Influencer Marketing Hub](https://influencermarketinghub.com/whatsapp-flows-for-checkout/) · [MercaBot](https://mercabot.com.br/en/blog/whatsapp-flows-formularios-estruturados/) · [8x8 — bonnes pratiques](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-flows-best-practices/)
- Tarification Meta : [SleekFlow](https://sleekflow.io/blog/whatsapp-business-price) · [Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) · [Uptail](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works)
- Récupération de panier : [Unifonic](https://www.unifonic.com/en/resources/the-ultimate-guide-to-whatsapp-abandoned-cart-recovery-for-e-commerce) · [Kanal — WhatsApp vs e-mail](https://getkanal.com/blog/whatsapp-vs-email-abandoned-cart-recovery) · [Zixflow](https://zixflow.com/blog/whatsapp-abandoned-cart-recovery/)
- Design conversationnel : [Botpress](https://botpress.com/blog/conversation-design) · [ParallelHQ](https://www.parallelhq.com/blog/chatbot-ux-design) · [NeuronUX](https://www.neuronux.com/post/ux-design-for-conversational-ai-and-chatbots)
- Contexte fraude Cameroun : [237online — arnaque WhatsApp](https://www.237online.com/arnaque-whatsapp-cameroun/) · [AfrikMag — arnaques 2026](https://www.afrikmag.com/arnaques-whatsapp-instagram-afrique-2026/) · [MINPOSTEL](https://www.minpostel.gov.cm/index.php/fr/actualites/328-arnaque-via-mobile-money-la-riposte-du-ministre-des-postes-et-telecommunications)
