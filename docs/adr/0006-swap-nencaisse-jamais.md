# 0006 — Swap n'encaisse jamais : les fonds vont d'un portefeuille à l'autre

- Statut : accepté
- Date : 2026-07-29
- Corrige la lecture réglementaire retenue en phase 0 du blueprint initial

## Contexte

Une première analyse traitait le communiqué du ministre des Finances du
5 mai 2025 comme un risque existentiel, au motif que le Règlement CEMAC 04/18
soumettrait à agrément tout acteur intervenant dans une chaîne de paiement,
y compris un prestataire technique ne détenant pas les fonds.

C'était une mauvaise lecture : elle confondait un régime de **statut** avec un
régime d'**activité**, en important un réflexe européen — le statut de
prestataire d'initiation de paiement au sens de la DSP2 — qui n'a pas
d'équivalent en zone CEMAC à ce jour.

Les faits :

- L'agrément d'« établissement de paiement » est détenu par celui qui **opère
  le réseau, détient les fonds et gère le moyen de paiement**. Orange Money
  Cameroun S.A. l'a obtenu par arrêté n° 00000373/MINFI du 5 mai 2022 ;
  Mobile Money Corporation l'a obtenu pour MTN.
- Swap **utilise** ces réseaux et n'en crée aucun.
- Utiliser un service de paiement n'est pas en fournir un : sinon toute
  boutique en ligne camerounaise acceptant MoMo serait en infraction.
- La cible réelle du communiqué, telle qu'elle ressort de la couverture de
  presse, ce sont les plateformes de prêt en ligne et de collecte de fonds.

## Décision

**Les fonds ne transitent jamais par un compte contrôlé par Swap.** Ils vont du
portefeuille de l'acheteuse vers celui de la vendeuse. Swap initie l'ordre et
lit le statut — rien d'autre.

La vendeuse est **bénéficiaire en son propre nom** : son wallet ou son code
marchand, jamais un sous-compte de Swap.

## Conséquences

1. **Aucune commission n'est prélevable sur le flux de paiement**, puisqu'on ne
   le détient jamais. Le revenu vient de l'abonnement. Ce qui était déjà une
   nécessité concurrentielle — le dépôt MoMo direct est gratuit — devient une
   conséquence structurelle de l'architecture.
2. **La question du compte bénéficiaire d'une vendeuse informelle** (sans
   registre de commerce ni numéro de contribuable) est un problème
   d'**onboarding produit**, à résoudre avec l'agrégateur. Ce n'est pas un
   problème réglementaire pour Swap.
3. **Interdit absolu** : encaisser sur un compte marchand contrôlé par Swap,
   même temporairement, même pour dépanner une vendeuse non formalisée. C'est
   le seul geste qui ferait basculer le produit dans le champ de l'agrément.
4. La phase 0 cesse d'être une porte pouvant arrêter le projet et redevient un
   onboarding commercial.

## À revoir si

Le modèle évolue vers la détention de fonds — séquestre, protection acheteur
avec retenue, avance sur recettes, portefeuille interne. Chacune de ces
fonctionnalités rouvrirait la question et exigerait un nouvel ADR ainsi qu'un
conseil juridique camerounais.
