# 0045 — Un monogramme dans l'onglet, et la CSP qui n'était pas servie

Date : 2026-08-05
Statut : accepté
Corrige : [0044](0044-site-societe-niveau-2026.md) — une affirmation fausse
Concerne : `apps/site`, réglages du projet Vercel `horizon-services-site`

## Contexte

Constat du porteur du produit : **l'onglet Chrome ne montre aucun logo.**

Le site n'avait effectivement aucune icône, ni fichier ni balise. Chrome
affichait donc son icône par défaut. En allant vérifier ce que le site sert
réellement, un second défaut est apparu — plus grave, et invisible sur toutes
les pages.

## Décision 1 — le monogramme

Un « H » blanc sur une tuile arrondie à la couleur de marque. C'est la lettre
du mot-marque, et c'est ce qui reste lisible à 16 px.

Deux choix de fabrication, tous deux contraints par la nature d'une favicon :

- **Le « H » est dessiné en `<rect>`, pas écrit en `<text>`.** Une favicon
  n'embarque pas sa police. Un `<text font-family="Georgia">` rendrait un
  Georgia sur un poste, un Arial sur un autre, et rien du tout sur un poste
  dépouillé. Les rectangles rendent la même forme partout.
- **Les empattements sont épais** (5 unités sur 64). À 16 px, un empattement
  fin disparaît dans le lissage et le serif devient un bâtons approximatif.
  L'empattement large est ce qui survit à la réduction — c'est la même raison
  qui a fait exister les caractères à empattement mécanique.

Trois fichiers, et chacun a une raison distincte :

| Fichier | Pourquoi il existe |
|---|---|
| `favicon.svg` | La source. Versionnée, lisible, modifiable à la main. |
| `favicon.ico` | Les navigateurs le demandent **à la racine, sans balise**. Sans lui, un 404 par page ouverte. |
| `apple-touch-icon.png` | L'écran d'accueil iOS ignore le SVG. |

`scripts/icones.mjs` régénère les deux binaires depuis le SVG. **Il se lance à
la main**, pas à la construction : les fichiers sont versionnés, et le site se
construit sans `sharp` — une dépendance native n'a rien à faire dans un paquet
qui n'a aucun code.

Le script emballe le PNG dans un conteneur ICO à la main. Le format accepte un
PNG tel quel depuis Vista ; l'en-tête tient en 22 octets, et cela évite
d'écrire un bitmap DIB et son masque de transparence.

**Un test vérifie que chaque icône déclarée existe vraiment.** Le défaut est
silencieux : un `href` mort ne casse rien, le navigateur retombe sur son icône
par défaut, et l'onglet reste vide — exactement le symptôme qu'on vient de
corriger.

## Décision 2 — la CSP était déclarée, pas servie

**L'ADR 0044 affirme que la CSP `default-src 'none'` interdit matériellement
tout script. C'était faux en production.** Les commentaires de `Base.astro` et
de `pages.test.ts` portaient la même affirmation.

Relevé :

```bash
curl -sSI https://<url>/ | grep -i content-security
# (rien)
```

### La cause

**Vercel lit `vercel.json` relativement au `Root Directory` du projet.** Celui
de `horizon-services-site` valait `.` — la racine du dépôt. Vercel cherchait
donc `/vercel.json`, un fichier qui n'existe pas et **qui ne doit pas
exister** : trois projets Vercel partagent cette racine, et un fichier
commun y casserait la boutique et l'app vendeuse.

`apps/site/vercel.json` n'était donc jamais ouvert. Aucun des quatre en-têtes
n'était servi.

Le chemin de déploiement pré-construit qui avait fonctionné plus tôt posait
les en-têtes dans `.vercel/output/config.json` — mais ce chemin a été abandonné
quand le projet a été relié à Git (ADR 0044, runbook). Les en-têtes sont partis
avec lui, sans que rien ne le signale.

### Ce qui rend le défaut coûteux

Il ne se voit **sur aucune page**. Le site s'affiche parfaitement sans
en-têtes. Il ne se constate qu'en regardant la réponse HTTP — ce que personne
ne fait quand la page est belle.

Et l'affirmation fausse portait précisément sur le point qu'un vérificateur
examine : la page de confidentialité promet qu'aucun traceur n'est chargé, et
la garantie technique de cette promesse était absente.

### La correction

`Root Directory` du projet mis à **`apps/site`**, les trois autres champs
vidés pour laisser le préréglage Astro faire son travail. `vercel.json` est
alors lu, et les quatre en-têtes sont servis :

```
content-security-policy: default-src 'none'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

Vérifié en production, pas seulement sur un aperçu.

## Ce qui reste vrai, et ce qui l'est redevenu

- Le site n'embarque **aucun JavaScript** — c'était vrai avant, et vérifiable
  dans le HTML servi. Ce qui manquait n'était pas l'absence de script, c'était
  la barrière qui l'empêche d'y revenir.
- `img-src 'self' data:` autorise les trois icônes : elles sont servies depuis
  le même domaine.

## La leçon à retenir du réglage

**Un en-tête déclaré n'est pas un en-tête servi.** La seule vérification qui
vaut est la réponse elle-même :

```bash
curl -sSI https://horizonservices.store/ \
  | grep -i "content-security\|x-frame\|x-content\|referrer"
```

Les quatre lignes doivent sortir. Si la commande ne rend rien, le
`Root Directory` a bougé. C'est écrit dans le runbook, à côté du réglage.

## Non fait, et signalé

- **La boutique publique (`apps/shop`) n'a aucune favicon non plus.** Son
  onglet est vide lui aussi. Le geste est le même, mais l'icône ne l'est pas :
  la boutique porte le nom d'une vendeuse, pas celui d'Horizon Services. C'est
  une décision de marque à prendre, pas un fichier à recopier.
- **Les deux autres projets Vercel** ont toujours `Root Directory = .`. Leur
  configuration n'a pas été relue ; si l'un d'eux compte sur un `vercel.json`
  de sous-répertoire, il souffre du même défaut.
