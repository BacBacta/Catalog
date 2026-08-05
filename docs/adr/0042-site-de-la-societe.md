# 0042 — Le site de la société, déployé à part

Date : 05/08/2026 · Statut : accepté · Complète : 0041

## Contexte

L'ADR 0041 a mis la confidentialité et l'identité légale sur la racine de la
**boutique publique**, faute de mieux. C'était le bon geste dans l'urgence et
le mauvais endroit : le domaine acheté est `horizonservices.store`, au nom de
la société, et c'est lui qui sera déclaré à 360dialog puis à Meta.

Deux publics et deux rythmes se retrouvaient sur la même page. Le porteur du
produit a tranché : un site à part, un déploiement à part.

## Décision 1 — Un second projet Vercel, pas une page de plus

`apps/site` est une application Astro autonome, avec son propre déploiement.

| | `apps/shop` | `apps/site` |
|---|---|---|
| Rôle | le produit : boutiques, reçus, suivi | qui édite Catalog, ce qu'il fait |
| Dépend de | l'instantané du catalogue | rien |
| Se reconstruit | quand une vendeuse publie | quand on change un texte |

**Le point décisif est la dépendance.** La boutique ne se construit pas sans
`shop:snapshot`, c'est-à-dire sans un export de la base — c'est voulu (ADR
0006 : pas de fausse boutique publiée). Faire dépendre du même export la page
que Meta vérifie ferait tomber le site institutionnel le jour où la base est
indisponible, c'est-à-dire le mauvais jour.

## Décision 2 — L'identité vit dans `contracts`, pas dans deux copies

`packages/contracts/src/editeur.ts`, exporté en sous-chemin
`@catalog/contracts/editeur`, lu par les deux applications.

Le premier réflexe avait été de copier le fichier dans le nouveau site. C'est
exactement la dérive contre laquelle l'ADR 0041 met en garde : deux
dénominations sociales qui divergent d'un mot, et un vérificateur qui compare
le site au document déposé trouve l'incohérence.

Le sous-chemin, et non le baril : la règle de l'ADR 0017 tient ici aussi — le
baril réexporte les schémas Zod, dont les déclarations ont des effets de bord
au niveau du module.

## Décision 3 — Une seule politique de confidentialité, sur le site

Elle déménage de la boutique vers le site. La boutique y renvoie par un lien
absolu.

Deux copies d'un texte juridique divergent — l'une se corrige, l'autre non — et
c'est précisément le genre d'écart qu'un vérificateur relève. Le lien qui sort
du domaine est normal et compris de tous.

## Décision 4 — Zéro JavaScript, garanti par l'en-tête

Le site n'a aucune interaction : ni cadriciel d'interface, ni compteur, ni
traceur. `vercel.json` pose `default-src 'none'` — la page qui affirme que nous
ne vendons aucune donnée **ne peut pas** charger un mouchard, ce n'est pas une
promesse mais une contrainte.

Aucune police téléchargée non plus, pile système : même raison que pour la
boutique, le forfait de la vendeuse.

## Décision 5 — L'apex est canonique

Le domaine a été acheté en `www` ; les deux formes doivent répondre, `www`
redirigeant vers l'apex. Les pages déclarent une canonique absolue vers l'apex.

Sans canonique, `www` et l'apex sont deux sites pour un moteur — et pour un
vérificateur qui compare l'URL déclarée à celle qu'il atteint.

## Ce que ça ne fait pas

- **Aucun formulaire de contact.** Il supposerait un point de réception, un
  stockage des messages et une politique pour eux. Une adresse de courriel ne
  suppose rien, arrive au même endroit, et se met à l'épreuve : le vérificateur
  écrit, on répond.
- **Aucune page de tarifs.** Le modèle — abonnement, 0 % de commission — est
  dit dans le corps du texte parce qu'il découle de l'architecture (ADR 0009).
  Afficher une grille tarifaire est une décision commerciale qui n'a pas été
  prise.
- **Aucune traduction.** Le site est en français. L'anglais suivra le jour où
  une lectrice anglophone le demandera, pas avant.
- **Ça ne branche pas le domaine.** DNS et certificat sont des gestes de
  console, décrits dans `docs/runbooks/deploiement-site-societe.md`.
