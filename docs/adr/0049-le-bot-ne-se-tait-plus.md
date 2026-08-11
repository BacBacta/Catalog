# 0049 — Le bot ne se tait plus jamais

Date : 2026-08-08
Statut : accepté
Lot A du plan de l'audit du 07/08/2026 (`docs/analyses/2026-08-07-audit-integral-du-bot.md`)

## Contexte

L'audit intégral du bot a mesuré une sortie que personne n'avait vue parce
qu'elle ne produit aucune trace : **certaines formes de message entrant ne
recevaient rien du tout.** Pas une réponse, pas un accusé, pas même une coche
bleue.

`lireEntreesBot` ne poussait que `text`, `image` et `interactive`. Le
commentaire l'assumait — « *stickers, audios, accuses : ignores ici* » — en
renvoyant au service le soin de répondre. Le service ne répondait pas : sans
entrée produite, `traiterEntree` n'était jamais appelé.

Le cas qui compte n'est pas le sticker. C'est **le vocal**. Mama Ngo, 42 ans,
vendeuse de pagnes à Mokolo, tape lentement et dicte par défaut : c'est le
geste le plus naturel du canal, et la maquette validée le dit en toutes
lettres (`bot-cible.html:250`, « La note vocale — **LE geste du terrain** »).
Elle envoyait neuf secondes de voix et recevait le néant.

Sur WhatsApp, l'absence de réponse ne veut pas dire « je n'ai pas compris ».
Elle veut dire **panne**. C'est d'ailleurs ce que nous venons de vivre nous-mêmes
le 07/08/2026, deux fois : un webhook qui refusait tout (ADR 0047) et des envois
morts sur `(#131037)`, tous deux indiscernables d'un bot cassé.

## Décision

**Toute forme entrante est nommée, et toute question reçoit une réponse.**

### 1. Le parseur nomme au lieu d'ignorer

Un nouveau genre `autre`, porteur d'une `FormeNonLue` : `vocal`, `video`,
`document`, `sticker`, `localisation`, `contact`, `inconnue`. Aucun contenu
n'est retenu — **pas même un identifiant de média** : on ne lit pas ce qu'on
ne sait pas lire.

Une forme inédite de demain (un retour de Flow, une réponse de catalogue
natif) tombe dans `inconnue` plutôt que dans le silence. C'est un filet, pas
une fonctionnalité.

### 2. Ce qui n'est PAS une question ne reçoit pas de réponse

`reaction`, `system`, `ephemeral`, `order` restent ignorés, et cette liste est
fermée. **Répondre « je ne sais pas lire ça » à un 👍 est pire que le silence :
c'est un reproche adressé à quelqu'un qui vient d'approuver.**

C'est le seul endroit du lot où l'on choisit délibérément de se taire, et il
mérite d'être écrit noir sur blanc parce qu'il contredit le titre.

### 3. Une phrase par forme, jamais une phrase générique

Dire « je ne sais pas écouter les vocaux » à quelqu'un qui a partagé sa
position est une réponse fausse — donc un silence déguisé. Sept phrases, en
français et en anglais, la parité tenue par le typage.

Celle de la position est la plus utile de toutes, parce qu'elle rattrape :

> « Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi
> votre quartier et un repère (« en face de… »). »

### 4. On explique, puis on repose la question

Côté vendeuse, l'explication seule laisserait la personne devant un mur : elle
sait ce que le bot ne fait pas, pas ce qu'il attend. `questionDeLEtat` rend la
**question** de l'état courant — à ne pas confondre avec les messages de
reproche (« Je n'ai pas compris le prix ») : quelqu'un qui envoie un vocal n'a
rien fait de mal.

Côté acheteuse, **l'état ne bouge pas** : un vocal envoyé au milieu de la
saisie de livraison ne renvoie pas au catalogue.

### 5. L'accusé de lecture et l'indicateur de frappe

Posés **avant** tout travail, sur chaque message entrant qui porte un `wamid`.
La double coche bleue est la seule chose qui distingue « le bot réfléchit » de
« le bot est mort », et le traitement peut durer : téléchargement de média,
ré-encodage, carte-vitrine.

`AccuseLecture` n'est **pas** un `MessageSortant` : il ne porte ni destinataire
ni contenu, il désigne un message reçu. Il part sur la même route et c'est tout
ce qu'il partage. Le garder hors de l'union évite qu'il traverse
`envoyerSequence`, dont les replis n'ont aucun sens ici.

`accuser` est **facultatif** sur `EnvoyeurBot` et de confort, comme la réaction
et la citation (ADR 0035) : un transport qui ne sait pas le faire reste valide,
un accusé refusé ne coûte aucune conversation. L'indicateur se dissipe seul —
à l'envoi du message suivant, ou au bout de 25 secondes. Il n'y a rien à
éteindre si le traitement échoue.

### 6. Une erreur serveur cesse d'être un silence

Le `catch` de `traiterLivraisonBot` journalisait (ADR précédent) mais ne disait
rien **à la personne**. Il envoie désormais une phrase qui invite à réessayer.
L'envoi de repli est lui-même protégé : si c'est l'envoi qui est cassé, on ne
boucle pas.

## Ce que ce lot ne fait PAS

- **La position partagée n'alimente pas `geo`.** Le champ existe dans
  `deliverySchema`, et la tentation est réelle. Mais une position WhatsApp est
  celle du téléphone à l'instant de l'envoi, pas celle du lieu de livraison —
  une acheteuse dans un taxi enverrait le taxi. Cela demande une décision
  produit et son ADR.
- **Le vocal n'est pas transcrit.** Ce serait un service tiers, un coût par
  minute, et des données de conversation qui sortent de nos serveurs.
- **Les boutons de l'état courant ne sont ajoutés que côté vendeuse.** Côté
  acheteuse, les états n'ont pas encore de fonction de re-question ; le lot D
  (« on choisit, on ne tape plus ») la construira en refondant ces messages.

## Conséquences

- 21 tests, vus rouges avant d'être verts.
- Un test existant a été **remplacé** : il verrouillait « stickers et audios
  rendent une liste vide ». C'était le défaut, pas une garantie. La garantie
  qu'il portait aussi — une entrée difforme ne lève jamais — est conservée
  dans un test à part.
- `questionDeLEtat` fait exister en un seul endroit les six questions du fil
  vendeuse, qui étaient jusqu'ici recopiées dans les branches d'erreur. La
  sortie de secours (`annuler`) y est désormais uniforme, alors qu'elle
  manquait dans deux états sur six.
