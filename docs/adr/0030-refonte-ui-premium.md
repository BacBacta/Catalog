# ADR 0030 — Refonte visuelle de l'app vendeuse : le premium dans le contrat

- **Statut** : accepté
- **Date** : 01/08/2026
- **Lot** : hors séquence — demande produit explicite
- **Concerne** : `packages/ui/src/tokens.css`, `packages/ui/src/primitives/basics.tsx`,
  `packages/ui/src/blocks.tsx`, `apps/seller/src/components/` (Coquille, BarreNav,
  CadreConnexion, Ecran, icones), tous les écrans de `apps/seller/src/routes/`,
  `apps/seller/vite.config.ts` (icônes PWA), `apps/seller/index.html`
- **Étend** le lot 2 (jetons et primitives) sans en défaire aucune règle.

## Contexte

La demande : « une UI/UX ultra premium, du niveau des meilleures applications
de 2026 ». Dans ce produit, « premium » a déjà une définition, et elle est dans
AGENTS.md : rapide sur Slow 4G, lisible en plein soleil, WCAG 2.2 AA, cibles
de 44 px, quatre états par écran, `prefers-reduced-motion` respecté. La refonte
devait donc être somptueuse **et** rester dans ces bornes — pas de bibliothèque
d'icônes, pas de police téléchargée (`tokens.test.ts` fait respecter les deux),
pas de bibliothèque de graphiques (plafond de 8 Ko du paquet statistiques).

L'inventaire préalable a montré que le vrai déficit n'était pas cosmétique :
**l'app n'avait aucune navigation persistante.** L'accueil était un annuaire de
six cartes-menu, chaque écran un cul-de-sac dont on ne sortait que par le
retour du navigateur, et `/appareils` n'était relié à rien.

## Décisions

1. **Une barre de navigation inférieure** (`BarreNav`), cinq destinations au
   pouce : Accueil, Articles, Commandes, Chiffres, Réglages. Elle vit dans une
   `Coquille` de routes imbriquées — les écrans d'authentification ne l'ont
   pas. `aria-current` posé par `NavLink`, état actif porté par la graisse et
   un point, jamais la couleur seule, `safe-area-inset-bottom` respecté.

2. **Un écran Réglages** rassemble ce qui était éparpillé : connexion,
   reversement, appareils scellés (enfin reliés), boutique publique,
   déconnexion. Le tableau de bord garde sa carte de reversement : c'est le
   champ qu'un attaquant chercherait à détourner, il reste sous les yeux.

3. **L'accueil devient un tableau de bord** : la tuile des soldes en lavis de
   marque (un seul chiffre-roi par écran), quatre gestes rapides, l'état du
   reversement. Les cartes-menu disparaissent — la barre a pris leur rôle.

4. **Les jetons s'enrichissent, ne changent pas** : ombres à deux couches
   teintées de l'encre (`--shadow-card/raised/nav`, quasi éteintes en sombre où
   la profondeur vient des surfaces), cran typographique `--text-display` pour
   les titres de page (la hiérarchie h1 > h3 devient visible), rayon de carte
   16 px, `--ease-spring`, entrée d'écran de 8 px (`--animate-entree`,
   neutralisée par `prefers-reduced-motion`). **Aucune couleur existante n'a
   bougé** : les 18 paires de contraste et les rampes de graphique sont
   vérifiées par `tokens.test.ts`, inchangées.

5. **Les primitives gagnent les gestes** : bouton avec état pressé
   (scale 0,985) et prop `loading` — anneau à CÔTÉ du libellé, jamais à sa
   place, `aria-busy` posé ; cartes et tuiles portent l'ombre.

6. **Un jeu d'icônes maison** (`icones.tsx`, trait 1,7, grille 24) et un
   logotype — l'étiquette de prix inclinée, l'œillet en évidence : le
   catalogue, sans lettre, lisible dans toutes les langues du marché. Décoratif
   partout (`aria-hidden`) : le sens reste dans le texte.

7. **Les écrans d'authentification ont leur cadre** (`CadreConnexion`) :
   logotype, marque, colonne centrée. C'est le seul endroit où la marque
   s'affiche — les écrans connectés portent le commerce de la vendeuse.

8. **La PWA a un visage** : icônes 192/512 + variantes `maskable` (motif dans
   la zone sûre de 80 %), favicon SVG, `apple-touch-icon`, `theme-color` par
   thème. Générées par sharp depuis le SVG source, committées.

9. **Deux défauts corrigés au passage** : le champ « numéro WhatsApp de la
   boutique » de la création de profil (ADR 0029) n'était pas rendu ; les
   états chargement/vide/erreur d'Appareils étaient écrits à la main au lieu
   des primitives.

## Ce qui n'a pas été fait, et pourquoi

- **Pas de police téléchargée.** `tokens.test.ts` l'interdit dans les jetons,
  et la pile système est un choix de fond du lot 2 — le premium vient de
  l'échelle, des graisses et de l'espace, pas d'une fonte de 45 Ko.
- **Pas de Motion.** `components.test.tsx` interdit son import dans le design
  system ; tout le mouvement est en CSS et disparaît sous
  `prefers-reduced-motion` par la règle globale.
- **Les graphiques n'ont pas bougé** : palette sous validateur (ADR 0022),
  budget de 8 Ko vérifié après refonte (`pnpm size` passe).
- **Un test e2e a été adapté, pas contourné** : `catalogue.spec.ts` ouvrait le
  catalogue par la carte-menu disparue ; il passe par la barre de navigation.
  Tous les autres ancrages (libellés, `data-testid`, niveaux de titres) sont
  préservés au caractère près.

## Conséquences

- Le paquet principal passe de ~183 à ~186 Ko compressés (icônes, coquille,
  écran Réglages) ; le paquet statistiques reste sous son plafond mesuré.
- La navigation change la topologie de l'app : les écrans de premier niveau ne
  dépendent plus du tableau de bord. Les tests qui naviguaient par ses cartes
  doivent passer par la barre — un seul était concerné.
- Les captures de référence des deux thèmes accompagnent la PR de refonte.
