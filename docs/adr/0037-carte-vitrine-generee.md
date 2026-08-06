# 0037 — La carte-vitrine : une image à poster en Statut

Date : 04/08/2026 · Statut : accepté · Complète : 0016, 0047, 0035

## Contexte

Le Statut WhatsApp est **le** canal marketing des vendeuses camerounaises :
gratuit, vu par tout le carnet d'adresses, consulté plusieurs fois par jour.
C'est là que se joue l'acquisition de Catalog, et l'analyse des parcours l'a
noté « D » — le point le plus faible du côté vendeuse.

Or ce que le bot lui donne aujourd'hui à partager est un lien `wa.me` nu. Un
tel lien **n'a aucun aperçu riche** : posté en Statut, il apparaît comme une
ligne de texte grise. Personne ne clique sur une ligne de texte grise.

D'où la carte-vitrine : une **image** qui porte le nom de la boutique, ses
articles, son lien et un QR. Sur un Statut, l'image *est* l'aperçu ; imprimée,
elle devient l'enseigne de l'étal.

## Décision 1 — SVG composé dans le domaine, rasterisé par un adaptateur

La composition est une **fonction pure** : des données entrent, une chaîne SVG
sort. Elle se teste sans image, sans fichier et sans bibliothèque — on vérifie
que le nom, le prix et le lien y sont, que les longs noms sont coupés, que le
gabarit tient sans article.

La rasterisation vit dans l'adaptateur, avec `sharp` — **déjà présent** pour le
pipeline de photos (ADR 0016), et capable de rendre du SVG. Aucune bibliothèque
de rendu supplémentaire : ni `satori`, ni `resvg`, ni `canvas` natif.

Les photos d'articles ne sont **pas** encodées en base64 dans le SVG — elles
sont composées par-dessus par `sharp`. Trois photos en base64 gonfleraient la
chaîne de plusieurs centaines de kilo-octets pour rien.

## Décision 2 — une police entre dans l'image Docker, et c'est une nécessité

`node:24-slim` n'embarque **aucune police**. Un SVG contenant du texte y rend
des blancs : la carte serait vide, silencieusement, en production seulement.
`fonts-dejavu-core` (~1,5 Mo) est donc installé aux côtés d'`openssl` — il
couvre le latin **et les accents français**, ce dont « Chez Béa » et « Marché
central » ont besoin.

C'est le genre de dépendance d'environnement qui se découvre au pire moment ;
elle est donc posée avec sa raison, et le test visuel de la définition de
terminé consiste à **regarder la carte**, pas à vérifier qu'un octet est sorti.

## Décision 3 — un encodeur QR, et pas le nôtre

`qrcode` entre en dépendance de l'API. Écrire un encodeur à la main
supposerait implémenter la correction d'erreur de Reed-Solomon et la sélection
de masque : un risque de justesse pur, sans contrepartie. La bibliothèque rend
un **chemin SVG**, injecté dans la composition — donc le domaine reste
ignorant d'elle.

La règle des 10 Ko d'AGENTS.md ne s'applique pas : elle borne le **chemin
critique de la boutique**, c'est-à-dire le paquet du navigateur. Rien de ceci
n'y entre.

## Décision 4 — l'objet suit exactement le régime des photos d'articles

La carte passe par `reencoderImage` comme n'importe quelle photo : trois
déclinaisons (AVIF, WebP, JPEG), **sous 100 Ko** (ADR 0016), clé opaque, jamais
publique, servie par URL signée. Un seul chemin de stockage d'images dans le
produit, pas deux.

Elle est **regénérée à chaque demande** plutôt que mise en cache : une carte
montre des articles et une réputation qui changent, et une carte périmée
partagée en Statut est pire que pas de carte. L'ancienne clé est supprimée.

`ObjectStorage` gagne `lire` — il fallait bien récupérer les photos d'articles
pour les composer. C'est une lecture de nos propres objets, côté serveur ; elle
n'ouvre rien de nouveau.

## Décision 5 — 9:16, parce que c'est le Statut qui est visé

Un seul gabarit, 1080 × 1920. C'est le format du Statut, et il reste lisible
partagé dans une conversation. Le carré « pour l'impression » attendra un
besoin constaté (AGENTS.md §7.7) : on ne fabrique pas deux gabarits pour une
hypothèse.

## Décision 6 — quand la carte part

Deux moments, et deux seulement : **après la publication du premier article**
— l'instant où la boutique devient montrable —, et **sur demande** (« ma
carte », ou le bouton du menu « ma boutique »). Pas à la création : une carte
sans article ne donne envie à personne.

## Conséquences

- Le libellé du lien porté par la carte est celui du `wa.me` de la boutique ;
  sans `WHATSAPP_WABA_NUMERO`, il n'y a pas de lien, donc **pas de carte** —
  et le bot le dit plutôt que d'imprimer une URL fausse.
- Une vendeuse sans photo d'article obtient une carte quand même : les
  emplacements montrent l'initiale de l'article sur un aplat. Une boutique sans
  aucun article n'obtient pas de carte, et s'entend proposer d'en ajouter un.
- Le fil vendeuse gagne son premier message **image**.
