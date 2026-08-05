# Déployer le site de la société sur Vercel

`apps/site` → **https://horizonservices.store**

C'est un **second projet Vercel**, distinct de celui de la boutique publique.
Les deux vivent dans le même dépôt : Vercel sait construire un sous-répertoire
d'un monorepo, à condition qu'on le lui dise.

## Pourquoi deux projets et pas un

| | `apps/shop` | `apps/site` |
|---|---|---|
| Domaine | celui des boutiques | `horizonservices.store` |
| Rôle | le produit : boutiques, reçus, suivi | qui édite Catalog, ce qu'il fait, confidentialité |
| Dépend de | l'instantané du catalogue (`shop:snapshot`) | rien |
| Se reconstruit quand | une vendeuse publie | on change un texte |

Les mêler ferait dépendre la page que Meta vérifie d'un export de base de
données. Un site institutionnel qui ne se construit plus parce que la base est
indisponible est un site qui tombe le mauvais jour.

## Le projet existe déjà

Projet Vercel **`horizon-services-site`**, créé le 05/08/2026 par le CLI. Les
déploiements suivants tiennent en trois commandes.

## Déployer — on construit ICI, Vercel ne construit rien

```bash
pnpm --filter @catalog/site build

S=apps/site
rm -rf $S/.vercel/output && mkdir -p $S/.vercel/output/static
cp -r $S/dist/. $S/.vercel/output/static/
# config.json : redirection www → apex, puis les en-têtes de sécurité.
# Le fichier est reproduit à la fin de ce runbook.

vercel deploy --prebuilt --prod --yes --cwd $S
```

**Pourquoi pré-construit et non une construction distante.** Le site vit dans
un monorepo pnpm et lit `@catalog/contracts/editeur` : une construction dans
le sous-répertoire seul ne résoudrait pas la dépendance d'espace de travail.
Construire ici évite de dépendre du réglage *Root Directory* de la console, et
donne le même artefact que celui qu'on vient de tester.

**Corollaire à connaître** : `apps/site/vercel.json` n'est PAS lu par ce
chemin. Les en-têtes vivent dans `.vercel/output/config.json`. Le fichier
`vercel.json` reste pour qui rebrancherait un jour la construction Git.

## Le domaine : attaché côté Vercel, à pointer côté registrar

Les deux formes sont déjà rattachées au projet :

```bash
vercel domains inspect horizonservices.store --cwd apps/site
```

Il reste **un geste chez le registrar** (le domaine est chez un tiers, pas chez
Vercel). Vercel en propose deux ; **une seule est utilisable ici.**

- **A** — la bonne : garder le DNS chez Namecheap, et n'y corriger que deux
  lignes. Enregistrement `A` sur l'apex vers `76.76.21.21`, `CNAME` sur `www`
  vers `cname.vercel-dns.com`.
- **B** — ❌ **déléguer les serveurs de noms à `ns1/ns2.vercel-dns.com`.**
  `vercel domains inspect` la propose en évidence. **Ne pas la suivre.**

### Pourquoi la délégation casserait le courriel de la société

Relevé le 05/08/2026, dans la zone servie par Namecheap :

```
MX   10 mx1.privateemail.com / 10 mx2.privateemail.com
TXT  "v=spf1 include:spf.privateemail.com ~all"
```

C'est la boîte **`support@horizonservices.store`** — l'adresse que le site
affiche en très grand sur deux pages, et celle par laquelle une demande de
suppression de données doit arriver.

Déléguer la zone à Vercel remplace les serveurs de noms : les `MX` et le `SPF`
**ne sont plus servis par personne**, et le courriel cesse d'arriver dans la
minute. Vercel ne recopie pas les enregistrements existants. La voie **A**
laisse la zone en place et n'y touche que le web.

### Le geste chez Namecheap, pas à pas

Constaté le 05/08/2026, et **inchangé depuis** : le domaine résout vers
`192.64.119.150` — la page de parking de Namecheap — et `www` ne résout pas du
tout. `http://horizonservices.store/` rend un **302 vers `www.`**, servi par
`Namecheap URL Forward`, et `www` n'existe pas : c'est une boucle. HTTPS ne
répond pas.

Le rattachement côté Vercel ne suffit pas : tant que le DNS pointe ailleurs,
`horizonservices.store` ne montre rien.

Dans le tableau de bord Namecheap → *Domain List* → **Manage** →
**Advanced DNS** :

1. **Supprimer d'abord** la ligne `URL Redirect Record` sur `@` (ou
   `CNAME · @ · parkingpage.namecheap.com`). C'est elle qui sert le 302 vers
   `www`, et elle prime sur tout ce qu'on ajoute ensuite. Tant qu'elle est là,
   les étapes 2 et 3 ne changent rien de visible.
2. **Ajouter** `A Record` · Host `@` · Value `76.76.21.21` · TTL Automatic.
3. **Ajouter** `CNAME Record` · Host `www` · Value `cname.vercel-dns.com` ·
   TTL Automatic.
4. **Ne toucher à AUCUNE ligne `MX` ni au `TXT` qui commence par `v=spf1`.**
   Ce sont elles qui font arriver le courriel.

⚠️ **Ne pas ajouter les deux formes du même enregistrement.** Un `A` et un
`CNAME` sur le même hôte est un conflit, et la résolution devient aléatoire.

Compter de quelques minutes à deux heures de propagation. Pour vérifier sans
attendre le navigateur — qui garde son propre cache :

```bash
getent hosts horizonservices.store      # doit rendre 76.76.21.21
getent hosts www.horizonservices.store  # doit résoudre

# Et pour relire la zone sans dépendre du résolveur local :
curl -sS -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=horizonservices.store&type=A'
curl -sS -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=horizonservices.store&type=MX'
```

### Le courriel : la zone est prête, la boîte ne l'est peut-être pas

Les `MX` et le `SPF` pointent vers **Namecheap Private Email**. Cela dit que
le domaine sait recevoir ; cela ne dit **pas** que la boîte
`support@` existe. Elle se crée dans *Private Email* → *Mailboxes*, et la
seule vérification qui vaut est de s'écrire à soi-même depuis un compte
extérieur et de constater l'arrivée. Un `MX` correct sur une boîte inexistante
rend un rejet différé, invisible depuis l'extérieur.

**Tant que la boîte n'existe pas, ne pas déclarer l'URL à 360dialog** : le
site affiche cette adresse comme unique point de contact, et un vérificateur
qui écrit sans réponse conclut vite.

Vercel émet le certificat tout seul dès que la résolution est bonne, et envoie
un courriel. **Tant que HTTPS n'est pas émis, ne pas déclarer l'URL** : un
certificat en cours donne un avertissement de navigateur, et c'est ce que le
vérificateur verrait.

La redirection `www` → apex est faite **par le déploiement**, pas par la
console : une route conditionnée sur l'en-tête `Host` rend un 308. Elle est
donc versionnée avec le reste, et elle survit à une recréation du projet.

L'URL canonique des pages pointe l'apex (`astro.config.mjs`, champ `site`). Si
vous décidez l'inverse — `www` principal —, changez `EDITEUR.site` dans
`packages/contracts/src/editeur.ts` **et** ce champ, sinon les pages
déclareront une canonique qui redirige.

## Vérifier avant de déclarer l'URL à 360dialog

```bash
curl -sSI https://horizonservices.store/                | head -1   # 200
curl -sSI https://horizonservices.store/confidentialite | head -1   # 200
curl -sSI https://horizonservices.store/contact         | head -1   # 200
curl -sSI https://www.horizonservices.store/            | head -1   # 30x
```

**HTTPS doit répondre**, pas seulement HTTP : un certificat en cours d'émission
donne un avertissement de navigateur, et c'est ce que le vérificateur verra.
Vercel l'émet en quelques minutes après le branchement du DNS.

Puis, dans le gestionnaire WhatsApp : *Ajouter un site web* →
`https://horizonservices.store`.

## Ce qui doit rester vrai

- **Zéro JavaScript.** Le site n'a aucune interaction. Une page qui explique
  qu'on ne vend aucune donnée ne charge pas un mouchard pour compter ses
  visites — et `Content-Security-Policy` dans `vercel.json` l'interdit
  matériellement (`default-src 'none'`).
- **Aucune police téléchargée**, pile système. Même raison que pour la
  boutique : le forfait de la vendeuse.
- **Une seule politique de confidentialité**, ici. La boutique publique y
  renvoie par un lien absolu. Deux copies divergeraient, et c'est le genre de
  divergence qu'un vérificateur relève.
- **L'identité légale vient d'un seul fichier**,
  `packages/contracts/src/editeur.ts`, lu par les deux applications.

## Le jour où l'identité change

Un seul fichier à modifier : `packages/contracts/src/editeur.ts`. Les deux
sites suivent à la reconstruction suivante.

⚠️ Le numéro RCCM y est **lu sur un champ manuscrit** du registre. Il doit être
confirmé sur l'original ; un numéro faux est une mention légale fausse, et
c'est ce qu'un vérificateur recoupe avec le document déposé.

## Annexe — `.vercel/output/config.json`

Il n'est pas versionné (`.vercel/` est ignoré : le répertoire porte aussi les
identifiants de liaison du projet). Le voici, à recréer à chaque déploiement :

```json
{
  "version": 3,
  "routes": [
    {
      "src": "/(.*)",
      "has": [{ "type": "host", "value": "www.horizonservices.store" }],
      "headers": { "Location": "https://horizonservices.store/$1" },
      "status": 308
    },
    {
      "src": "/(.*)",
      "headers": {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      },
      "continue": true
    }
  ]
}
```

L'ordre compte : la redirection d'abord, les en-têtes ensuite avec
`"continue": true` — sinon la première route absorberait la requête et le
fichier ne serait jamais servi.

## Quand un déploiement reste bloqué en `UNKNOWN`

Constaté le 05/08/2026 : après plusieurs déploiements rapprochés, le CLI
affiche `Building…` indéfiniment et `vercel inspect` rend `status UNKNOWN`.
L'URL du déploiement répond bien `200` — mais elle sert la **page de
protection Vercel**, pas le site. C'est le piège : un `curl` qui ne regarde que
le code HTTP conclut que tout va bien.

```bash
# Ce qui distingue un vrai déploiement d'une page de protection :
curl -sS https://<url>/contact | head -c 120   # doit commencer par notre <html lang="fr">
```

Ce qui a été écarté, dans l'ordre :

- **une panne globale** — `vercel-status.com` annonçait *All Systems
  Operational*, zéro incident ouvert ;
- **la file d'attente saturée** — les cinq déploiements bloqués ont été
  supprimés (`vercel remove <url> --yes`), le suivant est resté bloqué quand
  même.

Reste une limite côté compte (le plan gratuit borne les déploiements par jour,
tous projets confondus). **Le déploiement précédent reste servi** : rien n'est
cassé, la mise en ligne est simplement différée. Réessayer plus tard, et
vérifier le CONTENU, pas le code HTTP.

⚠️ **Ne jamais tuer `vercel deploy` en cours** (`timeout`, Ctrl-C). Chaque
interruption laisse un déploiement fantôme en `UNKNOWN` qu'il faut ensuite
supprimer à la main. Le lancer en tâche de fond et attendre.

## Le piège du `vercel.json` dans un sous-répertoire

Constaté le 05/08/2026, sur une construction déclenchée depuis la console :

```
Error: No Output Directory named "dist" found after the Build completed.
```

**Les trois projets Vercel de ce dépôt ont `Root Directory = .`**, la racine.
Vercel lit donc `/vercel.json` — pas `apps/site/vercel.json`, qui n'est jamais
ouvert.

Ce qui l'a rendu dangereux plutôt qu'inerte : au tout premier déploiement CLI,
Vercel a **recopié dans les réglages du projet** le `buildCommand` et
l'`outputDirectory` trouvés dans `apps/site/vercel.json`. Le projet s'est donc
retrouvé avec « construis `apps/site`, cherche la sortie dans `dist` » — alors
qu'il construit depuis la racine, où `dist` n'existe pas.

Réglages corrects du projet `horizon-services-site` :

| Réglage | Valeur |
|---|---|
| Root Directory | `.` |
| Build Command | `pnpm --filter @catalog/site build` |
| Output Directory | **`apps/site/dist`** |
| Install Command | `pnpm install --frozen-lockfile` |

⚠️ **Ne pas créer de `vercel.json` à la racine du dépôt.** Les trois projets
partagent cette racine : il s'appliquerait aussi à la boutique et à l'app
vendeuse, et casserait leurs déploiements.

`apps/site/vercel.json` ne garde donc que les en-têtes, pour qui rebrancherait
un jour une construction avec `Root Directory = apps/site`. **Les en-têtes qui
comptent aujourd'hui sont dans `.vercel/output/config.json`**, reproduit en
annexe.

## Le projet est connecté à Git — c'est LUI qui déploie

Découvert le 05/08/2026, après avoir cherché longtemps du côté du CLI : le
projet est relié au dépôt. **Chaque push sur la branche de travail déclenche
une construction**, et elle aboutit en ~40 s.

Deux conséquences qui expliquent ce qui paraissait cassé :

1. Un push sur une branche qui n'est pas la branche par défaut produit un
   déploiement **Preview**, pas Production. Le site public ne bouge donc pas,
   même quand la construction réussit.
2. **Les déploiements `--prebuilt --prod` du CLI restent bloqués en `UNKNOWN`**
   sur ce projet depuis qu'il est relié à Git. Ils n'aboutissent jamais et il
   faut les supprimer à la main.

### La marche à suivre

```bash
git push                      # déclenche la construction (Preview sur une branche)
vercel ls --cwd apps/site     # relever l'URL du Preview « Ready »
vercel promote <url-preview> --yes --cwd apps/site
```

`promote` reconstruit avec l'environnement de production et bascule le
domaine. Compter ~40 s de plus.

**Ne plus utiliser `vercel deploy --prebuilt --prod` sur ce projet.** La
section « pré-construit » plus haut décrit ce qui marchait AVANT la liaison
Git ; elle reste vraie pour un projet non relié.
