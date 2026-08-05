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
Vercel). Au choix, chez Namecheap :

- **A** — recommandé, le plus simple : enregistrement `A` sur l'apex vers
  `76.76.21.21`, et `CNAME` sur `www` vers `cname.vercel-dns.com`.
- **B** — déléguer : remplacer les serveurs de noms par `ns1.vercel-dns.com`
  et `ns2.vercel-dns.com`.

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
