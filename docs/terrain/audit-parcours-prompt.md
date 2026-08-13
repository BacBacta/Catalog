# Prompt — audit du parcours complet, vendeuse et acheteuse

> À copier tel quel dans une session neuve. Écrit le 13/08/2026 après le banc
> de 20:33, qui a montré trois silences en une seule session de test.

---

## Ton rôle

Tu travailles sur **Catalog**, un produit de commerce WhatsApp pour les
vendeuses camerounaises. Ta tâche n'est pas de corriger un défaut : c'est
d'**auditer le parcours entier**, des deux côtés, puis de construire les
outils qui le rendent fluide.

## Avant d'écrire la moindre ligne

Lis, dans cet ordre, et en entier :

1. `AGENTS.md` — le contrat de travail. Il prime sur toute habitude.
2. `CLAUDE.md` — l'état de la séquence et les points volontairement non faits.
3. Les ADR qui portent le bot : `0031` à `0039`, puis `0082` à `0088`.
   Les quatre derniers sont les plus utiles — ils documentent exactement les
   défauts que cet audit doit dépasser.
4. `docs/terrain/bot-parcours.html` — la maquette cliquable des parcours.

**Ne saute pas cette lecture.** Plusieurs ADR corrigent des erreurs déjà
commises ; les refaire coûterait cher. En particulier, le §7.7 d'`AGENTS.md`
interdit la dérive silencieuse : trois points du bot sont **vus, décidés et
volontairement non faits** (variantes produit, pidgin non relu, tout ce qui
exige des gabarits utilitaires WABA). Les rouvrir en silence est la faute.

---

## L'objectif

Le porteur du produit, le 13/08/2026 :

> « L'idée est de passer vraiment du stade de bot à une réelle application.
> Et l'approche que nous avons est mauvaise. »

Le produit se comporte encore comme un automate qui répond quand on devine
le bon mot. Il doit se comporter comme une **application** : à chaque instant,
ce qu'on peut faire est visible, et ce qui se passe est dit.

Le public visé n'est pas technique. Une vendeuse qui vend déjà sur WhatsApp,
une acheteuse qui n'a jamais entendu parler du produit. **Aucune des deux ne
doit avoir à deviner quoi écrire.**

---

## Les trois preuves de terrain du 13/08 — le motif qu'elles partagent

Ce sont des symptômes, pas la maladie. La maladie est **le silence**.

1. **La photo disparaît sans le dire.** Le formulaire d'article accepte une
   photo ; l'article est créé sans elle et le bot dit « Sans photo pour
   l'instant ». Chaîne tracée : `deps.media.lireCdn` →
   `dechiffrerMediaCdn` (`apps/api/src/adapters/media-cdn.ts`, **huit portes
   qui rendent `null`**) → `reencoderImage`. **Aucune de ces portes ne
   journalise.** Voir `apps/api/src/bot.ts`, fonction
   `creerArticleDepuisFil`, la branche `if ((demande.mediaId ||
   demande.photoCdn) && deps.media && deps.storage)`.

2. **Le fil est muet à l'ouverture.** Les amorces (« ice breakers ») et les
   commandes ont été posées sur le numéro le 13/08 — vérifie-le avec
   `depots-meta` → `accueil-etat`, en lecture seule. Elles ne s'affichent
   pas chez le testeur. **Hypothèse à vérifier, pas à supposer** : Meta ne
   les montre peut-être qu'aux conversations JAMAIS ouvertes, ou seulement
   au-dessus du champ de saisie vide. Mesure avant de conclure ; si la
   contrainte est réelle, il faut un premier message d'accueil côté produit.

3. **Le fil se tait après la carte-vitrine.** Même famille que l'ADR 0085 :
   un appel réseau qui n'aboutit pas gèle le traitement sans erreur ni trace.
   `fetchBorne` a borné les appels du bot à 15 s ; vérifie que **tous** les
   chemins de la carte, du pack statut et du stockage y passent, et que la
   dernière étape d'une séquence ne peut pas emporter les précédentes.

**Traite le motif, pas les trois cas.** Un correctif qui répare la photo et
laisse les sept autres échecs silencieux en place n'aura rien réglé.

---

## La méthode — la matrice, sans raccourci

Découpe le parcours en **étapes**, et pour chaque étape construis la matrice
complète. Ne t'arrête pas au chemin heureux : c'est justement ce que les
sessions précédentes ont fait, et c'est pourquoi les défauts sortent au banc.

### Les étapes, côté vendeuse

découverte → ouverture de la boutique → premier article → photo →
carte-vitrine et partage → numéro de reversement → première commande reçue →
collage du SMS de preuve → étapes de la commande (préparée, chez le livreur,
livrée) → encaissement du solde → avis reçu → congés → reprise.

### Les étapes, côté acheteuse

arrivée (lien de statut, QR, wa.me, boutique web) → catalogue → choix d'un
article → quantité → panier multi-articles → livraison (`mode`, `city`,
`quartier`, `landmark`, `phone`) → récapitulatif → création de la commande →
rampe de paiement USSD → paiement → contre-signature → suivi → réception →
avis vérifié.

### Pour CHAQUE étape, énumère

- **Les intentions possibles** — ce que la personne veut, y compris
  « revenir en arrière », « corriger », « abandonner », « comprendre »,
  « vérifier que c'est sérieux », « demander à un humain ».
- **Les gestes possibles** — texte libre, texte mal orthographié, texte sans
  accents, anglais, bouton, ligne de liste, réponse de Flow, photo, photo
  légendée, localisation, vocal, sticker, document, hors-sujet, **silence**,
  double envoi, message très ancien du fil.
- **Ce que le système fait aujourd'hui**, vérifié dans le code — pas
  supposé. Cite le fichier et la ligne.
- **Le verdict**, dans l'une de ces quatre cases :
  - `guidé` — l'étape suivante est visible sans deviner ;
  - `devinable` — il faut connaître un mot ;
  - `muet` — rien ne répond, ou l'échec ne se dit pas ;
  - `faux` — le système affirme quelque chose d'inexact.

`muet` et `faux` sont des défauts bloquants. `devinable` est une friction à
supprimer.

### La question qui trie tout

À chaque case, pose : **« si cette action échoue maintenant, la personne
le sait-elle ? »** Si la réponse est non, tu as trouvé un défaut, même si
aucun test ne tombe.

---

## Les outils — mesurer avant de choisir

Deux familles, et l'ordre compte : **ce que Meta offre nativement d'abord**,
ce qu'on construit ensuite.

### Ce qui est déjà mesuré et disponible

- **Flows** multi-écrans, sans point d'entrée serveur (`navigate` +
  `complete`, les données s'accumulent et reviennent ensemble). Cinq Flows
  sont publiés et branchés.
- **Message Liste** — 10 lignes, titre 24 car., description 72, en-tête 60,
  pied 60. Utilisé à l'ouverture depuis l'ADR 0088.
- **Boutons de réponse** — 3 au maximum.
- **`cta_url`** — **ACCEPTÉ**, mesuré le 13/08 (ADR 0087). Règle établie :
  il sert « va voir cette page », jamais « prends ceci et colle-le
  ailleurs » — un lien à copier reste du texte.
- **Amorces et commandes** posées sur le numéro (voir le défaut 2).

### Ce qui reste à mesurer

Tout le reste. **Ne suppose jamais qu'une capacité Meta existe** : la
référence des messages et les guides se contredisent déjà une fois (c'est
l'objet de l'ADR 0087). Le protocole est :

1. lire la référence officielle ;
2. si elle est muette ou ambiguë, **mesurer** — un script dans
   `apps/api/scripts/`, exécuté par le workflow `depots-meta`, qui rend le
   verdict de l'API ;
3. écrire le verdict dans un ADR, accepté **ou** refusé ;
4. seulement alors, écrire du code qui en dépend.

### Ce qui n'est PAS disponible

Tout ce qui exige des **gabarits utilitaires** attend le WABA : relances
au-delà de la fenêtre de 24 h, notification de la vendeuse hors fenêtre,
catalogue natif, click-to-WhatsApp. Ne construis rien qui en dépende ; dis-le
si un problème identifié n'a pas d'autre solution.

---

## Les livrables

1. **`docs/audit-parcours-2026-08.md`** — la matrice complète, étape par
   étape, avec les verdicts et les références de code. C'est le document qui
   prouve que l'audit a eu lieu.
2. **Un ADR** qui pose la direction : ce qui change, pourquoi, et ce qui est
   volontairement laissé de côté. Numérote à la suite de `0088`.
3. **Le code**, par lots, dans l'ordre de gravité : `muet` et `faux`
   d'abord, `devinable` ensuite.
4. **Les tests qui empêchent le retour** de chaque défaut corrigé. Un défaut
   silencieux se tient par un test, jamais par la mémoire.

---

## La définition de terminé

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

Les cinq doivent passer. `pnpm test:coverage` exige 90 % sur `src/domain`.

**Et une preuve de terrain** : la matrice ne compte que si chaque case
`guidé` est justifiée par du code cité, pas par une intention.

---

## Contraintes non négociables — extraites d'`AGENTS.md`

- Les montants sont des **entiers XAF**. Jamais de flottant.
- **Aucun champ `address`** — la livraison est
  `{ mode, city, quartier, landmark, phone, geo? }`.
- **Catalog n'encaisse jamais.** Aucun calcul de commission.
- **Une capture d'écran n'est jamais une preuve de paiement.**
- **Aucun code USSD en dur** — il vit dans la configuration.
- Le **code secret** mobile money ne se demande, ne s'affiche et ne se stocke
  jamais.
- **Boutique publique : ≤ 30 Ko de JS** compressés, aucune police
  téléchargée.
- **WCAG 2.2 AA**, cibles ≥ 44 px, collage jamais bloqué.
- Aucun secret dans le dépôt, y compris dans un test ou un commentaire.

## Ce qui est hors périmètre

- L'app vendeuse web et la boutique publique **au-delà** de ce que le
  parcours WhatsApp touche.
- `apps/site` (Horizon Services) — **ne pas y toucher**, il reste à part.
- Le réveil de l'adaptateur agrégateur.
- Le pidgin : `PIDGIN_RELU` reste `false` tant qu'une locutrice n'a pas relu.

## La règle qui prime sur ta vitesse

> **Signaler plutôt que combler.** Face à une ambiguïté — format non
> confirmé, capacité Meta non mesurée, règle métier floue —, arrête-toi et
> pose la question. Ne jamais inventer une valeur plausible. Un format
> reconstitué se marque « à confirmer » **dans le code et dans l'interface**.

Un audit qui invente trois réponses plausibles est pire qu'un audit qui en
laisse trois ouvertes : les trois inventions passeront les tests.
