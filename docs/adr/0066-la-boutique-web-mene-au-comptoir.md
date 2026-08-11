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
