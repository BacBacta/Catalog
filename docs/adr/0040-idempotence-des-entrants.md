# 0040 — Un message entrant n'est traité qu'une fois

Date : 05/08/2026 · Statut : accepté · Complète : 0027, 0031

## Contexte

Premier parcours prospect complet en bac à sable, le 05/08/2026 à 09 h 38. Ce
qui en est sorti :

- la boutique créée s'appelle **« Bonjour »** ;
- son premier article s'appelle **« Douala »** ;
- le même menu est envoyé quatre fois de suite ;
- « Je n'ai pas compris le prix » revient à 09 h 39, 09 h 40, 09 h 41, 09 h 42,
  09 h 43 — indéfiniment, à intervalle croissant.

« Bonjour » était le premier message de la conversation. « Douala » était la
ville, tapée une minute plus tôt. Ce ne sont pas des valeurs inventées : ce
sont les messages **précédents**, rejoués dans la machine à un moment où ils
voulaient dire autre chose.

L'intervalle croissant nomme la cause : **le relais relivre**. WhatsApp et ses
relais garantissent la livraison *au moins une fois*. Un accusé qui tarde — et
un tour de bot envoie plusieurs messages sortants, chacun un aller-retour HTTP
— et la même livraison revient. Sans idempotence, chaque relivraison fait
avancer la machine d'un cran, avec une entrée périmée.

Le défaut était invisible à toute la batterie de tests : aucun ne rejouait deux
fois la même livraison. C'est le genre de défaut qu'on ne trouve qu'en vrai,
et qui détruit exactement ce que le produit vend — un état de commande sur
lequel deux personnes s'accordent.

## Décision 1 — La clé est le `wamid`, et rien d'autre

WhatsApp donne à chaque message un identifiant unique de bout en bout. C'est le
seul point fixe d'une relivraison : l'horodatage, le contenu et l'expéditeur
sont identiques d'une tentative à l'autre, l'identifiant aussi — et il ne
collisionne pas.

Une table `bot_message_vu`, la clé primaire est le `wamid`. Pas de hachage du
contenu : deux « Bonjour » légitimes à dix secondes d'intervalle sont deux
messages, pas un doublon.

## Décision 2 — On réclame AVANT de travailler, on termine après

Poser la marque après le traitement laisserait grande ouverte la fenêtre qui
nous a mordus : la relivraison arrive *pendant* que la première est en cours,
justement parce que la première est lente.

Donc : `INSERT` d'abord — la contrainte d'unicité fait l'arbitrage, pas un
`if` — puis le travail, puis `termineLe`.

## Décision 3 — Une réclamation morte se laisse rejouer, passé deux minutes

`termineLe` nul veut dire deux choses : « en cours » ou « mort en chemin ».
Les confondre coûterait un message perdu à chaque redémarrage de machine.

Au-delà de `RECLAMATION_PERIMEE_MS` (2 min), une réclamation inachevée se
reprend. En deçà, on laisse travailler.

**Le compromis est explicite** : on préfère perdre un message dont le
traitement est mort en chemin — la vendeuse réécrit, elle est devant son
téléphone — plutôt que d'en traiter un deux fois. Un double traitement, lui,
corrompt un état que personne ne répare : une boutique s'appelle « Bonjour »
et rien ne dit pourquoi.

## Décision 4 — Sans `wamid`, on traite

Le simulateur de terrain (`sandbox-entrant.mjs`) n'en pose pas, et c'est sa
raison d'être : rejouer un scénario à l'identique. Une garde qui l'en
empêcherait rendrait l'instrument inutilisable le jour d'un incident.

## Décision 5 — La purge vit sur ce chemin, pas dans un job

Une ligne ne sert que le temps où une relivraison peut encore arriver. Trois
jours, purgés à la fin de chaque livraison traitée. Ajouter une file pg-boss
pour balayer une table qui n'existe que par ce chemin serait une pièce mobile
de plus à surveiller.

## Ce que ça ne fait pas

- **On n'accuse pas réception avant de travailler.** Ce serait la façon
  d'arrêter les relivraisons à la source, mais `fly.toml` porte
  `auto_stop_machines = "suspend"` : une promesse détachée peut être coupée, et
  le message serait perdu *après* avoir été marqué vu. Avec l'idempotence, les
  relivraisons sont inoffensives et l'accusé rapide n'est plus qu'un confort.
  À rouvrir si le volume le justifie, avec une file durable.
- **Rien n'est réparé rétroactivement.** Les boutiques nées d'un message
  rejoué existent ; elles se détachent avec `terrain-raz.mjs`.
