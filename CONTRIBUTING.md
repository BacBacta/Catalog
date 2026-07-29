# Contribuer

## Flux

Trunk-based : branche courte depuis `main`, pull request, squash. `main` est
toujours déployable.

Commits au format [Conventional Commits](https://www.conventionalcommits.org/) :
`feat(shop): ...`, `fix(api): ...`, `chore(db): ...`.

## Avant d'ouvrir une pull request

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

## Décisions d'architecture

Tout écart au blueprint produit un ADR dans `docs/adr/`, numéroté et jamais
réécrit : on ajoute un ADR qui remplace le précédent. C'est ce qui permet à
quelqu'un — ou à un agent — d'arriver six mois plus tard et de comprendre
*pourquoi*, plutôt que de deviner.

## Migrations

Expand / contract, toujours : ajouter, double-écrire, migrer les lectures,
retirer. Jamais de changement destructif en une seule étape, sinon un
déploiement raté devient une perte de données.

Après chaque migration, réappliquer les contraintes SQL :

```bash
pnpm --filter @swap/db constraints
```

## Revue — la liste courte

- Les montants sont-ils des entiers XAF ?
- A-t-on introduit un champ « adresse » ?
- Le budget de 30 Ko de la boutique tient-il toujours ?
- Un état de paiement peut-il reculer ?
- Le changement touche-t-il l'argent sans écrire dans le grand livre ?

## Note sur Biome et les fichiers `.astro`

Biome ne lit que le frontmatter d'un fichier `.astro` : il ne voit pas l'usage
des variables dans le template et les signale donc comme inutilisées. Les règles
`noUnusedVariables` et `noUnusedImports` sont désactivées pour ces fichiers dans
`biome.json`. La couverture n'est pas perdue : `astro check` fait l'analyse de
types complète sur les `.astro`, template compris, et tourne dans la CI.
