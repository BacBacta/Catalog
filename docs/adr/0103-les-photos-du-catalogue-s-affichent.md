# 0103 — Les photos du catalogue s'affichent, ou la construction échoue

Date : 2026-08-15
Statut : accepté
Câble : 0017 (les photos de catalogue sont publiques, `MEDIA_PUBLIC_BASE`)
Complète : 0102 (la cause d'une photo perdue se dit à la vendeuse)

## Constat — deux maillons cassés, aucun bruit

Le 15/08/2026, en préproduction, un article publié avec photo s'affichait
avec un **cadre vide** sur la boutique publique. L'enquête a trouvé deux
défauts distincts, et un troisième qui n'est pas du code.

### 1. La base publique des photos n'était posée nulle part

`apps/shop/src/lib/catalogue.ts` :

```ts
export const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE ?? "/media";
```

L'ADR 0017 avait décidé la variable ; **personne ne l'avait jamais câblée**.
Elle n'apparaissait dans aucun workflow, aucun `.env.example`, aucun runbook
— seulement dans le texte de l'ADR qui l'annonçait.

Le défaut retombait donc sur `/media`, un chemin **relatif à l'origine Vercel
de la boutique**. Or `vercel.json` ne réécrit que `/v/*` et `/suivi/*` :
chaque `<img>` pointait vers une adresse où rien ne répond.

**Rien n'échouait** : ni le build, ni le budget de poids (les images en sont
exclues, bornées ailleurs à 100 Ko par objet), ni un test. Le seul endroit où
ça se voyait était l'écran d'une acheteuse. C'est mot pour mot le défaut 4.9
de la checklist de lancement, dans une autre variable.

### 2. La cause d'une photo perdue n'était observable nulle part

`mesurerMediaBot` sépare proprement `lecture_cdn`, `dechiffrement` et
`reencodage` — mais il n'écrit que dans un compteur OpenTelemetry, et sans
`OTEL_EXPORTER_OTLP_ENDPOINT` l'API rend un instrument **sans effet**. La
préproduction n'a pas de collecteur. La cause existait donc, calculée, et
n'atteignait personne : ni la vendeuse (c'est l'ADR 0102), ni nous.

### 3. Ce qui n'est pas du code — le projet Vercel

Les deux déploiements du 15/08 portent `▲ Aliased
https://dist-gules-zeta-13.vercel.app`, tandis que
`catalog-boutique-preprod.vercel.app` répond `404` sur toute page de
boutique. `VERCEL_PROJECT_ID` désigne un projet nommé `dist` — le nom du
répertoire déployé — et non celui dont `catalog-boutique-preprod` est le
domaine.

Le pas « La boutique sert la nouvelle version » reste vert parce qu'il
n'interroge que `/`, la page d'accueil statique, identique dans les deux
projets. **C'est un vert qui ment**, et il n'est pas corrigé ici : repointer
un projet ou rattacher un domaine est une décision d'exploitation, pas un
changement de code.

## Décision 1 — sans base publique, on refuse de construire

Le workflow gagne un pas de garde, jumeau de celui d'`API_BASE_URL` : absente
ou relative, `MEDIA_PUBLIC_BASE` arrête le déploiement en disant quoi poser.
Mieux vaut ne pas déployer que publier un catalogue aux photos mortes.

La variable est **passée à l'étape de construction**, sans quoi le garde-fou
vérifierait une valeur que le build n'utilise pas.

## Décision 2 — elle est DISTINCTE de `S3_ENDPOINT`

L'endpoint de l'API S3 sert à écrire, avec signature ; chez R2 il répond
`403` en lecture anonyme. La base publique est le domaine public du bucket,
ou le CDN devant lui. **Elle ne se dérive pas** de la configuration de
stockage, et le code ne tente pas de la deviner : une valeur devinée
produirait exactement le même cadre vide, en plus difficile à voir.

C'est aussi pourquoi elle n'est pas servie par l'API à la façon de
l'instantané (ADR 0070) : l'API connaît son endpoint d'écriture, pas
l'adresse publique de lecture, qui peut ne pas exister.

## Décision 3 — la cause se lit dans le journal

`creerArticleDepuisFil` écrit une ligne quand une photo demandée n'a pas pu
être enregistrée : **la cause et le transport, rien d'autre**. Jamais
d'octets, jamais d'identifiant de média, et surtout jamais l'URL du CDN —
elle porte les clés de déchiffrement. Même régime que les traces : une liste
fermée de ce qui sort (ADR 0023), et un test le vérifie.

C'est ce qui permettra de répondre, la prochaine fois : téléchargement,
déchiffrement, ou ré-encodage ?

## Ce que cet ADR NE fait pas

- **Il ne dit toujours pas pourquoi la photo du 15/08 a échoué.** Le stockage
  est un vrai S3 — la route mémoire n'est pas montée, mesuré —, donc l'échec
  est entre le téléchargement et le ré-encodage. La prochaine occurrence le
  dira, dans le fil et dans le journal.
- **Il ne repointe aucun projet Vercel** (constat 3).
- Il ne rend pas le bucket public : c'est une configuration du fournisseur,
  et l'ADR 0017 en pose seulement la règle.

## Preuves

- `deploiement.yml` — le pas de garde refuse une base vide **et** une base
  relative ; `MEDIA_PUBLIC_BASE` entre dans l'étape de construction.
- `bot-ouverture-photo.test.ts` — la cause part au journal, avec le
  transport, et **sans** l'identifiant de média.
- `docs/runbooks/deploiement.md` — ce que la variable vaut, ce qu'elle ne
  vaut pas, et pourquoi elle se lit à la construction.
