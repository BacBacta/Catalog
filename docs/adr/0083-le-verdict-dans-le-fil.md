# 0083 — Le verdict de preuve se rend dans le fil quand il n'y a rien à choisir

- **Statut** : accepté
- **Date** : 13/08/2026
- **Complète** : l'ADR 0035 (P0 — le fil reconnaissait le SMS et aiguillait) ;
  ne touche pas au lot 8 (les sept contrôles) ni au lot 7 (la machine).

## La friction n° 1 du produit, mesurée

Le geste central de Catalog — transformer le SMS de l'opérateur en reçu
opposable — exigeait un changement de surface au moment le plus chargé :
l'argent vient d'arriver, la vendeuse colle le SMS dans le fil… et le bot
répondait par un lien vers l'app. Lien, connexion, écran de collage,
re-collage : quatre marches entre le geste et son résultat. Le banc du 12/08
l'a dit sans détour (« collage sms inexistant ») : pour la vendeuse, un
verdict qui vit ailleurs n'existe pas.

Fait notable relevé par la cartographie du 13/08 : `messageVerdict` existait
dans le domaine, testé — et n'était branché nulle part. Le « V1 :
reconnaissance et aiguillage » était une prudence de mise en route, pas une
position de fond. Cet ADR le tranche.

## La décision

**Quand UNE SEULE commande a un solde ouvert, le SMS collé dans le fil est
soumis aux sept contrôles et le verdict se rend dans le fil.** Il n'y a
alors rien à choisir, donc rien à déléguer à un écran.

- **Le même service que la route** : le cœur de `POST /:orderId/preuve`
  devient `soumettrePreuve` (`preuve-service.ts`), appelé par les deux
  surfaces. Sept contrôles, INSERT qui tranche le n° 5 par la contrainte
  `UNIQUE(operator, operator_tx_id)`, transition par la machine du lot 7,
  versement, journal d'audit — indistinguables selon la porte d'entrée.
  Deux implémentations du parcours le plus surveillé du produit seraient
  pires qu'aucune.
- **Accepté** : le fil dit « ✅ Paiement prouvé — les contrôles passent.
  CT-X est à jour, le reçu est émis. » L'acheteuse est notifiée après
  commit, par le même chemin que depuis l'app.
- **Refusé** (contrôle pur ou identifiant déjà réclamé) : le fil dit le
  refus AVEC l'explication du contrôle échoué — elle est rédigée pour la
  vendeuse et ne cite jamais le texte du SMS — et le lien vers l'écran de
  l'app reste le détail, contrôle par contrôle.
- **Plusieurs commandes ouvertes : on aiguille encore.** Choisir dans une
  liste WhatsApp le paiement qu'on rattache serait le vrai risque d'erreur ;
  l'écran de l'app montre les montants et les dates, le fil non.
- **Sans la porte configurée** (`deps.preuve` absent), le fil se comporte
  comme avant — reconnaissance et aiguillage. Rien ne casse.

## Ce qui ne change pas

- Le SMS brut ne sort jamais en clair : chiffré avant la base (même
  chiffreur que la route — une seule résolution dans `server.ts`), jamais
  journalisé, jamais retranscrit dans un message.
- Le contrôle n° 5 reste tranché par la BASE (jamais un SELECT suivi d'un
  `if`), et il est réseau-large : un identifiant réclamé chez une vendeuse
  est refusé chez toutes — le test d'intégration le rejoue à travers le fil.
- Seul un SMS entrant accepté fait avancer la commande ; « accepté sous
  réserve » écrit la preuve sans toucher ni l'état ni l'argent.
- L'écran de collage de l'app demeure, intact : c'est lui qui montre les
  sept contrôles un à un, et c'est la seule porte quand plusieurs commandes
  sont ouvertes.
