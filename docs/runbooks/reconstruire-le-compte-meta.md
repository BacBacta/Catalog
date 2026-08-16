# Reconstruire le compte Meta après la perte de l'administrateur

> Ce fichier se lit **une fois**, le jour où l'on décide de reconstruire.
> Il fait suite à l'**ADR 0109** : le compte personnel qui administrait le
> Business Manager a été désactivé définitivement le 16/08/2026, et c'était
> le seul administrateur.
>
> **Rien ici n'est urgent.** Le jeton en place est un jeton d'utilisateur
> système **permanent** — mesuré, `expires_at = JAMAIS`. Le service tourne
> sans échéance connue. Ce runbook se déroule au rythme qu'on choisit.

## L'interdit, avant toute chose

> **On ne touche à rien sur le WABA actuel.**

Pas de suppression de numéro, pas de tentative de migration, pas de
« nettoyage ». Le service tourne sur un équilibre qu'on ne sait pas
reproduire.

En particulier, **supprimer le numéro du WABA actuel coupe le service à la
seconde et ne se défait pas**. C'est pourtant le premier geste que suggère
la voie « propre ». Il est interdit tant que l'étape 5 n'est pas atteinte.

## L'état de départ, mesuré le 16/08/2026

| | |
|---|---|
| WABA | `27932621843070231` — ACTIVE, révision APPROVED |
| Entreprise | `1549278773267455` — Horizon Services Sarl, **verified** |
| Application | `1404746664890890` |
| Numéro | `+32 451 05 51 44` — CONNECTED, GREEN, nom APPROVED |
| Jeton | SYSTEM_USER, **permanent**, 5 portées |
| Flows déposés | livraison, inscription, ouverture, article, avis, reversement |

Ces identifiants **ne se relisent plus dans aucune interface**. Ils vivent ici
et dans `operations-preprod.yml`. Ne pas les perdre.

Pour les revérifier à tout moment :
`Depots Meta` → `sante-compte` (lecture seule, aucun envoi).

## La séquence

### 1. Un Business Manager neuf, avec DEUX administrateurs

C'est l'étape la plus importante du runbook, et elle prend dix minutes.

1. Un compte personnel Facebook **stable** — pas un compte créé le jour même,
   qui inspire peu de confiance aux contrôles automatiques.
2. Créer le Business Manager.
3. **Ajouter immédiatement un second administrateur**, un autre compte. Pas
   « plus tard », pas « quand on aura le temps » : maintenant, pendant qu'on
   y pense et qu'on a la main.

> La panne du 16/08 tient entièrement à l'absence de cette ligne. Tout le
> reste de ce runbook n'existe que parce qu'elle manquait.

### 2. Lancer la vérification d'entreprise TOUT DE SUITE

C'est le chemin critique — la leçon du terrain du 05/08/2026, déjà écrite
dans `bascule-waba-production.md` : tant que la vérification n'est pas
passée, **aucun numéro ne peut être enregistré ni utilisé**, et aucun bouton
ne débloque un numéro « en attente ».

Elle se lance avant tout le reste et court en arrière-plan.

### 3. Un NOUVEAU numéro, et les dépôts par script

Ne pas tenter de récupérer `+32 451 05 51 44` à ce stade — voir l'étape 5.

Une fois le WABA créé et le numéro enregistré, créer l'utilisateur système et
son jeton avec **sept** portées :

```
whatsapp_business_management      (déjà)
whatsapp_business_messaging       (déjà)
manage_app_solution               (déjà)
whatsapp_business_manage_events   (déjà)
public_profile                    (déjà)
catalog_management                ← pour l'ADR 0108
business_management               ← pour l'ADR 0108
```

Puis, dans l'ordre, par le workflow `Depots Meta` :

| Opération | Ce qu'elle fait |
|---|---|
| `catalogue-etat` | Vérifie les portées **réelles**. Deux ✓ attendus. |
| `gabarits` + `--deposer` | Redépose les gabarits (Meta les réexamine) |
| `flux` + `--deposer` | Redépose les six Flows, imprime leurs identifiants |
| `accueil-poser` | Repose les amorces du fil |
| `catalogue-deposer` | Crée le catalogue, imprime `WABOT_CATALOGUE_ID` |
| `catalogue-synchroniser` | Pousse les fiches, verdict de Meta par fiche |

### 4. Basculer Catalog — configuration seule

Aucune ligne de code. Par `fly secrets set` :

```
WABOT_API_KEY            le nouveau jeton
WHATSAPP_WABA_ID         le nouveau WABA
WHATSAPP_PHONE_NUMBER_ID le nouvel identifiant de numéro
WHATSAPP_WABA_NUMERO     le nouveau numéro, en E.164
WHATSAPP_APP_SECRET      le secret de la nouvelle application
WABOT_FLUX_*_ID          les cinq identifiants rendus par `flux.mjs`
WABOT_CATALOGUE_ID       rendu par `catalogue.mjs --deposer`
```

`resoudreTransport` déduit le transport de l'hôte (ADR 0046) : rien à
déclarer tant qu'on reste chez Meta.

**Vérifier ensuite** : `sante-compte` sur le nouveau WABA, puis un vrai
message dans le fil.

### 5. Alors seulement : récupérer l'ancien numéro

À ce stade, le service tourne sur le nouveau compte. Une tentative qui échoue
ne coûte plus rien — c'est exactement ce qui la rend raisonnable.

Le porteur du produit contrôle la ligne `+32 451 05 51 44`, donc le code de
vérification lui parviendra. La question **non vérifiée** est de savoir si
Meta autorise le transfert quand le Business Manager cédant n'a plus
d'administrateur. Elle se mesure à ce moment-là, pas avant.

Si le transfert réussit, l'ancien numéro rejoint le nouveau WABA et
`WHATSAPP_WABA_NUMERO` change une dernière fois. S'il échoue, on garde le
nouveau numéro et rien n'est perdu.

## Pourquoi le numéro se change maintenant plutôt que plus tard

Le coût de changer de numéro est **à son minimum aujourd'hui** : la
préproduction n'a pas encore de vendeuses installées. Chaque semaine qui
passe, ce coût monte — un numéro partagé, imprimé sur une carte-vitrine, mis
en Statut WhatsApp, ne se change plus sans perdre des gens.

## La leçon, qui déborde de Meta

Un actif administré par un **seul** compte est un actif à durée
indéterminée. La règle vaut pour Fly, Vercel, Tigris, le registrar du domaine
et le dépôt lui-même. Ce qui protège n'est pas une sauvegarde : c'est un
**second administrateur**, posé le jour de la création.

L'inventaire de ces comptes n'existe pas encore. Il est dit, pas comblé
(AGENTS.md §7.7).
