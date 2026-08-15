# 0102 — La photo de l'ouverture se dit, donc l'article naît d'abord

Date : 2026-08-15
Statut : accepté
Révise : 0088 (l'ordre, pas la règle d'une seule bulle)
Prolonge : 0087 (l'ouverture en deux écrans), 0079 (le média CDN chiffré)
Rouvre et referme : constat D3 de `docs/audit-pipeline-2026-08.md`

## Le défaut, mesuré en préproduction le 15/08/2026

Une vendeuse ouvre sa boutique par le formulaire en deux écrans, photo
comprise. Le bot répond :

> ✅ **Chop** est ouverte.
> **Sac** — 1 000 FCFA est en ligne.

Pas un mot sur la photo. La boutique publique, elle, affiche un **cadre
vide** : `imageKey` est resté `null`, et `imagePublique` refuse — à raison —
de rendre un `<img>` sans clé ni dimensions.

La cause tient à l'ordre, pas au pipeline. `avecPhoto` se calculait ainsi :

```ts
avecPhoto: Boolean(ouverture.article.mediaId ?? ouverture.article.photoCdn)
```

C'est-à-dire **l'intention** — « le `PhotoPicker` a rendu quelque chose » —
et non le **résultat**. L'article naissait ensuite, par
`publierArticleDepuisFil(..., "deja_dite")`, et `"deja_dite"` supprime
précisément le seul message qui porte le verdict :

```ts
if (annonce === "ici" || !article) {
  ... messageArticlePublie(vers, article, ...)   // le seul porteur de photoRefus
}
```

Le verdict existait donc, il était même **compté** dans `catalog.bot.media`
(`lecture_cdn`, `dechiffrement`, `reencodage`) — et il n'atteignait
personne. C'est le constat D3 de l'audit 2026-08, « quand la cause est
connue, elle se DIT », rouvert par un chemin que ce constat n'avait pas
regardé. Le coût est celui que D3 décrivait : la vendeuse renvoie la même
photo, échoue pareil, et conclut que ça ne marche pas.

## Décision 1 — l'article naît AVANT sa confirmation

Le verdict n'existe qu'une fois le pipeline passé. Pour le dire, il faut
donc le passer d'abord : dans le chemin d'ouverture, `creerArticleDepuisFil`
s'exécute avant que `messageBoutiqueCreee` ne soit composé, et la bulle
reçoit `avecPhoto` et `photoRefus` **réels**.

**La règle de l'ADR 0088 ne bouge pas** : un formulaire rempli, une bulle.
C'est son ORDRE qui change, pas son nombre de messages.

## Décision 2 — la règle du banc du 13/08 tient toujours

Ce banc a laissé une règle dure : *l'essentiel part d'abord, la décoration
suit*. Un article était entré en base et le fil était resté muet, parce que
la composition de la décoration — rendu de carte, ré-encodage, trois
téléversements — précédait le premier envoi, et un appel réseau sans délai
d'attente l'avait suspendue pour toujours.

Ce que la décision 1 déplace n'est **pas** la décoration : c'est la création
de l'article, et elle est bornée par construction — `fetchBorne` plafonne
les appels réseau du média, et rien d'autre ne s'intercale. La carte-vitrine,
le pack statut et le mode d'emploi restent **après** la confirmation. Ce qui
avait suspendu le fil reste après lui.

## Décision 3 — `dejaCree` plutôt qu'un second chemin

`publierArticleDepuisFil` accepte l'article déjà créé. Sans cela, l'article
naîtrait **deux fois** — une pour la bulle, une pour la publication —, et
deux articles pour un formulaire seraient pire que le défaut corrigé.

Le paramètre est préféré à une copie de la fonction pour la raison écrite
dans son en-tête : elle est le SEUL chemin de publication, et « un second
exemplaire de cette liste divergerait au premier lot venu ».

## Ce que cet ADR NE fait pas

- **Il ne dit pas pourquoi la photo a échoué** en préproduction le
  15/08/2026. Téléchargement CDN, déchiffrement, ré-encodage et stockage sont
  comptés séparément dans `catalog.bot.media` ; la mesure reste à lire. Ce
  lot rend la panne **visible**, il ne la répare pas.
- **Il ne touche pas au pipeline d'images** ni au contrat de champs du Flow.
- Il ne corrige pas `MEDIA_PUBLIC_BASE`, absente de la construction de la
  boutique et qui se rappellera dès qu'une photo sera enregistrée : les URL
  retombent sur `/media`, un chemin relatif que `vercel.json` ne réécrit pas.
  C'est un défaut distinct, constaté le même jour, et il mérite son propre
  lot.

## Preuves

- `inscription.test.ts` — la bulle d'ouverture dit la CAUSE (« WhatsApp ne
  l'a pas fournie »), n'ajoute pas l'invitation à qui vient d'essayer,
  garde l'invitation quand rien n'a été tenté, et se tait quand la photo est
  là. Une seule bulle dans les quatre cas.
- `bot-ouverture-photo.test.ts` — contre une vraie base : un lecteur de
  média muet fait dire la cause dans le fil, et l'article **n'est créé
  qu'une fois**.
