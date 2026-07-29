# 0008 — CamPay : évaluation de l'API et adaptateur écrit

- Statut : **évalué, non retenu en l'état** — adaptateur écrit et testé
- Date : 2026-07-29

## Surface de l'API

Relevée sur le SDK Python officiel (`github.com/CamPay/campay-python-sdk`,
dernière publication janvier 2026) :

| Opération | Endpoint |
|---|---|
| Jeton temporaire | `POST /api/token/` |
| Encaissement | `POST /api/collect/` |
| Reversement | `POST /api/withdraw/` |
| Statut | `GET /api/transaction/{reference}/` |
| Solde | `GET /api/balance/` |
| Page de paiement hébergée | `POST /api/get_payment_link/` |

Authentification par jeton permanent (`Authorization: Token …`) ou temporaire.
Statuts : `PENDING` · `SUCCESSFUL` · `FAILED`. Numéros au format `237XXXXXXXXX`,
sans le `+`. Montants entiers ou chaînes, **décimales refusées** — ce qui
s'accorde avec l'ADR 0004. Environnement de démonstration sur `demo.campay.net`.

## Ce qui est bon

- **API petite et compréhensible.** Six endpoints, sémantique claire, SDK
  lisible. L'intégration se code en une journée.
- **Environnement de démonstration ouvert.** On peut écrire et tester
  l'adaptateur **sans contrat ni engagement** — c'est ce qui a été fait ici.
- **`initCollect` renvoie un `ussd_code`.** Le prestataire indique le code que
  la payeuse peut composer si la notification push n'arrive pas. Cela se marie
  directement avec la rampe de paiement : on peut afficher ce code en repli.
- **Le solde est ventilé par opérateur** (`mtn_balance`, `orange_balance`).
  Utile, et révélateur du fonctionnement : voir ci-dessous.

## Les deux raisons de ne pas le retenir en l'état

**1. Pas de bénéficiaire tiers.** `collect` n'a qu'un champ `from`, aucun champ
de destinataire. Les fonds atterrissent sur le solde du compte marchand, et il
faut un `withdraw` pour les reverser. C'est le modèle « compte marchand
unique » que l'ADR 0006 écarte, puisqu'il ferait détenir des fonds à Swap.

**2. La référence de l'opérateur n'est pas exposée.** Les réponses ne portent
que la référence CamPay, un UUID. La référence qui figure dans le SMS reçu par
la vendeuse — un identifiant à 11 chiffres chez MTN — n'apparaît nulle part.
Conséquence : **la voie agrégateur et la voie SMS produisent deux identifiants
sans lien**, et l'on perd le rapprochement élégant entre les deux mécanismes de
preuve. Le repli serait un rapprochement par montant + numéro + horodatage,
moins fiable.

## Ce qui a été produit malgré tout

`apps/api/src/adapters/campay.ts` — adaptateur complet de l'interface
`PaymentProvider`, couvert par 21 tests. Il n'est pas branché en production,
mais il sert trois choses :

- il **valide l'interface** `PaymentProvider` contre un prestataire réel ;
- il fournit un **banc d'essai** utilisable dès aujourd'hui sur `demo.campay.net` ;
- il **documente** dans le code même les deux limites ci-dessus, à l'endroit
  où quelqu'un les redécouvrirait.

Deux décisions de sécurité y sont figées : `PENDING` est projeté sur
`waiting_customer` et **jamais** sur `failed`, et `verifySignature` **refuse
tout ce qui n'est pas signé** — CamPay ne documentant pas publiquement de
signature de webhook, on ne laisse pas de laissez-passer en attendant.

## Seconde passe : ce que la documentation ne dit pas

Sources épuisées le 29/07/2026 : SDK Python (README + source), SDK Android
(README), wrapper PHP communautaire (README + source), documentation Postman
(deux lectures), page du plugin WooCommerce. `campay.net` renvoie un 403 et
`demo.campay.net` comme le navigateur de sources WordPress sont fermés à la
consultation automatisée.

**Trouvé en seconde passe :**

- Un **septième endpoint non documenté publiquement** : `POST /api/history/`
  avec `start_date` / `end_date`, relevé dans le wrapper PHP et absent du SDK
  Python. C'est **le seul endroit où la référence de l'opérateur pourrait
  apparaître** — à vérifier en priorité en bac à sable.
- Les **codes d'erreur** : `ER101` numéro invalide, `ER102` opérateur non
  supporté (MTN et Orange seulement), `ER201` montant décimal refusé,
  `ER301` solde insuffisant au reversement. Le dernier est le cas
  « flottant épuisé » : il est **réessayable**, les autres non. L'adaptateur
  les traduit désormais en erreurs typées.
- Le plugin WooCommerce mentionne l'ajout d'un **webhook en version 1.2.1
  (mars 2025)** — donc les webhooks existent, mais ni leur charge utile ni
  leur éventuelle signature ne sont documentées publiquement.

**Reste inconnu, et ne se lèvera pas en ligne :** structure exacte de la charge
utile des webhooks, existence et schéma d'une signature, plafonds de montant,
délai de reversement, et forme de la réponse de `/api/history/`.

**Comment fermer ces trous :** créer une application sur `demo.campay.net`.
C'est gratuit, immédiat, sans engagement, et l'interface de configuration des
webhooks montrera la charge utile et la présence ou non d'une signature.
L'adaptateur de ce dépôt est déjà prêt à être branché dessus.

## Questions à poser à CamPay par écrit

1. Existe-t-il un modèle **sous-marchand** où le vendeur est enregistré comme
   bénéficiaire avec son propre numéro, sans transit par un compte à notre nom ?
2. La **référence de transaction de l'opérateur** est-elle disponible dans le
   webhook, ou dans un champ étendu de la réponse de statut ?
3. Les webhooks sont-ils **signés** ? Selon quel schéma, avec quel en-tête ?
4. Le reversement est-il **instantané** ou groupé ?
5. Que se passe-t-il quand le **solde d'un opérateur tombe à zéro** — les
   reversements échouent-ils silencieusement, et existe-t-il une alerte ?
6. Grille tarifaire contractuelle, et plan de conformité au statut d'Opérateur
   de Services de Paiement au 1ᵉʳ janvier 2027.

## À revoir si

Une réponse favorable à la question 1 ou 2 change l'évaluation. La question 2
suffirait à elle seule à rendre CamPay nettement plus intéressant que ses
concurrents, puisqu'elle réconcilierait les deux voies de preuve.
