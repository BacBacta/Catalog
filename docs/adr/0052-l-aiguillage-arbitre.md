# 0052 — L'aiguillage arbitre au lieu d'avaler

Date : 2026-08-08
Statut : accepté
Lot C du plan de l'audit — `docs/analyses/2026-08-07-audit-integral-du-bot.md` §2

## Contexte

C'est le défaut qui a produit la toute première capture d'écran de la mise en
service, et le dernier bloquant de structure du bot.

`aiguillage.ts`, règle 1 :

```ts
/* 1. Une inscription commencee se termine. Rien ne la detourne — sinon un
   nom de boutique qui ressemble a un slug renverrait la personne au
   catalogue au milieu de son inscription. */
if (ctx.etatVendeuseEnCours) return "inscription";
```

La raison est **bonne** : un nom de boutique qui ressemble à un slug ne doit
pas éjecter la vendeuse au milieu de son inscription. Mais la règle est
**absolue**, et elle avalait donc tout, pendant les 24 h d'un formulaire :

| Geste | Ce qu'il devenait |
|---|---|
| `boutique chez-amina` | « Je n'ai pas compris le prix. » |
| un **SMS d'opérateur** collé | un nom d'article, ou un prix |
| `livree CT-522801` | un article publié à **522 801 F** |

Le deuxième est le plus grave : le SMS reçu par la vendeuse est **la valeur
n° 1 du produit** (AGENTS.md §2), le seul signal de paiement qui existe. Le
troisième vient de ce que `lirePrix` colle tous les chiffres du message.

L'ADR 0048 a traité la **durée** (un état oublié périme au bout de 24 h).
L'ADR 0049 a traité les formes non lues. Restait la **portée** : quels gestes
doivent traverser un formulaire en cours.

## Décision 1 — les gestes non ambigus traversent, et rien n'est perdu

Deux gestes passent **avant** la règle 1, parce qu'aucun n'est une réponse
plausible à « quel est le nom de l'article ? » ou « son prix, en francs ? » :

- **un SMS d'opérateur reconnu** → fil vendeuse ;
- **`livree CT-XXXXXX`** → fil vendeuse.

Le formulaire n'est pas détruit pour autant : l'état vendeuse reste en base, et
la question se repose après le verdict.

`demandeRemise` quitte `reagirVendeuse` pour devenir une fonction exportée :
l'aiguillage en a besoin, et un motif recopié à deux endroits diverge un jour.

## Décision 2 — le lien de boutique s'ARBITRE, il ne se tranche pas

Un lien de boutique reste routé vers le fil inscription. Ce n'est pas un
oubli : **seule la machine sait ce qui est en cours**, et peut donc poser la
question au lieu de choisir à la place de la personne.

Elle ne l'avale plus (« Je n'ai pas compris le prix ») et ne le jette pas non
plus. Elle met le formulaire **de côté** et demande :

> Vous étiez en train d'ajouter *Pagne wax 6 yards*.
>
> On finit ça, ou on va voir la boutique *chez-amina* ?
>
> `[Finir]` `[Voir la boutique]`

La question **nomme le travail en cours** — sans quoi « on finit ça ? » ne veut
rien dire pour quelqu'un qu'une cliente a interrompu dix minutes plus tôt.

Rien n'est perdu d'un côté comme de l'autre : « Finir » reprend exactement où
on en était, « Voir la boutique » libère le fil et **rejoue** le geste mis de
côté. Sans ce rejeu, la personne aurait appuyé sur un bouton pour ne rien
recevoir.

En pause, tout autre message re-pose la question. `annuler` sort, comme
partout.

## Le défaut trouvé avant qu'il n'arrive

`normaliserEtatVendeuse` ne relisait pas `enPause`. La question d'arbitrage
serait partie, l'état aurait été sauvé **sans** la pause, et le message suivant
aurait ré-arbitré — indéfiniment.

Ce défaut n'apparaît qu'en production, parce qu'il exige un aller-retour par le
stockage : la machine seule, en mémoire, ne le montre jamais. Un test le tient
maintenant, sur les six états, par `JSON.parse(JSON.stringify(...))` — le
trajet réel d'une colonne JSON.

## Ce que ce lot ne fait PAS

- **`extraireSlugBoutique` garde son motif non ancré.** La garde par état de
  l'ADR 0050 (`texteEstDuContenu`) ferme les cas mesurés côté acheteuse, et
  l'arbitrage ferme le côté vendeuse. Ancrer le motif en plus serait une
  ceinture sur des bretelles, au risque de casser `salut, boutique chez-amina`
  dont aucun producteur n'existe dans le dépôt mais qu'un humain peut écrire.
- **Une photo pendant un formulaire d'article n'arbitre pas.** Elle est déjà
  traitée par la machine, qui sait la lire — c'est le geste du terrain
  (ADR 0035), pas une interruption.

## Conséquences

- 13 tests, vus rouges avant d'être verts. 922 tests API au total.
- `EtatVendeuse` gagne un champ optionnel `enPause` sur ses six membres, et
  `EffetVendeuse` un `aller_boutique` que le service exécute en rejouant
  `boutique <slug>` dans le fil acheteuse.
- La règle 1 garde sa raison d'être et son commentaire : elle n'est plus
  absolue, elle est **précédée**.
