# 0044 — Le site de la société au niveau de 2026, et deux mentions retirées

Date : 2026-08-05
Statut : accepté
Révise : [0043](0043-site-societe-editorial.md) — mise en page éditoriale
Concerne : `apps/site`, `packages/contracts/src/editeur.ts`

## Contexte

Le site de HORIZON SERVICES a été refondu deux fois en une journée. La
deuxième version — l'ADR 0043 — a posé le bon registre : éditorial, serif,
presque vide. Le retour du porteur du produit est resté le même : **« le site
n'est pas toujours premium »**, avec une demande explicite de comparer aux
meilleurs sites de 2026 et de monter à leur niveau.

Trois demandes de contenu accompagnaient la remarque :

1. retirer la phrase sur l'absence d'adresse postale de rue au Cameroun ;
2. retirer des mentions légales le **directeur de la publication** et
   l'**immatriculation RCCM** ;
3. le domaine ne fonctionne toujours pas, et vérifier l'adresse de courriel.

## Ce que le relevé de 2026 dit vraiment

Le relevé a porté sur les distinctions et les revues de l'année (Awwwards
site de l'année, sites du mois, revues de tendances). Quatre traits reviennent,
et **trois sont atteignables sous une CSP `default-src 'none'`** :

| Trait relevé | Atteignable ici ? |
|---|---|
| La typographie EST l'architecture — un titre à l'échelle de la fenêtre porte seul l'entrée | oui, et c'était déjà le parti |
| Néo-serif pour les titres, **mono pour les données** (dates, numéros, étiquettes) | oui, déjà en place |
| Blocs de couleur pleine à fort contraste, grilles visibles (néo-brutalisme assagi) | oui — c'est ce qui manquait |
| Transitions et révélations à 60 im/s, **en CSS et non en JavaScript** | oui, et c'est nouveau |
| Polices variables comme base | **non** — aucune police téléchargée ici |

Le dernier point est un écart assumé : la règle « aucune police téléchargée »
tient. La pile système donne un serif variable sur les plateformes récentes
(New York, Georgia) sans un octet transféré, et c'est ce qui est déclaré dans
`--serif`.

## Décision

### 1. Trois gestes de 2026, en CSS pur

La CSP interdit tout script. Ce n'est pas une limite à contourner : les trois
gestes qui séparent aujourd'hui une page correcte d'une page tenue sont
devenus du CSS.

- **`@view-transition { navigation: auto }`** — la transition d'un document à
  l'autre, en navigation classique. Le mot-marque de l'en-tête et la signature
  du pied portent un `view-transition-name` : ils sont **morphés** au lieu
  d'être refondus, donc ils ne clignotent pas au changement de page. C'est ce
  qui donne l'impression d'une application alors que chaque page est un
  fichier HTML statique.
- **`animation-timeline: view()`** — les révélations au défilement, calculées
  par le compositeur. Aucune bibliothèque, aucun `IntersectionObserver`, rien
  à charger.
- **`text-box: trim-both cap alphabetic`** — le rognage du demi-interligne.
  Sur un titre de 8 rem, l'espace fantôme au-dessus des capitales est
  exactement ce qui distingue une mise en page composée d'une mise en page
  posée.

Les trois dégradent en silence : un navigateur qui ne les connaît pas rend la
page fixe et correcte. **Aucune n'est une dépendance.**

### 2. Le mouvement ne touche jamais l'opacité d'un texte

Règle héritée du lot 2 (voir `tokens.css`) et tenue ici : un fondu rend le
contraste **dépendant de l'instant où on le mesure**, et axe-core lit la page
pendant l'animation. Les révélations sont donc des **translations**.

Deux tests le garantissent (`pages.test.ts`) :

- aucune `@keyframes` du site n'anime `opacity` — le corps de chaque bloc est
  extrait par équilibrage d'accolades, pas par une expression régulière
  approximative ;
- `prefers-reduced-motion: reduce` **nomme explicitement** les
  pseudo-éléments `::view-transition-*`. La règle globale de `tokens.css` vise
  `*` et ne les atteint pas : ils vivent dans un arbre à part. Sans cette
  règle, la page continuerait de fondre pour quelqu'un qui a demandé
  l'inverse.

### 3. La bande de repères — le bloc de couleur qui manquait

La page était quatre écrans de la même surface claire, sans une respiration.
La bande en est une : le **seul** bloc de couleur pleine du site.

Elle **n'affirme rien de neuf** : l'année est celle déjà écrite dans le jalon,
la ville est celle du siège, et le nombre de domaines est **calculé** depuis
la liste — la bande ne peut pas annoncer un chiffre que la liste ne tient
plus. Y mettre un chiffre d'affaires, un nombre de clients ou une année
d'expérience arrondie aurait été inventer (AGENTS.md §7.7).

**Elle s'inverse avec le thème.** La première version figeait ses couleurs
dans les deux thèmes : un `#0b1512` posé sur un fond `#0d0d0d`. En mode
sombre, la bande disparaissait purement et simplement, et avec elle la seule
respiration de la page. Son rôle est d'être **le contraire de la page** —
sombre sur clair, claire sur sombre.

### 4. Un défaut de contraste corrigé au passage

`--color-brand-700` n'est **pas** redéfini en mode sombre. L'accent du titre
géant et le survol des rangs l'utilisaient : `#0a5c48` sur `#0d0d0d` mesure
**2,4:1**, sous le seuil même pour du grand texte. Les deux passent à
`--color-brand-500`, qui s'éclaircit avec le thème : 4,8:1 en clair,
6,0:1 en sombre.

### 5. Deux mentions légales retirées

Retrait demandé par le porteur du produit. Il est défendable, et pour deux
raisons distinctes :

- **Le numéro RCCM a été lu sur un champ MANUSCRIT** du registre et n'est pas
  confirmé sur l'original. Une mention légale fausse est pire qu'une mention
  absente : c'est précisément ce qu'un vérificateur recoupe avec le document
  déposé.
- **Le nom du gérant est une donnée personnelle**, sur un site dont la page
  voisine promet de ne collecter que le minimum.

**Ce que le retrait coûte, et il faut le savoir :** l'usage OHADA attend le
numéro d'immatriculation et le directeur de la publication sur le site d'une
société, et un vérificateur qui cherche à rapprocher le site du registre ne
les trouvera plus. Les deux champs **restent dans
`packages/contracts/src/editeur.ts`** : c'est leur affichage qui est fermé, et
il se rouvre en une ligne le jour où les chiffres sont confirmés.

Restent : dénomination, forme juridique, capital, siège, courriel. Un test
(`pages.test.ts`) empêche les deux mentions de revenir par distraction.

> **Non fait, et signalé :** le pied de la boutique publique
> (`apps/shop/src/pages/index.astro`) affiche encore le RCCM **et** le nom du
> gérant. La demande portait sur le site de la société ; aligner la boutique
> est une décision à prendre, pas à déduire.

### 6. La phrase sur l'adresse postale

Retirée, comme demandé. Elle expliquait pourquoi le siège est une boîte
postale. L'explication reste vraie — l'ADR 0005 en fait une contrainte du
produit — mais une page de mentions légales n'est pas l'endroit où on
l'enseigne.

## Ce qui n'a PAS été fait, et pourquoi

- **Aucune police téléchargée**, malgré « les polices variables sont la base
  en 2026 ». La règle tient (AGENTS.md §2), et la pile système donne un serif
  variable sur les plateformes récentes.
- **Aucun WebGL, aucun défilement piloté**, qui sont ce que récompensent la
  plupart des distinctions de l'année. Ils supposent du JavaScript ; la CSP
  l'interdit, et une page qui affirme ne rien collecter ne charge pas un
  moteur de rendu pour l'annoncer.
- **Aucun chiffre inventé.** Voir la bande de repères ci-dessus.

## Le domaine — le diagnostic, et pourquoi il ne se règle pas ici

Relevé le 05/08/2026 :

```
horizonservices.store.      A     192.64.119.150   ← page de parking Namecheap
www.horizonservices.store.  —     ne résout pas
NS                          dns1/dns2.registrar-servers.com
```

`http://horizonservices.store/` rend un **302 vers `www.`**, servi par
`Namecheap URL Forward` — et `www` ne résout pas. C'est une boucle : la
redirection pointe vers un nom qui n'existe pas. HTTPS ne répond pas du tout.

Côté Vercel, **tout est en place** : les deux formes sont rattachées au projet
`horizon-services-site`, et le déploiement de production est servi. Le geste
manquant est **entièrement chez le registrar**, et il n'existe aucun moyen de
le poser depuis le dépôt.

### Le piège à ne pas tomber dedans

`vercel domains inspect` propose de **déléguer les serveurs de noms** à
`ns1/ns2.vercel-dns.com`. **Il ne faut pas le faire.** La zone actuelle porte
le courriel de la société :

```
MX   10 mx1.privateemail.com / 10 mx2.privateemail.com
TXT  "v=spf1 include:spf.privateemail.com ~all"
```

Déléguer la zone à Vercel **emporterait ces deux enregistrements avec elle**,
et `support@horizonservices.store` cesserait de recevoir — l'adresse même que
le site affiche en très grand sur deux pages. La voie à suivre est l'autre :
garder le DNS chez Namecheap et n'y corriger que deux lignes. Le runbook
`docs/runbooks/deploiement-site-societe.md` porte la marche à suivre.

## Conséquences

- Le site anime, et n'embarque toujours **aucun octet de JavaScript**.
- Deux tests de plus sur le mouvement, un de plus sur les mentions retirées.
- Le contraste du mode sombre est corrigé sur deux éléments.
- Le domaine reste bloqué par un geste chez le registrar, documenté et borné.
