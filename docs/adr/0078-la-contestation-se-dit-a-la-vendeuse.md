# 0078 — La contestation se dit à la vendeuse, et la remise cesse d'attendre

- **Statut** : accepté
- **Date** : 12/08/2026
- **Étend** : la liste fermée de gabarits de l'ADR 0054, d'une entrée.
- **Même famille que** : l'ADR 0060, en plus petit et en plus grave.

## Deux gabarits qui existaient sans jamais partir

L'ADR 0060 avait trouvé des relances qui n'empruntaient pas la porte. Deux
autres messages avaient le même défaut, et personne ne les avait comptés.

### `commande_livree` — approuvé, payé, jamais appelé

`notifierLivree` passait bien par `notifier()`, mais sans son cinquième
argument. Hors des 24 h, la notification partait donc en file d'attente et
attendait que **l'acheteuse réécrive d'elle-même** — ce qu'elle n'a aucune
raison de faire : c'est la vendeuse qui vient de livrer.

Ce n'est pas un retard, c'est une perte. **L'avis vérifié se dépose depuis ce
message-là.** Une invitation à noter remise trois jours plus tard, quand la
commande n'est plus dans l'esprit de personne, n'est plus une invitation.

Le gabarit était déposé, approuvé, et déjà payé. Il ne manquait qu'un argument.

### `paiement_conteste` — le trou qui retournait la valeur n° 1 contre elle

La contre-signature (ADR 0036) donne à l'acheteuse un bouton « ce n'est pas
moi ». Il **gèle la commande**. La vendeuse ne l'apprenait qu'à sa prochaine
visite dans le fil : entre-temps elle préparait, livrait, relançait une
commande déjà arrêtée.

Une contestation découverte trois jours plus tard n'est plus un désaccord,
c'est un litige. C'était le seul endroit du produit où la **preuve opposable**,
qui en est la valeur n° 1, se retournait contre celle qu'elle est censée
protéger.

## La décision

**On ajoute une entrée à la liste fermée**, et il faut dire pourquoi c'est
légitime : la liste est fermée parce qu'un gabarit ne doit se déclencher que
sur un événement qui a déjà de la valeur. Une contestation en a — beaucoup, et
négative. C'est exactement le genre d'événement pour lequel ouvrir une fenêtre
facturée se défend, et il est même plus défendable que « nouvelle commande » :
une commande ratée coûte une vente, un litige coûte une vendeuse.

Le nom est `catalog_paiement_conteste`, **sans suffixe**. Celui des cinq autres
est le prix de la manœuvre ratée du 08/08, pas une marque de version — le
module l'écrit noir sur blanc, et un gabarit neuf qui l'aurait porté aurait
menti sur son histoire.

## Les deux chemins, pas un

Il existe **deux** chemins de contestation, et n'en brancher qu'un laisserait
le défaut entier pour l'autre moitié des acheteuses :

1. le bouton « ce n'est pas moi » du fil WhatsApp (`bot.ts`) ;
2. `POST /api/suivi/:jeton/contester`, ouvert depuis le lien de suivi web.

Le second passe par `apresContestation`, une dépendance **optionnelle** de
`suiviRoutes` — sans bot monté, le suivi web reste entier. Une notification
n'est jamais le chemin critique.

Elle est appelée **après** la transaction et ne peut pas faire échouer la
réponse : la contestation est enregistrée, c'est ce qui compte pour
l'acheteuse. Lui rendre une erreur sur un geste qui a réussi serait mentir dans
l'autre sens.

## Deux choix de forme à ne pas défaire

**Aucun bouton sur la notification de contestation.** Un litige ne se tranche
pas d'un tap. Le message ouvre la conversation, il ne propose pas de la clore.

**Le fil vendeuse est en français** (ADR 0033). La langue de l'acheteuse ne
commande pas celle de la vendeuse, et c'est bien la sienne qu'il faut ici.

Le corps dit aussi que **la preuve n'est pas effacée** — elle reste au dossier
(ADR 0021, `payment_proof` est en ajout seul). Sans cette phrase, une vendeuse
pouvait croire qu'une contestation supprime ce qu'elle a prouvé.

## Un défaut trouvé en chemin, et corrigé

Le module `bot-notifications.ts` pose sa règle en tête : « le `to` de l'API est
un wa_id — la clé de conversation, **sans son `+`** ». Le chemin texte la
suivait, via `versWhatsapp()`. **Le chemin gabarit ne la suivait pas** : tout
gabarit partait avec un `+` que les messages ordinaires n'avaient pas.

Meta tolère les deux formes, donc rien n'était cassé. Mais un code qui n'obéit
qu'à moitié à sa propre règle est un code dont on ne sait plus laquelle des
deux formes fait foi — et c'est ce qu'on découvre au mauvais moment. Corrigé.

## Le code de vérification cesse d'être haché — trouvé par la CI

Le premier passage de CI a échoué là où le local passait :
`order_verification_code_key`, sur `RYEC-6XVX`.

Les fichiers de tests se recopient un `codeDeTest(graine)` qui **hache** sa
graine — `n * 31 + 17` modulo 1 000 003. Le bloc par fichier (ADR 0077)
partitionne les **nombres** ; il ne partitionne pas ce qu'un hachage en fait.
Pire : les nombres du schéma récent dépassent 1 000 003, donc ils **retombent
dans la plage des autres fichiers**. Deux graines séparées par construction
produisaient le même code, et `verification_code` est `UNIQUE` sur une base
qu'on ne purge jamais.

`identifiants()` rend désormais le code lui-même, par un **changement de base
sur l'alphabet non ambigu** — pas par un hachage. L'encodage est injectif :
deux appels ne peuvent pas rendre le même code, et quatre tests le démontrent
au lieu de l'espérer (forme, injectivité, deux fichiers, deux exécutions).
25^8 vaut 1,5 × 10^11 ; la place ne manque pas.

**Les treize autres fichiers gardent leur `codeDeTest` local**, et le risque y
subsiste — faible, mais réel et de la même famille. Les migrer est un lot à
part : le faire ici aurait noyé deux correctifs de notification sous une
réécriture de fixtures.

## Un test assoupli, parce qu'il disait plus que la règle

`gabarits.test.ts` exigeait que **tout** nom finisse par `_v2`. Cette assertion
confondait l'accident avec la convention : elle aurait forcé chaque gabarit
futur à porter la trace d'un incident du 08/08 qui ne le concerne pas.

Elle est remplacée par la règle réelle, et par une table explicite : **aucun
gabarit ne reprend un nom brûlé**, et les cinq redéposés gardent le suffixe qui
les a débloqués.

## Vérification

Le critère de #44 était de voir le test **rouge avant le correctif**. Il l'a
été : le cinquième argument retiré, les deux tests de la remise échouent —
aucun gabarit ne part. Remis, ils passent.

Sept tests contre une vraie base, avec un envoyeur qui refuse tout hors gabarit
comme Meta le fait hors fenêtre (131047) : les deux gabarits partent, celui de
la contestation va bien à la **vendeuse** et non à l'acheteuse qui vient de
cliquer, la route web notifie elle aussi, et un envoi qui échoue de bout en
bout met en file au lieu de perdre.

## Ce qui reste ouvert

**Le dépôt chez Meta.** `catalog_paiement_conteste` est écrit, testé et
branché ; il n'est pas encore soumis. Tant qu'il ne l'est pas, le comportement
hors fenêtre est exactement celui d'avant — la notification attend en file,
elle ne se perd pas. Le dépôt est un acte sortant et durable, et une série de
refus abîme la note de qualité du numéro : il ne part pas tout seul.
