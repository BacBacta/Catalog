# Tester le bot sur le sandbox — guide de terrain

Mis à jour le 04/08/2026, après P1a→P1e (ADR 0035 à 0039).

## L'état du sandbox, sans fard

- **Le sortant marche** : tout message émis par le bot arrive en vrai sur le
  téléphone enregistré au sandbox (celui qui a envoyé `START` au numéro
  360dialog).
- **L'entrant marche AUSSI — tant que la session sandbox est vivante.** Ce
  qui avait été pris pour un relais en panne était une session expirée :
  renvoyer `START` au numéro sandbox la réveille (vérifié le 02/08/2026 à
  20 h 01 — `menu` tapé au téléphone, accueil reçu dans la seconde).

### Un `START` peut rendre une NOUVELLE clé — et casse alors les DEUX sens

Constaté le 04/08/2026 : après un `START`, la clé avait changé **et**
`GET /v1/configs/webhook` rendait `url: null`. La configuration ne survit pas
à la rotation.

Le piège est que les deux sens tombent pour des raisons **différentes** :

| Sens | Ce qui casse | Ce qui répare |
|---|---|---|
| Sortant | `WABOT_API_KEY` porte l'ancienne clé | `flyctl secrets set WABOT_API_KEY=<nouvelle>` |
| Entrant | la configuration du webhook est vide | `sandbox-webhook.mjs`, dans la machine |

Réparer l'un sans l'autre donne un bot à moitié muet, et le diagnostic coûte
une soirée. Dans l'ordre :

```bash
flyctl secrets set WABOT_API_KEY=<la nouvelle clé> --app catalog-api-preprod
flyctl ssh console --app catalog-api-preprod \
  -C "node /app/apps/api/scripts/sandbox-webhook.mjs"
```

Le second **tourne dans la machine**, là où `WHATSAPP_ENTRANT_SECRET` et
`WABOT_WEBHOOK_AUTH` vivent déjà : ils ne passent ni par un argument de ligne
de commande, ni par un presse-papiers. Sa sortie masque l'URL — elle se colle
sans précaution. `--lire` seul diagnostique sans rien écrire.

**Premier réflexe si le bot ne répond plus : renvoyer `START`.** Le
simulateur ci-dessous reste utile pour deux choses : rejouer un scénario
scripté à l'identique, et jouer un SECOND personnage (une acheteuse dont le
numéro n'est pas enregistré au sandbox).

## Préparer le simulateur

```bash
export ENTRANT_URL="https://catalog-api-preprod.fly.dev/api/whatsapp/entrant/<WHATSAPP_ENTRANT_SECRET>"
export ENTRANT_AUTH="<WABOT_WEBHOOK_AUTH>"
alias bot="node apps/api/scripts/sandbox-entrant.mjs"
```

Les deux valeurs sont les secrets de la préproduction — elles ne vivent ni
dans le dépôt, ni dans ce fichier.

## L'astuce qui rend tout visible : un numéro, deux rôles

L'aiguillage route sur le **geste**, pas sur l'identité (ADR 0034). Votre
numéro peut donc être à la fois la vendeuse de sa boutique ET une acheteuse —
y compris chez lui-même. En achetant sur votre propre boutique, **les deux
côtés de chaque échange arrivent sur votre téléphone** : la confirmation
d'achat ET la notification « nouvelle commande », l'avis de livraison ET
l'invitation à noter.

Deux boutiques utiles sur la préproduction :

- `chez-amina` — vendeuse fictive, **reversement posé** (Orange) : c'est elle
  qui montre le bloc paiement. Ses messages de vendeuse partent vers un
  numéro non enregistré : ils se mettent en file d'attente (visible en base),
  pas sur un téléphone.
- votre boutique née dans le fil (ex. `chez-bea`) — **votre numéro est la
  vendeuse** : tout ce qui lui est destiné arrive chez vous.

## Les scénarios

Les cinq premiers viennent du P0 ; les scénarios 6 à 8 couvrent P1d et P1e et
se jouent **entièrement au pouce**, sans terminal ni secret.

`<moi>` est votre wa_id sans `+` (ex. `32466457281`).

### 1 · Le bloc paiement dans le fil

```bash
bot <moi> texte "boutique chez-amina"
bot <moi> liste "art:<id>"        # l'id sort de la liste reçue… ou du seed
bot <moi> bouton "cmd:<id>"
bot <moi> bouton "qte:2"
bot <moi> bouton commander
bot <moi> bouton "mode:livraison"
bot <moi> texte "Bali, derriere le college Alfred Saker, 677 88 99 00"
bot <moi> bouton confirmer
```

Attendu sur le téléphone : **quatre messages** — la confirmation (avec
« hors livraison »), le bloc paiement (montant, numéro Orange, `#150*50#`,
lien `/payer`), le lien de suivi, le wa.me de la vendeuse. Le code d'entrée
vient de la configuration de la rampe : changez `RAMPE_ORANGE_ENTREE_MODELE`
sur Fly et rejouez — le fil suit, sans redéploiement.

### 2 · La notification vendeuse, des deux côtés

Achetez **sur votre propre boutique** depuis votre numéro (mêmes commandes
qu'au scénario 1, avec votre slug). La confirmation ET la
« 🛍️ Nouvelle commande » arrivent toutes deux chez vous — la seconde avec le
rapprochement préparé (« un SMS de X F devrait arriver — collez-le ici »).

Pour voir la **file d'attente** : commandez chez `chez-amina` (sa vendeuse
n'a pas de fenêtre ouverte) puis vérifiez `bot_notification` en base — la
notification attend, datée à la remise.

### 3 · « livrée CT-XXXXXX » et la boucle d'avis

```bash
bot <moi> texte "livree CT-XXXXXX"
```

- Solde encore ouvert → refus expliqué, journalisé (`solde_ouvert`) — c'est
  la machine d'étapes du lot 11, pas un bogue.
- Une fois le solde réglé (déclaration ou preuve dans l'app) → « 📦 … est
  marquée livrée », et l'acheteuse reçoit l'invitation à noter. En achetant
  chez vous-même, les deux messages arrivent sur votre téléphone.

### 4 · La preuve appliquée, de bout en bout

1. Connectez-vous à l'espace vendeuse avec votre numéro (le code de
   connexion arrive sur votre WhatsApp — le sortant marche).
2. Ouvrez la commande, collez un SMS au format réel : partez d'un message de
   `docs/formats-sms-operateurs.md`, ajustez **montant** (= ce qui est
   attendu : l'acompte si rien n'est arrivé, le solde ensuite),
   **identifiant de transaction** (jamais deux fois le même — contrôle n° 5)
   et **date** (dans la fenêtre de 48 h — contrôle n° 4).
3. Attendu : verdict accepté, la commande passe à « prouvé », l'argent est
   appliqué, le reçu s'émet — et l'acheteuse reçoit
   « ✅ Votre paiement est prouvé » dans son fil.

Recollez le même SMS : refusé. Sur une commande soldée, c'est le montant qui
ne correspond plus (contrôle n° 2) ; sur un acompte dont le solde égale
l'acompte, c'est l'unicité (contrôle n° 5).

### 5 · Les images — LA limite du sandbox, constatée le 02/08/2026

**Le sandbox n'a pas de médias, et c'est documenté** : ni téléversement ni
récupération par media ID — il n'expose que `/v1/configs/webhook` et
`/v1/messages`. Une photo envoyée au bot en sandbox est donc reçue (le
webhook livre son identifiant, la légende marche, la confirmation part)
mais **jamais téléchargeable** : l'article se publie « sans photo », et
c'est le comportement voulu, pas une panne.

Ce que le sandbox permet quand même de tester : la lecture de la légende
« nom prix », la réaction 👍, la confirmation citée, la publication. Le
téléchargement lui-même ne se vérifie qu'avec un **numéro de test Meta**
(Cloud API) ou en production — l'adaptateur applique la règle 360dialog
(l'URL `lookaside` réécrite vers l'hôte de l'API), corrigée à la suite de ce
constat.

Pour voir les images de la BOUTIQUE (accueil, fiche photo d'abord, rafale
« Voir en photos ») : ajoutez la photo depuis l'app vendeuse — le pipeline
web, lui, ne passe pas par les médias WhatsApp.

À savoir aussi : le sandbox plafonne à **200 messages** par instance — les
longues sessions de test se comptent.

### 6 · Le panier se voit — P1d, ADR 0038

Au pouce, sans terminal. Sur n'importe quelle boutique ayant deux articles :

1. Ajoutez un premier article (`Commander` → une quantité).
   Attendu : **« ✅ Ajouté : … »** PUIS le bloc `🧺 Votre panier` avec **la
   ligne** et le total. Avant P1d, seul le total s'affichait.
2. `Autre article` → la liste. Attendu : **une ligne « Mon panier » EN TÊTE**,
   avec le total en description.
3. Ouvrez une fiche article. Attendu : un **troisième bouton « Mon panier »**
   (il n'apparaît que si le panier contient quelque chose).
4. Tapez **`panier`** n'importe où — y compris en plein flux de livraison,
   après avoir donné son quartier. Attendu : le même bloc, **sans** la ligne
   « Ajouté », et le flux reprend au panier.
5. Tapez `aide`. Attendu : le mot `panier` est **annoncé** parmi les gestes.

Panier vide, `panier` répond « votre panier est vide » **sans** changer
d'état — il ne fabrique pas une étape de commande.

### 7 · Le stock, enfin saisissable — P1d, ADR 0038

Le stock était lu partout et écrit nulle part : en production il valait `0`
pour tout le monde, donc « non suivi », donc rien de ce code ne tournait.

1. App vendeuse → un article → dépliez **« Description et stock »**, mettez
   `4`, enregistrez. Attendu : un badge **`4 en stock`** dans la liste.
2. Dans le fil, ouvrez la fiche de cet article. Attendu : **« 4 disponibles »**
   — et à 3 ou moins, « Plus que N disponibles », **sans point d'exclamation** :
   le nombre ne se décompte pas tout seul, la copie ne promet pas de rareté.
3. Demandez une quantité supérieure. Attendu : **« La vendeuse en annonce 4 »**
   — la déclaration est attribuée à celle qui la fait.
4. Videz le champ, enregistrez. Attendu : le badge disparaît, la fiche ne parle
   plus de stock, et le champ **rouvert reste vide** (jamais « 0 », qui se
   lirait comme une rupture).

### 8 · Le mode congés — P1e, ADR 0039

Le scénario le plus rentable du lot : il se joue à deux personnages sur un
seul téléphone.

**Côté vendeuse**, tapez `congés` (ou `ma boutique` → le menu l'annonce).
Attendu : « 🌴 C'est noté… reste en ligne… n'accepte plus de nouvelle
commande », **et** le rappel des commandes en cours s'il y en a. Retapez
`ma boutique` : le menu porte « 🌴 En congés » et le bouton **« Je reprends »**
a pris la place de « Ma carte à partager ».

**Côté acheteuse** (le simulateur, ou un second téléphone), sur cette boutique :

- l'accueil dit la fermeture **avant** qu'on ait choisi quoi que ce soit ;
- la fiche article n'a **plus** de bouton « Commander » — la vendeuse prend sa
  place ;
- le catalogue, les photos, le panier et le suivi marchent **toujours** ;
- un ancien bouton `Confirmer` d'un fil ouvert avant le départ → refus, et
  **aucune commande créée**. C'est le service qui relit la base, pas l'écran.

**Ce qui ne doit PAS changer** : une commande déjà passée continue sa course —
collez son SMS, elle se prouve ; marquez-la livrée, elle se livre ; l'avis
s'ouvre. Si l'un de ces trois gestes échoue en congés, c'est un défaut.

`je reprends` remet tout en marche. La boutique publique, elle, ne suit qu'à
la **prochaine publication** de l'instantané : c'est voulu, et c'est pourquoi
le verrou vit dans le bot (ADR 0039).

### 9 · Les relances (elles demandent du temps réel)

- **Acompte** : une commande à acompte laissée impayée → rappel dans le fil
  acheteuse ~1 h après. Payée entre-temps : silence — la décision se reprend
  à l'exécution.
- **Reversement** : une boutique ouverte dans le fil sans reversement →
  rappel ~20 h après, avec le lien de l'espace vendeuse. Reversement posé
  entre-temps : silence.

## Recommencer un test à zéro

```bash
# 1. voir ce qui sera touché — n'écrit rien
flyctl ssh console --app catalog-api-preprod \
  -C "node /app/apps/api/scripts/terrain-raz.mjs +237690000000 --voir"

# 2. appliquer
flyctl ssh console --app catalog-api-preprod \
  -C "node /app/apps/api/scripts/terrain-raz.mjs +237690000000"
```

**Effacer la conversation ne suffit pas** : la vendeuse se reconnaît par
**deux** chemins (`bot.ts`) — `authUser.phoneNumber` → sa relation `seller`,
et `seller.phone`. N'en couper qu'un donne un parcours à moitié neuf, où le
bot répond « Collez ici le SMS de votre opérateur » à une prospect.

Le script coupe les deux en **détachant** la boutique — rien n'est effacé :

- `seller.phone` → numéro factice unique, `userId` → nul (les deux chemins
  tombent) ;
- `status` → `closed` : la boutique sort de l'instantané public à la
  prochaine publication ;
- `slug` → suffixé : l'ancien lien ne résout plus, et le nom d'origine
  redevient libre pour la nouvelle boutique ;
- `bot_conversation` supprimée, `bot_notification` en attente purgées — sinon
  elles seraient remises au premier message du parcours neuf.

**L'`authUser` est conservé.** Le bot le retrouvera par son numéro et lui
rattachera la nouvelle boutique : c'est le chemin réel d'une vendeuse qui
revient, pas un raccourci de test. Commandes, preuves et avis restent en base
— une remise à zéro de test n'a aucune raison de détruire une preuve de
paiement.

## Vérifier côté base (quand le téléphone ne suffit pas)

```bash
flyctl ssh console --app catalog-api-preprod
# puis, dans node : commandes, bot_notification, pgboss.queue…
```

Les trois lectures utiles : la commande (`step`, `proofState`,
`amountPaidXaf`), la file `bot_notification` (`remisLe` nul = en attente),
et les files pg-boss (`bot-relance-acompte`, `bot-relance-reversement`).

## Et pour tester SANS simulateur ?

Deux issues, par ordre de préférence :

1. **Le ticket 360dialog aboutit** : le relais entrant revient, et tout ce
   guide se rejoue au pouce, sans terminal.
2. **Le numéro de test Meta** (Cloud API directe, gratuit, 5 destinataires) :
   entrant ET sortant complets, **médias compris** — c'est le seul canal où la
   chaîne photo se vérifie.

   > ⚠️ **Correction du 05/08/2026.** Cette ligne disait « c'est un changement
   > d'environnement, **pas de code** ». C'était faux sur trois points, et
   > l'ADR 0046 les traite :
   >
   > | | 360dialog | Meta directe |
   > |---|---|---|
   > | Authentification | `D360-API-KEY` | `Authorization: Bearer` |
   > | Envoi | `{base}/messages` | `{base}/{idNuméro}/messages` |
   > | Média, 2ᵉ temps | hôte de l'URL **réécrit** | URL suivie **telle quelle** |
   >
   > Le troisième est le plus coûteux : la réécriture d'hôte est
   > **indispensable** chez 360dialog et **casse** le téléchargement chez Meta.
   > Elle ne se voit qu'en téléchargeant une vraie photo — donc jamais sur le
   > bac à sable, qui n'a aucun média.

   Aujourd'hui c'est bien un changement d'environnement, parce que le code a
   été écrit. À régler :

   ```
   WABOT_BASE_URL="https://graph.facebook.com/v21.0"
   WABOT_API_KEY="<jeton System User, PAS celui du tableau de bord>"
   WHATSAPP_PHONE_NUMBER_ID="<l'identifiant du numéro de test>"
   WHATSAPP_APP_SECRET="<celui de l'app Meta>"
   WABOT_WEBHOOK_AUTH=""   # vidé : en Meta directe, l'HMAC reprend du service
   ```

   `WABOT_TRANSPORT` n'a pas à être déclaré : `graph.facebook.com` suffit à le
   déduire.

   **Le piège du jeton.** Celui qu'affiche le tableau de bord Meta expire en
   **24 h**. Le bot cesserait d'envoyer du jour au lendemain, sans rien changer
   de visible ailleurs. Il faut un jeton de *System User*, sans expiration.

   **Ce que ce numéro ne fera jamais** : s'ajouter à l'application WhatsApp
   Business — il n'y a aucune ligne derrière, donc aucun code à recevoir —, ni
   écrire à quelqu'un qui n'est pas dans les 5 destinataires inscrits, ni
   devenir le numéro de production.
