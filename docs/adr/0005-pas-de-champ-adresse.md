# 0005 — Pas de champ « adresse » : quartier, point de repère et téléphone

- Statut : accepté
- Date : 2026-07-28

## Contexte

Il n'existe pas de système d'adressage postal utilisable au Cameroun. La CNUCED
le relève comme frein structurel à l'e-commerce. Yaoundé a lancé en 2016 un
programme pour nommer 5 100 rues, jamais mené à terme ; aucun programme
comparable n'est documenté pour Douala.

En pratique, le livreur se rend dans la zone, **appelle le destinataire**, et se
fait guider vers un point de repère. Le rendez-vous en un point convenu est
aussi fréquent que la livraison à domicile.

## Décision

Aucun champ `address`, nulle part. La livraison se modélise en
`{ mode, city, quartier, landmark, phone, geo? }`, avec `landmark` et `phone`
obligatoires en mode livraison.

Le **point de retrait convenu** est un mode de livraison de plein droit, pas
un cas dégradé — c'est d'ailleurs la stratégie vers laquelle les acteurs
rentables du secteur ont basculé.

## Conséquences

- Les quartiers sont une liste fermée par ville, maintenue dans
  `packages/contracts/src/delivery.ts`.
- La position GPS est facultative et jamais requise.
- Le point de repère est effacé 90 jours après la livraison (minimisation).
