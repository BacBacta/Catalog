# ADR 0099 — une horloge figée dans le passé se fait purger

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0040

## Le symptôme, et pourquoi il a duré

Trois tests de `bot-idempotence.test.ts` tombaient ensemble, par intermittence :
**2 échecs sur 11** exécutions complètes le 14/08 au matin, jamais sur
`pnpm --filter @catalog/api test` seul, jamais reproduits à la demande. L'un de
ces rouges a bloqué un déploiement.

Ce qui l'a fait durer n'est pas sa rareté, c'est que **la trace n'avait jamais
été capturée** : les deux occurrences étaient passées par un `grep` sans
journal, et il ne restait que les noms des tests. On peut discuter d'un nom de
test pendant des heures. Une assertion, non.

La capture a demandé une boucle : `pnpm test` en série, sel différent à chaque
tour, journal **conservé seulement si l'échec survient**. Reproduit au douzième
tour.

## Ce que la trace disait

```
la MEME livraison rejouee ne repond qu'une fois
  AssertionError: expected 4 to be 1

purge les vues anciennes, garde les recentes
  AssertionError: expected +0 to be 1     ← la ligne « recente » avait disparu
```

`4` et non `1` : les **trois** relivraisons avaient été traitées. La garde
n'avait pas eu un hoquet, elle avait été **désarmée**. Et une ligne posée à
`NOW − 1 h` avait été effacée par quelqu'un.

Un seul mécanisme explique les deux.

## Le mécanisme

`traiterLivraisonBot` se termine par une purge **globale et datée** :

```ts
await deps.prisma.botMessageVu.deleteMany({
  where: { reclameLe: { lt: new Date(maintenant.getTime() - RETENTION_VUS_MS) } },
});
```

Elle ne regarde ni le numéro, ni la conversation : elle efface tout ce qui a
plus de trois jours **selon l'horloge de cet appel**.

`bot-idempotence.test.ts` épinglait son horloge au `2026-08-05` — la date du
défaut de l'ADR 0040, en guise de récit. Ses lignes portaient donc `reclameLe`
neuf jours dans le passé. Tout autre fichier de tests joué en parallèle, avec
l'horloge réelle, les effaçait au passage.

Les lignes de réclamation disparues, chaque relivraison recréait la sienne et
était traitée comme neuve : `expected 4 to be 1`. Et la ligne « récente » du
test de purge partait avec : `expected 0 to be 1`.

**Reproduit hors suite, déterministe** : une ligne posée au 05/08 disparaît au
premier passage d'un `traiterLivraisonBot` à l'heure réelle. Ce n'est plus une
hypothèse, c'est une manipulation.

## Ce que ce n'est pas

**Ce n'est pas un défaut du produit.** En production toutes les instances
partagent la même horloge : aucune n'efface les lignes fraîches d'une autre.
La garde d'idempotence de l'ADR 0040 est intacte.

C'est le fait d'**épingler une horloge dans le passé tout en appelant du code
qui purge globalement par le temps**. Le test se sabotait lui-même, et
accusait le produit.

## Décision

L'horloge de ce fichier se prend au **présent** — `new Date()`. Tous ses usages
étaient déjà relatifs, des écarts ; rien ne dépendait de la date elle-même, et
le récit du 05/08 vit dans l'en-tête du fichier.

Le piège est écrit **à l'endroit où on le rencontre** : au-dessus de la purge
dans `bot.ts`, et dans l'en-tête du test.

Et il est tenu par un garde, `purge-horloge-figee.test.ts` : *aucun fichier de
tests qui touche `bot_message_vu` ne fige son horloge dans le passé*. Sept
fichiers épinglent une date ; six ne touchent pas cette table et ne sont pas
concernés. Le garde a été vérifié en le faisant rougir — remettre la date
littérale, voir le message nommer le fichier fautif et dire quoi faire.

Il ne peut pas deviner quel fichier *asserte* sur cette table : ça ne se lit pas
dans une expression régulière. Il tient la règle plus large, et suffisante.

## Ce que la chasse a trouvé d'autre, et qui reste OUVERT

Les quarante exécutions de la boucle ont créé cinquante boutiques nommées
« Chez Solange », et **épuisé l'espace de dédoublonnage des identifiants
d'URL** :

```ts
export async function slugLibre(prisma, base) {
  for (let i = 0; i < 50; i++) { … }
  throw new Error(`aucun identifiant d'URL libre pour « ${base} »`);
}
```

Au 51ᵉ homonyme, ça lève. `traiterLivraisonBot` avale l'exception et répond
« panne passagère » : **la vendeuse ne peut pas ouvrir sa boutique et
n'apprend jamais pourquoi**, quoi qu'elle réessaie.

Le commentaire de la fonction dit lui-même que « chez tantine » n'est pas un
nom rare. Cinquante est donc un plafond atteignable — pas demain, mais pas
jamais.

**Ce n'est pas corrigé ici, et c'est délibéré.** Ce qu'il faut faire au 51ᵉ est
une décision produit : suffixe aléatoire (l'adresse devient illisible),
demander un autre nom (on refuse une vendeuse pour un homonyme), ou suffixe par
ville (« chez-solange-douala », qui se lit et qui distingue). Choisir sans
arbitrage serait exactement la dérive que le §7.7 d'`AGENTS.md` interdit.
