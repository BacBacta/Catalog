# 0024 — Durcissement : gardes de bordure, attaques testées, ouverture progressive

- **Statut** : accepté
- **Date** : 31/07/2026
- **Lot** : 15
- **Concerne** : `apps/api/src/middleware/`, `apps/api/src/domain/securite/`,
  `apps/api/src/domain/deploiement/`, `apps/shop/scripts/entetes.mjs`,
  `scripts/charge/`, `docs/runbooks/`
- **Amende** : le contrôle n° 7 de l'ADR 0019 — voir §2

## Contexte

Le lot 15 prépare le lancement. Il ne s'agit pas d'ajouter des fonctionnalités
mais de répondre à une question : **qu'est-ce qui casse quand quelqu'un essaie,
et qu'est-ce qui casse quand tout le monde arrive en même temps ?**

Cet ADR consigne les six décisions qui en sont sorties, et **un défaut réel
trouvé en chemin**.

---

## 1. Les gardes enveloppent l'application, ils ne s'ajoutent pas dedans

### Décision

`monterAvecGardes(app, options)` construit une application racine, y pose les
six gardes dans un ordre fixe, puis **monte** l'application existante dessous.
`server.ts` sert la racine.

### Pourquoi

La première écriture posait les gardes par `app.use("*", …)` dans `server.ts`.
Hono exécute les gestionnaires **dans l'ordre d'enregistrement** : `/health`,
déclaré dans `app.ts` donc enregistré à l'import, passait avant eux.

Mesuré sur le serveur en marche, pas déduit :

```
$ curl -sS -D- -o/dev/null http://127.0.0.1:8791/health
HTTP/1.1 200 OK
content-type: application/json
        ← aucun en-tête de sécurité
```

Le défaut est silencieux : pas d'erreur, pas d'avertissement, et tous les tests
au vert — parce qu'ils testaient l'intergiciel, pas la composition. Le montage
en racine rend la question impossible à reposer, et
`securite-http.test.ts` reproduit exactement la situation (une route enregistrée
avant le montage) pour verrouiller la propriété.

### L'ordre, et ce qu'il garantit

1. **en-têtes** — posés sur *toute* réponse, y compris celles que les gardes
   suivants produisent. Un 429 sans `nosniff` serait la réponse la moins
   protégée du service, et c'est celle qu'on provoque le plus facilement ;
2. **CORS** — répond aux préliminaires `OPTIONS` sans réveiller la suite ;
3. **interrupteur** — arrête avant tout travail ;
4. **débit** — refuse sans toucher ni au corps ni à la base ;
5. **taille** — lit le corps, plafonne, le remet à disposition ;
6. **cohorte** — résout une session, donc coûte une requête de base : en
   dernier, et seulement sur les écritures de l'app vendeuse.

---

## 2. Le contrôle n° 7 dépend du SENS du message — correction d'un défaut

### Le défaut

`AGENTS.md` §2 est explicite depuis le début :

> Le SMS d'émission de l'acheteuse est une **corroboration**, jamais une
> preuve. […] un message de sens `sortant` produit au mieux « accepté sous
> réserve », en attente du message entrant ou de la contre-signature.

Et §8 range parmi les interdits : « faire passer une commande en "prouvé" sur le
seul SMS d'émission de l'acheteuse ».

Ce n'était pas le cas. Un `mtn.sortant.transfert` dont le destinataire est le
numéro de reversement franchissait les contrôles 1 à 4, le n° 5 passait à
l'INSERT, le n° 6 n'existe pas chez MTN, et le n° 7 rendait `pending` — qui ne
dégrade rien. Verdict : **`accepte`**.

Mesuré avant correction :

```
sens: sortant | brut: accepte | final: accepte
1:pass 2:pass 3:pass 4:pass 5:pending 7:pending
```

### La correction

`controle7Contresignature(commande, sens)` rend désormais :

| situation | état | effet sur le verdict |
|---|---|---|
| contresignée | `pass` | — |
| message **entrant**, non contresignée | `pending` | aucun : le message fait autorité seul |
| message **sortant**, non contresignée | **`warn`** | plafonne à « accepté sous réserve » |

Le plafond se lève dès que l'acheteuse contresigne : « en attente du message
entrant **ou** de la contre-signature » est bien une alternative.

### Pourquoi dans le n° 7 et pas dans le n° 3

Le n° 3 répond à « l'argent est-il allé au bon endroit ? », et la réponse reste
oui. Le fait manquant est autre : **une seule voix ne suffit pas quand cette
voix est celle de la partie qui n'a pas l'argent.** C'est exactement l'objet du
contrôle n° 7, et sa numérotation canonique (ADR 0019) n'a pas à bouger.

### Ce que cette correction ne corrige pas — à savoir avant d'ouvrir

**Aucun des six contrôles purs ne détecte un SMS MTN bien formé dont
l'identifiant est inventé.** Onze chiffres opaques ne se contredisent pas :
c'est précisément pourquoi le contrôle n° 6 n'existe que chez Orange. Une
vendeuse qui retape un message de réception plausible obtient `accepte`.

Ce qui protège alors est le contrôle n° 7, et lui seul : la preuve reste
`prouve`, elle n'atteint jamais `contresigne` sans un geste de l'acheteuse, et
le reçu affiche la différence en toutes lettres. C'est écrit dans
`attaques-preuve.test.ts` comme un constat, pas comme un échec.

**Conséquence opérationnelle : le taux de contre-signature est une métrique de
sécurité, pas de confort.** S'il s'effondre, la seule protection contre la
fabrication s'effondre avec lui. La checklist de lancement demande qu'un seuil
d'alerte soit décidé *avant* l'ouverture — un seuil décidé après coup se décide
toujours au niveau où l'on se trouve.

---

## 3. Le plafond de taille compte les octets reçus, pas l'en-tête annoncé

### Décision

`tailleMaximale` refuse d'abord sur `Content-Length` quand il existe, puis lit
le corps **en comptant**, s'arrête net au franchissement, et reconstruit la
requête autour des octets déjà lus pour que la route les relise normalement.

### Pourquoi

Le contrôle d'en-tête seul se contourne d'une ligne : un corps en
`Transfer-Encoding: chunked` n'a pas de `Content-Length`. L'application se met
alors à mettre en tampon ce qu'on lui envoie, aussi longtemps qu'on l'envoie.
La route de téléversement de photo avait exactement cette forme depuis le lot 5.

Vérifié sur le serveur en marche :

```
$ head -c 200000 /dev/zero | tr '\0' 'a' | curl -X POST -H 'Transfer-Encoding: chunked' …
{"erreur":"charge_trop_grosse","maximumOctets":16384}  [413]
```

Mettre en tampon n'est pas un coût nouveau : `formData()` le fait déjà pour lire
un fichier. Ce qui change, c'est qu'il y a maintenant une borne.

---

## 4. La politique de sécurité de contenu de la boutique est GÉNÉRÉE

### Décision

`apps/shop/scripts/entetes.mjs` tourne après `astro build` et écrit
`dist/_headers` : en-têtes communs, plus une CSP dont les `script-src` portent
l'**empreinte sha256** de chaque script en ligne du site.

### Pourquoi pas `'unsafe-inline'`

Astro émet l'amorce d'hydratation de ses îlots en ligne. `'unsafe-inline'`
aurait tenu en une ligne — et vidé la politique de tout contenu. Les empreintes
la rendent réelle : un script injecté à l'exécution ne porte pas d'empreinte
connue.

### Pourquoi UNE règle et non une par page

La première version émettait une règle par page. Plus stricte, et
**inexploitable** : la boutique construit 358 pages, alors que les hébergeurs
statiques plafonnent le nombre de règles d'un `_headers` (cent chez Cloudflare
Pages). Le fichier aurait été tronqué en silence — donc une partie des pages
serait partie *sans* politique.

L'union des empreintes coûte ceci, et rien d'autre : une empreinte valable sur
la page d'un article l'est aussi sur la page d'accueil. Ces scripts sont les
nôtres et ne portent aucune donnée de vendeuse. Le script **échoue** au-delà de
vingt empreintes distinctes, ce qui signalerait qu'un îlot s'est mis à embarquer
des données variables — et autoriser mille scripts revient à n'en autoriser
aucun. Mesuré aujourd'hui : **trois** empreintes pour 358 pages.

### `Referrer-Policy: no-referrer` est l'en-tête le plus important du produit

Pas pour une raison générique. **Le jeton de suivi de l'acheteuse voyage dans
l'URL** (`/suivi/<jeton>`) et c'est lui qui autorise la contre-signature
(ADR 0021). Sans cet en-tête, toute requête partant de cette page — une image
hébergée ailleurs, un lien sortant — emporterait l'URL complète dans son
`Referer`, c'est-à-dire publierait le secret. Il est posé des deux côtés, API et
boutique.

`jeton-jamais-expose.test.ts` complète en lisant les sources : aucun `select`
ne demande `buyerToken`, aucune réponse ne le recopie. Le défaut redouté n'est
pas une route qui l'exposerait exprès — c'est un `select` élargi de bonne foi,
six mois plus tard, qui passerait toutes les suites existantes.

---

## 5. L'interrupteur a trois positions, et celle du milieu est la principale

### Décision

`ouvert` / `lecture_seule` / `ferme`. En `lecture_seule`, les écritures rendent
503 et **les reçus restent consultables**. `/health` et `/api/statut` passent en
toutes positions.

### Pourquoi

Un reçu est une preuve opposable : une acheteuse le montre, un litige se tranche
avec. Couper les écritures et les preuves déjà émises dans le même geste
transformerait un incident technique en incident de confiance — la valeur numéro
un du produit tomberait précisément le jour où l'on en a besoin.

`ferme` reste, pour le cas où l'intégrité des données est en doute : servir un
reçu peut-être faux est alors pire que n'en servir aucun.

### Une valeur inconnue laisse le service OUVERT

Le réflexe « en cas de doute, on ferme » serait un défaut ici :
`INTERRUPTEUR="lecture-seule"` — un tiret au lieu d'un souligné — mettrait
Catalog à l'arrêt sans que personne l'ait décidé. L'arrêt est un acte délibéré ;
il s'écrit exactement.

### Un fichier en plus de la variable d'environnement

Une variable ne change pas dans un processus vivant : la modifier suppose un
redéploiement, donc quelques minutes et une chaîne d'outils qui marche. Or
l'interrupteur sert précisément les jours où l'on n'a ni les minutes ni la
certitude. `echo lecture_seule > "$INTERRUPTEUR_FICHIER"` bascule en deux
secondes. La variable reste la valeur qui survit au redémarrage.

---

## 6. Les cohortes sont un hachage, pas un tirage

### Décision

`ouvertePour(id, {pourcent, pilotes})` — seau FNV-1a de l'identifiant sur 0–99,
plus une liste explicite qui passe avant.

### Pourquoi un hachage

**La monotonie.** Une vendeuse admise à 10 % l'est encore à 20 %, à 50 % et à
100 %. Élargir ne referme jamais la porte à quelqu'un qui l'avait franchie —
propriété qu'un tirage au sort n'aurait pas, et qui ne survivrait pas non plus à
un redémarrage. Une vendeuse qui a mis son catalogue en ligne lundi ne peut pas
se retrouver dehors mercredi parce qu'un chiffre a bougé. Vérifié par un test
sur les cent transitions de pourcentage.

### Le garde ne bloque jamais une lecture

Une vendeuse hors vague voit tout ce qu'elle possède. Cacher les données de
quelqu'un parce qu'un pourcentage n'est pas encore monté serait à la fois cruel
et absurde : le risque qu'une ouverture progressive borne est celui des
écritures nouvelles, pas d'un `SELECT` que la base sert depuis des mois.

Et **le parcours acheteuse n'est jamais filtré**. Une acheteuse ne choisit pas
sa vendeuse en fonction de nos vagues ; lui refuser la contre-signature
casserait le contrôle n° 7 pour une raison qui ne la regarde pas.

---

## 7. La cible de charge est une hypothèse, et elle est écrite comme telle

### Décision

`scripts/charge/charge.mjs` porte le calcul du pic du 8 mars **en toutes
lettres, entrée par entrée, avec le statut de chacune** :

| entrée | valeur | statut |
|---|---|---|
| vendeuses de la cohorte | 500 | **supposée** |
| commandes par vendeuse le 8 mars | 20 | **supposée** |
| concentration sur 4 heures | 100 % | **supposée** |
| requêtes d'API par commande | 8 | estimée à partir du parcours |

→ 5,6 req/s de pic, **cible 3× = 17 req/s**.

### Pourquoi ne pas simplement écrire un grand nombre

Parce que Catalog n'a pas de trafic, et qu'inventer une valeur plausible est ce
qu'`AGENTS.md` §7.7 interdit. Le chiffre obtenu est petit, et c'est
l'information la plus utile du fichier : **ce qui doit tenir le 8 mars n'est pas
un volume, c'est une latence sous charge soutenue avec une base qui grossit.**

Mesuré en local : 17 req/s → p95 8 ms ; 300 req/s (17× la cible) → p95 6 ms,
aucune erreur. Ces chiffres ne disent rien de l'infrastructure réelle, et la
checklist le note comme tel.

### Le détail qui invalide tout si on l'oublie

Depuis une seule machine, toutes les requêtes portent la même adresse — et la
limitation de débit les refuserait à 120 par minute. On mesurerait alors la
limitation, pas le service. Chaque utilisateur virtuel porte donc un
`X-Forwarded-For` distinct, ce qui est aussi la vérité du terrain, et le script
signale en clair toute réponse 429.

### Le compteur de débit vit en mémoire du processus

Conséquence à dire tout haut : avec N instances, la limite effective est N fois
celle qui est écrite. Arbitrage assumé — un compteur partagé demanderait un
Redis, donc une dépendance de plus à auditer, sauvegarder et surveiller, pour
une v1 qui tient sur une instance. Le jour où l'on passe à deux, un seul module
change.

---

## 8. L'audit bloque sur les dépendances de PRODUCTION

### Décision

La CI lance `pnpm audit --prod --audit-level high`. Des résolutions
(`brace-expansion`, `tmp`, `uuid`) rendent par ailleurs l'audit complet vide.

### Pourquoi `--prod` pour la porte

Un avis sur `@lhci/cli` décrit du code qui tourne deux minutes sur un exécuteur
d'intégration continue. Un avis sur Hono, Prisma ou Better Auth décrit du code
qui tourne devant des paiements. Les mettre dans le même rapport bloquant, c'est
apprendre à l'équipe à passer au-dessus des deux — et le jour où la ligne qui
compte apparaît, elle se noie.

### Pourquoi les résolutions quand même

Un rapport qui affiche en permanence deux lignes rouges « connues et sans
gravité » est un rapport qu'on cesse de lire. Un audit ne vaut que s'il est
vide.

Les trois montées traversent des frontières de version majeure (`uuid` 8 → 11
passe en modules ES). Elles ont donc été **vérifiées et non supposées** : build
de l'app vendeuse avec `vite-plugin-pwa`, et `pnpm shop:lighthouse` complet —
quinze passages, toutes les assertions vertes.

---

## 9. La page de statut refuse de dire deux choses

`GET /api/statut` et `/statut` rendent la position de l'interrupteur, la
joignabilité de la base, et le message d'incident écrit à la main. Pas plus.

Deux absences sont délibérées (AGENTS.md §7.7) :

- **aucun pourcentage de disponibilité.** Une disponibilité se mesure depuis
  l'extérieur ; un service qui calcule la sienne affiche 100 % exactement quand
  il est incapable de répondre ;
- **aucun voyant « formats SMS ».** Le canari du lot 14 tourne en intégration
  continue ; ce processus ne sait pas s'il est vert. Afficher « formats SMS :
  OK » serait une affirmation qu'aucun code ne soutient.

La page dit à la place où l'information existe vraiment.

Deux choix de conception s'y ajoutent :

- **la page est servie par le CDN**, donc elle s'affiche même quand l'API est
  morte — une page de statut hébergée avec le service qu'elle décrit tombe avec
  lui, exactement au moment où on la regarde ;
- **le silence est traité comme une information.** Ne pas obtenir de réponse
  depuis une page servie par le CDN veut presque toujours dire que le service
  est arrêté, et l'îlot l'écrit ainsi plutôt que d'afficher « erreur de
  chargement ».

`/api/statut` répond **200 même en panne** : le code HTTP décrit la réponse à
cette requête, pas l'état du service. Un 503 empêcherait une supervision de
distinguer « la page de statut est tombée » de « le service est arrêté », qui
sont deux incidents différents.

---

## Conséquences

- Un défaut de conformité à `AGENTS.md` §2 est corrigé : le SMS d'émission ne
  peut plus produire « accepté ». Deux tests le verrouillent, l'un dans le
  domaine, l'autre contre la base.
- Le taux de contre-signature devient une métrique de **sécurité**. Il faut lui
  donner un seuil d'alerte avant l'ouverture.
- `pnpm build` de la boutique produit maintenant `dist/_headers`. Un
  déploiement qui ne servirait pas ce fichier livrerait la boutique sans
  politique de sécurité de contenu — la checklist le rappelle.
- Quatre points de la définition de terminé restent **non cochables depuis une
  session** : charge sur l'infrastructure réelle, budgets depuis un vrai réseau
  camerounais, retour arrière en préproduction, chaîne d'alerte. Ils sont
  listés dans `docs/runbooks/checklist-lancement.md` §6, pas déclarés faits.
