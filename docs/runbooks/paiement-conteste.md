# Paiement contesté

> Une vendeuse et une acheteuse ne disent pas la même chose. C'est le seul
> incident de cette liste qui met deux personnes en face, et **le rôle de
> Catalog n'est pas d'arbitrer** : c'est de rendre le paiement vérifiable, puis
> de dire ce que le système sait et ce qu'il ne sait pas.

## Ce que Catalog peut et ne peut pas

**Ne peut pas :** rembourser, annuler un transfert, geler des fonds, obliger qui
que ce soit. Les fonds ne transitent par aucun compte que nous contrôlons — ils
sont allés du portefeuille de l'acheteuse à celui de la vendeuse, en dépôt
direct. Il n'y a rien à reprendre.

**Peut :** dire si un identifiant de transaction a été enregistré, par qui,
quand, sur quelle commande, avec quel verdict — et si l'acheteuse a
contre-signé. C'est ce qui distingue ce produit d'une conversation WhatsApp.

Le fait de le dire clairement, dès le premier message, désamorce la plupart des
litiges : les deux parties cherchent souvent un arbitre, et découvrir qu'il n'y
en a pas les ramène à l'opérateur, qui est la bonne adresse.

## Symptômes

Trois cas, à ne pas confondre :

| Ce qui est dit | Cas réel | Section |
|---|---|---|
| « J'ai payé, elle dit que non » | L'acheteuse a payé quelqu'un d'autre, ou la vendeuse n'a pas collé son SMS | A |
| « Elle dit avoir payé, je n'ai rien reçu » | Fausse capture d'écran — l'arnaque la plus courante du marché | B |
| « J'ai été débitée deux fois » | Double composition côté opérateur | C |

## Diagnostic

**1. La commande, par sa référence.**

```sql
SELECT id, ref, proof_state, step, total_xaf, amount_paid_xaf, balance_xaf,
       created_at, delivered_at, cancelled_at
FROM "order" WHERE ref = 'CT-XXXX';
```

**2. Les preuves apportées.** `payment_proof` est en **ajout seul** : rien n'y a
été modifié ni effacé, jamais.

```sql
SELECT operator, operator_tx_id, amount_xaf, occurred_at, verdict,
       pattern_id, pattern_a_confirmer, checks
FROM payment_proof WHERE order_id = '<id>' ORDER BY id;
```

**Ne jamais déchiffrer `raw_sms` pour un litige.** Il porte le solde de la
vendeuse. Tout ce dont l'arbitrage a besoin — identifiant, montant, date,
contrepartie, verdict — est déjà dans les colonnes en clair.

**3. Le journal de la commande.** En ajout seul lui aussi, et c'est lui qui porte
la chronologie, contre-signature comprise (la colonne `countersigned_at` est
morte, voir l'ADR 0021).

```sql
SELECT kind, actor, at, payload FROM order_event
WHERE order_id = '<id>' ORDER BY at;
```

**4. L'identifiant a-t-il servi ailleurs ?** Le contrôle n° 5 est réseau-large.

```sql
SELECT order_id, verdict, occurred_at FROM payment_proof
WHERE operator = 'mtn' AND operator_tx_id = '<identifiant>';
```

Un identifiant présent sur **une autre commande** est le cas le plus révélateur
de tous : quelqu'un a réutilisé une preuve.

## Actions

### Cas A — l'acheteuse dit avoir payé

1. Lui demander **son** identifiant de transaction, lu dans son propre SMS
   d'émission.
2. Le chercher en base (requête 4).
   - **Trouvé sur cette commande** → le paiement est enregistré. Le litige est
     un malentendu : envoyer le lien du reçu, `/v/?c=<code>`.
   - **Trouvé sur une autre commande** → la preuve a servi ailleurs. Ne pas
     accuser : demander aux deux parties de vérifier leur historique opérateur.
   - **Introuvable** → le paiement n'a jamais été apporté à Catalog. Deux
     sous-cas : la vendeuse n'a pas collé son SMS (lui demander de le faire, la
     commande passera en `prouve`), ou l'argent est parti vers un autre numéro.

3. **Rappeler la règle** : seul le SMS reçu par la vendeuse fait autorité. Celui
   de l'acheteuse est une corroboration — il porte le même identifiant, ce qui
   permet le recoupement, mais il ne peut pas à lui seul faire passer une
   commande en « prouvé ».

### Cas B — la vendeuse n'a rien reçu

C'est la fraude dominante du marché, et Catalog la neutralise par construction :
la personne qui apporte la preuve est celle dont l'argent est en jeu.

1. Vérifier `proof_state`. S'il est `attendu`, **aucune preuve n'a été
   apportée** : la capture d'écran que l'acheteuse a envoyée sur WhatsApp n'est
   pas une preuve et n'en a jamais été une.
2. Le dire à la vendeuse en ces termes : **une capture d'écran ne porte aucun
   identifiant contrôlable.** Ne pas expédier.
3. Si l'acheteuse insiste, lui demander son identifiant de transaction et le
   chercher (requête 4). Une transaction réelle est retrouvable chez
   l'opérateur ; une capture truquée n'a pas d'identifiant qui tienne.

### Cas C — double débit

Catalog n'y peut rien, et c'est important de le dire vite plutôt que de laisser
espérer.

1. Vérifier s'il y a **deux preuves** avec deux identifiants distincts sur la
   même commande (requête 2). Si oui, le double débit est réel côté opérateur.
2. Orienter vers le service client de l'opérateur, avec les deux identifiants.
   C'est lui qui détient les fonds et lui seul qui peut rembourser.
3. Côté commande : `amount_paid_xaf` peut dépasser le total. L'invariant
   `amount_paid + balance = total` est garanti par une contrainte de base — le
   trop-perçu apparaît en `aRendreXaf` sur la déclaration de paiement, et se
   règle entre les deux personnes.

### Marquer la contestation

Si le litige reste ouvert, faire passer la commande en `conteste` par le lien de
suivi de l'acheteuse. Cet état **n'efface rien** : il enregistre qu'une partie
dément, et il retire le droit à l'avis vérifié.

Un paiement **ne recule jamais** : une transition arrière est journalisée puis
ignorée. C'est visible dans `order_event` avec `kind` de refus.

## Critère de sortie

- [ ] Les deux parties ont reçu **la même** information : ce que le système
      enregistre, et ce qu'il n'enregistre pas.
- [ ] L'état de la commande reflète la situation — `prouve` si la preuve est
      arrivée, `conteste` si le désaccord persiste, inchangé sinon.
- [ ] Si un identifiant a servi deux fois, les deux commandes concernées sont
      identifiées et notées.
- [ ] Aucun `raw_sms` n'a été déchiffré.
- [ ] Si le litige est réglé par la contre-signature, `order_event` en porte la
      trace.

## Ce qu'il ne faut pas faire

- **Arbitrer.** Catalog constate, il ne tranche pas. Se poser en arbitre crée
  une attente qu'aucune architecture ne peut tenir — nous ne détenons pas les
  fonds.
- **Accepter une capture d'écran** comme entrée d'un contrôle, même « juste pour
  débloquer ». C'est un interdit d'AGENTS.md, et c'est la porte de la fraude.
- **Rejeter un paiement au seul motif que le numéro émetteur diffère.** Double
  SIM et paiement depuis le téléphone d'un proche sont la norme : un numéro qui
  ne correspond pas est un avertissement, jamais un rejet.
- **Modifier `payment_proof`.** La table est en ajout seul et un déclencheur de
  base refuse l'`UPDATE`. C'est ce qui donne sa valeur à ce qu'elle contient.
