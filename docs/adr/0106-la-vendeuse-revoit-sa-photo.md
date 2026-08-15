# 0106 — La vendeuse revoit sa photo

Date : 2026-08-15
Statut : accepté
Complète : 0105 (les deux tranches de la rafale), 0102 (la cause d'une photo perdue se dit)

## Constat

> « Les photos ne sont pas visibles côté vendeur à l'ajout. »

C'était exact. Elle envoyait sa photo, le fil répondait en texte :

> ✅ **Sac en raphia** — 8 000 FCFA est dans votre catalogue.

et rien ne lui montrait ce que l'acheteuse verrait. Une photo cadrée de
travers, une photo floue, ou simplement la mauvaise photo, ne se découvrait
qu'en ouvrant la boutique publique — c'est-à-dire jamais.

La carte-vitrine, elle, lui revenait **tout en initiales**, alors que sa
boutique avait des photos.

## Deux défauts, une seule racine et une seule addition

### 1. La carte prenait les trois premiers articles

`take: ARTICLES_MAX` avec `orderBy: position asc`. C'est la **troisième
instance** du désaccord de tranche de l'ADR 0105, et la plus visible des
trois : un article neuf prend `position = max + 1`, une vendeuse qui commence
à photographier photographie ses ajouts récents, donc la carte ramassait
exactement les articles sans photo.

**Décision** : on lit large (`ARTICLES_CANDIDATS = 24`) et on choisit —
illustrés d'abord, puis on complète, ordre de position conservé dans chaque
groupe. La règle vit dans le domaine (`selectionVitrine`) parce que c'est une
règle de produit — « une carte montre ce qui se montre » — et non un détail de
stockage : le service lui passe un booléen, jamais une clé.

Une boutique sans aucune photo retombe exactement sur le comportement d'avant.

### 2. La confirmation ne portait pas la photo

**Décision** : la bulle de publication prend un **en-tête d'image**, avec
l'URL vérifiée de la photo enregistrée. Zéro message de plus — l'en-tête vit
dans la bulle qui existait déjà. Absente, la bulle est exactement celle
d'avant : c'est un enrichissement, pas une condition.

## Le risque assumé, et pourquoi il ne l'est plus

Cette addition met un appel de stockage **avant** le premier envoi, ce que le
banc du 13/08/2026 interdisait : la composition de la décoration précédait la
confirmation, un `fetch` sans délai s'est suspendu pour toujours, et la seule
phrase qui comptait n'est jamais partie.

La règle posée alors — « un appel réseau du bot échoue, ou il finit ; jamais
il n'attend » — vivait dans `fetch-borne.ts`. **Le client S3 y échappait** : le
SDK AWS n'utilise pas `fetch`, il a son propre client HTTP, dont les délais
par défaut valent zéro, c'est-à-dire *pas de délai*. Un `HeadObject` vers un
endpoint qui accepte la connexion puis se tait suspendait la promesse pour
toujours, et la route entrante attend la fin du traitement avant de rendre son
200. Exactement la même panne muette, dans le seul adaptateur qui n'avait pas
été borné.

`S3Storage` porte donc désormais `requestTimeout` (quinze secondes, la même
valeur, pour la même raison) et `connectionTimeout` (cinq — une machine
injoignable se déclare plus vite qu'un objet ne se transfère). Le pire cas
n'est plus « le fil s'arrête » mais « la confirmation part en texte, quinze
secondes plus tard » : le comportement d'avant, en retard.

C'est une correction qui dépasse le besoin qui l'a fait trouver, et elle est
gardée telle quelle : le défaut existait avant cette décision, sur tous les
autres appels au stockage.

## Ce qui tient la décision

- `carte-vitrine.test.ts` — quatre cas sur `selectionVitrine` : les illustrés
  passent devant même en fin de boutique, l'ordre tient dans chaque groupe,
  une boutique sans photo rend les trois premiers, et les bornes.
- `bot-photos-vendeuse.test.ts` — contre une vraie base et un vrai stockage :
  la confirmation porte un lien qui pointe un objet **présent**, et sans
  stockage la bulle n'a pas d'en-tête vide tout en disant encore la cause
  (ADR 0102). Mesuré avant correctif : `expected null not to be null`.

## Ce qui n'est pas fait

**Corriger un prix ou un stock depuis le fil.** La fiche article de l'ADR 0107
les affiche et renvoie à l'espace vendeuse. Ouvrir l'écriture demanderait un
état de conversation par champ, une confirmation, et une entrée au journal
d'audit — c'est un lot, pas une addition. Le besoin dit était « consulter »,
et c'est ce qui est livré.
