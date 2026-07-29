# Sonde CamPay — mode d'emploi

Deux scripts qui répondent aux questions que la documentation publique de
CamPay ne répond pas (voir `docs/adr/0008-campay-evalue.md`).

Compte au total : **environ 30 minutes**, gratuit, sans engagement.

---

## Étape 1 — créer le compte de démonstration (5 min)

1. Aller sur **https://demo.campay.net** et créer un compte.
2. Créer une **application**.
3. Relever, dans la section **APP KEYS**, le **jeton permanent**
   (« permanent access token »).

## Étape 2 — lancer la sonde (5 min)

```bash
export CAMPAY_TOKEN="votre_jeton_permanent"
export CAMPAY_ENV=DEV
export CAMPAY_TEST_MSISDN=237XXXXXXXXX   # un numéro MTN ou Orange de test
export CAMPAY_TEST_AMOUNT=5

node apps/api/scripts/campay-probe.mjs
```

La sonde interroge le solde, l'endpoint non documenté `POST /api/history/`,
un encaissement de test, le statut complet, et les limites de montant. Elle
**fouille automatiquement toutes les réponses** à la recherche d'un champ qui
ressemblerait à une référence d'opérateur — un nom de champ évocateur, ou une
valeur de 9 à 15 chiffres comme les identifiants MTN à 11 chiffres.

Elle affiche chaque réponse **brute**, sans interprétation : c'est le point.

> Sécurité : la sonde refuse d'interroger la production sans `CAMPAY_ENV=PROD`
> **et** l'option `--i-know`.

## Étape 3 — capturer un webhook (20 min)

```bash
node apps/api/scripts/webhook-capture.mjs      # écoute sur :8899
npx localtunnel --port 8899                    # ou : ngrok http 8899
```

Coller l'URL publique obtenue dans la configuration webhook du tableau de bord
CamPay, puis déclencher un paiement de test.

Le capteur consigne **verbatim** les en-têtes, le corps brut et les champs
analysés, dans le terminal et dans `campay-webhooks.log`. Il signale les
en-têtes qui ressemblent à une signature, et alerte s'il n'y en a aucun.

---

## Ce que ces trois étapes tranchent

| Question ouverte | Ce qui y répond |
|---|---|
| La référence de l'opérateur est-elle exposée ? | sonde, étapes 2 et 4 |
| Que contient exactement la réponse de statut ? | sonde, étape 4 |
| À quoi sert `/api/history/` ? | sonde, étape 2 |
| Quels sont les plafonds de montant ? | sonde, étape 5 |
| Les webhooks sont-ils signés, et comment ? | capteur |
| Quelle est la charge utile exacte du webhook ? | capteur |
| Le corps à signer est-il le JSON brut ? | capteur, section « corps brut » |

**La première ligne est celle qui compte.** Si CamPay expose la référence de
l'opérateur — l'identifiant à 11 chiffres qui figure aussi dans le SMS reçu par
la vendeuse — alors la voie agrégateur et la voie SMS partagent un identifiant
commun, et les deux mécanismes de preuve se réconcilient. Sinon, le
rapprochement devra se faire sur montant + numéro + horodatage.

## Après

Renvoyer la sortie de la sonde et le contenu de `campay-webhooks.log`.
L'adaptateur `apps/api/src/adapters/campay.ts` sera ajusté en conséquence :
mapping des champs réels, vérification de signature au bon schéma, et
suppression des suppositions qui y figurent aujourd'hui.
