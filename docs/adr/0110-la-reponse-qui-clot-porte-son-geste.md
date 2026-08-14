# ADR 0110 — la réponse qui clôt porte son geste

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0088 (le menu natif) et 0109 (l'accroche en une bulle) —
même famille : ce que le pouce peut faire doit être sous le pouce.

## Ce que le porteur du produit a vu, à 23 h 38

Sur son téléphone, en testant l'accroche fraîchement déployée :

> C'est annulé. Écrivez « vendre » pour reprendre, ou « ajouter » pour un
> article.

Ses mots : « l'idée est de rester toujours intuitif, et moins manuel — toute
réponse ne doit pas se terminer en muet, elle doit proposer des actions à
l'utilisateur sous forme de bouton. »

## Le défaut, et il est double

**1. La fermeture est muette.** Le fil vient de se libérer — c'est l'instant
exact où la personne se demande « et maintenant ? » — et la réponse lui tend
deux mots à taper. Sur un clavier de téléphone, entre deux clientes, chaque
mot à taper est une marche. Le fil acheteuse, lui, faisait déjà le bon
geste : « annuler » y repose l'accueil de la boutique, boutons compris
(`conversation.ts`, id `annuler`). Le fil vendeuse fermait en texte nu.

**2. Un des deux mots promis ne menait nulle part.** « Ajouter » est réservé
par la règle 3 de l'aiguillage aux vendeuses **installées**. Tapé par une
prospect qui vient d'annuler son inscription — précisément la personne à qui
ce message s'affiche le plus —, il partait au fil acheteuse et rendait
l'accueil générique. La phrase promettait un chemin que le routage refusait,
et aucun test ne pouvait le voir : le message était du texte, il n'offrait
rien de vérifiable.

## Décision 1 — la règle, et elle entre dans AGENTS.md

> **Aucune réponse ne clôt un échange en muet.** Tout message qui ferme un
> parcours — annulation, mise de côté, confirmation, refus, erreur — propose
> le ou les gestes suivants en boutons ou en liste, avec des identifiants
> routés pour la personne qui les reçoit.

Deux exceptions, chacune parce que le geste est **déjà à l'écran** :

- la **question ouverte** — y répondre EST le geste ; lui accrocher des
  boutons la transformerait en menu qu'elle n'est pas ;
- la réponse qui suit **immédiatement un menu interactif** portant les mêmes
  gestes — les redonner est le doublon mesuré et retiré par l'ADR 0109.

La règle vit dans AGENTS.md §2 (« Le fil WhatsApp ») : c'est une contrainte
de produit, pas une préférence de session.

## Décision 2 — la sortie de flux vendeuse devient contextuelle

`messageSortieFlux` (`inscription.ts`) rend les trois fermetures — « annuler »,
« menu », abandon du comptoir — en **boutons**, et les gestes dépendent de qui
sort, ce que l'état dit déjà :

| Qui sort | États | Boutons | Routage |
|---|---|---|---|
| Prospect, pas de boutique | `inscription_*` | Reprendre (`vendre`) · Comment ça marche ? (`comment`) | règle 2 de l'aiguillage · fil acheteuse |
| Vendeuse installée | `article_*`, `comptoir` | Ajouter un article (`article`) · Ma boutique (`ma_boutique`) | règle 3, la même que le menu d'ouverture (ADR 0088) |

Aucun identifiant nouveau : les quatre sont ceux dont le routage est déjà
tenu par les tests d'aiguillage, bouton et ligne de liste. Le service fait
déjà le reste — une vendeuse qui entre au bouton `article` sans état en cours
reçoit directement la question (`bot.ts`), une prospect qui reprend reçoit la
première question et le formulaire d'ouverture.

Les mots tapés restent tous reconnus : le bouton s'ajoute au mot, il ne le
remplace jamais.

## Ce que ce lot ne fait pas

Le **balayage systématique** des autres fermetures du produit n'est pas fait
ici : c'est un inventaire à mener depuis `balayage-reponses.md` — colonne des
réponses en texte nu sur des étapes terminales — et chaque cas demande ses
gestes propres, routés pour son contexte. La règle d'AGENTS.md gouverne ce
balayage et tout message futur ; ce lot la pose et l'applique à la fermeture
que le banc a montrée, qui était aussi la plus fréquente : celle par laquelle
on sort d'un formulaire.

Le pidgin ne bouge pas : le fil vendeuse est en français seul (ADR 0033).
