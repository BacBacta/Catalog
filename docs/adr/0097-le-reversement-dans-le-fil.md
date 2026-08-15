# 0097 — Le reversement dans le fil : un écran, puis le code collé

Date : 2026-08-15
Statut : accepté
Lot : P3 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095.
Complète : 0021 (deux clés, deux pouvoirs), 0025 (canal du code), 0055 (les
Flows), 0061 (rang 2b, gel et alerte), 0087 (ouverture en formulaire).

## Contexte

Le numéro de reversement — là où l'argent arrive — se règle depuis le lot 4
dans l'espace web, avec son OTP propre envoyé au NOUVEAU numéro. La cible
premium le ramène dans le fil, au moment où il coûte le moins : un formulaire
Meta recueille le numéro et l'opérateur, le code arrive par SMS, et il se
colle dans la conversation.

C'est le champ qu'un attaquant chercherait à détourner (AGENTS.md §2). Tout
ce que ce lot ajoute est donc un **porteur** de la vérification existante,
jamais une seconde vérification.

## Décision 1 — le Flow tient en UN écran, pas deux

Le prompt du lot — et la maquette validée — décrivaient deux écrans : le
numéro, puis le code. **Le second écran ne peut pas exister.**

Un Flow sans point de terminaison est statique : aucun aller-retour serveur
entre deux écrans (ADR 0087 — seul `data_exchange` en exigerait un, on ne
l'emploie pas). Au moment où l'écran s'affiche, le code n'a pas encore été
émis — il ne part qu'à la réception de la réponse du formulaire, quand les
gardes ont accepté le numéro. Un écran « saisissez le code » afficherait un
champ pour un secret qui n'existe pas.

Le code se colle donc **dans le fil**, où le collage n'est jamais bloqué
(WCAG 3.3.8 — c'est un champ de conversation, rien à interdire). C'était
déjà la doctrine de l'ADR 0063 : le formulaire d'inscription n'a jamais porté
le reversement, « un formulaire statique ne peut pas le vérifier ».

La maquette est mise à jour au même commit (règle de l'ADR 0095 §2) : le
tiroir n'a plus qu'un écran, et le code se joue en message collé.

**Le compteur du parcours nominal bouge, et c'est dit ici** (ADR 0095 §1.4 :
toute frappe de plus se justifie par ADR ou ne se fait pas) : la vendeuse qui
pose son reversement tape désormais DEUX collages — le code, puis le SMS de
preuve — au lieu d'un. Ce n'est pas un mot à apprendre ni une question
ouverte : c'est un collage, inautomatisable pour la même raison que la
preuve — il arrive par SMS, possiblement sur une autre puce que WhatsApp, et
ne peut venir que d'elle.

## Décision 2 — le fil rejoue les gardes de la route, dans le même ordre

`changerNumeroDeReversement` (`routes/payout.ts`) est déjà un service exporté,
utilisable hors HTTP : gel avant tout, journal d'audit dans la MÊME
transaction que la modification — refus compris —, alerte SMS à l'ancien
numéro après commit. **Le fil l'appelle tel quel.** Le seul changement dans
ce fichier est l'export des deux tables de messages (`MESSAGE`,
`MESSAGE_OTP`) : les mêmes refus se disent avec les mêmes phrases sur les
deux surfaces.

Avant d'émettre un code, le fil rejoue les gardes de la route, dans l'ordre :

1. **le gel** (`reversementGeleDepuis`) — vérifié AVANT l'émission, alors que
   la route ne le voit qu'à la vérification : ne pas envoyer de code à un
   compte gelé vaut mieux qu'un code qui sera refusé ;
2. **le numéro inchangé** ;
3. **la limitation de débit** — le MÊME domaine (`checkOtpRateLimit`), la
   MÊME table de tentatives et la même étiquette `otp_reversement` que la
   route : les plafonds par numéro valent pour la somme des deux surfaces,
   pas pour chacune. L'« adresse » est `fil:<numéro de connexion>` — stable,
   nominative, du même régime que `inconnue` dans la couche HTTP ;
4. `otp.emettre` → SMS vers le NOUVEAU numéro → état d'attente du code.

**Un envoi SMS qui échoue ne pose AUCUN état** : sinon le fil attendrait un
code qui n'est jamais parti. La ligne d'OTP émise expire seule, et une
émission suivante la consomme — c'est le comportement existant du magasin.

## Décision 3 — l'attente du code est un état à charge utile de la machine

`{ nom: "reversement_code", numero, operateur }` entre dans `EtatVendeuse`,
sur le patron de la rafale (ADR 0096) : relu défensivement par
`normaliserEtatVendeuse`, périmé par la même horloge d'inactivité, couvert
par la matrice du harnais dès ce lot.

La machine reste pure : elle lit le code collé — le seul groupe de six
chiffres du message, ce qui accepte le code seul, le code espacé et le SMS
Catalog collé en entier — et rend l'effet `verifier_code_reversement`. Le
service exécute : verdict OTP, puis `changerNumeroDeReversement`, dans cet
ordre et avec la même précision de messages que la route.

Les verdicts ferment ou gardent l'état selon ce qu'un nouveau code
changerait :

- **code incorrect, essais restants** : l'état RESTE — on recolle, sans
  rejouer le formulaire ;
- **expiré, brûlé, déjà servi, aucun code** : l'état se FERME — il faut un
  nouveau code, donc repasser par le formulaire ;
- **vérifié** : l'état se ferme, le numéro est posé, la confirmation le dit
  avec l'opérateur enregistré.

Chaque saisie, bonne ou mauvaise, laisse sa trace : le service est appelé
dans tous les cas, et c'est LUI qui journalise — mêmes entrées
`reversement_modifie` / `reversement_refuse` que la route, même transaction.

## Décision 4 — l'opérateur déclaré est un filet, jamais une donnée

Le formulaire demande l'opérateur (copie de la maquette), mais **l'opérateur
enregistré reste celui que le service dérive du préfixe**
(`operateurDuNumero`) — pas de second chemin d'écriture.

La déclaration sert UNE chose : attraper la faute de frappe avant qu'elle ne
coûte. Un numéro dont le préfixe dit MTN sous une déclaration Orange Money
est une erreur certaine — de numéro ou de choix — et le fil refuse d'émettre
le code en nommant l'écart. Préfixe indéterminé (Camtel, nouveau) : on
n'invente rien, le code part, et l'opérateur enregistré reste nul — comme
sur la route.

## Décision 5 — l'invitation accompagne la publication, le repli reste entier

La carte d'invitation (copie de la maquette : « 💡 Un dernier réglage… »,
bouton « 💳 Être payée d'avance ») part avec la réponse à une publication —
salve ou article — quand le numéro n'est pas posé. Jamais au premier article :
cette réponse-là porte déjà le mode d'emploi, dont la ligne 3 dit la même
chose — deux invitations dans une salve seraient du bruit (ADR 0086). Elle
n'est jamais une bulle poussée seule : elle s'ajoute à une réponse que la
vendeuse vient de provoquer, comme la carte-vitrine entretenue (ADR 0095-c),
et cesse le jour où le numéro est posé.

La relance de ~20 h (ADR 0035) devient cette même carte quand la fenêtre de
service est ouverte et que le Flow est posé ; sinon elle garde son texte et
son lien vers l'espace — y compris par gabarit, un message à formulaire ne
pouvant être ni un gabarit ni une notification en attente. Le rappel à la
première commande partie sans acompte (`corpsNouvelleCommande`) garde son
lien : son porteur est une notification composite qui peut partir par
gabarit, le canal ne permet pas d'y accrocher un formulaire, et une seconde
bulle serait le défaut de l'ADR 0086.

**Sans `WABOT_FLUX_REVERSEMENT_ID`, rien ne change nulle part** : pas
d'invitation, relance et rappel pointent vers l'espace web, le fil est
exactement celui d'hier. Le dépôt chez Meta reste un geste manuel
(`flux.mjs --deposer`, workflow « Depots Meta ») — documenté dans
`.env.example` avec les cinq autres, jamais prétendu automatique.

## Ce que ce lot NE fait pas

- **L'aiguillage des canaux ne bouge pas** (ADR 0025) : quand
  `SMS_PROVIDER=whatsapp`, le code du reversement arrive sur la même puce que
  la connexion. C'est un report explicite du porteur du produit, borné au
  canal et réversible — pas un défaut à corriger en passant.
- Le gel ne se lève toujours que par un humain ; le fil ne fait que le
  constater plus tôt.
- L'espace web reste le chemin complet : écran, OTP, mêmes limites. Le fil
  est un raccourci, jamais un remplacement (doctrine ADR 0055/0063).
- Le fil vendeuse reste en français (ADR 0033) ; le pidgin reste écrit et
  non servi (ADR 0034).

## Preuves

- `apps/api/src/__tests__/flux-spec.test.ts` — le contrat de champs du
  formulaire : `numero` et `operateur`, tous deux obligatoires, les deux
  seuls, et les identifiants d'opérateur sont ceux du produit.
- `apps/api/src/domain/bot/__tests__/flux-reversement.test.ts` — le lecteur
  (réponse complète, malformée, opérateur inconnu), la lecture du code collé
  (seul, espacé, SMS entier, refus du reste), l'état et ses sorties.
- `apps/api/src/__tests__/bot-reversement.test.ts` — contre une vraie base :
  le formulaire émet le code et pose l'état ; l'échec d'envoi n'en pose
  aucun ; le gel et le débit refusent avant d'émettre ; un code faux
  journalise `reversement_refuse` et l'état reste ; le bon code pose le
  numéro, journalise `reversement_modifie` dans la même transaction et
  l'invitation disparaît des publications suivantes.
- La matrice du harnais couvre `reversement_code` dès ce lot (règle de
  l'ADR 0095).
