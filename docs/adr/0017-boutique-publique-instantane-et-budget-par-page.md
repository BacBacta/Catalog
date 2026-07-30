# 0017 — La boutique publique : un instantané, un budget par page, et une révision de l'ADR 0016

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 6 (`apps/shop`, `packages/contracts`, `apps/api/scripts`)
- Ajoute deux dépendances côté boutique : Preact 10.29.7 et `@astrojs/preact` 6.0.2
- **Révise l'ADR 0016, décision 4** : les photos de catalogue sont du contenu public

## Contexte

Le lot 6 construit la boutique publique : la page d'une vendeuse, la fiche d'un
article, et un bouton « Commander sur WhatsApp » qui ouvre un message pré-rempli.
C'est la surface la plus critique du produit en performance — elle est ouverte par
des acheteuses sur des réseaux mobiles saturés, depuis un lien WhatsApp, sur des
téléphones d'entrée de gamme.

Quatre chiffres la gouvernent : 30 Ko de JS, 120 Ko de charge de document,
LCP < 2,5 s en Slow 4G bridé, décalage visuel < 0,1. Trois d'entre eux ont cassé
une hypothèse pendant l'implémentation.

## Décision 1 — la boutique lit un instantané, elle ne parle pas à la base

Le chemin évident est de lire la base dans `getStaticPaths`. Il a été écrit, puis
retiré : `apps/shop` n'a aucune raison de connaître Prisma, et le regroupeur a
d'ailleurs refusé de résoudre `@catalog/db` — signal que la dépendance allait dans
le mauvais sens.

`apps/api/scripts/exporter-catalogue.mjs` produit donc un instantané JSON, et la
boutique le lit. Trois bénéfices, dans l'ordre :

1. **la règle de dépendance tient.** Faire entrer un client de base dans le graphe
   d'un paquet dont la seule contrainte est de peser moins de 30 Ko serait une
   inversion ;
2. **la construction est reproductible et hors ligne.** Le même instantané
   reconstruit le même site, ce qu'on veut d'un site statique servi par le CDN ;
3. **c'est la forme réelle du déploiement.** Publier la boutique, c'est prendre
   une photo du catalogue à un instant donné et la pousser au CDN.

L'instantané reste **proche de la base** : la mise en forme — identifiants d'URL,
URL d'images, moyenne des avis — vit dans `apps/shop/src/lib`, où elle est pure et
testée sans base ni fichier.

**Sans instantané, aucune page de boutique n'est construite.** Pas de boutique de
démonstration, pas de données de repli : une fausse boutique publiée sous le nom
d'une vraie vendeuse serait pire qu'une page absente. La construction réussit
quand même, avec un avertissement.

Le chargement passe par `import.meta.glob` et non par `node:fs`. Ce n'est pas un
détail de style : un chemin relatif à `import.meta.url` ne survit pas au
regroupement — Astro déplace le module dans `dist/.prerender/`, le chemin calculé
ne pointe plus sur rien, et la construction réussissait en annonçant **zéro
boutique**. Un échec silencieux, exactement le genre que ce dépôt cherche à rendre
impossible.

## Décision 2 — Preact, et une seule île

React fait environ 45 Ko compressés : une fois et demie le budget entier, pour un
compteur de quantité et un sélecteur de variante. Preact en fait moins de cinq.
AGENTS.md n'exige un ADR qu'au-delà de 10 Ko compressés sur le chemin critique —
Preact passe largement — mais le choix mérite d'être écrit parce qu'il sera
questionné.

L'île est montée en `client:visible` : le JavaScript ne se télécharge que quand le
bouton entre dans le champ de vision. Une acheteuse qui parcourt une grille sans
ouvrir de fiche ne paie rien.

**L'île est utilisable avant son hydratation, et il n'y a pas de `<noscript>`.**
Astro rend l'île côté serveur : le HTML livré contient déjà un lien WhatsApp
complet pour une quantité de un. Un bloc `<noscript>` — écrit d'abord, puis retiré
— doublait le bouton sans rien ajouter. Si le JavaScript n'arrive jamais — réseau
coupé, forfait épuisé, navigateur ancien — l'acheteuse commande quand même. C'est
ce qui fait du compteur un confort et non le porteur de la fonction.

Mesure finale : **13,3 Ko de JS** sur la page la plus lourde, dont 4,5 pour
Preact, 3,0 pour ses signaux, 1,8 pour l'île elle-même.

## Décision 3 — le baril `@catalog/contracts` ne traverse pas vers le navigateur

L'île pesait **20,6 Ko compressés** au lieu de 1,8. La cause : `import { formatXaf }
from "@catalog/contracts"` passe par le baril, qui réexporte tous les schémas Zod.
Une déclaration de schéma a des effets de bord au niveau du module, donc l'élagage
ne la retire pas.

Deux conséquences, et la règle qui en découle :

- `@catalog/contracts` expose désormais des **sous-chemins** — `./money`,
  `./phone`, `./whatsapp` — et la boutique n'importe que par ceux-là ;
- `normalizePhone` a été extrait de `delivery.ts` vers **`phone.ts`, sans Zod**.
  Il vivait à côté de schémas, et l'importer suffisait à faire entrer Zod.

**Règle : une fonction destinée au navigateur ne partage pas son module avec un
schéma.** Elle n'est pas devinable depuis le code ; elle est écrite ici et dans
l'en-tête de `phone.ts`.

## Décision 4 — le budget se mesure PAR PAGE

`budget.mjs` sommait tout `dist/`. C'était juste tant que le site tenait en une
page, et faux dès qu'il en a eu vingt-deux : le premier passage annonçait 65 Ko de
JS et 188 Ko de total, soit le poids du **site**, que personne ne télécharge.

Le budget porte sur une visite, donc sur une page. On mesure chaque page et on
retient la pire. Pour chacune : le HTML compressé — styles et scripts en ligne
compris —, tout le JavaScript **atteignable transitivement**, et les feuilles de
style externes. Suivre les imports compte : ne regarder que le HTML sous-estimait
le poids d'un facteur trois, puisque l'île importe Preact, qui importe ses
crochets.

**Les images ne sont pas dans la charge de document.** Elles sont du contenu,
servies par le CDN media, et bornées ailleurs : le lot 5 garantit qu'un objet
stocké tient sous 100 Ko. Les mélanger rendrait ce budget-ci ininterprétable — une
page à six articles ne pourrait jamais tenir sous 120 Ko. Le script le dit à
l'écran, pour qu'on ne relise pas le chiffre de travers dans six mois.

Le script refuse aussi **toute police téléchargée**, quelle que soit sa taille.
Une police de douze octets passerait tous les seuils ; c'est un interdit
d'AGENTS.md, pas une question de poids.

## Décision 5 — le dépassement délibéré est prouvé par un test, pas par une pull request

Le blueprint demandait de prouver qu'un dépassement délibéré fait échouer le
build « par une pull request de test ». C'est remplacé par un test qui lance
`budget.mjs` sur des sorties fabriquées et vérifie le code de sortie : 300 Ko de
JavaScript incompressible, 900 Ko de HTML, une police de six octets, une sortie
sans page, et du JavaScript caché **en ligne** dans le HTML.

C'est plus fort qu'une pull request : vérifié à chaque exécution plutôt qu'une
fois, et le contenu de test est incompressible exprès — 300 Ko de zéros pèsent
200 octets compressés et ne prouveraient rien.

## Révision de l'ADR 0016 — les photos de catalogue sont publiques

L'ADR 0016 posait : « les objets ne sont jamais publics […] une URL signée
expire ». Cette règle est **trop large**, et le lot 6 le montre : une URL signée
expire en quinze minutes, une page statique en cache CDN vit des jours. Les deux
sont incompatibles.

C'est la page qui a raison, pour une raison de fond : une photo de catalogue est
du contenu dont **l'usage entier est d'être montrée à des acheteuses**. Il n'y a
rien à protéger. La règle de l'ADR 0016 garde toute sa force pour ce qui est
sensible — et le lot 8, avec les captures d'écran de paiement, en sera le vrai
terrain.

Ce qui ne change pas : **les clés restent opaques.** Ni identifiant de vendeuse,
ni nom de fichier d'origine. Public ne veut pas dire énumérable.

`MEDIA_PUBLIC_BASE` porte la base publique. L'app vendeuse continue d'utiliser
des URL signées : elle est derrière authentification et n'a pas de contrainte de
cache CDN.

## Le message WhatsApp

Contenu canonique, ni plus ni moins : **article, quantité, prix unitaire, total,
nom de la boutique**. La référence de commande et le code de vérification n'y sont
pas, et un test le vérifie explicitement : ils n'existent qu'une fois la commande
créée, et un code inconnu de la page publique de vérification serait exactement la
fausse preuve que le produit combat. Ils rejoignent le message au lot 11.

Trois points d'encodage, chacun cassant le lien s'il manque, chacun couvert par un
test :

- **le numéro est en chiffres seulement.** `wa.me/+237…` ne s'ouvre pas ;
- **le texte passe par `encodeURIComponent`.** Un saut de ligne devient `%0A`,
  et c'est ce qui fait tenir la mise en forme. L'espace fine insécable de
  `formatXaf` (U+202F) devient `%E2%80%AF` ;
- **on n'encode pas deux fois.** `'`, `(`, `)` et `!` sont licites dans une chaîne
  de requête ; les encoder à la main afficherait `l%27article` à l'acheteuse.

Le message ne contient **aucun lien**. Certaines acheteuses sont sur un forfait où
les liens externes échouent — « WhatsApp illimité » sans data générale, cas
courant au Cameroun. Si l'information n'est que derrière le lien, la commande
n'existe pas.

## Deux choix de produit qui ne sont pas techniques

**La racine n'est pas un annuaire.** Une acheteuse arrive toujours par un lien que
la vendeuse lui a envoyé. Publier la liste des vendeuses ferait de Catalog une
place de marché — ce qu'il n'est pas — et révélerait qui vend quoi, ce que personne
n'a demandé.

**Le badge dit un fait contrôlable.** Pas « vendeuse de confiance », que nous
n'avons aucun moyen d'attester : « le numéro sur lequel cette boutique encaisse a
été vérifié par un code reçu sur ce numéro ». Et une boutique sans avis affiche
« pas encore d'avis vérifié », jamais « 0 sur 5 » — une vendeuse qui commence n'est
pas une vendeuse mal notée.

## Les mesures, et ce qu'elles ne disent pas

Lighthouse sur profil mobile bridé (Slow 4G, processeur ralenti quatre fois),
trois exécutions, sur les trois formes de page :

| | performance | accessibilité | LCP | décalage visuel |
|---|---|---|---|---|
| racine | 100 | 100 | ~0,7 s | 0 |
| boutique | 100 | 100 | ~0,7 s | 0 |
| fiche article | 100 | 100 | ~0,9 s | 0 |

**Ce que ces chiffres ne mesurent pas** : les photos. Elles vivent sur le CDN media
et ne sont pas dans `dist/`, donc le LCP mesuré est celui du texte. Sur une vraie
boutique, l'élément LCP sera la première photo. Ce qui est sous notre contrôle est
en place — dimensions explicites, `fetchpriority="high"` sur les deux premières,
AVIF sous 100 Ko garanti par le lot 5 — mais **le LCP réel reste à mesurer sur un
déploiement avec media**, et il ne faut pas lire le 0,9 s comme s'il l'incluait.

Deux notes d'outillage, pour qui rouvrira ce dossier :

- Lighthouse CI ne transmet pas `chromeFlags` au lanceur dans tous les chemins
  d'appel. Chrome démarre sans `--no-sandbox`, refuse de tourner en root, et
  l'échec remonte en « Unable to connect to Chrome ». D'où
  `scripts/chrome-lighthouse.sh`, passé par `CHROME_PATH` — qui est toujours
  respecté ;
- `skipAudits` est un piège : retirer `uses-http2`, qui appartient à la catégorie
  performance, rend le score de la catégorie entière `null` et l'assertion échoue
  sur « NaN ». Les audits hors sujet se neutralisent un par un dans `assert`.
- `tslib` 1.14 était résolu pour Lighthouse et n'a pas `__spreadArray` : tous les
  audits de performance sortaient en erreur. Une résolution `tslib: ^2.8.1` dans
  `pnpm-workspace.yaml` le corrige. C'est une collision de dépendance transitive,
  pas un choix de stack.

## Conséquences

- `pnpm shop:snapshot` est une étape de publication, avant `build`. La CI l'exécute
  dans les deux jobs ; sans elle, `pnpm size` mesurerait un site d'une page.
- `apps/shop/src/data/` est ignoré par git : l'instantané est un artefact.
- Le job `e2e` de la CI construit la boutique, vérifie le budget, et lance
  Lighthouse avec des seuils durs. Les rapports HTML partent en artefact.
- `apps/shop` a désormais des tests unitaires (28) : la mise en forme du catalogue,
  et la sortie construite — polices, dimensions d'images, scripts externes, lien
  `wa.me` présent dans le HTML avant hydratation.
