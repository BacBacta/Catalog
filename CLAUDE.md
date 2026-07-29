# CLAUDE.md

@AGENTS.md

`AGENTS.md` est le contrat de travail : contraintes non négociables, stack
figée, conventions, interdits. Il prime sur toute habitude ou tutoriel.
Ce fichier-ci ne contient que ce qui est propre à une session Claude Code.

## Avant de commencer

Lis `AGENTS.md`, puis les ADR de `docs/adr/` concernés par ta tâche. Ils
expliquent **pourquoi** les choix ont été faits — plusieurs corrigent des
erreurs précédentes, et les refaire coûterait cher.

Les plus structurants :

- `0004` — les montants sont des entiers XAF, jamais de flottant
- `0005` — il n'existe pas d'adresse au Cameroun, jamais de champ `address`
- `0006` — Swap n'encaisse jamais, les fonds ne touchent aucun compte à nous
- `0007` — le paiement passe par un agrégateur agréé, vendeuse bénéficiaire
- `0008` — évaluation CamPay, et les six questions encore ouvertes

## Secrets

Les identifiants vivent dans `.env`, jamais dans un fichier versionné, un
commit, un test ou un commentaire. `.env` est déjà dans `.gitignore`.
Si un secret apparaît dans le dépôt, arrête-toi et signale-le.

## Vérifier son travail

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

Les cinq doivent passer. `pnpm size` fait échouer la boutique publique
au-delà de 30 Ko de JS — c'est une règle de compilation, pas une intention.

## Méthode

Un lot à la fois. Test d'abord sur la logique métier. Tout écart au blueprint
produit un ADR dans `docs/adr/`. Face à une ambiguïté ou une information
manquante, arrête-toi et demande plutôt que d'inventer une valeur plausible.

## Tâche en cours

Sonder l'API CamPay sur son environnement de démonstration et corriger
l'adaptateur sur les champs réels — voir `apps/api/scripts/README.md`.
