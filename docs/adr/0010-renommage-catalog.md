# 0010 — Le produit s'appelle Catalog

- Statut : accepté
- Date : 2026-07-29
- Ne remplace aucune décision technique. Ne concerne que le nom.

## Décision

Le produit s'appelait **Swap**. Il s'appelle **Catalog**.

Orthographe unique, à ne pas décliner : `Catalog`, majuscule initiale, sans
« ue » final, sans accent, invariable. Ni *Catalogue*, ni *CATALOG*, ni
*catalog.app*, ni *Catalog+*.

## La collision, et comment on vit avec

Le mot **catalogue** est déjà partout dans ce projet : c'est le nom commun
français désignant la liste d'articles d'une vendeuse. Le produit porte
désormais un nom qui lui ressemble. C'est assumé — le catalogue est bien ce que
le produit met entre les mains d'une vendeuse — mais il faut une règle nette,
sinon la relecture devient pénible.

| Écriture | Ce que c'est |
|---|---|
| **Catalog** | le produit, l'entreprise, l'application |
| **catalogue** | le nom commun : la liste d'articles d'une boutique |

Conséquences pratiques :

- Dans la prose française, `catalogue` reste `catalogue`. On n'écrit jamais
  « le Catalog de Maman Jeanne ».
- Dans le code, les identifiants métier existants — `catalog`, `catalogItem`,
  `rCat()` — désignent le **nom commun** et ne changent pas. Renommer un
  `catalogService` en croyant qu'il porte le nom du produit serait l'erreur
  exacte que cet ADR existe pour prévenir.
- Ce qui change dans le code est **uniquement** ce qui portait `swap` :
  portée des paquets, nom du dépôt, titres, textes d'interface, domaine.
- Le titre de la phase 2 de `PROMPTS.md`, autrefois « Catalogue », devient
  « Boutique et articles ». Une phase et un produit ne peuvent pas porter le
  même nom.

## Les ADR antérieurs gardent l'ancien nom

Les ADR 0001 à 0009 ont été écrits sous le nom Swap. **Ils ne sont pas
réécrits**, et le fichier `0006-swap-nencaisse-jamais.md` conserve son nom de
fichier.

Ce n'est pas de la négligence, c'est la règle du dépôt : un ADR est un
enregistrement daté d'une décision prise à un moment donné. Le réécrire
falsifie l'historique et casse tous les renvois. Le présent ADR est le pont :
qui lit « Swap » dans un ADR ancien sait qu'il s'agit de Catalog.

Seule exception, déjà appliquée : l'ADR 0009, écrit le même jour et jamais
diffusé sous l'ancien nom, porte le nouveau dans son corps et le signale dans
son en-tête.

## Ce qu'il faut renommer dans le dépôt

Exécuté au lot 0. Ni plus, ni moins :

- portée des paquets `@swap/*` → `@catalog/*`, dans les `package.json` et dans
  tous les imports ;
- `name` du paquet racine, `README.md`, `CLAUDE.md`, `docker-compose.yml`,
  `CODEOWNERS`, workflows CI ;
- titres de pages, textes d'interface, `<title>`, manifeste PWA ;
- domaine de démonstration `swap.cm` → `catalog.cm` ;
- préfixe des références de commande `SW-` → `CT-`, y compris dans les seeds et
  les fixtures ;
- nom du dossier de travail local, si l'on veut — sans conséquence.

Ce qu'il ne faut **pas** toucher : les ADR 0001 à 0008, l'historique git, et
tout identifiant où `catalog` désigne le nom commun.

## Pourquoi ce changement

Décision du porteur du projet. Un ADR n'a pas à justifier un choix de marque ;
il a à le figer pour que personne n'ait à deviner l'orthographe six mois plus
tard.
