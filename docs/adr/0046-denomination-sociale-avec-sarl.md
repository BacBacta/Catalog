# 0046 — La dénomination porte « SARL », et la marque avec elle

Date : 2026-08-06
Statut : accepté
Révise : [0042](0042-site-de-la-societe.md), [0043](0043-site-societe-editorial.md)
Concerne : `packages/contracts/src/editeur.ts`, `apps/site`, `apps/shop`

## Contexte

Décision du porteur du produit : la société s'appelle **Horizon Services
Sarl**. Le dépôt écrivait `HORIZON SERVICES` en dénomination et
`Horizon Services` en nom d'usage — la forme juridique n'entrait nulle part
dans le nom.

Deux formes retenues, et c'est la même construction qu'avant :

| Champ | Valeur | Où il sert |
|---|---|---|
| `societe` | `HORIZON SERVICES SARL` | mentions légales, ligne légale du pied |
| `nom` | `Horizon Services Sarl` | la prose, les titres, le mot-marque |

Les capitales restent réservées à la mention légale : une dénomination de
registre au milieu d'une phrase se lit comme un cri.

## Ce que « SARL » ne rend pas redondant

`forme` vaut toujours `SARL pluripersonnelle`, et la ligne du pied lit donc
« HORIZON SERVICES SARL / SARL pluripersonnelle au capital de… ». Ce n'est pas
une répétition à corriger : la dénomination **nomme** la société, la forme la
**qualifie** et porte la mention `pluripersonnelle`, que le nom ne porte pas.
Les fusionner ferait perdre l'information la plus précise des deux.

## La marque prend « SARL » elle aussi

Décision explicite, prise contre l'usage courant — une forme juridique dans un
logotype est inhabituel. Le mot-marque de l'en-tête et la signature géante du
pied lisent tous deux `EDITEUR.nom` : ils suivent donc, en capitales par
`text-transform`.

**Conséquence typographique, et c'est la partie qui n'était pas gratuite.**
`.pied__marque` porte `white-space: nowrap` dans un `.pied` en
`overflow: hidden` : un nom trop long n'est pas renvoyé à la ligne, il est
**coupé**. La taille était réglée pour que « HORIZON SERVICES » — 16 signes —
tienne entier à toutes les largeurs. La signature en fait maintenant 21.

Les trois bornes du `clamp` sont descendues d'un facteur 16/21, puis
**mesurées au rendu** dans Chromium, de 320 px à 2560 px, sur les trois pages :

```
clamp(1.9rem, 9.4vw, 11.5rem)   →   clamp(1.45rem, 7.1vw, 8.75rem)
```

| Largeur | Avant | Après |
|---|---|---|
| 320 px | 288 / 320 px | 284 / 320 px |
| 768 px | 685 / 768 px | 667 / 768 px |
| 1920 px | 1713 / 1920 px | 1668 / 1920 px |

Le taux de remplissage est conservé à un ou deux points près : la signature
occupe la même part de l'écran qu'avant, avec cinq signes de plus.

Le mot-marque de l'en-tête a été mesuré de la même façon — il ne déborde de
son enveloppe à aucune largeur, la barre de navigation passant à la ligne
avant lui.

## Le monogramme ne change pas

Le « H » de la favicon reste l'initiale du mot-marque. « SARL » n'ajoute pas
une lettre lisible à 16 px, et l'ADR 0045 a déjà tranché ce qui survit à cette
taille. Seule l'étiquette `aria-label` du SVG suit le nom.

## Deux gardes ajoutées, pour un défaut trouvé en chemin

Le changement a révélé que les trois attributs `description=` des pages
portaient « Horizon Services » **en dur**, alors que le corps des pages lisait
`EDITEUR`. Le nom aurait donc été juste à l'écran et faux dans la métadonnée —
celle que Google affiche et que WhatsApp met dans l'aperçu du lien. Le défaut
est invisible sur la page.

Les descriptions sont devenues des gabarits lisant `EDITEUR.nom`, et deux
tests tiennent la règle :

- aucun attribut `title=` ou `description=` d'une page ne contient le premier
  mot de la dénomination ;
- l'`aria-label` de `favicon.svg` — seul endroit du site où le nom est écrit à
  la main, un fichier statique ne pouvant pas lire `EDITEUR` — dit le même nom
  que `contracts`.

## Ce qui suit tout seul, et ce qui ne suit pas

`apps/shop` lit `EDITEUR.societe` et `EDITEUR.forme` dans sa ligne légale :
elle affiche la nouvelle dénomination à la reconstruction suivante, sans
retouche.

**Ne suit pas, et doit être fait à la main** : le nom d'affichage WhatsApp
déclaré à 360dialog et à Meta. Il est comparé au document déposé, et le dépôt
n'a aucun moyen de le mettre à jour.

## Non fait, et signalé

Un défaut **antérieur** à ce changement a été mesuré au passage, et il n'est
pas corrigé ici : `/contact` et `/confidentialite` provoquent un **défilement
horizontal en dessous de 414 px**. Deux causes distinctes, toutes deux sans
rapport avec la dénomination — les mesures sont identiques avant et après.

- `/contact` : la grille `.fiche__rang` vaut
  `minmax(8rem, 15rem) 1fr`. À 320 px, la colonne de gauche réclame 128 px, la
  gouttière 32 px, et la piste `1fr` ne descend pas sous son contenu minimum —
  or `support@horizonservices.store` ne se coupe pas.
- `/confidentialite` : le mot « Confidentialité » à `--t-mega`, dont la borne
  basse est de 3 rem, dépasse la largeur utile à 320 px et ne peut pas être
  renvoyé à la ligne.

Les corriger touche la grille des mentions légales et l'échelle typographique
du porche : c'est un lot en soi, pas un effet de bord d'un changement de nom.
