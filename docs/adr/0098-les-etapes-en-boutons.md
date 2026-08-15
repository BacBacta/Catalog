# 0098 — Les étapes en boutons, et l'absence restituée en une carte

Date : 2026-08-15
Statut : accepté
Lot : P4 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095 (décision d).
Complète : 0035 (« livrée CT-… »), 0040 (idempotence), 0054 (gabarits),
0061 (un seul moteur), 0086 (le fil ne noie pas).

## Contexte

Le fil vendeuse ne connaît qu'une étape : « livrée CT-… » tapé. Les étapes
intermédiaires — préparée, chez le livreur — vivent dans l'app, et la
notification de commande renvoie vers elle. Et une vendeuse qui rouvre sa
fenêtre après une soirée chargée reçoit ses notifications une à une : trois
commandes, trois messages — le mur que l'ADR 0086 a nommé.

## Décision 1 — la notification porte les gestes, le moteur reste unique

`corpsNouvelleCommande` garde sa copie ; la notification devient une carte à
boutons : « 🧺 Marquer préparée » et « Écrire à la cliente ». Les boutons
sont PERSISTÉS avec la notification (le mécanisme de l'ADR 0036) : remis en
attente, ils reviennent intacts à la réouverture de la fenêtre.

Le bouton appelle **la même transition que l'app** — `avancerEtape` de
`domain/order/cycle.ts` — avec les mêmes refus, journalisés dans la même
transaction (`etape_avancee` / `etape_refusee`, canal `bot_whatsapp`). C'est
la décision P0-d, et elle n'était pas révisable : un seul moteur (ADR 0061).
« livrée CT-… » tapé reste, et reste annoncé — le bouton n'est qu'un
raccourci contextuel.

Deux écarts de copie à la maquette, tous deux dits :

- le bouton dit « Écrire à la cliente », pas « 💬 Écrire à Marie » : le nom
  de l'acheteuse du fil ne se re-projette jamais (règle existante de
  `corpsNouvelleCommande`), et le titre d'un bouton est borné à 20
  caractères ;
- un bouton de réponse WhatsApp ne porte pas de lien : le tap répond avec le
  `wa.me` du numéro de livraison — en texte, pas en `cta_url`, dont
  l'affichage réel n'a pas encore été constaté (réserve de l'ADR 0087).

## Décision 2 — le bouton suivant suit l'étape, et l'argent garde la porte

Chaque transition répond par UNE carte — « 🧺 CT-… → préparée » — qui porte
le bouton de l'étape suivante : « 🛵 Chez le livreur » en mode livraison,
« 📦 Remise faite » en retrait ou après le livreur. La séquence vient de
`etapesPour(mode)` : un retrait ne voit jamais une étape de livreur
(ADR 0005, le point de retrait est un mode de plein droit).

**La garde du produit : pas de « Remise faite » sur un solde ouvert.** Le
bouton ne se montre pas ; la carte rappelle le solde attendu et le collage
du SMS — c'est la règle `solde_ouvert` de `cycle.ts`, dite au moment où elle
sert. Un bouton périmé pressé quand même reçoit le même refus que la route,
journalisé (`corpsLivraisonRefusee`, complété d'une phrase pour
`solde_ouvert`). Presser deux fois un bouton d'étape est le refus
`recul_ignore` : journalisé puis ignoré, comme partout — et la relivraison
d'un même message reste couverte par la réclamation wamid (ADR 0040).

La carte « → livrée » garde la copie en place (`corpsLivraisonMarquee`) et
la notification d'avis existante. Prévenir l'acheteuse aux étapes
INTERMÉDIAIRES est le lot P5 — rien ici ne lui écrit.

## Décision 3 — l'absence se restitue en UNE carte, sans schéma de plus

À la réouverture de la fenêtre, quand PLUSIEURS notifications de commande
attendent, elles se compilent en une carte (copie de la maquette
`parcours-vendeur-v2.html`) :

> *Pendant votre absence*
> 2 commandes : CT-104298 (9 500 F) · CT-104305 (12 000 F).
> Écrivez « commandes » pour le détail.

Trois choix dedans :

- **aucune colonne nouvelle.** La référence vit déjà dans l'identifiant du
  bouton persisté (`etape:preparee:<ref>`) ; le montant se RELIT de la
  commande au moment de la remise — la base est la source de vérité, pas un
  instantané pris à la mise en attente ;
- **seules les notifications de commande se compilent.** Une contestation ou
  une relance porte un contenu qui ne se résume pas ; elles se remettent une
  à une, comme avant. UNE seule commande en attente : la carte complète
  habituelle, boutons compris ;
- **la carte compilée n'a pas de boutons** : trois commandes ne tiennent pas
  dans trois boutons, et choisir lesquelles serait choisir à la place de la
  vendeuse. Elle enseigne « commandes », qui doit donc exister (décision 4).

## Décision 4 — « commandes » devient un mot-clé, parce qu'une carte le promet

Une ligne d'aide qui promet un mot que le bot ne comprend pas est pire que
pas d'aide (règle du mode d'emploi). « commandes » rend le détail des
commandes ouvertes — référence, total, étape, reste à encaisser — depuis les
données que le fil vendeuse charge déjà. Le mot entre dans l'aiguillage
(même famille que « solde » : il doit traverser un achat en cours) et dans
`motDuModeDemploi` (il ne devient jamais un nom d'article).

## Ce que ce lot NE fait pas

- L'app vendeuse ne change pas — les deux comptoirs partagent déjà le moteur
  (ADR 0061).
- Aucun message à l'acheteuse aux étapes intermédiaires : c'est P5.
- Un paiement ne recule jamais ; une transition arrière est journalisée puis
  ignorée — rien de nouveau, le moteur le tenait déjà.

## Preuves

- `apps/api/src/domain/bot/__tests__/etapes-boutons.test.ts` — les boutons
  de la notification, la séquence par mode, la garde `solde_ouvert` qui
  masque et rappelle, la carte d'absence, le mot-clé « commandes », la
  lecture des identifiants de bouton.
- `apps/api/src/__tests__/bot-etapes.test.ts` — contre une vraie base : la
  séquence complète reçue → préparée → chez le livreur → livrée pilotée aux
  boutons, le solde réglé entre les deux dernières (démonstration du lot) ;
  le refus journalisé du bouton pressé deux fois ; retrait sans étape de
  livreur ; 3 notifications en attente → UNE carte, 1 → la carte complète.
- La matrice du harnais gagne les gestes « commandes » et les boutons
  d'étape sur le fil vendeuse.
