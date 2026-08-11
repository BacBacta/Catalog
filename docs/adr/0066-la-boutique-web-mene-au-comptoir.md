# 0066 — La boutique web mène au comptoir

Date : 2026-08-11
Statut : accepté
Applique : le rang 0 de l'ADR 0061 (« deux comptoirs, un moteur »)
Concerne : `domain/bot/entree-boutique.ts`, `domain/bot/conversation.ts`,
`apps/shop/src/lib/entree-bot.ts`, `apps/shop/src/pages/[slug]/[produit].astro`

## La fuite

`[produit].astro:42` construisait un lien vers
`wa.me/<numéro personnel de la vendeuse>`. Une acheteuse qui appuyait sur
« Commander » atterrissait dans une **conversation humaine** : aucune commande
créée, pas de rampe, pas de preuve, pas de reçu, pas de statistique. Tout ce
qui a été construit des lots 7 à 12 était invisible depuis cette porte.

C'est le constat qui a fondé l'ADR 0061, et son rang 0.

## Ce qui ne ferme pas

Le numéro de la vendeuse **reste sur la page**, sous « Parler à la vendeuse ».
« L'acheteuse et la vendeuse continuent de se parler sur WhatsApp » est un
invariant produit (AGENTS.md §1), pas une étape transitoire.

Ce qui change est le **rôle** : ce numéro porte désormais la relation, plus le
comptoir. Deux boutons, deux gestes distincts.

## Un seul texte, trois informations

```
boutique chez-ngo web robe-wax-a1b2c3
   │        │       │       │
   │        │       │       └── l'article : celui dont l'id finit par a1b2c3
   │        │       └────────── le canal : d'où elle arrive
   │        └────────────────── la boutique
   └─────────────────────────── le mot-clé, inchangé
```

**Il se lit comme une phrase, et c'est un critère de conception.** Ce texte est
pré-rempli dans un lien `wa.me` : l'acheteuse le voit dans son champ de saisie
avant de l'envoyer, et peut le modifier. Un cuid de vingt-cinq caractères la
ferait hésiter, ou effacer. D'où le slug d'article — le nom pour elle, les six
derniers caractères de l'identifiant pour nous.

**Il ne porte aucun secret.** Ce lien s'affiche dans une barre d'adresse, se
copie, se transfère : ni jeton acheteuse (ADR 0021), ni numéro.

## L'article ne se perd pas en route

C'était l'arbitrage du lot, et il a été tranché par le porteur : **le complet**.

Sans ce branchement, une acheteuse venue d'une fiche produit atterrissait sur
le **catalogue entier** et devait retrouver à la main l'article qu'elle venait
de choisir. Fermer une fuite de commandes en ouvrant une fuite de confort
aurait été un mauvais échange.

Le suffixe doit désigner **un** article, exactement. Zéro ou plusieurs : retour
à l'accueil de la boutique. On n'ouvre jamais « un » article au hasard parce
que le lien était abîmé — elle verrait un prix qui n'est pas celui qu'elle a vu.

## Le vocabulaire des canaux

`statut`, `chaine`, `carte`, `web`, `direct`. **Liste fermée** : sans elle, le
premier mot venu deviendrait une source de trafic, et les statistiques
diraient n'importe quoi avec aplomb.

Deux propriétés :

- **`direct` est un canal**, celui d'un lien partagé de la main à la main —
  pas un fourre-tout. Une entrée **sans** marque reste sans canal, et c'est
  une information différente.
- **Le canal ne change rien à ce que l'acheteuse voit.** Il se compte, il ne
  se raconte pas. Un test compare les messages avec et sans canal : ils sont
  identiques.

C'est ce vocabulaire qui donnera les sources de trafic que le lot 13 déclare
manquantes (`stats-instrumentation.test.ts`). La lecture côté statistiques
reste à faire ; le marquage est posé.

## Dormant par défaut

Sans `PUBLIC_BOT_WHATSAPP`, la page garde **exactement** le chemin d'avant :
un bouton `wa.me/` sans numéro ouvrirait WhatsApp sur rien. Même régime que le
reste (AGENTS.md §5).

Le numéro du bot n'est pas un secret — il est affiché sur la carte-vitrine et
sur tous les liens partagés —, d'où le préfixe `PUBLIC_`.

## Pourquoi la boutique ne partage pas le module du domaine

`entree-bot.ts` compose le texte, `domain/bot/entree-boutique.ts` le relit. Ce
sont **deux fichiers**, et c'est délibéré : le premier est chargé par le
navigateur, et un import depuis `@catalog/contracts` y ferait entrer les
schémas Zod — mesuré au lot 6, 20,6 Ko au lieu de 1,8.

Les deux formes sont donc tenues par des tests **des deux côtés**. Une
divergence casserait la lecture en silence : c'est le même risque que le
contrat des Flows, et il se traite de la même façon.

## Un faux vert trouvé au passage

`pnpm lint` rendait « zéro erreur » alors que Biome tronquait ses diagnostics
au plafond par défaut. Deux erreurs réelles étaient masquées, dont **un import
mort laissé par l'ADR 0060 le matin même**. Le script passe à
`--max-diagnostics=400` : une chaîne de vérification qui ment est pire qu'une
chaîne absente.

## Ce qui reste du rang 0

Le **canal n'est pas encore lu par les statistiques** : il est marqué à
l'entrée, il n'est pas encore compté. C'est la suite naturelle, et elle
suppose de décider où il se range — sur la conversation, ou sur la commande
(une colonne, donc une migration *expand*).

## Conséquences

- 20 tests neufs, dont celui qui compte : le canal ne change rien à ce que
  l'acheteuse voit.
- La fiche produit a deux boutons là où elle en avait un.
- `PUBLIC_BOT_WHATSAPP` à poser sur la construction de la boutique.

---

## Addendum du 11/08/2026 — le garde de la boutique ne gardait qu'une branche

`sortie-construite.test.ts` porte, depuis le lot 6, la promesse la plus concrète
du produit côté web : **si le JavaScript n'arrive jamais, l'acheteuse peut quand
même agir.** Il vérifiait qu'une page d'article émet un lien `wa.me` complet
dans le HTML.

Cet ADR a fait passer `[produit].astro` de une à **trois** branches — congés
(0039), comptoir (celui-ci), îlot rendu côté serveur — et le test n'en
connaissait qu'une. Il passait donc pour de mauvaises raisons :

- `PUBLIC_BOT_WHATSAPP` n'est posée nulle part dans la CI, donc la branche du
  comptoir **n'a jamais été construite** ;
- les données semées ne contiennent aucune boutique fermée, donc la branche
  congés non plus.

Le jour où la variable est posée en production — ce que cet ADR demande —, le
garde aurait cessé de garder ce qu'il décrit, **sans jamais rougir**. C'est le
même faux vert que le lint tronqué plus haut, à trois heures d'intervalle.

Ce qui a changé :

- le test suit les trois branches et exige de chacune ce qu'elle promet :
  le texte canonique pour l'îlot, la **phrase d'entrée avec son article** pour
  le comptoir, et pour une boutique fermée, aucun bouton de commande **mais**
  le lien vers la vendeuse — « la vendeuse reste joignable » (0039) est la
  moitié de cet ADR qu'un test doit tenir ;
- la répartition entre les trois est comptée et affirmée, pour qu'une branche
  jamais exercée se voie ;
- vérifié dans les deux sens : construction **avec** `PUBLIC_BOT_WHATSAPP`
  (la branche comptoir sort bien `boutique <slug> web <slug-article>`), puis
  altération délibérée du lien émis — le garde rougit.

L'identifiant `data-testid="commander"` **ne distingue pas** les branches :
l'îlot porte le même. Le discriminant est la présence du second lien, celui de
la vendeuse, que seule la page Astro émet.

## Addendum du 11/08/2026 — trois avis élevés, et la CI qui rougit pour eux

Le pas `Audit des dependances de production` a échoué sur cette branche, et
**échoue à l'identique sur `main`** (vérifié sur un clone propre de `0da8eee` :
3 élevés, 3 moyens, 1 faible). La dernière CI verte de `main` date du 02/08 ;
les trois avis — `fast-uri`, `js-yaml`, `nanoid` — ont été publiés depuis. Ils
sont transitifs, en une seule version dans l'arbre, et corrigés à l'intérieur du
même majeur. Les résolutions sont posées dans `pnpm-workspace.yaml`, à côté de
celles du lot 15 et pour la raison qu'elles énoncent : un audit ne vaut que
s'il est vide. Le plancher de `brace-expansion` est relevé au passage.
