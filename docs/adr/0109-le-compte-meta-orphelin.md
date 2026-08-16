# 0109 — Le compte Meta orphelin : ce qui tient, et comment reconstruire

Date : 2026-08-16
Statut : accepté
Concerne : `WABOT_API_KEY`, `WHATSAPP_WABA_ID`, tout dépôt chez Meta
Reporte : 0108 (le catalogue natif), jusqu'à un compte administrable

## Constat

Le 16/08/2026, le compte Facebook personnel qui administrait l'entreprise
*Horizon Services Sarl* a été **désactivé définitivement**. L'appel a été
rejeté. C'était le **seul** administrateur du Business Manager.

Meta ne rouvre pas d'examen après un rejet définitif. Personne ne peut donc
plus ouvrir `business.facebook.com` pour ce Business Manager.

## Ce qui a été MESURÉ, et non supposé

`apps/api/scripts/diagnostic-meta.mjs`, exécuté sur la machine de
préproduction le 16/08 à 11:54, **après** la désactivation définitive :

```
── 0. Le jeton ──
  type          SYSTEM_USER
  valide        oui
  expiration    JAMAIS (jeton permanent)
  accès données JAMAIS (jeton permanent)
  portées       whatsapp_business_management, whatsapp_business_messaging,
                manage_app_solution, whatsapp_business_manage_events,
                public_profile

── 1. Le WABA ──
  statut ACTIVE · révision APPROVED · entreprise verified

── 2. health_status ──
  envoi global AVAILABLE
  WABA 27932621843070231      AVAILABLE, aucune erreur
  BUSINESS 1549278773267455   AVAILABLE, aucune erreur
  APP 1404746664890890        AVAILABLE, aucune erreur

── 3. Le numéro ──
  +32 451 05 51 44 · CONNECTED · GREEN · nom APPROVED · code VERIFIED
```

**Le service tourne, et son jeton n'expire jamais.** C'est le fait qui
commande tout le reste : il n'y a pas de compte à rebours, donc pas
d'urgence, donc pas de décision à prendre dans la panique.

La raison est structurelle : un jeton d'**utilisateur système** n'est adossé
à aucune connexion personnelle. La mort du compte qui l'a créé ne le tue pas.

## Ce qui est gelé

Tout ce qui passe par la console Meta, c'est-à-dire toute ADMINISTRATION :

- générer un jeton, ou changer ses portées ;
- déposer ou corriger un Flow, un gabarit, une amorce de fil ;
- créer le catalogue Commerce Manager — **l'ADR 0108 est donc reporté**, son
  code reste dormant sans `WABOT_CATALOGUE_ID`, exactement comme prévu ;
- transférer le numéro : le transfert se valide côté cédant.

Le produit est **fonctionnel et figé**. Ce qui est déposé continue ; rien de
nouveau ne peut l'être.

## Ce qui est reconstructible depuis ce dépôt

Vérifié fichier par fichier le 16/08 :

| Actif | Où il vit | Comment il se rejoue |
|---|---|---|
| Les 6 Flows | `docs/flux-*.json` | `flux.mjs --deposer` |
| Les gabarits | `domain/bot/gabarits.ts` | `gabarits.mjs --deposer` |
| Les amorces du fil | `composants.mjs` | `--accueil-poser` |
| Le catalogue | `catalogue.mjs` | `--deposer` puis `--synchroniser` |

**Le coût d'une reconstruction n'est donc pas le contenu, c'est
l'ADMINISTRATIF** : la vérification d'entreprise (documents, délai) et
l'approbation du nom affiché. Le reste se compte en heures de script.

C'est l'inverse de l'intuition courante — « on perd les modèles approuvés » —
et ça se vérifie en lisant les quatre lignes du tableau ci-dessus.

## Décision

### 1. On ne touche à RIEN sur le WABA actuel

Aucune suppression, aucune tentative de migration, aucun « nettoyage ». Le
service tourne sur un équilibre qu'on ne sait pas reproduire ; le casser pour
tenter de le réparer serait échanger un système vivant contre un pari.

En particulier : **supprimer le numéro du WABA actuel est irréversible et
coupe le service à la seconde.** C'est pourtant le geste que la voie
« propre » suggère en premier. Il est interdit ici.

### 2. On reconstruit À CÔTÉ, pas à la place

Dans cet ordre, chaque étape étant sans effet sur le service en cours :

1. **Nouveau compte personnel, nouveau Business Manager, DEUX
   administrateurs dès le premier jour.** C'est la faute d'origine — un seul
   administrateur — et c'est la seule qu'il serait impardonnable de répéter.
2. **Lancer la vérification d'entreprise immédiatement.** C'est le poste le
   plus long ; il court pendant qu'on fait le reste.
3. **Un NOUVEAU numéro** pour le nouveau WABA. Redéposer Flows et gabarits
   par script.
4. **Basculer Catalog** : une variable d'environnement, aucune ligne de code.
   `whatsapp-transport.ts` et les identifiants de Flows sont déjà de la
   configuration.
5. **Alors seulement**, tenter de récupérer `+32 451 05 51 44`. À ce moment,
   un échec ne coûte plus rien — c'est ce qui rend la tentative raisonnable.

### 3. Le numéro se change MAINTENANT ou jamais

Le porteur du produit contrôle encore la ligne `+32 451 05 51 44`, ce qui
garde l'option de migration ouverte. Mais l'argument décisif est ailleurs :
**le coût de changer de numéro est à son minimum aujourd'hui**, parce que
la préproduction n'a pas encore de vendeuses installées. Chaque semaine qui
passe, ce coût monte — un numéro partagé, imprimé, mis en Statut, ne se
change plus sans perdre des gens.

## Ce que cet incident enseigne, au-delà de Meta

**Un actif administré par un seul compte est un actif à durée indéterminée.**
La règle vaut pour le Business Manager, mais aussi pour Fly, Vercel, Tigris,
le registrar du domaine et le dépôt lui-même. Le geste qui protège n'est pas
une sauvegarde : c'est un **second administrateur**, posé le jour de la
création et jamais retiré.

L'inventaire de ces comptes, et de qui les administre, se fait au prochain
lot d'exploitation. Il n'existe pas aujourd'hui, et c'est dit ici plutôt que
comblé (AGENTS.md §7.7).

## Ce qui n'est pas décidé ici

La reconstruction elle-même. C'est un arbitrage du porteur du produit — coût,
calendrier, choix du numéro —, pas un correctif technique. Cet ADR établit
l'état mesuré et l'ordre sûr ; il ne déclenche rien.
