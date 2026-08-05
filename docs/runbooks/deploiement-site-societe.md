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

## Créer le projet

1. Vercel → **Add New… → Project** → le dépôt Catalog.
2. **Root Directory** : `apps/site`.
   C'est le seul réglage qui compte. Vercel lit alors `apps/site/vercel.json`.
3. **Framework Preset** : *Other* — la commande est déjà dans `vercel.json`.
4. Déployer. La première construction doit sortir **3 pages**.

Si Vercel se plaint de ne pas trouver pnpm : *Settings → General → Install
Command* → `pnpm install --frozen-lockfile`.

## Brancher le domaine

*Settings → Domains* → ajouter **les deux** :

- `horizonservices.store` — le principal ;
- `www.horizonservices.store` — en **redirection** vers le premier.

Les deux formes doivent répondre. Le domaine a été acheté en `www` ; une
personne qui tape l'un ou l'autre doit arriver, et un vérificateur qui compare
l'URL déclarée à celle qu'il atteint ne doit pas trouver deux sites.

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
