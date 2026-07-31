# Code USSD modifié

> Un code USSD n'échoue pas proprement. Composé alors qu'il a changé, il
> **ouvre un menu inattendu** : l'acheteuse se retrouve dans « Acheter du
> crédit » au lieu de « Transfert », ou dans un menu vide. Elle abandonne, et
> elle en conclut que le lien de la vendeuse est cassé.

## Symptômes

- Des acheteuses signalent que le bouton « payer » ouvre le composeur mais que
  **le menu n'est pas le bon**, ou qu'il ne se passe rien après l'appel.
- Le taux de passage `commandes → payées` chute dans l'entonnoir de l'écran
  statistiques, sans que les preuves refusées augmentent — c'est la marque d'un
  paiement qui n'est **jamais tenté**, pas d'un paiement refusé.
- L'opérateur a communiqué un nouveau code (rare mais ça arrive), ou une
  vendeuse le signale de vive voix.

**Attention au faux positif le plus fréquent** : le raccourci paramétré n'est
pas vérifié (`verifie: false`) tant que personne ne l'a composé à Douala. Une
plainte sur le raccourci n'est donc pas forcément un changement — ce peut être
l'inconnue de terrain n° 2 (AGENTS.md §10) qui se manifeste pour la première
fois. L'attribut de trace `catalog.rampe.code_verifie` dit lequel des deux cas
on est en train de servir.

## Diagnostic

**1. Lire ce qui est réellement servi.**

```bash
curl -s "$API_ORIGIN/api/rampe" | node -e '
  const c = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const o of c.operateurs) {
    console.log(o.id, "entrée:", o.codeEntree.modele, "vérifié:", o.codeEntree.verifie);
    for (const r of o.raccourcis) console.log("   raccourci:", r.modele, "vérifié:", r.verifie);
  }
'
```

**2. Composer le code sur un vrai téléphone**, à Douala, sur la puce concernée.
`docs/terrain/rampe-paiement.html` est fait pour ça : il porte les chaînes
exactes de la configuration, plus des variantes de repli à essayer.

Il n'y a pas de raccourci ici. **Aucune documentation d'opérateur n'est fiable
sur ce point** ; seule la composition réelle tranche. C'est la raison d'être du
drapeau `verifie`.

**3. Distinguer les deux cas.**

| Ce qui échoue | Gravité | Suite |
|---|---|---|
| Le **code d'entrée** (`*126#`, `#150*50#`) | **Haute** — plus aucun paiement possible par la rampe | Actions §1 |
| Un **raccourci** paramétré | Basse — le menu manuel reste proposé | Actions §2 |

## Actions

### 1. Le code d'entrée a changé

C'est le seul cas urgent. **Aucun redéploiement n'est nécessaire** : le code
vit dans la configuration, et c'est exactement ce que l'ADR 0020 a rendu
possible.

1. Poser la nouvelle valeur en variable d'environnement — voir
   `.env.example` et `apps/api/src/domain/ramp/config.ts` pour le nom exact du
   préfixe par opérateur.
2. Redémarrer l'API. **Ne pas reconstruire la boutique** : la page `/payer` lit
   `GET /api/rampe` à l'exécution, c'est tout l'objet du lot 9.
3. Poser `..._VERIFIE=true` **seulement** si quelqu'un a composé le nouveau code
   sur un vrai téléphone. Sinon, le laisser à `false` : l'interface propose alors
   le raccourci **et** le menu manuel, et reste utilisable si le code échoue.
4. Mettre à jour la valeur par défaut datée dans
   `apps/api/src/domain/ramp/config.ts`, avec la date de constatation en
   commentaire — la variable d'environnement remplace à chaud, mais le défaut
   doit rester juste pour le prochain environnement créé.

**Le code ne se fige jamais en constante ailleurs dans le code.** `config.ts`
est le seul fichier du dépôt où un code USSD est écrit, et un test parcourt les
quatre arbres de sources pour le garantir.

### 2. Un raccourci ne marche pas

Pas d'urgence : le menu manuel est toujours proposé à côté.

1. Poser `verifie: false` sur le raccourci concerné si ce n'était pas déjà le
   cas. L'interface cesse alors de le présenter comme sûr.
2. Noter la chaîne réellement observée — les niveaux de menu, l'ordre des
   champs — dans le commentaire du raccourci.
3. Corriger le modèle si la bonne chaîne a été trouvée, et poser `verifie: true`
   **uniquement** si elle a été composée à Douala.

## Critère de sortie

- [ ] Le code servi par `GET /api/rampe` est celui qui fonctionne sur un vrai
      téléphone, sur la puce de l'opérateur concerné.
- [ ] Le drapeau `verifie` reflète la vérité : `true` seulement pour ce que
      quelqu'un a composé lui-même.
- [ ] Le taux `commandes → payées` de l'entonnoir est revenu à son niveau
      d'avant, mesuré sur **une journée pleine** — le paiement mobile a un
      rythme journalier, une heure ne dit rien.
- [ ] La valeur par défaut de `config.ts` est à jour et datée.

## Ce qu'il ne faut pas faire

- **Figer le nouveau code dans le code source.** C'est un interdit d'AGENTS.md,
  et la raison est celle-ci exactement : les opérateurs les changent.
- **Poser `verifie: true` sur la foi d'une documentation.** Le drapeau ne dit
  pas « on pense que ça marche », il dit « quelqu'un l'a composé ».
- **Écrire un code de repli côté boutique.** Ce serait la constante que le
  lot 9 interdit, et elle serait périmée le jour où elle servirait.
