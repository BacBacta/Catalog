# 0050 — La ville cesse de mentir, et la vendeuse voit enfin où livrer

Date : 2026-08-08
Statut : accepté
Lot B (première moitié) du plan de l'audit — `docs/analyses/2026-08-07-audit-integral-du-bot.md`

## Contexte

`packages/contracts/src/delivery.ts:62` déclarait `city: z.enum(["Douala", "Yaounde"])`.

Trois conséquences, toutes mesurées :

1. **Une boutique à Bafoussam ne pouvait jamais vendre en livraison.** Ni à
   Bamenda, Garoua, Kribi, Buea, Limbé — ni à « Yaoundé » avec son accent.
2. **L'échec ne tombait pas là où on pouvait le corriger.** La ville était
   acceptée à l'inscription (2 à 80 caractères), stockée, puis injectée en
   silence dans la livraison de chaque acheteuse. Celle-ci faisait neuf tours,
   appuyait sur *Confirmer*, et lisait « Cette commande n'a pas pu être
   enregistrée ». Indéfiniment. Le mode *retrait* passait — le symptôme
   observable était donc « la livraison ne marche jamais, le retrait oui ».
3. **La ville enregistrée était fausse même quand elle passait.** Une boutique
   de Douala livrant à une acheteuse de Yaoundé enregistrait « Douala ».

Le porteur du produit a tranché trois points : étendre à toutes les villes du
Cameroun, valider à l'inscription, et cesser d'injecter la ville de la
boutique dans la livraison de l'acheteuse.

## Décision 1 — un prédicat, pas une liste

**Il n'y a pas de liste de villes dans ce dépôt, et c'est délibéré.**

Écrire « les 59 chefs-lieux » ne corrige rien : cela déplace le mur à la
soixantième ville. Et écrire cette liste sans source vérifiable serait
exactement ce qu'AGENTS.md §7.7 interdit — une ville oubliée exclut une
vendeuse du produit, en silence, sans que personne ne sache pourquoi. Une
première conception a d'ailleurs produit une liste dont la relecture a montré
qu'elle contenait au moins une ligne fausse.

Le vrai défaut n'était pas la longueur de l'énumération : **deux validateurs
gardaient la même valeur à deux moments différents, et celui qui refusait
s'exécutait chez quelqu'un d'autre, trois semaines plus tard.**

D'où `packages/contracts/src/villes.ts` : `villeAcceptable`, un prédicat, appelé
aux **trois** points — les deux portes d'écriture (le bot à l'inscription, la
route web) et la lecture (`deliverySchema`). Un test de propriété leur interdit
de diverger : il n'y a plus deux endroits à mettre d'accord.

`.refine`, jamais `.trim()` ni `.transform()` : `deliverySchema` relit du JSON
déjà stocké, et un schéma qui réécrit ce qu'il relit rend toute comparaison
ininterprétable.

Le fichier n'importe **rien**, pas même zod — même règle que `phone.ts` : une
fonction destinée au navigateur ne partage pas son module avec un schéma
(budget de 30 Ko de la boutique publique).

## Décision 2 — la ville de livraison vient de l'acheteuse

Un nouvel état `ville` entre `mode` et `details`, pour la livraison seulement.
**Le retrait n'en a pas** : le point de rendez-vous porte déjà le lieu, lui
ajouter une ville serait un tour de parole pour rien.

Un bouton — la ville de la boutique, cas majoritaire, une frappe — et toute
autre ville s'**écrit**. Pas de liste : le Cameroun ne tient pas en dix lignes,
et une liste incomplète exclurait une acheteuse sans lui dire pourquoi.

Coût : **un tour de parole**, sur les dix que compte le parcours. C'est le prix
d'une donnée vraie, et l'audit le rendra en trois ailleurs (lot D).

La ville apparaît désormais dans le récapitulatif — « Livraison à Bafoussam :
Banengo, en face du marché A ». Le récap est le seul garde-fou du produit ; une
valeur absurde y est vue avant l'appui sur *Confirmer*.

## Décision 3 — la vendeuse voit enfin où livrer

Découvert en instruisant la décision 2, et **plus grave que le défaut de
départ** : `corpsNouvelleCommande` ne portait que « Numéro à appeler pour la
remise ». Aucune ville, aucun quartier, aucun repère. Et l'app vendeuse déclare
`livraison: unknown` (`apps/seller/src/lib/api.ts:168`) sans aucun
consommateur.

Autrement dit : l'acheteuse saisissait un quartier et un repère — **tous deux
rendus obligatoires par AGENTS.md §2, précisément parce qu'il n'existe pas
d'adresse au Cameroun** — et aucune surface vendeuse ne les affichait. La
vendeuse devait appeler pour savoir où aller.

`destinationLisible` construit la ligne, et la notification la porte. Le
retrait aussi : un point de retrait convenu est un mode de livraison de plein
droit, pas un cas dégradé.

## Ce que le lot corrige aussi, parce qu'il le fallait

Un texte libre était lu comme un lien de boutique **avant** le switch d'états.
Mesuré pendant l'écriture des tests : une acheteuse qui écrit « Bafoussam »
dans l'état `ville` était renvoyée au catalogue — le mot ressemble à un slug
nu. C'est le même défaut que le repère « en face de la boutique Bata », que
l'audit avait relevé.

`texteEstDuContenu` ferme les quatre états où un texte libre est du contenu et
jamais de la navigation : `details`, `ville`, `recap`, `avis_mot`.

## Conséquences

- Une ville de la génération précédente : un état `details` de livraison
  **sans** ville retourne demander la ville, panier intact. On ne la devine
  pas.
- `QUARTIERS` devient `QUARTIERS_SUGGERES`, et son commentaire dit ce qu'il
  est : des exemples pour deux villes, de provenance non documentée, qui ne
  valident rien. Le type `City = keyof typeof QUARTIERS` est **retiré** : il
  affirmait qu'une ville est une clé de cette table, ce qui est faux.
  Aucun consommateur — il était mort.
- Aucune migration de schéma : `city` est déjà une colonne JSON libre côté
  base. Le changement est strictement **élargissant** — toute valeur acceptée
  hier l'est encore. Aucune commande en vol ne casse.
- 899 tests API, 117 contrats. 16 nouveaux, vus rouges avant d'être verts.

## Ce qui reste ouvert

- **Les boutiques existantes dont la ville est invalide.** Le schéma les
  accepte désormais toutes : il n'y a plus rien à rattraper pour vendre. Mais
  une ville absurde entrée avant ce lot (par exemple « boutique chez-amina »,
  conséquence de l'aiguillage que le lot C ferme) reste en base et sera
  affichée. Aucun écran ne permet encore de la corriger — lot G.
- **`apps/seller` ne lit toujours pas `livraison`.** La notification du fil
  suffit à livrer ; l'app vendeuse reste aveugle. C'est un écran à écrire.
