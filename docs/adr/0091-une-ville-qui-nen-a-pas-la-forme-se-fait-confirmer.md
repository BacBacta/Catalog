# ADR 0091 — une ville qui n'en a pas la forme se fait confirmer

Date : 13/08/2026
Statut : accepté
Révise : ADR 0051 (les mots du tunnel), sur la seule étape « ville »
Ne révise PAS : ADR 0050 — voir « ce qui n'a pas changé »

## Contexte — ce que le harnais a mesuré

À l'étape « ville de livraison », le harnais a joué une question à la place
d'une ville :

```
… → bouton « mode:livraison » → « est-ce que vous vendez des chaussures pour bébé ? »
   → quartier / repère / téléphone valides → « confirmer »
```

La commande **a été créée**, avec :

```json
{"city":"est-ce que vous vendez des chaussures pour bébé ?","mode":"livraison",
 "phone":"+237690112233","landmark":"en face de la pharmacie Bleue",
 "quartier":"Bonapriso"}
```

La vérification adverse a établi deux choses de plus. D'abord, **la valeur ne
dort pas en base** : elle part dans le gabarit Meta `catalog_nouvelle_commande_v2`
envoyé à la vendeuse (« Livraison : est-ce que vous vendez des chaussures pour
bébé ?, Bonapriso, … ») et dans le message de commande de l'acheteuse. Ensuite,
le comportement n'est pas propre à ce texte : `12345`, `?? ...`, une URL et
« c'est trop cher pour moi » passent tous. Le seul prédicat, `villeAcceptable`,
ne borne qu'une **longueur** — 2 à 80 caractères.

Un angle de vérification sur trois a **réfuté** le constat, et sa réfutation est
retenue : elle borne le remède. Voir la section suivante.

## Ce qui n'a PAS changé, et ne doit pas changer

**Il n'y a toujours aucune liste de villes, et il ne doit pas y en avoir.**
L'ADR 0050 l'a refusée pour une raison qui tient mot pour mot : une liste
« déplace le mur à la soixantième ville », et l'écrire sans source vérifiable
exclurait en silence une vendeuse de Foumbot. `villeAcceptable` reste le seul
prédicat d'acceptation, aux trois points d'écriture, avec son test de propriété.

**Le récapitulatif reste le garde-fou.** L'ADR 0050 le nomme ainsi, et il fait
son travail : la valeur y est visible avant l'appui sur *Confirmer*.

## Décision — regarder la forme, jamais le mot, et demander au lieu de refuser

Un second prédicat, `villeDouteuse`, vit à côté du premier dans
`packages/contracts/src/villes.ts`. Il ne juge **aucun mot** : il regarde quatre
formes, et rien d'autre.

| forme | ce qu'elle attrape |
|---|---|
| un point d'interrogation | la question posée au bot, avalée comme réponse |
| aucune lettre | `12345`, `?? ...` — une saisie qui a dérapé |
| une adresse web | un lien collé par erreur |
| plus de cinq mots | une phrase, jamais un toponyme |

Quand il est vrai, l'étape n'avance pas et le bot **répète la saisie** :

> Je note **est-ce que vous vendez des chaussures pour bébé ?** comme ville de
> livraison — c'est bien ça ?
>
> Si c'était une question, écrivez plutôt la ville, et posez-la ensuite à la
> vendeuse.
>
> `[ Oui, c'est la ville ]` `[ Non, corriger ]`

**« Oui » garde la saisie telle quelle.** C'est ce qui rend la mesure
compatible avec l'ADR 0050 : rien n'est fermé, personne n'est exclu, un lieu
nommé d'une façon inattendue s'écrit en un appui de plus. Un test de non-retour
tient explicitement ce côté-là de la bascule.

Le seuil de cinq mots est généreux à dessein : « Douala Bonaberi carrefour Total
Ndokoti » en fait cinq et passe sans question.

### Pourquoi cela révise l'ADR 0051

L'ADR 0051 pose que dans le tunnel d'achat, un texte libre est du **contenu**,
et ferme la détection de question à `accueil` et `catalogue`. La raison était
bonne — « Bonapriso, en face de la *boutique* Bata » est la façon camerounaise
de donner un repère, et le lire comme une navigation effaçait le panier.

Cette révision est **étroite et ne touche qu'une étape** : `ville`, où la saisie
n'est ni un repère ni une adresse, mais un nom de lieu court. `details` reste
intouché, et c'est là que vivait le vrai risque de l'ADR 0051.

### Le raisonnement qui a fait pencher, malgré la réfutation

Le récapitulatif affiche bien la valeur. Mais **un écho n'est pas un signal** :
l'acheteuse n'a pas mal orthographié une ville, elle a posé une question — et se
relire ne lui apprend pas que le bot l'a rangée comme destination. Sa question,
elle, n'a jamais reçu de réponse.

## Conséquences

- Un état `ville_doute` porte la saisie en attente. Il est au catalogue de
  couverture du harnais : ses vingt-deux gestes sont joués.
- Retaper une ville depuis cet état repasse par **la même porte**, donc par le
  même contrôle de forme. On ne devine jamais à la place de l'acheteuse.
- Le même contrôle profite à la vendeuse sans code supplémentaire : sa propre
  ville est relue dans la confirmation d'ouverture (ADR 0090).
- Textes en français, anglais et **wes** — le kamtok reste écrit et non servi
  (`PIDGIN_RELU = false`, ADR 0034). Ce lot ne touche pas ce drapeau.
