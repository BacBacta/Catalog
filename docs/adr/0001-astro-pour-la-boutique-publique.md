# 0001 — Astro pour la boutique publique, SPA pour l'espace vendeuse

- Statut : accepté
- Date : 2026-07-28

## Contexte

Deux surfaces aux contraintes opposées. La boutique publique est ouverte par
des acheteuses sur des réseaux mobiles saturés, souvent sur un forfait data
compté : elle doit être minuscule et servie depuis un point de présence CDN.
Le Cameroun n'a pas de PoP Cloudflare confirmé ; les plus proches sont Lagos,
Accra et Kinshasa. Plus la page est statique, plus elle est servie de là et
jamais depuis l'origine européenne.

L'espace vendeuse est entièrement derrière authentification : il n'y a rien à
mettre en cache côté CDN. La vendeuse l'ouvre tous les jours, donc les visites
répétées dominent.

## Décision

- Boutique publique : **Astro 7**, le seul framework dont le défaut est zéro
  JavaScript. Îlots uniquement là où il y a réellement de l'interactivité.
- Espace vendeuse : **React Router 8 en SPA**, avec service worker. Une coquille
  en cache démarre plus vite en visite répétée qu'un rendu serveur.

## Conséquences

- Deux frameworks à maintenir. Coût accepté : chacun a un seul rôle, et le
  design system est partagé via `packages/ui`.
- Le budget de 30 Ko de JS sur la boutique devient tenable, et il est appliqué
  par `size-limit` dans la CI.
- Corollaire : aucune bibliothèque de graphiques, aucune police téléchargée.
