# 0007 — Le paiement passe par un agrégateur agréé, en modèle sous-marchand

- Statut : accepté
- Date : 2026-07-29
- Complète l'ADR 0006 (Swap n'encaisse jamais)

## Contexte

Trois architectures étaient envisageables pour encaisser un paiement.

**USSD pré-rempli.** Swap génère l'instruction, l'acheteuse l'exécute elle-même,
les fonds vont directement au portefeuille de la vendeuse. Aucun intermédiaire
ajouté — mais **aucune observabilité** : Swap ne peut pas constater le paiement.
Donc pas de reçu à code, pas d'avis vérifié. C'est le comportement actuel du
marché, avec sa capture d'écran falsifiable. Rejeté : cela revient à supprimer
la valeur numéro un du produit.

**Paiement marchand direct.** L'acheteuse paie le code marchand de la vendeuse.
Direct et notifié — mais exige que chaque vendeuse dispose d'un code marchand,
donc d'un registre de commerce et d'un numéro de contribuable. Rejeté comme
architecture de base : cela replace la formalisation sur le chemin critique de
l'inscription. Conservé comme **option d'évolution** pour les vendeuses
formalisées, chez qui il est moins cher (paiement marchand à 0 F chez Orange).

**Agrégateur agréé.** Retenu.

### Le fait technique qui ferme le débat

L'API MTN MoMo `requestToPay` ne comporte **aucun champ de bénéficiaire tiers** :
on désigne le payeur, et le destinataire est le détenteur des clés API. Orange
Money Web Payment fonctionne de même avec son code marchand. Aucune API
camerounaise ne permet aujourd'hui à une application d'initier un virement du
portefeuille A vers le portefeuille B sans être elle-même destinataire — c'est
la définition d'un service d'initiation de paiement, statut qui n'existe pas
encore en zone CEMAC.

Corollaire à ne pas perdre de vue : **ce qui rend le reçu vérifiable possible,
c'est qu'un tiers agréé se trouve dans le flux et peut en témoigner.** Supprimer
tout intermédiaire, c'est supprimer le témoin.

## Décision

Le paiement passe par un agrégateur agréé, **en modèle sous-marchand** :

```
  Acheteuse                Agrégateur agréé              Vendeuse
  (wallet MoMo/OM)         (établissement agréé)         (wallet de son choix)
        │                          │                            │
        │  1. Swap demande         │                            │
        │     un paiement ─────────▶                            │
        │                          │                            │
        │  2. push / USSD          │                            │
        ◀──────────────────────────┤                            │
        │  3. saisie du code       │                            │
        │     secret ──────────────▶                            │
        │                          │                            │
        │                    4. encaissement                    │
        │                          │                            │
        │                    5. webhook ──▶ Swap                 │
        │                       (Swap re-verifie le statut)     │
        │                          │                            │
        │                    6. reversement instantané ─────────▶
        │                          │                            │

  Swap n'apparaît jamais dans le flux de fonds.
  Il émet un ordre, lit un statut, écrit un reçu.
```

### La distinction qui décide de tout

| | Sous-marchand — **à exiger** | Compte marchand unique — **à refuser** |
|---|---|---|
| Bénéficiaire enregistré | la vendeuse, avec son propre numéro | Swap |
| Où atterrissent les fonds | compte de l'agrégateur, puis wallet de la vendeuse | solde de Swap, puis wallet de la vendeuse |
| Swap détient-il des fonds ? | **jamais** | oui, avec un flottant |
| Nature de l'activité de Swap | intégrateur technique | transmission de fonds |

L'API peut sembler identique dans les deux cas : la différence est
**contractuelle et dans le KYC**. Le modèle par défaut proposé commercialement
est souvent le second, parce qu'il est plus simple pour l'agrégateur. Il faut
donc poser la question explicitement et obtenir la réponse par écrit.

## Conséquences

1. **Aucun compte de solde au nom de Swap** chez l'agrégateur. S'il en existe
   un techniquement, il doit rester à zéro et ne jamais servir de transit.
2. **Reversement instantané exigé**, pas en lot quotidien. Une vendeuse qui
   attend le lendemain pour voir son argent retourne au dépôt direct — et la
   durée de stationnement des fonds chez l'agrégateur est aussi la mesure de
   l'exposition au risque de contrepartie.
3. **Le numéro de reversement est un champ distinct du numéro de connexion**,
   vérifié par son propre OTP, et toute modification exige une nouvelle
   vérification. La double SIM est la norme : une vendeuse se connecte avec sa
   puce MTN et veut être payée sur son Orange Money. C'est aussi le champ qu'un
   attaquant chercherait à détourner.
4. **Deux agrégateurs intégrés dès que possible**, derrière l'interface
   `PaymentProvider`. Un seul prestataire est un point unique de défaillance à
   la fois technique et commercial.
5. **Le coût devient le sujet de négociation numéro un** — voir ci-dessous.

## Le calcul qui doit guider la négociation

Panier moyen visé : 11 200 FCFA.

| Chemin | Coût pour le circuit |
|---|---|
| Dépôt MoMo direct (l'alternative existante) | transfert 0,5 % + taxe 0,2 % ≈ **78 F** |
| Via agrégateur à 2,5 % | ≈ **280 F** |
| Paiement marchand Orange, vendeuse formalisée | **0 F** |

Passer par Swap coûte donc environ **3,5 fois** l'alternative que vendeuse et
acheteuse pratiquent déjà. Deux conséquences opérationnelles : négocier des
paliers de volume dès le premier contrat, et accepter que la valeur perçue du
reçu vérifiable et des avis doive dépasser ~200 F par transaction — c'est
précisément ce que le pilote doit mesurer.

## À revoir si

- Le statut d'« initiateur de paiement » de la réforme CEMAC entre en vigueur :
  il ouvrirait une voie plus directe et probablement moins chère.
- Une part significative des vendeuses se formalise : le paiement marchand
  direct devient alors moins cher et plus simple pour elles.
- L'agrégateur retenu se révèle incapable de garantir un reversement instantané
  ou un enregistrement en sous-marchand.
