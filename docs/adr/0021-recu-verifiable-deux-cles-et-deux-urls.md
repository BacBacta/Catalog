# 0021 — Le reçu vérifiable : deux clés, deux URL, et une colonne devenue morte

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 10 (`packages/contracts/src/recu.ts`,
  `apps/api/src/domain/receipt`, `apps/api/src/routes/recu.ts`, `apps/shop`,
  `apps/seller`)
- **Ajoute une colonne** `order.buyer_token` — migration additive
- **Rend morte** la colonne `payment_proof.countersigned_at`, héritée du lot 3
- N'ajoute aucune dépendance

## Contexte

Le lot 10 livre la valeur numéro un du produit : un paiement dont n'importe qui
peut contrôler la réalité. Catalog n'atteste rien de lui-même — **il rend la
vérification possible**. C'est la phrase à relire quand une décision de
conception hésite, et elle a tranché plusieurs fois dans ce lot.

Quatre écrans : la page publique `/v/`, le suivi de l'acheteuse `/suivi/`,
l'écran vendeuse « vérifier un reçu », et le refus explicite sur chacun.

## Décision 1 — deux clés, deux pouvoirs

Le blueprint écrivait `/suivi/[ref]`. La référence `CT-1043` est séquentielle et
voyage en clair dans une conversation WhatsApp : **elle se devine**. Or c'est
cette page qui porte la contre-signature, c'est-à-dire la seconde voix qui donne
au reçu sa valeur. Si la référence l'ouvrait, il suffirait d'essayer des liens
pour valider le paiement d'autrui — et le contrôle n° 7 perdrait exactement ce
qu'il cherche à établir.

Le code de vérification ne peut pas jouer ce rôle non plus, pour la raison
inverse : **il est public par construction**. Le montrer est tout l'intérêt du
reçu.

> `verification_code` **identifie**. `buyer_token` **autorise**.

D'où une colonne de plus sur `order` : `buyer_token`, nullable, unique, 192 bits
de base64url. Nullable parce que les commandes antérieures n'en ont pas, et que
leur en fabriquer un dans une migration serait fabriquer un secret que personne
n'a reçu. Un test essaie la référence, le code et le code sans tiret sur la
route de contre-signature : les trois sont refusés, et l'état ne bouge pas.

**Corollaire assumé, et il est écrit à l'écran** : partager le lien de suivi,
c'est partager le pouvoir de contresigner. C'est le prix de « pas de compte
requis ». Une acheteuse qui transmet son lien dans une conversation de groupe
affaiblit sa propre voix ; l'écran le lui dit — « Ce lien vous est personnel …
Ne le transmettez pas » — plutôt que de la laisser le découvrir.

Même raisonnement pour la recherche côté vendeuse : **par code elle est
publique, par identifiant d'opérateur elle est authentifiée.** Un identifiant
MTN est un nombre à onze chiffres, donc énumérable ; un code de vérification
tire huit caractères d'un alphabet de vingt-cinq.

## Décision 2 — deux formes d'URL, et la moins jolie est la vraie

`/v/<code>` et `/suivi/<jeton>` dépendent d'une donnée qui n'existe pas à la
construction du site : le reçu n'est pas écrit, et il change quand l'acheteuse
contresigne.

L'option évidente était un adaptateur SSR. Elle est **refusée** : ce serait un
changement de la stack figée pour deux pages, et cela retirerait la boutique du
cache CDN posé par l'ADR 0003 — celui qui tient le LCP sous 2,5 s depuis Douala
alors que l'origine est en Europe.

Retenu : une route attrape-tout par famille, **une seule page construite**, et
`public/_redirects` qui réécrit `/v/*` et `/suivi/*` dessus en 200. Une
réécriture et non une redirection : l'URL vue par l'acheteuse reste celle qu'elle
a recopiée, ce qui compte pour un lien qu'on partage.

**Mais cette réécriture est une configuration d'hébergement, et le produit ne
doit pas en dépendre.** C'est la correction que la mise en œuvre a imposée : je
croyais qu'`astro dev` servirait `/v/<code>` nativement. Faux — en sortie
statique, seuls les chemins énumérés à la construction existent, et tout le reste
est un 404. Sans la réécriture, la page n'était donc joignable nulle part :
ni en développement, ni en prévisualisation, ni derrière un CDN mal configuré.

D'où la seconde forme : **`/v/?c=<code>` et `/suivi/?t=<jeton>`, qui n'exigent
rien**. Elles fonctionnent partout. La jolie URL devient un confort par-dessus,
et c'est la forme sans dépendance que le test de bout en bout exerce — tester ce
dont le produit dépend vraiment.

## Décision 3 — la date de contre-signature vient du journal

`payment_proof` est **en ajout seul** : un déclencheur de base refuse tout
`UPDATE`. Écrire `countersigned_at` sur la preuve était donc impossible, et la
découverte est venue d'un 500 en test, pas d'une relecture.

On ne desserre pas la garantie d'ajout seul pour une date. La contre-signature
est déjà journalisée dans `order_event`, qui existe exactement pour cela : c'est
lui qui fait foi, et le reçu lit la date là.

**Conséquence : `payment_proof.countersigned_at` est une colonne morte.** Elle
reste en place — la retirer maintenant serait un changement destructif en une
étape, ce que les migrations en expand / contract interdisent. Elle se retirera
en phase *contract*, une fois qu'on aura vérifié qu'aucune lecture ne la touche.
Un test vérifie qu'elle reste vide et que le reçu porte quand même sa date.

## Décision 4 — un refus est NOMMÉ, et il dit quoi faire

Quatre refus : `code_inconnu`, `declare_non_trace`, `preuve_absente`,
`conteste`. Ils n'appellent pas la même décision, et celui qui vérifie doit
savoir lequel il a devant lui.

Deux règles en découlent :

- **une page vide est interdite.** Un test mesure le texte rendu de chaque refus
  et échoue sous soixante caractères. Une page vide se lit comme une panne, là où
  il faut une décision ;
- **le refus porte la consigne.** « Aucune preuve ne correspond » est suivi de
  « n'expédiez pas tant que le paiement n'est pas prouvé ». Une vendeuse qui ne
  comprend pas un refus expédie quand même — et le produit n'aura servi à rien.

Un code inconnu et un code mal formé donnent la **même** réponse : distinguer
apprendrait à un curieux qu'un code a la bonne forme sans exister. À l'inverse,
un code recopié en minuscules et sans tiret est **accepté** : une acheteuse le
dicte au téléphone, et refuser sur la forme serait refuser des gens qui ont le
bon code.

## Ce que le reçu ne dit jamais

Ni « garanti », ni « certifié », ni « infalsifiable », ni « authentifié par
Catalog ». Ce n'est pas une preuve cryptographique : c'est un identifiant de
transaction que l'opérateur peut confirmer, apporté par la personne dont l'argent
est en jeu, et contresigné par l'autre partie. Des tests cherchent ces mots dans
tout ce que le domaine produit et dans quatre variantes de la carte rendue.

La phrase qui dit cela — `porteeDuRecu` — est écrite **une seule fois dans le
dépôt** et vient du serveur. Trois écrans l'affichent ; trois formulations
seraient trois occasions d'en affaiblir une.

Deux distinctions de la même famille, tenues par des tests :

- **la date du transfert n'est pas la date du constat.** Les confondre laisserait
  croire que Catalog a vu passer le paiement ;
- **la marche à suivre vient de la configuration de la rampe** (lot 9), jamais
  d'un gabarit de reçu. Un reçu qui figerait `*126#` enverrait l'acheteuse sur un
  code faux le jour où l'opérateur en change — l'interdit « figer un code USSD en
  constante » sous une autre forme. Un test change le code et vérifie que le reçu
  suit. Sans opérateur configuré, le reçu renvoie à l'agence et n'invente rien.

## La portée du test de bout en bout, et ce qu'il ne couvre pas

Le blueprint demandait « le parcours complet : commande, rampe, collage du SMS,
reçu, contre-signature ». **La création de commande appartient au lot 11** ; la
fabriquer ici aurait été écrire une route hors périmètre.

Les dix-huit tests couvrent donc les quatre écrans sur ce que seul un navigateur
montre — axe-core sans violation bloquante, le tap de contre-signature, ce qui
est écrit et ce qui ne l'est pas — avec l'API simulée. Ce n'est pas un
raccourci : le serveur est couvert par seize tests contre une vraie base, et rien
de ce que mesure le navigateur n'en dépend. **Le maillon manquant est nommé
plutôt que contourné** : il se referme au lot 11.

## Trois pièges rencontrés, notés pour la prochaine fois

**Un `select` Prisma passé par VARIABLE échappe au contrôle des propriétés en
trop.** `shopName` — qui n'existe pas, le champ s'appelle `businessName` —
compilait sans un mot. Le contrôle d'excédent ne s'applique qu'aux littéraux
passés directement. C'est le test contre une vraie base qui l'a montré, et c'est
un argument de plus pour en avoir.

**`RUN = Date.now() % 90000` se répète toutes les quatre-vingt-dix secondes.**
Un jeton dérivé d'un aléa déterministe semé là-dessus entrait en collision avec
les lignes laissées par l'exécution précédente, sur une colonne `UNIQUE`. Les
jetons de test viennent maintenant de `randomBytes` : le déterminisme du
générateur se vérifie dans son propre test, il n'a rien à faire dans une fixture.

**`preact-render-to-string` n'échappe pas l'apostrophe dans un nœud de texte**,
seulement dans un attribut. Des assertions écrites en `&#039;` passaient à côté
du contenu réel.

Deux réglages de la suite de bout en bout, documentés dans la configuration :
`astro dev` bascule en arrière-plan dès qu'il détecte un environnement d'agent,
donc la boutique est servie par `build && preview` — qui a l'avantage de servir
exactement ce que le CDN servira. Et les plafonds d'OTP **par adresse** sont
relevés pour la suite, seulement ceux-là : tous les tests sortent par
`127.0.0.1`, c'est littéralement le cas que l'ADR du lot 4 signalait. Le plafond
par numéro reste à sa valeur de production, c'est lui que
`parcours-vendeuse.spec.ts` vérifie.
