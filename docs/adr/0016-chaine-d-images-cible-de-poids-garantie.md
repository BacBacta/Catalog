# 0016 — La chaîne d'images : une cible de poids garantie, pas espérée

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 5 (`apps/api`, `apps/seller`, `packages/contracts`, `packages/db`)
- Ajoute deux dépendances côté serveur : `sharp` 0.35.3 et `@aws-sdk/client-s3` 3.1098.0

## Contexte

Le lot 5 demande une chaîne d'images en quatre temps : redimensionnement côté
client, affichage du gain à la vendeuse, ré-encodage côté serveur en AVIF avec
repli WebP, stockage en clés opaques et URL signées. Sa définition de terminé
fixe un chiffre : **l'objet stocké fait moins de 100 Ko**.

C'est ce chiffre qui a orienté toutes les décisions ci-dessous.

## Décision 1 — la cible de 100 Ko est une garantie, pas une valeur de qualité

Le chemin évident est de choisir une qualité d'encodage — disons 45 en AVIF, 72
en WebP — de mesurer sur quelques photos, de constater qu'on est sous les 100 Ko,
et de s'arrêter là.

C'est faux, et le test l'a montré tout de suite. Sur une image de bruit par
pixel à 640 px, le WebP à qualité 72 pèse **144 Ko**. Il faut deux crans de
qualité en moins pour tenir la cible, là où l'AVIF y arrive du premier coup à
36 Ko. Les deux échelles ne se comparent pas.

Or le bruit par pixel n'est pas un cas d'école ici : un pagne wax dense, un
tissu à fines rayures, un panier en raphia tressé produisent exactement ce genre
de signal. C'est ce que vend une vendeuse camerounaise.

L'encodage recommence donc à qualité plus basse tant que la cible n'est pas
tenue — `QUALITES_AVIF = [45, 32, 22]`, `QUALITES_WEBP = [72, 55, 40, 28]`. Sur
une photo ordinaire, une seule passe suffit et un test le vérifie : deux appels à
l'encodeur AVIF doubleraient le temps d'attente de la vendeuse. Si aucune qualité
ne tient, on garde la dernière : mieux vaut une image un peu lourde qu'un article
sans photo.

Les valeurs de l'échelle WebP sont **mesurées**, pas supposées. Le commentaire du
fichier porte les chiffres.

## Décision 2 — le client redimensionne, le serveur ne le croit pas

Ce sont deux travaux distincts et il faut savoir lequel sert à quoi.

Le redimensionnement **côté client** ne sert pas la sécurité — il sert l'**envoi**.
Une photo de téléphone fait deux à cinq mégaoctets ; la même à 640 px en fait
quelques dizaines de kilooctets. Sur un forfait vendu au mégaoctet, la différence
n'est pas une optimisation : c'est le prix de la mise en ligne d'un article.
C'est pour cela que le gain est **affiché** — « 2,4 Mo → 48 Ko avant l'envoi ».
Ce n'est pas une statistique de développeur, c'est le forfait de la vendeuse.

En cas d'échec du redimensionnement — navigateur ancien, format que le canvas ne
décode pas, mémoire insuffisante sur un téléphone d'entrée de gamme — on envoie
**l'original** plutôt que de lever. La vendeuse doit pouvoir publier son article,
et l'écran dit que l'envoi sera long.

Le ré-encodage **côté serveur** sert, lui, la sécurité et la garantie de poids.
Il refait tout, sans exception :

- **la signature binaire fait foi**, jamais le `Content-Type` ni l'extension. Un
  script téléversé sous un nom d'image puis servi depuis notre domaine est le
  vecteur habituel. `detecterTypeImage` est pur — des octets vers un verdict —
  et il est testé sur des cas construits à la main, script, ELF, ZIP, PDF, et
  `RIFF….WAVE` qui passerait un contrôle ne regardant que `RIFF` ;
- **la taille est contrôlée avant le format**, et le format avant le décodage.
  Décoder trente mégaoctets pour conclure qu'ils sont trop gros est du travail
  offert à l'attaquant ; un test mesure que le refus prend moins de 200 ms ;
- **le nombre de pixels est borné**. Une bombe de décompression est une petite
  image compressée qui se décomprime en gigaoctets.

## Décision 3 — toutes les métadonnées partent, et c'est une question de sécurité physique

Une photo prise au téléphone porte ses coordonnées GPS. Publier le catalogue
publierait l'adresse du domicile de la vendeuse.

`sharp` supprime les métadonnées par défaut ; le point de vigilance est qu'un
appel à `withMetadata()` les rétablirait sans que rien d'autre ne change. Un test
fabrique une image portant un EXIF nommé, vérifie d'abord que la source le porte
bien — sans quoi le test passerait même si la fabrication avait échoué — puis
cherche la chaîne dans les octets de sortie.

L'orientation EXIF, elle, est **appliquée** avant d'être retirée. Sans `rotate()`,
une photo prise en portrait ressort couchée. C'est le défaut le plus visible de
toute chaîne d'images, et le plus facile à oublier parce qu'il n'apparaît jamais
sur des images de test créées par programme. Les dimensions annoncées sont celles
de l'objet stocké, après rotation : c'est ce que la boutique publique du lot 6
posera sur `<img width height>` pour tenir son budget de décalage visuel.

## Décision 4 — clés opaques, objets jamais publics

La clé ne contient ni identifiant de vendeuse, ni identifiant d'article, ni nom
de fichier d'origine. Trois raisons, par ordre d'importance :

1. le nom de fichier d'une photo de téléphone porte souvent une date et un
   numéro d'appareil, parfois un prénom ;
2. une clé devinable rend l'URL signée inutile — il suffirait d'énumérer ;
3. une clé qui porte l'identifiant de la vendeuse révèle, à qui voit une seule
   URL, combien d'articles elle a et depuis quand.

Les URL sont signées **à la lecture** et jamais stockées : une URL persistée
serait périmée la moitié du temps, et l'autre moitié elle constituerait un lien
public permanent vers un objet qui ne doit pas l'être.

Un nouvel envoi remplace l'image **puis** supprime l'ancienne, dans cet ordre :
l'inverse laisserait un article sans photo si le second envoi échouait. Un échec
de suppression ne fait pas échouer un envoi réussi — la photo est en place, c'est
ce qui compte pour la vendeuse — mais un test vérifie que l'ancienne disparaît,
sinon le stockage fuit à chaque modification.

## Décision 5 — le stockage en mémoire refuse la production

Sans les quatre variables `S3_*`, l'API prend un stockage **en mémoire**. Il
n'écrit rien sur disque et disparaît avec le processus, ce qui permet de
parcourir toute la chaîne — téléversement, ré-encodage, affichage — sans MinIO ni
compte S3.

Il **refuse de se construire si `NODE_ENV=production`**. C'est la même discipline
que `ConsoleSmsSender` : un oubli de configuration devient une panne immédiate et
lisible, plutôt qu'un catalogue sans photos au premier redémarrage.

`forcePathStyle` est vrai pour l'implémentation S3. MinIO et R2 servent en
`hôte/seau/clé` ; le style par sous-domaine est le défaut d'AWS et il échoue
ailleurs avec une erreur DNS qui ne dit rien du problème.

## Décision 6 — le réordonnancement se fait par boutons, pas par glisser-déposer

Le glisser-déposer est agréable sur un portable et pénible sur un téléphone : il
faut viser, maintenir, faire défiler la page en même temps. Il est de plus
inutilisable au clavier et au lecteur d'écran, ce qui en ferait une violation du
critère WCAG 2.5.7. Deux boutons « monter » et « descendre » marchent partout, et
le test de bout en bout exerce les deux chemins — le clic **et** la touche Entrée.

L'ordre envoyé est la liste **complète** des identifiants, écrite dans une seule
transaction. Deux réordonnancements concurrents laisseraient sinon des positions
en double, et l'ordre affiché à la vendeuse ne serait plus celui qu'elle a posé.

## Décision 7 — on archive, on n'efface pas

Une vendeuse qui supprime un article dont des commandes existent effacerait
l'histoire de ses ventes. Les lignes de commande recopient déjà nom et prix
(lot 3) ; l'archivage garde en plus la possibilité de remettre l'article en
vente, ce qui est le geste réel d'une vendeuse en fin de saison.

L'ordre ne se modifie pas quand les articles archivés sont affichés, et l'écran
le dit : la liste montrée n'est alors pas celle que voient ses clientes.

## Le cloisonnement, qui n'était pas dans la définition de terminé

Aucune route n'accepte un identifiant de vendeuse depuis le corps ou l'URL.
Chaque lecture et chaque écriture est filtrée par la session, **y compris** celles
qui portent déjà un identifiant d'article : sinon il suffirait de connaître un
identifiant pour modifier l'article de quelqu'un d'autre.

Un article qui n'appartient pas à la session renvoie **404 et non 403**. Un 403
apprendrait à un attaquant que l'identifiant est valide.

## Conséquences

- `sharp` et `@aws-sdk/client-s3` n'entrent que dans `apps/api`. Le budget de
  30 Ko de JS de la boutique publique n'est pas concerné : aucune des deux ne
  traverse la frontière.
- Une migration additive, `20260730160000_lot5_dimensions_image` : `image_width`,
  `image_height`, `image_bytes`. Les deux premières servent le lot 6, la
  troisième sert l'écran de la vendeuse.
- Le test de bout en bout **va chercher l'objet à son URL signée et compte ses
  octets**. Un serveur qui annoncerait 80 Ko en stockant 2 Mo passerait un
  contrôle sur la réponse JSON, et pas celui-là.
- L'image de test est un PNG de bruit fabriqué à la main, sans dépendance et sans
  binaire versionné. Le bruit vient d'un hachage en mode compteur et non d'un
  générateur à congruence linéaire : mesuré, la variante congruentielle produit
  des octets de poids faible à période courte que `deflate` recompresse, et une
  image censée peser 2,4 Mo n'en pesait que 0,4 — le test ne téléversait alors
  pas les deux mégaoctets demandés.
