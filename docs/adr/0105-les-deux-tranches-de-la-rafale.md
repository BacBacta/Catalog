# 0105 — Les deux tranches de la rafale, et le bucket qu'on croyait vide

Date : 2026-08-15
Statut : accepté
Complète : 0103 (les photos du catalogue s'affichent), 0035 (la rafale « voir en photos »)

## Constat — « Voir les photos » ne montrait rien

Le 15/08/2026 au soir, en préproduction, l'acheteuse touchait **Voir en
photos** et lisait :

> Cette boutique n'a pas encore mis de photos — les articles sont dans la
> liste.

Le message était faux. Les objets étaient dans le stockage, mesurés un par un.

## Le défaut — deux tranches qui ne parlaient pas de la même chose

Le service et le rendu se partagent le travail : le service vérifie que
chaque URL pointe un objet qui existe vraiment — un lien mort ferait refuser
le message **entier** par l'API Meta — et le rendu compose les bulles. Les
deux bornent leur travail à `RAFALE_MAX`, six images. Mais ils ne
comptaient pas les mêmes six.

`apps/api/src/bot.ts` enrichissait les articles **illustrés** :

```ts
const illustres = boutique.articles.filter((a) => charge.clesImage.has(a.id));
await Promise.all(illustres.slice(0, RAFALE_MAX).map(/* … */));
```

`apps/api/src/domain/bot/conversation.ts` rendait les **premiers** :

```ts
const photos = boutique.articles
  .slice(0, RAFALE_MAX)                    // ← la tranche AVANT le filtre
  .flatMap((a) => (a.imageUrl ? [image(/* … */)] : []));
```

Filtrer puis trancher, ou trancher puis filtrer : deux gestes dans deux
ordres. Tant qu'une boutique tient en six articles les deux ensembles sont
identiques et le défaut est invisible. **Au septième, ils divergent.**

Et ils divergent dans le sens qui fait le plus de mal. Un article neuf prend
`position = max + 1` : il arrive en **fin** de liste. Une vendeuse qui
commence à photographier photographie ses ajouts récents. La tranche du rendu
ramassait donc exactement les articles **sans** photo, `photos.length` valait
zéro, et le repli partait — en annonçant l'absence de ce que le service
venait de vérifier.

Mesure exacte, sur une boutique de dix articles dont neuf illustrés : le
service enrichissait les rangs 1 à 6, le rendu prenait les rangs 0 à 5, et
l'acheteuse recevait **cinq** images au lieu de six. C'est la même faute, un
cran plus discret.

### Le même désaccord, une deuxième fois

L'accueil d'une boutique porte une image d'en-tête, choisie par le domaine
comme le premier article **illustré** :

```ts
const enTete = b.articles.find((a) => a.imageUrl)?.imageUrl;
```

Le service, lui, enrichissait le premier article **tout court** :

```ts
const cibleId = articleVise ?? (slugDuTexte ? boutique.articles[0]?.id : null) ?? null;
```

Une boutique dont le premier article n'a pas de photo s'ouvrait donc sans
en-tête, quelle que soit sa taille — pas besoin d'attendre le septième
article pour celui-là.

## Décision

**Le filtre passe avant la tranche, des deux côtés, et les deux côtés
désignent le même ensemble.**

Le rendu filtre `imageUrl` puis tranche. Le service vise le premier article
illustré, exactement ce que `find((a) => a.imageUrl)` ira chercher.

C'est le correctif minimal, et c'est délibéré : on ne déplace pas la
sélection dans le domaine « pour qu'il n'y ait qu'un endroit ». Le domaine ne
peut pas connaître les clés de stockage — c'est un détail d'adaptateur, la
règle de dépendance l'interdit — donc la sélection restera à deux endroits.
Ce qui manquait n'était pas l'unicité, c'était **un test qui traverse les
deux**.

## Ce qui tient la décision

`apps/api/src/__tests__/bot-photos-acheteuse.test.ts` monte la disposition
qui fait diverger les deux tranches — huit articles, les deux derniers
illustrés — et la joue contre une vraie base et un vrai stockage. Quatre
cas : la rafale envoie les deux photos, l'accueil prend le bon en-tête, la
tranche reste bornée à six, et une clé en base **sans** objet dans le
stockage ne part pas en lien mort.

Mesuré avant correctif : les quatre échouent, `expected [] to have a length
of 2`. Le cas « plus d'illustrés que la tranche » échoue à cinq images sur
six — l'arithmétique ci-dessus, vérifiée.

Deux tests jumeaux vivent côté domaine (`conversation.test.ts`), où ils
tournent sans base.

## Ce que trois articles ne pouvaient pas attraper

Le défaut ne mord qu'au septième article. Tous les essais de terrain — et
tous les tests existants — se faisaient à deux ou trois articles. Il n'y a
pas de leçon de rigueur à en tirer, il y a une leçon de **dimension** : un
harnais qui ne dépasse jamais la borne qu'il teste ne teste pas la borne.

## Le bucket qu'on croyait vide

Le même soir, le porteur du produit a rapporté que le bucket Tigris était
vide. La mesure dit le contraire, et il faut l'écrire ici parce que trois
faits se contredisaient et que c'est ce qui a coûté la soirée.

`apps/api/scripts/diagnostic-stockage.mjs`, exécuté sur la machine de
préproduction, contre `catalog-media-preprod` :

- `img/` — 21 objets, 7 images distinctes ;
- écriture, relecture d'en-tête, lecture du corps et effacement d'une sonde
  jetable : les quatre étapes réussissent ;
- une clé nommée, vérifiée dans ses trois déclinaisons : présentes, 12 179,
  18 932 et 25 668 octets.

Deux raisons de croire un bucket vide alors qu'il ne l'est pas, rencontrées
toutes les deux :

1. **Un listage tronqué à vingt clés ne montre que `carte/`.** S3 rend les
   clés en ordre alphabétique, et `carte` précède `img`. La sonde liste
   désormais **par préfixe**, et trie les cinq plus récentes par date — la
   fraîcheur renseigne, le rang alphabétique non.
2. **Un 403 sur une clé absente ne prouve pas un refus de droits.** Quand le
   listage anonyme est interdit — ce qu'on veut —, une clé absente répond
   403 et non 404. Lire ce 403 comme « le bucket est privé, donc je ne vois
   rien » est une conclusion de trop.

Rien n'a été corrigé de ce côté, parce qu'il n'y avait rien de cassé. Ce
paragraphe existe pour qu'on ne rouvre pas l'enquête.

## Ce qui n'est pas décidé ici

`taille()` confond toujours « objet absent » et « droits insuffisants » : son
`catch` rend `null` dans les deux cas, et le bot renonce alors à la photo en
croyant qu'elle n'existe pas. C'est **vu et laissé**. Distinguer les deux
demanderait de faire remonter une erreur de droits jusqu'à un écran, donc de
décider ce qu'on en dit à une vendeuse qui n'y peut rien. La sonde de
stockage les sépare à la demande ; c'est suffisant tant que le cas ne s'est
pas produit en vrai.
