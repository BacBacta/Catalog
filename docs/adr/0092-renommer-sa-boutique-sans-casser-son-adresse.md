# ADR 0092 — renommer sa boutique sans casser son adresse

Date : 13/08/2026
Statut : accepté
Complète : ADR 0090 (la boutique se relit avant de s'ouvrir)

## Contexte

L'ADR 0090 pose la relecture avant ouverture. Elle **empêche** le défaut
d'arriver ; elle ne répare rien pour les boutiques déjà ouvertes.

Or la vérification adverse du constat C-002 a établi un fait qui ne dépend
d'aucune saisie malheureuse : **aucun chemin de renommage n'existait dans tout
le produit.** Le menu du bot n'offre que article / carte / ma boutique /
soldes / congés ; l'app vendeuse ne connaît que `creerProfil`, qui est
idempotente et refuse d'écraser. Une vendeuse qui change simplement le nom de son
commerce — cas ordinaire, sans aucun défaut en amont — n'avait aucun recours.

## Décision

Une route `POST /api/vendeuse/renommer` et une carte « Nom de la boutique » dans
les réglages. Le nom et la ville se corrigent ; l'écriture et la ligne de
journal d'audit voyagent dans **une transaction**, sur le patron exact de la
bascule des congés.

### Le slug ne bouge pas — c'est le point délicat

C'est la question que l'ADR 0090 laissait ouverte, et elle est tranchée dans le
sens de la stabilité.

L'adresse publique a peut-être **déjà été partagée** : en Statut WhatsApp, dans
une chaîne, dans le QR d'une carte-vitrine imprimée, dans une conversation
privée. La changer avec le nom casserait ces liens, et l'ADR 0073 dit exactement
ce que ça coûte :

> « Un lien de Statut qui mène à une page 404 ne se voit ni en CI, ni chez la
> vendeuse. Il se voit chez l'acheteuse, une fois, et elle ne revient pas. »

Le renommage change donc ce que les gens **lisent**, jamais où ils **arrivent**.
Un test de non-retour tient ce point : c'est le plus important des cinq, parce
qu'une régression y serait invisible partout ailleurs.

**L'écran le dit en toutes lettres** plutôt que de le laisser deviner :

> Votre adresse en ligne ne change pas : elle reste **/chez-amina**. C'est
> voulu — vous l'avez peut-être déjà partagée en Statut ou sur une affiche, et
> un lien cassé mène vos clientes sur une page vide.

### Les mêmes bornes qu'à la création

Le nom tient entre 2 et 80 caractères, la ville passe par `villeAcceptable` —
le prédicat unique de l'ADR 0050. Deux portes qui écrivent le même champ ne
peuvent pas diverger sur ce qu'elles acceptent ; c'est la leçon que ce dépôt a
déjà payée une fois, quand une ville de 4 000 caractères entrait par une porte
et faisait échouer la commande d'une acheteuse par une autre.

### Renommer sans rien changer n'entre pas au journal

Même règle que la bascule des congés : une écriture sans changement ne
journalise rien, sinon le journal cesse de répondre à « quand ? ».

## Ce qui n'est PAS fait, et pourquoi

- **Le renommage n'est pas dans le bot.** L'ADR 0088 vient de dégraisser le
  menu vendeuse, et un geste rare n'a pas sa place dans un fil où le pouce
  cherche une action. Il vit là où vivent les réglages.
- **Les boutiques déjà ouvertes avec un slug malheureux gardent leur adresse.**
  Le renommage corrige leur nom, pas leur URL. Changer un slug existant est une
  opération à part — elle demande de décider ce qu'on fait des liens déjà
  partagés, et probablement une redirection. Personne ne l'a demandée ; c'est
  signalé, pas comblé (AGENTS.md §7.7).
- **Aucun OTP.** Rien ne bouge d'argent et le geste se défait, exactement comme
  les congés. Le numéro de reversement, lui, garde le sien — c'est le champ
  qu'un attaquant chercherait à détourner.
