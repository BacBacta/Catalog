# ADR 0096 — sept composants de Flow, mesurés sur notre WABA

Date : 14/08/2026
Statut : accepté — **verdicts de mesure**, aucune ligne de code n'en dépend encore
Prolonge : ADR 0087, 0093
Ferme la porte de : ADR 0093

## Ce que cet ADR est

Le balayage du 13/08 (`docs/analyses/2026-08-13-balayage-capacites-meta.md`) a
dressé la liste des composants de Flow que Catalog n'emploie pas, à partir de
**sources secondaires** : les pages de référence de Meta étaient inatteignables
— HTTP 500 reproductible sur six tentatives et quatre formes d'URL. Il ne
concluait rien, il posait des questions.

Voici les réponses, obtenues sur **notre** WABA par la méthode de l'ADR 0087 :
un brouillon jetable par composant, jamais publié, verdict lu dans
`validation_errors`, brouillon supprimé. Sept brouillons créés, sept supprimés.
Rien ne survit chez Meta, rien n'a été envoyé à personne.

Cet ADR **n'autorise aucune fonctionnalité**. Il enregistre ce que la
plateforme accepte, avant qu'une ligne de code n'en dépende — c'est la règle
que le script imprime lui-même en dernière ligne.

## Le résultat qui commande les autres : 7.3 est acceptée

Le premier brouillon ne porte **que** le témoin, dans la version visée. Il est
**accepté**.

Cela ferme la porte que l'ADR 0093 avait laissée ouverte : nos cinq définitions
migrées en Flow JSON 7.3 passeront. Le seul risque de cette migration — que les
« validations renforcées » de 7.2/7.3 refusent ce que 7.0 tolérait — est levé
par la mesure, et non par la lecture d'un journal des changements qui reste
inatteignable.

Ce résultat commande tous les suivants : sans lui, un refus dirait « version »
autant que « composant », et aucun verdict ne vaudrait.

## Les sept verdicts

Mesure du 14/08/2026, run 31790206474.

| Composant | Version annoncée | Verdict sur notre WABA |
|---|---|---|
| témoin (7.3 nu) | — | **accepté** |
| `RichText` | 5.1+ | **accepté**, seul sur son écran |
| `If` / `Switch` | 4.0+ | **accepté** |
| `ChipsSelector` | 6.3+ | **accepté** |
| `ImageCarousel` | 7.1+ | **accepté** |
| `CalendarPicker` | 6.1+ | **accepté** — *voir ci-dessous* |
| `NavigationList` | 6.2+ | disponible, **contrainte d'action** — *voir ci-dessous* |

Tous les « accepté » le sont dans la même configuration : Flow JSON 7.3, action
`complete`, **sans endpoint**. C'est la configuration que Catalog emploie, et
c'est la seule qui nous intéresse.

## `CalendarPicker` : la documentation a tort, la troisième fois

Meta donne `CalendarPicker` en `data_exchange` **seulement**. Notre WABA
l'accepte en `complete` sans endpoint.

C'est le troisième démenti mesuré, après `cta_url` et
`location_request_message` — deux types de message que Catalog **envoie en
production** et qui sont absents de la référence des messages. La règle qui en
découle ne change pas depuis le balayage du 13/08 : **on mesure, on ne lit
pas.** Une capacité annoncée absente ne l'est pas forcément ; une capacité
annoncée présente ne l'est pas forcément non plus.

Ce verdict n'ouvre rien par lui-même. Il retire seulement l'objection qui
faisait écarter une date de remise sans endpoint.

## `NavigationList` : le composant passe, l'action non

L'erreur rendue n'est pas un refus du composant :

```
INVALID_ENUM_VALUE — Value should be one of: [data_exchange, navigate].
  path: screens[0].layout.children[0]['list-items'][0]['on-click-action'].name
```

`NavigationList` a donc été analysé sans problème. Ce qui est refusé, c'est
qu'un tap sur un article porte `complete` : **une ligne de liste peut naviguer,
elle ne peut pas conclure le formulaire.**

C'est une contrainte de conception à connaître avant d'imaginer un catalogue
navigable dans un Flow : il faudrait un second écran, donc un formulaire en
deux temps.

**Ce qui n'est PAS mesuré, et qu'il ne faut pas déduire** : que
`NavigationList` soit accepté avec `navigate`. La sonde n'a jamais essayé —
`navigate` exige un écran de destination, donc un brouillon à deux écrans, et
la méthode en tient un seul par composant à dessein (une erreur de parse
globale masquerait les autres verdicts). Le jour où ce composant intéresse
vraiment, la sonde se dédouble ; d'ici là, la question reste ouverte et écrite.

## `RichText` : la première mesure était fausse, et c'est la sonde qui l'était

La mesure du 14/08 a d'abord rendu :

```
RichText can either be the only component on the screen or it can be paired
exclusively with the Footer component.
```

La méthode place un `TextInput` témoin sur le même écran — c'est précisément ce
qui la rend fiable pour tous les autres candidats, en séparant « la version est
refusée » de « ce composant est refusé ». Pour `RichText`, **le témoin était ce
qui faisait échouer la mesure.** La sonde mesurait sa propre mise en page.

Elle a été corrigée (`ecranSeul` : ni formulaire, ni témoin, ni référence
`${form.…}` — qui serait une erreur de plus, faute de formulaire) et rejouée.
Verdict : **accepté**.

La garantie que le témoin apportait n'a pas disparu, elle a **changé de
place** : le premier brouillon de la série ne porte que le témoin, et il tourne
avant tous les autres. Tant qu'il est accepté, un écran isolé qui échoue ne
peut plus accuser la version. C'est pour cette raison que l'ordre des candidats
n'est pas cosmétique.

La leçon dépasse ce composant : **une sonde peut mesurer sa propre forme.**
C'est un mode de panne de l'instrument, pas de la chose mesurée, et il ne se
voit qu'en lisant le message d'erreur au lieu de compter les verdicts. Un
tableau qui aurait porté « RichText : refusé » aurait été faux, et personne
n'aurait eu de raison d'y revenir.

## Ce que cet ADR n'autorise pas

Aucun de ces composants n'entre dans un formulaire de Catalog du fait de cet
ADR. En particulier, les trois points de `CLAUDE.md` restent fermés — un
composant accepté ne décide rien :

- **`ChipsSelector` accepté ne rouvre pas `product.variants`.** La colonne
  reste morte parce qu'aucun modèle n'existe — tailles ? couleurs ? écarts de
  prix ? stock par variante ? C'est une décision produit, et un composant
  disponible ne la prend pas. Croire l'inverse serait exactement la dérive que
  le §7.7 d'`AGENTS.md` interdit.
- **`ImageCarousel` accepté ne crée pas de galerie.** Un article porte une
  photo ; en faire porter plusieurs est un changement de modèle, de chaîne
  d'images et de budget d'octets (ADR 0016 : 100 Ko par objet).
- **`CalendarPicker` accepté ne crée pas de date de remise.** Ce que devient
  une commande dont la date passe n'est arbitré nulle part — même question
  ouverte que l'expiration (C-003).

## Ce que ça débloque réellement, tout de suite

Une seule chose, et elle était la raison de la mesure : **`flux --deposer` peut
partir.** Les cinq définitions en 7.3 passeront la validation. L'ordre de
l'ADR 0093 est respecté — mesurer, puis déposer.
