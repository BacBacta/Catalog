# ADR 0111 — le balayage des fermetures muettes

Date : 14/08/2026
Statut : accepté
Exécute : le lot que l'ADR 0110 nommait sans le faire
Concerne : `conversation.ts`, `bot.ts` — aucun texte nouveau, aucune règle
métier touchée : la FORME des fermetures, rien d'autre.

## La méthode

L'inventaire est parti des deux machines et du service, pas de la
documentation : toute réponse qui **clôt** un échange — annulation,
confirmation, refus, erreur — rendue en texte nu, sans menu interactif encore
actif juste au-dessus. Le registre `balayage-muets.md` ne pouvait pas servir
ici : il ne compte que le silence total, et le silence d'idempotence est
légitime.

Chaque bouton ajouté réutilise un identifiant **déjà routé** — c'est la
contrainte qui a dimensionné le lot. Un seul identifiant a gagné un usage
nouveau sans gagner de code : `menu`, parce que tout le monde retombe
quelque part avec lui (accueil de boutique en fil d'achat, accueil froid sans
boutique, menu vendeuse par le repli de `reagirVendeuse`).

## Ce qui a été fermé, et avec quels gestes

### Fil acheteuse (`conversation.ts`)

| Fermeture | Gestes ajoutés |
|---|---|
| Merci d'avis, avis impossible, avis déjà déposé, refus de contre-signature, aucun geste sans commande | contextuels (`cloture`) : avec boutique **[Voir les articles · Parler au vendeur/se]**, sans **[Suivre ma commande · Comment ça marche ?]** |
| Merci de contre-signature | **[Donner mon avis]** — les deux gestes de confiance s'enchaînent (ADR 0072), et `veutNoter` routait déjà `avis` |
| Contestation enregistrée | l'humaine **en premier** : le geste utile d'un litige est de parler à la vendeuse (ADR 0078), pas de retourner au catalogue |
| Boutique introuvable | **[Suivre ma commande · Comment ça marche ?]** |
| Changement de langue sans boutique | l'accueil froid suit, **dans la langue demandée** — on change de langue pour se réorienter |

### Fil vendeuse (`conversation.ts`, `bot.ts`)

| Fermeture | Gestes ajoutés |
|---|---|
| Forme non lue au repos | **[Ajouter un article · Ma boutique]** |
| Congés posés | **[Je reprends]** — le retour à portée de pouce, le mot reste reconnu |
| Congés levés | **[Ma carte à partager · Ma boutique]** — le geste du retour est de l'annoncer |
| Chaîne rangée | **[Ma carte à partager]** — la confirmation dit « partagez » : l'objet à partager arrive avec |
| Chaîne retirée | **[Ma chaîne]** — le geste inverse reste offert |
| « livrée CT-… » (réussite ou référence introuvable) | **[Mes commandes]** — le registre, où les références exactes se retrouvent (ADR 0107) |

### Service (`bot.ts`)

| Fermeture | Gestes ajoutés |
|---|---|
| Panne passagère (le catch global) | **[Menu]** — le seul identifiant universel ; le fil est peut-être cassé, le prochain appui ne doit pas exiger de savoir quoi taper |
| Boutique fermée relue à la création | **[Parler au vendeur/se · Voir les articles]** — le miroir du refus de la machine (ADR 0056) |
| Commande ratée, stock insuffisant | **[Voir les articles · Parler au vendeur/se]** |

## Ce qui a été examiné et laissé tel quel — chaque cas a sa raison

- **Le verdict du SMS collé** (`messageVerdict`). L'ADR 0083 a choisi ce
  rendu récemment et délibérément. Le refus invite à recoller — une saisie
  libre, donc l'exception « la question est le geste » ; l'acceptation est
  suivie des notifications. Le rouvrir serait la dérive silencieuse
  qu'AGENTS.md §7.6 interdit : il faudra son propre ADR.
- **Les aides** (`aideGestes`, aides du tunnel). Réponses à une question,
  pas des fermetures — et les aides du tunnel portent leurs sorties depuis
  l'ADR 0053.
- **Le statut** (`messageStatut`). Une réponse qui porte déjà ses liens.
- **La forme non lue en plein état** (acheteuse et machine vendeuse). La
  question en cours reste le geste ; la machine vendeuse la repose déjà.
- **« annuler » côté acheteuse.** Conforme avant ce lot : l'accueil de la
  boutique est reposé, boutons compris. C'est lui qui a servi de modèle.
- **Le gel de reversement (STOP).** Un flux de sécurité ne s'habille pas au
  passage.
- **Les notifications hors fenêtre.** Elles attendent les gabarits WABA
  (CLAUDE.md, point 3) : un gabarit porte ses boutons dans sa soumission.

## Ce que ça change aux tests

Cinq assertions lisaient ces fermetures comme du texte nu
(`conversation.test.ts`) : elles passent au lecteur toutes-formes
`corpsQuelconque`, qui existait pour cela. Sept cas nouveaux dans
`couverture.test.ts` tiennent la règle — dont l'enchaînement
contre-signature → avis, et l'ordre humaine-d'abord de la contestation.
