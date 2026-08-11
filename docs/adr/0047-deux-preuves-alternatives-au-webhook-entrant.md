# 0047 — Les deux preuves du webhook entrant sont alternatives

Date : 2026-08-07
Statut : accepté
Corrige : une affirmation de `.env.example` et une condition de
`routes/whatsapp-entrant.ts`
Concerne : `apps/api/src/routes/whatsapp-entrant.ts`

## Contexte

Le bot est resté muet une journée entière. Trois causes se sont succédé, et
chacune masquait la suivante — c'est ce qui a rendu le diagnostic long.

| Heure | Journal | Cause |
|---|---|---|
| 14:29 → 16:06 | `signature=false en-tete=false` | l'en-tête n'était pas enregistré chez 360dialog |
| **16:20 →** | **`signature=true en-tete=true`** | **la règle de cette route** |

La première cause est traitée par `docs/terrain/webhook-360dialog.mjs` : la
console 360dialog a deux endroits pour régler le webhook, et le plus visible
efface les *Custom Headers*. Deux tentatives à la main ont donné
`"headers": {}`.

Une fois l'en-tête posé des deux côtés, les livraisons ont continué d'être
refusées — cette fois avec `signature=true en-tete=true`. **Les deux preuves
étaient présentes et valides, et la route refusait quand même.**

## Ce qui était faux, en deux endroits

### 1. `.env.example` affirmait que 360dialog ne signe pas

> « Les webhooks relayés par 360dialog NE SONT PAS SIGNÉS (pas de
> `X-Hub-Signature-256` : c'est un mécanisme Meta directe). »

**C'est faux pour le relais v2.** Il répercute la signature de Meta, calculée
avec le secret d'application de **360dialog** — que nous n'avons pas, et
n'aurons jamais : c'est leur application, pas la nôtre.

Toute la conception de la route reposait sur cette phrase.

### 2. La route exigeait l'absence de signature

```ts
const parEnTete =
  fournie == null &&                       // ← la condition fautive
  deps.authEnTete != null &&
  egalConstant(c.req.header("authorization"), deps.authEnTete);
```

Le commentaire justifiait ainsi : « une signature présente et fausse reste un
refus ». L'intention était bonne — refuser une preuve invalide — mais la
conclusion ne suit pas.

**Cette condition ne protégeait de rien.** C'est l'appelant qui décide
d'envoyer une signature ou non. Quelqu'un qui connaîtrait
`WABOT_WEBHOOK_AUTH` et voudrait entrer omettrait simplement l'en-tête de
signature, et passerait. La condition n'écartait donc aucun attaquant — elle
n'écartait que du trafic légitime, celui du relais qui signe avec une clé
étrangère.

Une garde qui n'arrête que les honnêtes gens n'est pas une garde.

## Décision

Les deux preuves sont **alternatives**, et chacune suffit :

```ts
const parEnTete =
  deps.authEnTete != null && egalConstant(c.req.header("authorization"), deps.authEnTete);
if (!parSignature && !parEnTete) → 401
```

- **Une signature Meta valide** prouve que Meta a envoyé.
- **Un en-tête partagé valide** prouve que le relais configuré a envoyé.

L'une ou l'autre ouvre la porte. Rien d'autre ne l'ouvre.

Ce que le changement **ne** fait pas : ouvrir sur une signature étrangère
seule. Sans en-tête valide, une livraison signée par un tiers reste un 401 —
un test le tient.

## Ce qui garde la décision

Trois cas dans `connexion-whatsapp-flux.test.ts`, et le premier a été
**vérifié rouge** avec l'ancienne règle avant d'être vert avec la nouvelle :

1. l'en-tête partagé ouvre **même** quand une signature étrangère accompagne
   la livraison — le cas réel du 07/08/2026 ;
2. une signature étrangère **sans** en-tête valide reste un refus ;
3. la signature Meta ouvre toujours, en-tête configuré ou non — le chemin
   d'un WABA en propre ne régresse pas.

## Ce que cet épisode apprend

**Le journal de refus a fait tout le travail.** Il ne recopie aucun contenu —
seulement la forme du refus, `signature=… en-tete=…` — et c'est exactement ce
qu'il fallait pour distinguer trois pannes qui, vues du téléphone, sont
rigoureusement identiques : un bot muet.

Sans lui, la troisième cause était indiagnosticable : la configuration était
juste des deux côtés, la sonde de bout en bout répondait `200`, et le bot ne
répondait toujours pas.

C'est un argument pour continuer à tracer la FORME des refus partout où une
authentification peut échouer de plusieurs façons.
