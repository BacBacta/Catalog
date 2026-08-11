# WhatsApp est la boutique — la traversée re-analysée sous la doctrine bot-first

Date : 02/08/2026 · Statut : analyse — les décisions qui en sortiront auront
leurs ADR · Complète et CORRIGE : `2026-08-02-analyse-pipeline-transversale.md`

## 0. La doctrine, et le test qu'elle impose

Le porteur du produit a posé la doctrine : **l'acheteuse visualise les
produits et achète DANS WhatsApp** — pas sur un site externe. L'analyse
transversale précédente a identifié les bons trous mais proposé plusieurs
mauvaises réparations, parce qu'elle tenait encore la boutique web pour une
surface porteuse. Ce document reprend la traversée sous la doctrine, et
commence par se corriger.

Le test à appliquer à chaque écran et chaque lien du parcours acheteuse :

> **« Pourquoi ce moment quitte-t-il WhatsApp ? »**

Trois réponses seulement sont recevables :

1. **Le composeur téléphonique.** WhatsApp ne rend pas les liens `tel:`
   cliquables dans un message : le composeur USSD pré-rempli (lot 9) ne peut
   exister que derrière une page. C'est une sortie vers le CLAVIER, pas vers
   un site — et elle doit rester un confort, jamais le chemin obligé.
2. **La preuve montrée à des tiers.** La page publique de vérification `/v/`
   a pour FONCTION d'être hors conversation : un reçu qu'on ne peut vérifier
   que dans le fil de l'acheteuse ne serait pas opposable. Elle reste.
3. **Les gestes de sécurité de la vendeuse.** L'OTP du numéro de reversement
   (AGENTS.md §2) vit dans l'espace vendeuse, et c'est voulu.

Tout le reste doit vivre dans le fil. Voyons ce qui y vit réellement.

---

## 1. L'audit des sorties — chaque fois que le flux bot éjecte l'acheteuse

Inventaire exhaustif des liens que le bot envoie à une acheteuse (mesuré dans
`textes.ts` et `bot.ts`) :

| Moment | Ce que le bot envoie | Où ça mène | Verdict doctrine |
|---|---|---|---|
| Confirmation, acompte attendu | « Pour payer l'acompte, ouvrez : ‹lien› » | Page de suivi web — **qui ne sait pas payer** (T9) | **Double faute** : éjection ET impasse |
| Confirmation, sans acompte | « Suivez votre commande ici : ‹lien› » | Page de suivi web | Éjection inutile : le fil sait déjà répondre « où est ma commande » |
| « Où est ma commande ? » | statut + « votre lien de suivi est dans la confirmation » | Renvoie au lien web | Éjection inutile |
| Contre-signature (contrôle 7) | rien — attend que l'acheteuse rouvre le lien | Page de suivi web | Éjection ET silence |
| Dépôt d'avis | rien — même page | Page de suivi web | Éjection ET silence |
| « Parler à la vendeuse » | wa.me du numéro personnel | WhatsApp | ✓ conforme |

**Les trois moments décisifs du post-achat — payer, confirmer, noter —
éjectent tous vers le web.** Sous la doctrine, ce ne sont pas des détails
d'UX : ce sont les trois fautes structurantes du produit. Et la première
mène en plus à une impasse.

---

## 2. Payer sans quitter WhatsApp — la doctrine était déjà écrite dans AGENTS.md

C'est la découverte la plus embarrassante de cette passe, parce que la règle
existe depuis le début :

> AGENTS.md : « Le message WhatsApp généré doit être **autosuffisant en
> texte brut**. […] Le lien est un confort, **jamais le seul porteur
> d'information**. »

Et `packages/contracts/src/whatsapp.ts` porte depuis le lot 9 le bloc
canonique exact :

> `PaiementWhatsApp { numeroReversement, montantXaf }` — « Il ne remplace pas
> la rampe, il la double. […] ce bloc écrit le même numéro et le même montant
> en TEXTE BRUT, pour que l'acheteuse puisse payer à la main si le lien
> échoue. »

**Le bot n'utilise ni la règle ni le bloc.** Sa confirmation d'acompte dit
« ouvrez ce lien » et rien d'autre. La réparation proposée hier — apprendre à
la page de suivi à payer — corrigeait l'impasse en consolidant l'éjection.
La réparation conforme est l'inverse :

**La confirmation d'acompte porte le paiement en texte brut :**

```
Acompte à envoyer : *9 500 F CFA*
Numéro Mobile Money : 6 56 74 62 15 (Orange Money)
Composez #150*50# et suivez le menu — ou ouvrez : ‹lien /payer›
Votre code secret ne se tape QUE sur l'écran de votre opérateur — jamais ici.
```

- Le **code d'entrée** vient de `GET /api/rampe` (configuration, jamais une
  constante — l'interdit d'AGENTS.md tient) ; l'opérateur du reversement est
  connu (`payoutOperator`), donc le bon code s'affiche.
- Copier un numéro et composer `#150*50#` est le geste que toute acheteuse
  MoMo fait dix fois par semaine — le composeur pré-rempli reste un confort
  derrière `/payer`, sa place d'origine.
- Le numéro de reversement dans un message se transfère, oui — même statut
  que sur l'écran de paiement web, où le lot 9 l'a déjà jugé public par
  nécessité. Le code secret, lui, ne s'approche jamais du fil.
- Boutique sans reversement : rien à payer d'avance, rien à afficher —
  cohérent, déjà le cas.

Effort : ~1 jour, aucune nouvelle décision d'architecture — c'est
l'application tardive d'une règle existante.

---

## 3. Suivre, contre-signer, noter — l'identité du fil rend la page de suivi optionnelle

L'insight structurel que l'analyse d'hier a manqué :

**La page de suivi web existe parce que le flux web n'avait pas d'identité.**
Une acheteuse web n'a ni compte ni numéro vérifié — d'où le `buyerToken`, un
secret capacitaire glissé dans un lien (lot 10). Toute l'architecture
« jeton → page → actions » est la réponse à cette absence.

**Le flux bot, lui, A une identité : le `wa_id`, attesté par Meta** — le même
qui a créé la commande (`bot_conversation.derniere_commande_id`). Les trois
usages de la page de suivi se relisent alors ainsi :

- **Suivre** : déjà rapatrié (« où est ma commande ? », sprint A). Il reste à
  cesser de renvoyer vers le lien web dans la réponse.
- **Contre-signer (contrôle 7)** : aujourd'hui `POST /:jeton/contresigner`,
  autorisé par `where: { buyerToken: jeton }`. La voix indépendante que le
  contrôle 7 cherche est « l'acheteuse, pas la vendeuse » — et le fil
  l'identifie exactement autant que le jeton, puisque le jeton a été ÉMIS
  dans ce fil. Un bouton **[Je confirme avoir payé]** après l'émission du
  reçu, autorisé par « même conversation que la commande », est
  sémantiquement équivalent. Deux gardes à respecter absolument : le jeton ne
  se re-projette JAMAIS (l'autorisation passera par `derniereCommandeId`,
  pas par une relecture du token) ; et c'est une décision d'architecture
  d'identité — **ADR obligatoire**, pas un raccourci. Nuance diaspora : la
  personne du fil est la commanditaire, pas toujours la payeuse — même
  sémantique que le jeton envoyé dans ce même fil, l'équivalence tient.
- **Noter** : `DepotAvis` (cinq boutons, commentaire facultatif — bien
  conçu) se transpose en UNE liste WhatsApp 1-5 envoyée au moment « livrée ».
  Le label « achat vérifié » vient de l'état de preuve, pas du canal de
  dépôt : rien ne change au modèle.

Conséquence : pour l'acheteuse du bot, la page de suivi passe de MAILLON
OBLIGATOIRE à confort. Les seules pages web structurelles côté acheteuse
restent `/v/` (tiers) et `/payer` (composeur).

---

## 4. « Visualiser les produits sur WhatsApp » — l'état exact, le plafond, la trajectoire

### 4a. Ce que le bot montre aujourd'hui — mesuré

- **Le bot ne sait pas envoyer une photo en plein format.**
  `MessageSortant = MessageTexte | MessageBoutons | MessageListe` — il
  n'existe AUCUN constructeur de message image. La seule photo qu'une
  acheteuse voit est la **bannière d'en-tête** d'un message à boutons :
  petite, recadrée, et seulement sur l'accueil et la fiche.
- **La liste du catalogue est du texte pur** : titres tronqués à
  24 caractères, prix, aucune vignette (plafond de l'API des listes —
  structurel).
- **Une seule photo par article** (`Product.imageKey`, clé unique). Les
  vendeuses réelles en postent 3 à 5 par article dans leur Statut : notre
  modèle de données plafonne la doctrine avant même l'API.
- **Le JPEG n'existe que pour les téléversements postérieurs à l'ADR 0032** :
  tout le stock d'images antérieur (AVIF/WebP seuls) est invisible dans le
  fil, sans rattrapage prévu.

Pour un produit dont la catégorie reine est le textile — celle où l'image
fait la vente —, la vitrine WhatsApp actuelle est **moins visuelle que le
Statut WhatsApp d'une vendeuse ordinaire**. C'est le constat le plus dur de
cette analyse.

### 4b. Le plafond de la fenêtre libre (pré-WABA) — plus haut que ce qu'on exploite

Tout ceci est disponible AUJOURD'HUI, en messages libres, gratuit dans la
fenêtre de service, sandbox compris :

1. **Le message image plein format avec légende**
   (`{type:"image", image:{link, caption}}`) : la photo en grand, nom + prix
   + description dans la légende. C'est la fiche article que la doctrine
   demande — un petit constructeur dans `messages.ts` et un envoi.
2. **La rafale d'images** : plusieurs messages image consécutifs se groupent
   visuellement en album dans WhatsApp. « Voir en photos » → 4-6 photos
   légendées (nom — prix) → puis la liste pour choisir. C'est la vitrine
   feuilletable pré-WABA — aucun des acteurs low-cost ne fait mieux sans
   catalogue natif.
3. Les en-têtes (déjà en place).

Le coût est en nombre de messages, pas en argent (fenêtre de service). La
seule discipline : ne pas noyer — une rafale sur demande explicite, jamais
d'office.

### 4c. Ce qui n'arrive qu'avec le WABA — la cible

- **Le catalogue Meta natif** : un flux produit (nom, prix, image,
  description, disponibilité) synchronisé chez Meta ; puis **messages
  multi-produits** (jusqu'à 30 articles avec vignettes, section par
  section), Single Product Message, et le **panier natif dans le client
  WhatsApp**. C'est la réponse définitive à « visualiser les produits sur
  WhatsApp » — l'acheteuse feuillette des vignettes DANS l'interface, sans
  un seul message de liste texte.
- Nous avons désormais TOUTES les pièces du flux : nom, prix entier,
  description (ADR 0033), image JPEG (ADR 0032), stock. La colonne
  vertébrale de l'intérim doit être : **tout ce qu'on construit converge
  vers ce flux produit.**

### 4d. L'écart précis à combler, côté modèle et adaptateurs

1. Constructeur `image()` dans `messages.ts` + rien d'autre (l'envoyeur est
   déjà générique). Petit.
2. **Photos multiples** : table `ProductImage` en expand (ou clés dérivées
   numérotées) + saisie dans le fil (« envoyez d'autres photos ») et dans
   l'app. Décision de modèle — ADR.
3. **Rattrapage JPEG** : re-encoder les objets antérieurs depuis le WebP
   stocké — une tâche pg-boss unique, le patron existe.
4. **Durée des URLs signées** : 600 s convient à l'envoi immédiat ; le flux
   catalogue Meta exigera des URLs stables — l'ADR 0017 a déjà acté que les
   photos de catalogue sont du **contenu public**, la voie est ouverte.

---

## 5. La boutique web statique — la décision que la doctrine impose

Le constat T6 d'hier (« deux catalogues, un vivant, un mort ») appelait une
synchronisation. Sous la doctrine, c'est la mauvaise question : **la
divergence n'est pas un bug de synchronisation, c'est une ambiguïté de rôle
jamais tranchée.** Le lot 6 a construit la boutique web comme LA vitrine ;
l'ADR 0031 a déplacé la vitrine dans le fil ; personne n'a redéfini le rôle
du survivant.

Trois options, une recommandation :

- **(a) Vitrine SEO/partage hors-WhatsApp**, reconstruite automatiquement à
  chaque écriture catalogue. Coûte un déclencheur de build + la maintenance
  du budget 30 Ko pour une surface désormais secondaire.
- **(b) Repli sur l'essentiel** : garder `/v/`, `/payer`, `/suivi` (des
  îlots branchés sur l'API, jamais périmés) ; retirer les pages catalogue
  `[slug]`. Zéro divergence possible, moins à maintenir, doctrine limpide.
- **(c) Statu quo divergent** — la pire : une vitrine périmée qui porte le
  nom du produit.

**Recommandation : (b) maintenant, (a) réévaluée post-WABA** (quand le lien
d'une boutique pourra pointer un catalogue natif, la question du web-vitrine
se reposera autrement). Dans les deux cas : **ADR obligatoire** — ça révise
le lot 6 (budgets, Lighthouse, instantané, `shop:snapshot`).

Le miroir vendeuse du même trou : « ma boutique » dans le fil ne montre
RIEN — la vendeuse peut ajouter des articles mais jamais voir son catalogue
tel que ses clientes le voient. La doctrine vaut pour elle aussi.

---

## 6. La traversée cible, message par message

Le script complet que la doctrine demande — chaque flèche reste dans
WhatsApp :

**Cliente** : lien → accueil (photo vitrine, ★ réputation, reçu vérifiable)
→ « voir en photos » : rafale légendée → liste → fiche IMAGE plein format →
quantité → panier → récap → **Confirmer** → confirmation avec **bloc
paiement texte brut** (+ lien composeur en confort) → elle paie depuis son
téléphone → *(la vendeuse colle son SMS, seul geste hors fil restant :
l'app, dette connue)* → « ✅ Reçu émis — CT-104312 » + **[Je confirme avoir
payé]** → contre-signature faite → *(vendeuse : « livrée CT-104312 » dans
SON fil)* → « Votre commande est livrée. Une note pour Chez Bea ? » liste
1-5 → avis vérifié déposé → il alimente l'accueil de la boutique dès la
prochaine visiteuse.

**Vendeuse** : « vendre » → nom → ville → boutique + liens → photos + prix →
articles en ligne → *(reversement : app, OTP — la seule sortie légitime)* →
commandes notifiées *(post-WABA)* → SMS collé → verdict → « livrée CT-x » →
son capital d'avis grandit — sans avoir jamais ouvert un navigateur, sauf
pour le geste d'argent.

Chaque segment de ce script existe déjà ou est spécifié ci-dessus. Aucun
n'exige le WABA, sauf les notifications vendeuses.

---

## 7. Benchmark 2026, par capacité

| Capacité | Meilleur du marché | Nous, aujourd'hui | Écart |
|---|---|---|---|
| Visualisation produit | Catalogue natif Meta : vignettes, MPM 30 articles, panier dans le client (leaders + tout Shopify-first) ; pré-WABA, les meilleurs font de l'image-first (rafales légendées) | Listes texte + bannières d'en-tête ; pas de message image ; 1 photo/article | **Le** chantier — §4 |
| Paiement | In-chat (IN/BR/SG) ; STK push dans le fil (Kenya : Chpter) ; ailleurs : instructions en texte brut dans le fil | Rampe USSD excellente… jointe en lien vers une page qui ne paie pas | §2 — 1 jour de travail |
| Post-achat | Statut de commande, contre-signature et avis SANS quitter le fil ; demande d'avis systématique (conversion PDP +8-15 % avec avis) | Les trois moments éjectent vers le web, aucune sollicitation | §3 |
| Activation vendeuse | Checklist → ~80 % actifs à 30 j (vs ~30 %) ; time-to-first-sale métrique de tête | Inscription 2 min excellente, puis ni checklist ni relance ni métrique | analyse précédente, toujours vraie |
| Confiance | Avis + badges plateformes | Reçu opposable + 7 contrôles : **au-dessus du marché** — mais invisible dans le fil aux moments décisifs | rapatrier, pas construire |

---

## 8. La feuille de route révisée — elle REMPLACE le P0 d'hier

### P0 — « l'acheteuse ne quitte plus WhatsApp » (≈ 4 j + 1 ADR)

1. **Bloc paiement en texte brut dans la confirmation** (numéro formaté,
   montant, code d'entrée depuis `/api/rampe` selon `payoutOperator`, lien
   `/payer` en dernière ligne). Remplace « le suivi sait payer ». ~1 j.
2. **Le message image** : constructeur, fiche image-first (photo plein
   format, légende nom-prix-description, puis boutons), « voir en photos »
   (rafale sur demande). ~1,5 j.
3. **ADR « l'identité du fil »** : contre-signature et dépôt d'avis dans la
   conversation, autorisés par `derniereCommandeId` — jamais par relecture
   du jeton. Puis implémentation. ~1,5 j après l'ADR.
4. Les cinq petits d'hier restent valides tels quels : URL de l'app dans la
   bienvenue, relance « posez votre reversement » (J+1, pg-boss), routage
   par `seller.phone`, « menu » garde le panier, wa.me de la vendeuse après
   confirmation.

### P1 — le modèle rejoint la doctrine (≈ 4 j + 2 ADR)

- **Photos multiples par article** (ADR modèle + saisie fil/app).
- **Rattrapage JPEG** des images antérieures (tâche pg-boss unique).
- **« ma boutique » montre le catalogue** dans le fil (vue vendeuse).
- **« livrée CT-x » dans le fil** — déclenche la demande d'avis in-thread.
- **ADR rôle de la boutique web** : recommandation (b), repli sur
  `/v/` + `/payer` + `/suivi`.
- Stock : un champ de saisie, ou le retrait de l'affichage.
- Funnel d'activation mesuré de bout en bout.

### P2 — WABA : la cible

Flux catalogue Meta + messages multi-produits + panier natif (**la** réponse
définitive au « visualiser sur WhatsApp ») ; notifications vendeuse
(commande, paiement) ; demande d'avis J+7 en gabarit ; verdict des sept
contrôles dans le fil (dette ADR 0031).

---

## 9. Sources

Benchmark détaillé et chiffres : voir les deux analyses précédentes
(`2026-08-02-analyse-critique-bot.md` §5,
`2026-08-02-analyse-pipeline-transversale.md` §5,7) — catalogue natif et MPM
([Flows checkout](https://influencermarketinghub.com/whatsapp-flows-for-checkout/),
[commerce WhatsApp Afrique](https://techtrendske.co.ke/2026/03/11/africa-whatsapp-commerce/)),
activation ([Mirakl 2026](https://www.mirakl.com/blog/the-marketplace-revolution-key-insights-from-our-2026-seller-report),
[WC Vendors](https://www.wcvendors.com/onboarding-vendors-to-your-new-marketplace/)),
post-achat ([Bloomreach](https://www.bloomreach.com/en/blog/perfect-post-purchase-emails-guide-examples-and-expert-tips),
[reviews → conversion](https://ustechautomations.com/resources/blog/automate-sync-product-reviews-to-the-catalog-2026)).
