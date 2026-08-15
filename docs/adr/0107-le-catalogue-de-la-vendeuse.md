# 0107 — Le catalogue de la vendeuse, dans son fil

Date : 2026-08-15
Statut : accepté
Complète : 0106 (la vendeuse revoit sa photo), 0038 (le stock se saisit, il ne se décompte pas)

## Constat

> « La boutique pour l'instant n'a pas de catalogue WhatsApp où il peut
> consulter ses articles listés et voir les stocks. Pourtant un flow même non
> natif Meta permettrait de résoudre ça. »

C'était exact, et c'est le genre de trou qui ne se voit pas depuis le code :
chaque écran existait, aucun ne montrait la liste. Le menu vendeuse disait

> 8 articles en ligne

et s'arrêtait là. Pour savoir **lesquels**, il fallait ouvrir sa propre
boutique publique en se faisant passer pour une acheteuse, ou l'espace web.
Les stocks, eux, ne s'affichaient nulle part dans le fil — alors que
l'ADR 0038 venait justement de les rendre saisissables.

## Décision — une liste interactive, pas un Flow

Le besoin est de **consulter**. Un Flow est un formulaire : de quoi saisir,
pas de quoi lire. Une liste interactive se rend en un message, marche sans
WhatsApp récent, et n'a rien à déposer chez Meta ni à faire approuver.

`mes articles` — et `mon catalogue`, `stock`, `mes stocks`, `inventaire` —
rend une liste où **chaque ligne porte les trois informations cherchées** :

```
Pagne wax        15 000 FCFA · 3 en stock
Sac raphia        8 000 FCFA · stock non suivi
Chaussures        6 500 FCFA · épuisé · pas de photo
```

Toucher une ligne ouvre la fiche, **photo d'abord** : c'est précisément ce
qui manquait à l'ADR 0106, et c'est ce qu'elle veut vérifier — que l'acheteuse
verra la bonne image, bien cadrée.

### Quatre choses décidées, et pourquoi

**Le mot « stock » ouvre la même porte.** Une vendeuse qui cherche son stock
ne pensera pas au mot « articles ». Deux portes, une pièce.

**« pas de photo » est dit en clair.** C'est l'anomalie qu'on veut qu'elle
voie : un article sans photo se vend mal, et rien ne le lui signalait.

**Zéro vaut « non suivi », jamais « épuisé ».** C'est la convention de la base
(`stock Int @default(0)`) et de la boutique publique. Annoncer « 0 disponible »
pour un article qu'elle n'a simplement jamais compté serait un mensonge sur
sa propre boutique.

**Le corps dit que les stocks ne se décomptent pas tout seuls.** Obligation,
pas politesse : l'ADR 0038 a décidé que le décompte automatique n'existe pas,
parce qu'elle vend aussi hors de tout ce que Catalog voit et qu'un compteur
qui ne verrait que la moitié des ventes serait plus faux que le nombre qu'elle
tient elle-même. Un écran qui montre un stock sans le dire laisse croire le
contraire.

### Le préfixe `vart:`, et non `art:`

Le fil **acheteuse** utilise déjà `art:` pour sa fiche article. Un identifiant
partagé aurait fait ouvrir la fiche acheteuse à la vendeuse, ou l'inverse,
selon l'ordre des règles d'aiguillage. Deux fils, deux préfixes.

Même raison pour le routage : `mes articles` et les lignes `vart:` partent au
fil vendeuse **avant** la règle 4, comme `ma carte` et `solde`. Sans cela, une
vendeuse qui a un panier ouvert — le cas normal quand elle teste sa boutique
ou achète à une consœur — verrait son geste avalé par le tunnel d'achat.

### Le geste est annoncé

La ligne du menu devient :

> 8 articles en ligne — écrivez « mes articles » pour les voir, avec les stocks.

Un mot-clé que personne ne connaît n'existe pas. C'est la même règle que
« congés » deux lignes plus bas, et elle a déjà été apprise ici.

## Ce qui tient la décision

- `conversation.test.ts` — neuf cas purs : les formes du mot reconnues et les
  phrases qui n'en sont pas, les trois informations par ligne dans les quatre
  états de stock, la pagination au-delà de neuf, la boutique vide qui invite
  au lieu de rendre une liste vide, la fiche avec et sans photo, les effets
  rendus plutôt que des messages devinés, et le menu qui annonce le mot.
- `bot-photos-vendeuse.test.ts` — contre une vraie base : la liste lit ses
  articles avec les bons stocks, la fiche vérifie sa photo dans le stockage,
  et **l'article d'une autre vendeuse ne s'ouvre pas** — `sellerId` est dans
  le filtre de la requête, pas dans un contrôle après coup.

## Ce qui n'est pas fait

**On ne corrige rien depuis le fil.** Ni prix, ni stock, ni nom. La fiche les
affiche et renvoie à l'espace vendeuse. Ouvrir l'écriture demande un état de
conversation par champ, une confirmation, et une entrée au journal d'audit :
c'est un lot, pas une addition, et le besoin dit était de consulter.

**Au-delà de 90 articles, la liste s'arrête.** Une liste paginée dans WhatsApp
cesse d'être le bon outil bien avant ce chiffre, et l'espace vendeuse sait
trier et chercher. La borne est réelle et écrite (`ARTICLES_VENDEUSE_MAX`)
plutôt que découverte un jour par une vendeuse dont le catalogue se tronque
en silence.

**Les archivés n'y sont pas** (`archivedAt: null`), comme partout ailleurs.
