# Mise en service du bot WhatsApp sur un canal 360dialog

Ce fichier se lit **avant** de poser la première clé, et il se relit le jour où
rien n'arrive. Il couvre la préproduction sur un **numéro de test Meta**
(ADR 0035) ; le passage au numéro de production est un autre geste, qui attend
la PLBV.

> **Le symptôme d'un branchement raté est le silence, pas une erreur.** Le Hub
> 360dialog affiche une URL enregistrée, l'API accepte les envois, et aucune
> livraison n'arrive. C'est pour ça que l'ordre des opérations ci-dessous se
> termine par une vérification, et pas par « c'est configuré ».

---

## 1. Ce que ce canal permet, et ce qu'il ne permet pas

| | Sur numéro de test |
|---|---|
| Fil acheteuse complet (catalogue → panier → récap → commande → rampe → reçu) | ✅ — tout est de la réponse en session, aucun gabarit requis |
| Fil vendeuse (mots-clés, collage de SMS, aiguillage) | ✅ |
| Relance d'acompte à ~1 h | ✅ — dans la fenêtre de 24 h |
| Destinataires | ⚠️ **liste d'autorisation** — déclarer les numéros des testeuses d'abord |
| Notification vendeuse, relance post-24 h, statuts | ❌ — gabarits utilitaires, attendent le WABA |
| Vendeuses réelles | ❌ — le numéro est jetable, celui de production sera différent |

Le nombre exact de destinataires déclarables et la procédure **sont à constater
sur le canal** : ils ne sont écrits nulle part ici, faute d'avoir été vérifiés.

---

## 2. L'ordre des opérations

**1. Générer le verrou du webhook.**

```bash
openssl rand -hex 24     # → WABOT_WEBHOOK_AUTH
openssl rand -hex 24     # → WHATSAPP_ENTRANT_SECRET, s'il n'existe pas déjà
```

**2. Récupérer la clé API.** Le Hub affiche « An API key has already been
generated » sans jamais réafficher la valeur. « Generate new key » en produit
une neuve **et tue l'ancienne** — à ne faire que si personne d'autre ne s'en
sert.

**3. Poser les secrets sur la machine**, jamais dans le dépôt :

```bash
fly secrets set --app catalog-api-preprod \
  WABOT_API_KEY="<la clé du Hub>" \
  WABOT_BASE_URL="https://waba-v2.360dialog.io" \
  WABOT_WEBHOOK_AUTH="<le verrou de l'étape 1>" \
  WHATSAPP_ENTRANT_SECRET="<le secret d'URL>"
```

> **`WABOT_BASE_URL` n'a pas de `/v1` en production.** Le `/v1` est propre au
> sandbox (mesuré le 01/08/2026, commit `557d5f6`) ; en production il rend 404
> à l'envoi. L'écran « Direct API Access » montre la bonne base dans son `curl`.

> **Ne pas poser `WHATSAPP_APP_SECRET`.** Il n'existe pas en relais, et une
> valeur inventée ferait croire à une signature Meta active (ADR 0035 §3).

**4. Déclarer le webhook, en-tête compris.** Dans le Hub, **« Edit WABA
Webhook »** — pas le champ URL de l'écran d'accueil, qui est un raccourci amputé
de la section des en-têtes (mesuré le 07/08/2026) :

| Champ | Valeur |
|---|---|
| Webhook URL | `https://catalog-api-preprod.fly.dev/api/whatsapp/entrant/<WHATSAPP_ENTRANT_SECRET>` |
| Custom Headers → Name | `Authorization` |
| Custom Headers → Value | la valeur de `WABOT_WEBHOOK_AUTH`, **au caractère près** |

**5. Cliquer « Send test request », dans la même boîte.** C'est le meilleur
contrôle du verrou, et il vient avant tout téléphone : il ne dépend ni de la
liste d'autorisation, ni d'un numéro déclaré, ni d'une session ouverte.

| Code rendu | Cause | Geste |
|---|---|---|
| **200** | Le verrou passe. Le corps de test n'est pas une livraison WhatsApp valide, et c'est sans importance : un JSON illisible est traité comme un message ordinaire (ADR 0027) | Passer à l'étape 6 |
| **401** | Le relais envoie **sans le verrou attendu** : en-tête absent, ou valeur différente — un espace de fin suffit | Reprendre l'étape 4, comparer les deux valeurs |
| **404** | Secret d'URL faux, **ou** la route ne s'est pas montée | Vérifier le secret ; puis que `WHATSAPP_ENTRANT_SECRET` **et** `WABOT_WEBHOOK_AUTH` sont bien sur la machine (ADR 0035 §1) |

**6. Vérifier qu'un vrai message arrive.** Depuis un numéro déclaré, écrire
« Hi » au numéro du canal, puis :

```bash
fly logs --app catalog-api-preprod | grep -i "entrant\|refusee"
```

---

## 3. Diagnostic — quand le test passe mais que rien n'arrive

L'étape 5 verte et l'étape 6 muette isolent la panne du côté du relais, pas du
nôtre : le verrou est bon, c'est la livraison qui ne part pas.

| Ce que disent les traces | Cause | Geste |
|---|---|---|
| Rien du tout | Le numéro de l'expéditrice n'est **pas sur la liste d'autorisation** du numéro de test, ou l'abonnement aux événements de message n'est pas actif | Déclarer le numéro (§1) ; vérifier les événements souscrits |
| `livraison entrante refusee : signature=false en-tete=false` | Le relais envoie sans le verrou — un vrai message ne passe pas là où le test passait : la configuration a été enregistrée deux fois, ou sur un autre canal | Rouvrir « Edit WABA Webhook » et relire les en-têtes |
| `livraison entrante refusee : signature=false en-tete=true` | L'en-tête est posé mais **ne correspond pas** à la valeur de la machine | Comparer les deux ; un espace de fin suffit |

Ces traces ne portent **aucun contenu** de message, par construction (ADR 0023) :
elles disent la forme du refus, jamais ce qui a été refusé.

---

## 4. Retour arrière

Retirer `WABOT_API_KEY` suffit à rendormir le bot : plus d'envoi, et le webhook
ne route plus rien vers lui. Les défis de connexion (ADR 0027) continuent seuls.

```bash
fly secrets unset --app catalog-api-preprod WABOT_API_KEY
```

Pour fermer aussi le webhook, retirer `WHATSAPP_ENTRANT_SECRET` : la route
cesse d'exister.
