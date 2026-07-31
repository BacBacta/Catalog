# ADR 0022 — Graphiques sans bibliothèque, et la vue tableau comme contrainte de typage

- **Statut** : accepté
- **Date** : 31/07/2026
- **Lot** : 13 — statistiques vendeuse
- **Concerne** : `packages/ui/src/charts/`, `packages/ui/src/tokens.css`,
  `apps/api/src/routes/stats.ts`, `apps/seller/src/routes/Statistiques.tsx`,
  `apps/seller/scripts/budget.mjs`

## Contexte

Le lot 13 demande un écran de statistiques : vues par jour, entonnoir, articles
les plus vus, sources de trafic, et la part des ventes prouvées. Sa définition
de terminé porte entièrement sur l'interface — vue tableau pour chaque
graphique, aucune bibliothèque de graphiques, budget JS respecté, axe-core sans
violation y compris sur les vues tableau.

Le domaine était livré avant cette session : répartition des ventes prouvées,
séries continues comblées à zéro, entonnoir avec taux d'étape à étape.

## Décisions

### 1. Aucune bibliothèque de graphiques, et le refus est exécutable

Les quatre formes tracées — une courbe, des barres horizontales, une barre
empilée, une piste de fond — tiennent en deux cents lignes de géométrie pure et
trois composants. La plus légère des bibliothèques de graphiques pèse
**environ 10 Ko compressés**, c'est-à-dire un tiers du budget JS **entier** de
la boutique publique, pour tracer ce qu'un `<polyline>` trace.

Trois contrôles, parce qu'un seul se contourne :

1. `packages/ui/src/__tests__/pas-de-bibliotheque-de-graphiques.test.ts` refuse,
   dans **tous** les `package.json` du dépôt, une liste nommée de paquets connus
   **et** tout nom qui trahit un moteur de graphiques. Le second attrape ce que
   le premier ne peut pas prévoir ;
2. un test lit les sources de `charts/` et vérifie qu'elles n'importent que du
   local et React ;
3. `apps/seller/scripts/budget.mjs` pèse le paquet de l'écran et le plafonne à
   **8 Ko compressés**. L'écran entier en fait 3,1. Le plafond n'est pas choisi
   pour serrer : il est choisi pour qu'aucune bibliothèque n'y entre, marge
   comprise.

Le troisième est le seul qui reste vrai si quelqu'un recopie une bibliothèque
dans le dépôt au lieu de l'installer.

### 2. L'écran est chargé à la demande — c'est ce qui rend son budget mesurable

`apps/seller` n'a pas de budget de poids déclaré, et ce lot n'en invente pas :
l'app vendeuse est derrière authentification, mise en cache par un service
worker, ouverte tous les jours par la même personne. Poser un plafond sur du
code déjà écrit reviendrait à choisir un chiffre au doigt mouillé.

Mais l'écran statistiques, lui, est chargé par `lazy(() => import(...))`. Il
forme donc son propre paquet, et **ce paquet-là se pèse seul**. Le critère
« l'écran respecte le budget JS » cesse d'être une appréciation.

Le script échoue **si le paquet est absent**. Si le découpage se cassait — un
import statique ajouté quelque part —, le code des graphiques repartirait dans
le paquet principal, le script ne trouverait rien à peser, et annoncerait
« budget respecté » sur une mesure qui n'a pas eu lieu. Tout continuerait à
marcher : c'est exactement le genre de panne qu'on ne voit jamais.

Pour information, hors budget : le paquet principal de l'app vendeuse pèse
181 Ko compressés. Le script l'affiche sans le plafonner. Le réduire est une
décision qui n'appartient pas à ce lot.

### 3. `Graphique` **exige** sa vue tableau

Le composant de cadre prend `colonnes` et `lignes` en paramètres obligatoires.
On ne peut donc pas rendre un graphique sans fournir sa vue tableau : le critère
« chaque graphique a une vue tableau consultable » est tenu par le typage, pas
par la discipline. C'est la même mécanique que le budget de la boutique — une
règle qu'on ne peut pas oublier d'appliquer vaut mieux qu'une règle qu'on se
rappelle d'appliquer.

Le tableau vit dans un `<details>` : il s'ouvre **sans JavaScript**, il est
annoncé comme ouvert ou fermé par les lecteurs d'écran sans qu'on écrive un
`aria-expanded`, et il ne coûte rien au paquet. `<summary>` a été ajouté à la
règle de cible tactile de 44 px dans `tokens.css` : c'est une commande, elle se
rate au pouce comme un bouton.

`traceMuet` distingue les deux natures de tracé. Un `<svg>` est masqué aux
lecteurs d'écran — c'est un sac de chemins, on y entre et on n'en ressort avec
rien — et un résumé en une phrase le précède. Des barres en CSS portent leur
propre texte : libellé, valeur, taux. Les masquer jetterait du contenu réel.

### 4. Pas d'infobulle au survol, délibérément

Le profil de référence est un téléphone tactile bas de gamme. Le survol n'y
existe pas : une valeur accessible seulement au survol serait une valeur
inaccessible. Le canal de lecture des valeurs est la vue tableau, et il est le
même pour tout le monde — au doigt, au clavier, au lecteur d'écran.

C'est un écart assumé à la pratique courante des tableaux de bord, et il ne
retire rien : aucune valeur n'est gâtée derrière un geste.

### 5. Les couleurs sortent d'un validateur, pas de l'œil

Deux **rampes ordinales** d'une seule teinte — celle de la marque — et un gris
de recul. Pas de palette catégorielle : ce qui est tracé ici a un ordre (les
marches de l'entonnoir, la force d'une preuve), et des teintes catégorielles le
détruiraient.

Les valeurs ont été produites en tenant la teinte de marque à son propre chroma
(≈ 0,10 OKLCH) et en faisant varier la clarté, puis validées : bande de clarté,
plancher de chroma, séparation sous protanopie et deutéranopie simulées
(Machado–Oliveira–Fernandes 2009, sévérité 1,0), plancher en vision normale,
contraste sur la surface.

| Rampe | Clair | Sombre |
|---|---|---|
| Entonnoir, 4 marches | `#5cb99b · #3a997d · #0d7b60 · #005b46` | `#00755a · #349376 · #56b394 · #77d3b3` |
| Preuve : contresigné / prouvé / non tracé | `#005b46 · #2b8d71 · #b1b1b1` | `#5bd0ab · #149d7a · #585858` |
| Série unique | `#0e7a5f` | `#17a37f` |

**Les rampes s'inversent entre les thèmes.** Ce n'est pas une inversion
automatique : la marche la plus profonde doit être celle qui contraste le plus
avec **sa** surface, donc foncée sur clair et claire sur sombre.

Le pire couple voisin est à ΔE 15,3 sous protanopie et 16,1 en vision normale
(OKLab ×100), au-dessus des seuils de 8 et 15.

`tokens.test.ts` ne rejoue pas la simulation de daltonisme : il tient
l'invariant dont tout le reste dépend, la **clarté**. Ce n'est pas un pis-aller.
Une protanopie ou une deutéranopie effondre les axes de teinte et laisse
essentiellement la clarté : deux couleurs séparées sur cet axe le restent pour
tout le monde, deux couleurs qui ne le sont que par la teinte se confondent. Une
retouche qui rapprocherait deux marches casse donc en CI.

**« Non tracé » est gris, jamais rouge.** Un dépôt direct déclaré à la main
n'est pas une faute : il compte, il n'est simplement pas prouvé. Le peindre en
danger accuserait la vendeuse d'un fait qui n'est pas établi — et volerait au
passage une couleur réservée au statut. Un test vérifie que ce jeton est neutre
et qu'il n'est jamais égal à un jeton de statut.

### 6. Deux informations manquantes sont **dites**, pas comblées

C'est la partie de cet ADR qui compte le plus, et elle relève d'AGENTS.md §7.7.

**Les sources de trafic n'existent pas.** Rien dans le système n'enregistre d'où
vient une visite : ni référent, ni paramètre de campagne, ni table pour les
recevoir. Le lot les demande. On pourrait dessiner un graphique plausible —
« WhatsApp 62 %, lien direct 28 % » — et il serait entièrement inventé. Une
vendeuse arbitrerait son budget dessus. L'écran affiche donc une carte qui dit
que ce n'est pas mesuré et pourquoi. Le graphique arrivera avec la mesure.

**`product_view` n'est alimentée par aucun chemin de code de la v1.** La
boutique publique est un site statique servi par un CDN : elle ne prévient
personne quand une page s'ouvre, et les seules lignes de cette table viennent du
jeu de données de développement. « 0 vue » se lirait « personne ne regarde ma
boutique » alors que la vérité est « rien ne compte encore ». La réponse porte
donc `instrumentation.vuesInstrumentees`, et l'écran l'écrit en toutes lettres
au-dessus du graphique concerné.

Le drapeau n'est **pas** une constante qu'on oublie de mettre à jour :
`stats-instrumentation.test.ts` parcourt les quatre arbres de sources, cherche
toute écriture Prisma ou SQL dans `product_view`, et exige que le drapeau vaille
exactement « un chemin de code écrit-il des vues ? ». Le jour où quelqu'un
branchera le comptage, ce test échouera, et c'est là que la constante passera à
`true`. L'inverse est verrouillé aussi : passer le drapeau à `true` sans écrire
de vues fait échouer le test — l'écran annoncerait des vues comptées sur une
table vide.

Instrumenter la boutique reste ouvert. C'est une décision qui touche le budget
de la boutique publique et la vie privée des acheteuses ; elle mérite son propre
ADR et son propre lot, pas un ajout discret dans un lot d'affichage.

### 7. Les types du fil viennent du contrat, des deux côtés

`packages/contracts/src/stats.ts` est la source unique. En l'écrivant, on a
constaté que `domain/stats/serie.ts` et `domain/stats/ventes-prouvees.ts`
déclaraient `Jour`, `PointSerie`, `EtapeEntonnoir` et la répartition à la main —
c'est-à-dire exactement la redéclaration de part et d'autre d'une frontière
qu'AGENTS.md §6 interdit. Les deux modules importent désormais ces types du
contrat et gardent ce qui leur appartient vraiment : **la règle**. Un schéma
décrit une forme, il ne dit pas quels états entrent au dénominateur.

L'app vendeuse importe depuis le sous-chemin `@catalog/contracts/stats`, en
`import type` : effacé à la compilation, donc ni Zod ni ses effets de bord de
module n'entrent dans le paquet.

## Conséquences

- Un graphique de plus se construit en fournissant colonnes et lignes ; on ne
  peut pas en livrer un sans vue tableau.
- Toucher une couleur de graphique fait échouer `tokens.test.ts` si la retouche
  rapproche deux marches.
- Installer une bibliothèque de graphiques fait échouer trois contrôles.
- Casser le découpage de l'écran fait échouer `pnpm size`.
- Brancher le comptage des vues fait échouer `stats-instrumentation.test.ts`,
  qui indique quoi changer.
- `pnpm size` couvre désormais **deux** paquets : la boutique et l'écran
  statistiques.

## Ce qui reste ouvert

- **Instrumenter `product_view`** — décision de budget et de vie privée, ADR
  propre.
- **Les sources de trafic** — il n'existe ni collecte ni table. Même remarque.
- **Le poids du paquet principal de l'app vendeuse** (181 Ko compressés) est
  mesuré et affiché, mais n'est plafonné par rien.
