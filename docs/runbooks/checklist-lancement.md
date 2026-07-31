# Checklist de lancement

Cette liste se coche **avant** d'ouvrir à la première vendeuse qui n'est pas
dans la pièce. Elle n'est pas une formalité : chaque ligne existe parce que son
absence coûte quelque chose de précis, et ce coût est écrit à côté.

Trois colonnes de statut, et une seule est acceptable au lancement :

| Statut | Sens |
|---|---|
| ✅ | vérifié, par une commande ou par un geste, et la preuve est reproductible |
| ⏳ | **ne peut pas être vérifié depuis une session de développement** — voir §6 |
| ❌ | à faire |

---

## 1. Ce que la chaîne de vérification garantit

Une seule commande, et elle doit passer entièrement :

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

| # | Point | Statut | Ce que son absence coûterait |
|---|---|---|---|
| 1.1 | Les cinq commandes passent | ✅ | — |
| 1.2 | `pnpm test:coverage` — 90 % sur `src/domain` | ✅ | Une règle d'argent non vérifiée |
| 1.3 | `pnpm audit --prod --audit-level high` est vide | ✅ | Du code vulnérable devant des paiements |
| 1.4 | Le canari de formats est vert | ✅ | Impossible de répondre « est-ce nous ou l'opérateur ? » |

Le canari se relance à la main le jour où l'on doute :

```bash
pnpm --filter @catalog/api exec vitest run src/__tests__/canari-formats.test.ts
```

---

## 2. La revue de sécurité

| # | Point | Statut | Vérification |
|---|---|---|---|
| 2.1 | En-têtes de sécurité sur **toutes** les réponses de l'API | ✅ | `securite-http.test.ts` |
| 2.2 | En-têtes et CSP sur la boutique | ✅ | `dist/_headers`, `entetes.test.ts` |
| 2.3 | `Referrer-Policy: no-referrer` des deux côtés | ✅ | **le jeton de suivi voyage dans l'URL** |
| 2.4 | CORS : joker uniquement sur les routes sans cookie | ✅ | `securite-http.test.ts` |
| 2.5 | Limitation de débit sur les routes publiques | ✅ | `debit.test.ts`, `securite-http.test.ts` |
| 2.6 | Plafond de taille des corps, compté sur les octets reçus | ✅ | un corps sans `Content-Length` est refusé |
| 2.7 | Le jeton de suivi n'est projeté par aucune route | ✅ | `jeton-jamais-expose.test.ts` |
| 2.8 | Aucun champ de code secret nulle part | ✅ | `pas-de-code-secret.test.ts` |
| 2.9 | L'adaptateur agrégateur reste inatteignable | ✅ | `aggregator-dormant.test.ts` |
| 2.10 | Le SMS brut n'apparaît dans aucune trace | ✅ | `traces-sans-sms.test.ts` |

### Les quatre attaques sur la preuve

Chacune a un test qui prouve son échec (`attaques-preuve.test.ts`) :

| Tentative | Ce qui l'arrête |
|---|---|
| Rejouer un identifiant, chez soi ou chez une autre vendeuse | Contrôle n° 5 — contrainte `UNIQUE` en base |
| Soumettre un SMS forgé, pour chaque motif | Contrôles n° 1 à 4 selon la forgerie |
| Contresigner sans le lien de suivi | Ni la référence, ni le code, ni l'identifiant n'ouvrent |
| Faire passer un motif `aConfirmer` pour confirmé | Le drapeau vient du motif, jamais de la requête |

> **Ce que la revue N'a PAS pu écarter, et qu'il faut savoir avant d'ouvrir.**
> Aucun des six contrôles purs ne détecte un SMS MTN bien formé dont
> l'identifiant est inventé : onze chiffres opaques ne se contredisent pas.
> Ce qui protège alors est le contrôle n° 7 — la contre-signature de
> l'acheteuse — et lui seul. Une preuve fabriquée reste `prouve`, elle
> n'atteint jamais `contresigne`, et le reçu affiche la différence en toutes
> lettres. **Conséquence opérationnelle : le taux de contre-signature est une
> métrique de sécurité, pas de confort.** S'il s'effondre, la seule protection
> contre la fabrication s'effondre avec lui.

---

## 3. La tenue en charge

```bash
pnpm charge --base=https://api.catalog.cm --duree=120
```

| # | Point | Statut | Note |
|---|---|---|---|
| 3.1 | Le script existe et tourne | ✅ | `scripts/charge/charge.mjs` |
| 3.2 | Passe à 3× le pic **modélisé**, en local | ✅ | 17 req/s ; p95 8 ms |
| 3.3 | Tenu à 300 req/s en local, soit 17× la cible | ✅ | p95 6 ms, aucune erreur |
| 3.4 | Passe à 3× le pic sur **l'infrastructure réelle** | ⏳ | §6 |

> **La cible de 17 req/s est une HYPOTHÈSE, pas une mesure.** Elle est calculée
> à partir de nombres que personne ne connaît encore — 500 vendeuses,
> 20 commandes chacune le 8 mars —, et le calcul est écrit en toutes lettres en
> tête de `scripts/charge/charge.mjs` pour qu'une mesure réelle le remplace en
> une ligne. Le chiffre est petit, et c'est l'information utile : ce qui doit
> tenir le 8 mars n'est pas un volume, c'est une **latence sous charge
> soutenue avec une base qui grossit**.

Un détail qui invalide la mesure si on l'oublie : depuis une seule machine,
toutes les requêtes portent la même adresse et la limitation de débit répond à
la place du service. Le script pose un `X-Forwarded-For` distinct par
utilisateur virtuel, et signale en clair toute réponse 429.

---

## 4. L'ouverture et l'arrêt

| # | Point | Statut | Vérification |
|---|---|---|---|
| 4.1 | `INTERRUPTEUR_FICHIER` pointe sur un chemin inscriptible | ❌ | à poser au déploiement |
| 4.2 | Basculer en `lecture_seule` garde les reçus lisibles | ✅ | `securite-http.test.ts`, `ouverture.test.ts` |
| 4.3 | Le runbook d'arrêt et de retour arrière existe | ✅ | [interrupteur-et-retour-arriere.md](interrupteur-et-retour-arriere.md) |
| 4.4 | Retour arrière déclenché en préproduction | ⏳ | §6 |
| 4.5 | `COHORTE_POURCENT` posé à la valeur de la première vague | ❌ | décision produit |
| 4.6 | Les identifiants des vendeuses pilotes sont dans `COHORTE_PILOTES` | ❌ | après le terrain |
| 4.7 | La page `/statut` est en ligne et servie par le CDN | ✅ | `apps/shop/src/pages/statut.astro` |

---

## 5. Ce qui doit être décidé, pas codé

Ces lignes ne sont pas des oublis : ce sont des décisions de produit qu'aucune
session de développement ne peut prendre à la place de quelqu'un.

| # | Décision | Statut |
|---|---|---|
| 5.1 | Perte de données maximale acceptable (combien d'heures de commandes) | ❌ |
| 5.2 | Délai de remise en service visé | ❌ |
| 5.3 | Qui est prévenu, et par quel canal, quand l'interrupteur bascule | ❌ |
| 5.4 | Taille de la première vague | ❌ |
| 5.5 | Le seuil de contre-signature au-dessous duquel on s'inquiète | ❌ |

Le 5.5 mérite d'être posé avant l'ouverture, pas après : c'est la seule
protection contre la fabrication de preuves, et un seuil décidé après coup se
décide toujours au niveau où l'on se trouve.

---

## 6. Ce qui ne peut pas être coché depuis une session

Quatre points de la définition de terminé du lot 15 exigent une infrastructure
réelle, un téléphone réel, ou un réseau camerounais réel. Ils sont listés ici
plutôt que déclarés faits.

| # | Point | Pourquoi une session ne peut pas le faire |
|---|---|---|
| 6.1 | Test de charge à 3× le pic sur l'infrastructure réelle | Un conteneur de développement ne dit rien de la base de production, du répartiteur ni du réseau |
| 6.2 | Budgets de performance depuis un vrai réseau camerounais | Un profil « Slow 4G » bridé est une simulation ; la latence réelle, la perte de paquets et le coût du forfait ne se simulent pas |
| 6.3 | Retour arrière déclenché volontairement en préproduction | Une procédure jamais jouée est une hypothèse |
| 6.4 | Chaîne d'alerte : chaque alerte déclenchée une fois | Hérité du lot 14. Une alerte jamais vue pointe souvent vers un tableau de bord vide ou un destinataire parti |

S'y ajoutent les **deux inconnues de terrain** d'AGENTS.md §10, qui ne sont pas
des tâches de lancement mais qui changent ce que l'interface affiche :

- le SMS Orange de réception reste reconstitué (`aConfirmer`) ;
- les raccourcis USSD paramétrés restent non vérifiés (`verifie: false`).

Une demi-journée à Douala lève les deux. Aucun lot de code ne le peut.
