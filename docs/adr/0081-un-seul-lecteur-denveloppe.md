# 0081 — Un seul lecteur d'enveloppe pour le webhook entrant

Date : 2026-08-13
Statut : accepté
Corrige : une divergence entre `domain/connexion-whatsapp.ts` et
`domain/bot/entrees.ts`
Concerne : `apps/api/src/domain/enveloppe-entrante.ts`,
`apps/api/src/auth-connexion-whatsapp.ts`, `apps/api/src/server.ts`

## Le symptôme

Le 13/08, après le déploiement de l'ADR 0080, le porteur du produit envoie
quatre fois de suite son message « Connexion Catalog : … » au numéro du bot.
Rien. L'écran d'attente tourne jusqu'à l'expiration.

Le fil, lui, est **vivant** : six minutes plus tôt, le bot a répondu dans la
même conversation, avec une image. Ce détail est le diagnostic — il exclut le
webhook non livré, le secret d'URL, l'en-tête du relais, la signature.

## Le défaut

Deux parseurs lisent le **même** corps de webhook :

| | enveloppe Cloud API | forme plate v1 |
|---|---|---|
| `bot/entrees.ts` (ADR 0031) | ✅ | ✅ depuis le 02/08 |
| `connexion-whatsapp.ts` (ADR 0027) | ✅ | ❌ |

La forme plate — `messages[]` à la racine, sans `entry[].changes[]` — est
celle du bac à sable 360dialog. Le bot l'a apprise le 02/08/2026 ; la
connexion ne l'a jamais sue. Sur ce transport, **le bot répond et la connexion
reste muette**.

Aucun des deux parseurs n'est faux pris isolément. C'est leur **désaccord** qui
est le défaut, et c'est pour cela qu'aucune relecture de l'un ou de l'autre ne
l'aurait trouvé.

## La décision

**Les formes de livraison se déclarent une fois**, dans
`domain/enveloppe-entrante.ts`. Les deux parseurs y prennent leurs messages et
ne gardent que ce qui leur est propre : le texte pour la connexion, les
boutons, photos, positions et Flows pour le bot.

Un test scelle la propriété qui compte, et qui vaut plus que la correction
elle-même : **pour chaque enveloppe, les deux parseurs voient le même texte**.
Une enveloppe apprise par l'un le sera désormais par l'autre.

## L'autre moitié : la panne était invisible

Un message qui portait un code et n'aboutissait pas ne laissait **aucune
trace, nulle part**. Quatre pannes distinctes se présentaient à l'identique —
« rien ne se passe » :

- la livraison n'est jamais arrivée ;
- elle est arrivée, mais aucun message n'en a été lu (le défaut ci-dessus) ;
- le code ne correspondait à aucun défi vivant ;
- le numéro a été refusé (le défaut de l'ADR 0080).

`appliquerMessageEntrant` renvoyait `"verifie" | "ignore"`, et personne ne
lisait la valeur. Elle nomme désormais les quatre chemins, et `server.ts`
écrit l'issue — **sauf `sans_code`**, qui est tout le trafic ordinaire du bot
et noierait les autres.

**La trace ne porte aucun contenu** : ni le code — il vaut une session pendant
cinq minutes, l'écrire dans un journal reviendrait à y écrire un `buyerToken`
(ADR 0023) —, ni le numéro, ni le texte. L'issue seule suffit à savoir quoi
regarder ensuite, et c'est précisément ce qui manquait ce matin.

Au passage, la trace d'erreur de `surMessage` disait `bot : message entrant
non traité` alors que ce chemin est celui des **défis de connexion**. Un jour
de panne de connexion, c'est la ligne qu'on cherche et celle qu'on écarte.

## Ce qu'on ne conclut pas

Ce correctif ne prouve pas que le transport de préproduction livre à plat au
moment où ces lignes sont écrites — cela se lit dans les journaux, pas dans le
dépôt. Il enlève la seule différence de comportement qui restait entre un bot
qui répond et une connexion muette, et il rend la question décidable en une
ligne de journal la prochaine fois.
