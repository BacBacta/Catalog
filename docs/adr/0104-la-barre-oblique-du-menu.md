# ADR 0104 — la barre oblique du menu

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0087, 0102, 0103

## Contexte — la moitié de l'accueil que personne ne regardait

Deux composants sont posés sur le numéro depuis l'ADR 0087, et ils n'ont pas
les mêmes conditions d'affichage :

- **les amorces** (« ice breakers ») n'apparaissent que dans un fil **vide** ;
- **les commandes** apparaissent dans le menu « / » de la zone de saisie, dans
  **n'importe quelle** conversation.

Les secondes sont donc la seule moitié de l'accueil joignable en permanence.
Quatre sont posées : `/vendre`, `/boutique`, `/suivi`, `/aide`.

## Le défaut

Aucune règle ne retirait la barre. Les reconnaissances de geste normalisaient
`texteBrut.trim().toLowerCase()` sans accents, et rien de plus — donc `/vendre`
ne valait pas `vendre`.

Mesuré le 14/08/2026 en passant les deux formes par `aiguiller` :

| tapé | prospect | vendeuse installée |
|---|---|---|
| `vendre` | inscription | vendeuse |
| `/vendre` | **acheteuse** ✗ | vendeuse |
| `vendu` | acheteuse | inscription (comptoir) |
| `/vendu` | acheteuse | **vendeuse** ✗ |
| `ajouter` | acheteuse | inscription |
| `/ajouter` | acheteuse | **vendeuse** ✗ |

**Trois aiguillages, pas un.** Et `/aide` ne rendait pas le mot-clé global :
dans une boutique ouverte, il ne donnait pas les gestes.

`/suivi` marchait déjà, par accident heureux : `demandeStatut` cherche
`\bsuivis?\b`, et la barre est une frontière de mot.

## Pourquoi ça a duré

**L'échec était silencieux.** Une commande non reconnue tombe sur l'accueil —
qui, depuis l'ADR 0103, est une bonne réponse : trois portes, rien de cassé. La
personne n'est jamais bloquée, aucune erreur n'est levée, aucune trace ne
s'écrit. Un menu qui annonce « /vendre — Ouvrir ma boutique en deux minutes » et
rend un accueil générique ment sur ce qu'il fait, sans jamais rougir.

C'est la même forme que l'amorce « Voir une boutique » (ADR 0103) : un composant
posé chez Meta qui promet un geste que le code ne rend pas. Les deux se
découvrent en tapant, jamais en lisant.

## Décision

`motDeGeste` (`src/domain/bot/geste.ts`) porte la normalisation, une fois :
accents, casse, espaces, puis **une barre de tête**. Les onze reconnaissances
de geste l'emploient — inscription, ajout d'article, espace vendeuse, soldes,
congés, carte-vitrine, abandon, comptoir, mot-clé global, statut, remise.

## La règle qui borne le changement, et qui compte plus que lui

**`motDeGeste` sert à RECONNAÎTRE un geste, jamais à fabriquer une valeur.**

C'est le corollaire exact de l'ADR 0102, qui disait « une valeur n'est pas un
geste » ; ici on ajoute que **un geste n'est pas une valeur**. Si la même
fonction produisait les deux, une vendeuse qui déclare un article nommé
« /vendu » le verrait amputé en base — et personne ne le saurait avant de lire
le reçu.

C'est pourquoi `avancerComptoir` et les comparaisons en cours de tunnel gardent
leur normalisation à elles. Deux tests tiennent les deux sens : `/vendu` ouvre
le comptoir quand c'est un geste, et reste `/vendu` quand c'est un nom
d'article.

## Ce qui reste ouvert

**`/boutique` ne mène nulle part**, et la barre n'y est pour rien : `boutique`
seul ne correspond à aucune règle non plus. `demandeEspaceVendeuse` accepte
« ma boutique », « espace vendeuse », « vendeuse » — pas « boutique », qui est
par ailleurs le préfixe de l'entrée acheteuse (« boutique chez-amina »).

Deux issues, et c'est une décision de produit : élargir la règle au mot seul
pour une vendeuse installée, ou changer la commande posée sur le numéro. Aucune
n'est prise ici.
