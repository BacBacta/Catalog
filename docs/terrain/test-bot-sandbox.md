# Tester le bot sur le sandbox — guide de terrain

Mis à jour le 02/08/2026, après le P0 de l'ADR 0035.

## L'état du sandbox, sans fard

- **Le sortant marche** : tout message émis par le bot arrive en vrai sur le
  téléphone enregistré au sandbox (celui qui a envoyé `START` au numéro
  360dialog).
- **L'entrant marche AUSSI — tant que la session sandbox est vivante.** Ce
  qui avait été pris pour un relais en panne était une session expirée :
  renvoyer `START` au numéro sandbox la réveille (vérifié le 02/08/2026 à
  20 h 01 — `menu` tapé au téléphone, accueil reçu dans la seconde). La clé
  est restée identique ce jour-là ; si un `START` futur en rend une autre,
  le webhook se re-pose avec elle (`POST /v1/configs/webhook`, URL entrante
  + en-tête `Authorization`) et `WABOT_API_KEY` se met à jour sur Fly.

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

## Les scénarios du P0

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

### 5 · Les images

Les articles du seed n'ont pas de photo : ajoutez-en une depuis l'app
vendeuse (l'envoi par le fil exige un vrai `mediaId` sandbox — le relais en
panne l'empêche). Ensuite : l'accueil de la boutique gagne
« Voir en photos », la rafale part légendée nom-prix, et la fiche article
s'ouvre photo d'abord.

### 6 · Les relances (elles demandent du temps réel)

- **Acompte** : une commande à acompte laissée impayée → rappel dans le fil
  acheteuse ~1 h après. Payée entre-temps : silence — la décision se reprend
  à l'exécution.
- **Reversement** : une boutique ouverte dans le fil sans reversement →
  rappel ~20 h après, avec le lien de l'espace vendeuse. Reversement posé
  entre-temps : silence.

## Recommencer un test à zéro

Trois écritures sur la préprod, pour qu'un numéro redevienne une inconnue —
via `flyctl ssh console --app catalog-api-preprod`, puis un script node qui :

1. **détache** toute boutique née de ce numéro (`seller.phone` → numéro
   factice unique, `userId` → nul) — l'historique reste, rien n'est détruit ;
2. **efface** la ligne `bot_conversation` du numéro (état, langue, mémoire de
   commande) ;
3. **purge** les `bot_notification` en attente qui le visent.

Les commandes passées comme acheteuse peuvent rester : une conversation
neuve ne les connaît plus. Après la remise à zéro, le premier message du
téléphone rouvre le parcours prospect complet (« vendre avec <slug> »…).

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
   entrant ET sortant complets. Il faut pointer son webhook vers
   `/api/whatsapp/entrant/<secret>` et aligner `WHATSAPP_APP_SECRET`,
   `WABOT_API_KEY` et `WABOT_BASE_URL` sur l'app Meta — c'est un changement
   d'environnement, pas de code.
