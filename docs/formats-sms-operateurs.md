# Formats de SMS opérateurs — la vérité terrain

> **Ce fichier n'est pas de la documentation, c'est une spécification.**
> Les expressions régulières qu'il contient ont été écrites contre des messages
> réels et vérifiées contre eux. Elles se copient. On ne les réécrit pas de
> mémoire : un motif écrit au jugé se casse sur l'espace avant la parenthèse
> fermante, sur le numéro à douze chiffres, ou sur l'anglais.
>
> Dernière mise à jour : 29/07/2026.

---

## Note de confidentialité

Les messages reproduits ici sont **pseudonymisés**. Numéros, noms commerciaux,
identifiants de transaction et soldes ont été remplacés par des valeurs de
**forme strictement identique** : même longueur, mêmes séparateurs, mêmes
espaces parasites, mêmes mélanges de devise. Tout ce dont un analyseur dépend
est préservé ; rien de ce qui identifie une personne ne l'est.

Les captures d'origine restent hors du dépôt. **Ne jamais y committer un SMS
réel non pseudonymisé**, ni en test, ni en fixture, ni en commentaire.

---

## 1. Ce qui est confirmé et ce qui ne l'est pas

| Format | Source | État |
|---|---|---|
| MTN — paiement sortant | capture réelle 23/06/2026 | ✅ confirmé |
| MTN — transfert sortant inter-réseaux | capture réelle 23/06/2026 | ✅ confirmé |
| MTN — réception | capture réelle 23/06/2026 | ✅ confirmé |
| Orange — rechargement | capture réelle 29/07/2026 | ✅ confirmé |
| Orange — réception | capture **tronquée** 29/07/2026 | ⏳ **reconstitué** |
| Orange — envoi | aucune capture | ❌ absent |

**Le format Orange de réception est reconstitué.** De la capture, seule l'amorce
est lisible : `You have received 650 FCFA of`. Deux choses en sont acquises —
Orange écrit aussi en anglais, et la préposition est `of` — le reste est déduit.

Conséquence obligatoire dans le code : ce motif porte `aConfirmer: true`, le
contrôle n° 1 renvoie un **avertissement** et non un succès, et le verdict
plafonne à « accepté sous réserve ». Il ne se promeut jamais sans une capture
complète. C'est un drapeau, pas un commentaire.

---

## 2. Les messages

### MTN — paiement sortant

```
Votre paiement de 17000 XAF a Transfer To non MoMo Account a ete effectue le 2026-06-23 14:03:21. Votre nouveau solde: 12020 XAF. Frais: 378 XAF. Message: -. Transaction Id: 17600000001. Prix Cassés chez MoMo pour tout le monde ! 0 F sur tes transferts et -25% sur tes retraits Hors Taxe.
```

Ce que ce message apprend :

- Le destinataire est une **chaîne libre non exploitable** (`Transfer To non
  MoMo Account`), pas un numéro. Seul.
- Les frais sont ici de **378 F sur 17 000**, soit **2,22 %** hors réseau.
  C'est le chiffre de référence du produit ; toute affirmation de gratuité doit
  distinguer sur réseau et hors réseau.
- Le libellé du champ est `Transaction Id:` — **minuscule au `d`**. Le message
  de transfert, lui, écrit `ID transaction`. Deux libellés dans le même
  opérateur.
- Une queue publicitaire suit l'identifiant. Le motif doit s'arrêter avant.

### MTN — transfert sortant inter-réseaux

```
Transfert reussi de 17000 FCFA au 688000001 via Orange Cameroun a 2026-06-23 14:03:21 . ID transaction 17600000001.Nouveau solde 12020 FCFA.
```

- **Espace AVANT le point** dans `14:03:21 .`
- **Pas d'espace APRÈS le point** dans `17600000001.Nouveau`
- Le numéro est en **neuf chiffres**, sans indicatif.
- `via Orange Cameroun` confirme que **le transfert MTN → Orange fonctionne**.
  Une acheteuse MTN peut payer une vendeuse Orange sans que personne change
  d'opérateur. Cette contrainte redoutée n'existe pas.

**Ces deux messages portent le même identifiant** : un transfert produit deux
SMS. C'est une redondance utile — un contrôle croisé gratuit si les deux sont
collés.

### MTN — réception

```
Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32. Message de l'expediteur:. Votre nouveau solde est de 29398 FCFA. Frais: 0 XAF. Transaction ID: 17600000002.Prix Cassés chez MoMo pour tout le monde !
```

C'est **le message qui fait autorité** : celui que la vendeuse reçoit quand elle
est payée. Trois pièges, chacun suffisant à casser un analyseur naïf :

1. **Le numéro est en douze chiffres avec l'indicatif** — `237652000001` — alors
   qu'il est en neuf dans les messages d'émission. Toute comparaison passe par
   une normalisation, sinon un paiement parfaitement légitime est rejeté.
2. **Espace avant la parenthèse fermante** : `(237652000001 )`.
3. **L'expéditeur peut être une raison sociale** avec des espaces, pas seulement
   un prénom.

Deux détails annexes : la devise est **mixte dans le même message** (`XAF` pour
le montant, `FCFA` pour le solde), et **les frais sont à zéro à la réception** —
le coût est intégralement porté par l'émetteur, ce qui corrobore les 378 F.

Le libellé est ici `Transaction ID:` — **majuscules aux deux lettres**. Troisième
variante du même champ chez le même opérateur.

### Orange — rechargement

```
Rechargement reussi. Montant de la transaction: 650 FCFA, ID transaction: RC241204.1533.B00001, Frais: 0 FCFA, Commission: 0 FCFA, Nouveau solde: 108762.45 FCFA
```

Un rechargement ne prouve aucune vente. Il établit autre chose, de plus grande
portée : **la grammaire des identifiants Orange**.

- **Les soldes Orange portent des décimales** — `108762.45 FCFA` — alors que le
  franc CFA n'a pas de subdivision. Tout montant lu chez Orange est ramené à
  l'entier au moment de l'analyse.
- Orange sépare **frais** et **commission** en deux champs distincts, là où MTN
  n'en affiche qu'un.
- La structure est **à virgules**, sans phrase : `champ: valeur, champ: valeur`.
- **Ce message date de décembre 2024**, pas du jour de la capture : l'identifiant
  s'auto-date au 4 décembre 2024 à 15 h 33. C'est un ancien message resté
  visible dans le fil, photographié le 29/07/2026. Ce n'est pas une
  incohérence — c'est la première confirmation que la date inscrite dans
  l'identifiant est bien celle de l'opération.

### Orange — réception (tronqué)

```
You have received 650 FCFA of…
```

C'est tout ce que la capture contient. **Orange écrit en anglais** — dans un
pays bilingue c'était prévisible, encore fallait-il le voir. La préposition est
`of`, pas `from`.

Ce qu'il manque : la suite du message, chez quelqu'un qui vient d'être payé en
Orange Money. Un déroulement vers le bas, ou une seconde capture.

---

## 3. L'identifiant Orange se date lui-même

C'est la découverte la plus exploitable de la capture du 29 juillet.

```
RC 241204 . 1533 . B00001
││  └date┘   └h m┘   └séquence┘
└ type d'opération
```

| Segment | Contenu | Exemple |
|---|---|---|
| 2 lettres | type d'opération | `RC` rechargement, `MP` paiement marchand |
| 6 chiffres | date `AAMMJJ` | `241204` → 4 décembre 2024 |
| `.` | séparateur | |
| 4 chiffres | heure `HHMM` | `1533` → 15 h 33 |
| `.` | séparateur | |
| 1 lettre + 4-6 chiffres | séquence | `B00001` |

Les onze chiffres de MTN (`17600000001`) sont opaques : ils ne disent rien
d'eux-mêmes, donc ils **ne peuvent pas se contredire**. Un identifiant Orange,
si. `MP269932.1403.C73941` tombe : le mois 99 n'existe pas.

D'où le **contrôle n° 6, gratuit et propre à Orange** (la numérotation
canonique est celle du tableau de la section 5). Pour un faussaire, la
charge de travail change de nature : il faut rendre cohérente une heure dont il
ignore qu'elle est inscrite dans l'identifiant.

Les préfixes `RC` et `MP` sont observés ; les autres (`TR`, `PP`, `CI`, `CO`)
sont **déduits par convention** et servent uniquement à l'affichage. Un préfixe
inconnu n'invalide rien : on affiche le préfixe brut.

---

## 4. Le code de référence

Ce code tourne, il est vérifié contre les messages ci-dessus. Il se transpose
en TypeScript strict dans `apps/api/src/domain/proof/` — types explicites,
`Xaf` au lieu de `number`, `Result` au lieu de `null` si le domaine le fait
déjà ailleurs. **La logique, elle, ne change pas.**

### Le type de sortie

```ts
export type ParsedSms = {
  amountXaf: number;                    // toujours entier
  txId: string;                         // identifiant opérateur, en MAJUSCULES
  at: Date | null;                      // null si l'identifiant s'auto-invalide
  counterparty: string | null;          // 9 chiffres normalisés, ou null
  counterpartyName?: string | null;
  feeXaf?: number;
  commissionXaf?: number;               // champ OPÉRATEUR, pas une commission Catalog
  soldeXaf?: number;                    // NE JAMAIS PERSISTER — voir ci-dessous
  soldeBrut?: string | null;            // idem : diagnostic d'analyse uniquement
  reseauCible?: string;
};
```

> **`soldeXaf` et `soldeBrut` ne sont jamais persistés, journalisés ni tracés.**
> C'est le solde du compte de la vendeuse. Ils existent parce que le motif les
> capture, et servent au seul diagnostic d'analyse en mémoire. Le lot 3 ne leur
> donne aucune colonne, délibérément.
>
> **`commissionXaf` est le champ « Commission » du SMS Orange**, prélevé par
> l'opérateur. Ce n'est pas une commission Catalog : l'interdit « ne jamais écrire
> de code de commission » porte sur un prélèvement par Catalog, et reste absolu.

### Le fuseau horaire

Les dates lues dans les SMS sont en **heure locale du Cameroun** — `Africa/Douala`,
UTC+1, sans heure d'été. `new Date(y, m, d, …)` construit en heure locale du
processus : le serveur et les tests **doivent** donc tourner avec
`TZ=Africa/Douala`, posé dans la configuration Vitest et dans le Dockerfile.
Sans ça, un test passe en local et échoue en CI, et la fenêtre « sous 48 h » du
contrôle 4 dérive d'une heure.

### Outils communs

```ts
/** Les numéros arrivent tantôt en 9 chiffres, tantôt avec l'indicatif 237. */
export const local9 = (s: string | null | undefined): string => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.startsWith("237") ? d.slice(3) : d;
};

/**
 * Orange écrit des décimales sur des montants qui n'en ont pas (108762.45).
 * Espaces et virgules sont des séparateurs de milliers, le point est décimal.
 * « 1 500 » → 1500 · « 1,500 » → 1500 · « 108762.45 » → 108762.
 * Un montant illisible LÈVE : mieux vaut un refus qu'un NaN dans une colonne Int.
 */
export const xafInt = (s: string): number => {
  const n = Number(String(s).replace(/[\s\u00a0\u202f,]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`montant illisible: ${s}`);
  return Math.round(n);
};

/** Normalisation d'entrée : espaces insécables, retours à la ligne, doublons. */
export const normalizeSms = (t: string): string =>
  t.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
```


### Décodeur d'identifiant Orange

```ts
const OM_KIND: Record<string, string> = {
  RC: "rechargement", MP: "paiement marchand", TR: "transfert",
  PP: "transfert", CI: "dépôt", CO: "retrait",
};

/** Fragment réutilisé dans les motifs Orange. */
export const OM_ID = String.raw`[A-Z]{2}\d{6}\.\d{4}\.[A-Z]\d{4,6}`;

export type OrangeId = {
  prefix: string; kind: string | null; seq: string;
  valid: boolean; at: Date | null;
};

export function decodeOrangeId(id: string): OrangeId | null {
  // Les motifs Orange portent le drapeau `i` : un identifiant peut arriver en
  // minuscules. On normalise AVANT de décoder — sinon le contrôle n° 6
  // disparaît silencieusement au lieu d'échouer, et deux casses du même
  // identifiant cohabitent dans une colonne UNIQUE.
  const m = String(id ?? "").trim().toUpperCase()
    .match(/^([A-Z]{2})(\d{2})(\d{2})(\d{2})\.(\d{2})(\d{2})\.([A-Z]\d{4,6})$/);
  if (!m) return null;
  const [, prefix, yy, mm, dd, HH, MM, seq] = m;
  const valid = +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31 && +HH < 24 && +MM < 60;
  return {
    prefix, kind: OM_KIND[prefix] ?? null, seq, valid,
    at: valid ? new Date(2000 + +yy, +mm - 1, +dd, +HH, +MM) : null,
  };
}
```

Un identifiant non-Orange renvoie `null` — c'est ainsi que le contrôle n° 6
disparaît chez MTN plutôt que d'échouer.

### Les cinq motifs

```ts
export type Sens = "entrant" | "sortant" | "rechargement";

export type SmsPattern = {
  id: string;
  label: string;
  /** Libellé d'affichage. NE VA PAS EN BASE. */
  operateur: "MTN MoMo" | "Orange Money";
  /** Valeur persistée dans payment_proof.operator. C'est CELLE-CI qui compose
   *  la clé UNIQUE(operator, operator_tx_id). Ne jamais y écrire `operateur`. */
  operatorKey: "mtn" | "orange";
  sens: Sens;
  /** Vrai uniquement pour un motif RECONSTITUÉ. Persisté tel quel dans
   *  payment_proof.pattern_a_confirmer — même nom, même polarité, exprès. */
  aConfirmer?: true;
  re: RegExp;
  map: (m: RegExpMatchArray) => ParsedSms;
};

/** Tout identifiant est mis en MAJUSCULES avant contrôle et avant écriture.
 *  Sans ça, `mp260729…` et `MP260729…` coexistent dans une colonne UNIQUE et
 *  le contrôle n° 5 se contourne d'une touche majuscule. */
const up = (s: string): string => s.trim().toUpperCase();

export const PATTERNS: SmsPattern[] = [
  {
    id: "mtn.entrant",
    label: "MTN — réception",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "entrant",
    re: /Vous avez recu\s+(\d+)\s*XAF\s+de\s+(.+?)\s*\(\s*(237\d{9})\s*\)\s*sur votre compte Mobile Money\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2}).*?Transaction ID:\s*(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +m[1],
      counterpartyName: m[2].trim(),
      counterparty: local9(m[3]),
      at: new Date(+m[4], +m[5] - 1, +m[6], +m[7], +m[8], +m[9]),
      txId: up(m[10]),
    }),
  },
  {
    id: "mtn.sortant.transfert",
    label: "MTN — transfert sortant",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "sortant",
    re: /Transfert\s+reussi\s+de\s+(\d+)\s*FCFA\s+au\s+(\d{9})\s+via\s+(.+?)\s+a\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\.\s*ID\s+transaction\s+(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +m[1],
      counterparty: local9(m[2]),
      reseauCible: m[3].trim(),
      at: new Date(+m[4], +m[5] - 1, +m[6], +m[7], +m[8], +m[9]),
      txId: up(m[10]),
    }),
  },
  {
    id: "mtn.sortant.paiement",
    label: "MTN — paiement sortant",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "sortant",
    re: /Votre paiement de\s+(\d+)\s*XAF\s+a\s+(.+?)\s+a\s+ete\s+effectue\s+le\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\..*?nouveau solde:\s*(\d+)\s*XAF\.\s*Frais:\s*(\d+)\s*XAF\..*?Transaction Id:\s*(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +m[1],
      counterparty: null,
      counterpartyName: m[2].trim(),      // « Transfer To non MoMo Account »
      at: new Date(+m[3], +m[4] - 1, +m[5], +m[6], +m[7], +m[8]),
      soldeXaf: +m[9], feeXaf: +m[10], txId: up(m[11]),
    }),
  },
  {
    id: "om.rechargement",
    label: "Orange — rechargement",
    operateur: "Orange Money",
    operatorKey: "orange",
    sens: "rechargement",
    re: new RegExp(String.raw`Rechargement\s+reussi\.\s*Montant de la transaction:\s*([\d.]+)\s*FCFA,\s*ID transaction:\s*(${OM_ID}),\s*Frais:\s*([\d.]+)\s*FCFA,\s*Commission:\s*([\d.]+)\s*FCFA(?:,\s*Nouveau solde:\s*([\d.]+)\s*FCFA)?`, "i"),
    map: (m) => ({
      amountXaf: xafInt(m[1]),
      counterparty: null,
      txId: up(m[2]),
      feeXaf: xafInt(m[3]),
      commissionXaf: xafInt(m[4]),
      soldeBrut: m[5] ?? null,
      at: decodeOrangeId(m[2])?.at ?? null,
    }),
  },
  {
    id: "om.entrant",
    label: "Orange — réception",
    operateur: "Orange Money",
    operatorKey: "orange",
    sens: "entrant",
    aConfirmer: true,                     // capture tronquée — voir section 1
    re: new RegExp(String.raw`(?:You have received|Vous avez re[cç]u)\s+([\d\s.,]+?)\s*(?:FCFA|XAF)\s+(?:of|from|de)\s+([^,.]{1,48}?)\s*[,.].*?(${OM_ID})`, "is"),
    map: (m) => ({
      amountXaf: xafInt(m[1]),
      counterpartyName: /\d{9,}/.test(m[2]) ? null : m[2].trim(),
      counterparty: local9((m[2].match(/\d{9,12}/) ?? [])[0] ?? "") || null,
      txId: up(m[3]),
      at: decodeOrangeId(m[3])?.at ?? null,
    }),
  },
];
```

**Sur l'ordre.** Les cinq motifs actuels sont mutuellement exclusifs — vérifié :
aucun message d'exemple n'en satisfait deux. Le premier qui correspond gagne,
donc l'ordre n'a aujourd'hui aucun effet observable.

Le test d'ordre existe quand même, et il faut savoir pourquoi : le jour où un
sixième motif s'ajoute — le SMS Orange d'envoi, par exemple —, rien ne garantit
qu'il restera disjoint des autres. Le test verrouille l'appariement attendu de
chaque fixture, de sorte qu'un nouveau motif trop large **fasse échouer la CI**
au lieu d'intercepter silencieusement les messages d'un motif existant.

---

## 5. Les sept contrôles

Entrées : le SMS analysé, la commande, et l'horloge — **passée en paramètre**,
jamais lue dans le domaine.

Sorties : une liste de verdicts `true | false | "warn" | "pending"`. Un seul
`false` refuse. Un `warn` fait passer en « accepté sous réserve ».

**Les six premiers contrôles sont purs.** Ils ne touchent ni la base ni le
réseau, et le contrôle n° 5 y renvoie toujours `"pending"` : le domaine ne peut
pas savoir si un identifiant est libre. Voir ci-dessous comment il est tranché.

| # | Contrôle | Succès | Échec | Avertissement |
|---|---|---|---|---|
| 1 | Format opérateur | motif confirmé | aucun motif → refus immédiat, rien à contrôler | motif `aConfirmer` |
| 2 | Montant | `amountXaf === total` | différent | — |
| 3 | Contrepartie | numéro attendu selon le sens | destinataire ≠ numéro de reversement | numéro absent, non exploitable, ou émetteur différent |
| 4 | Horodatage | postérieur à la commande, sous 48 h | antérieur, hors fenêtre, ou date impossible | — |
| 5 | Unicité réseau | identifiant inconnu | déjà réclamé, chez n'importe qui | — |
| 6 | Auto-cohérence *(Orange)* | date interne valide | mois 99, heure 99:99 | *(absent chez MTN)* |
| 7 | Contre-signature | l'acheteuse a tapé | — | `pending` tant qu'elle n'a pas tapé |

### Le contrôle 3 dépend du sens du message

C'est l'erreur la plus facile à commettre, et elle rejetterait **tous** les
paiements légitimes.

- Message **sortant** (celui de l'acheteuse) : la contrepartie est le
  **destinataire** → comparer au numéro de reversement de la vendeuse.
- Message **entrant** (celui de la vendeuse, qui fait autorité) : la
  contrepartie est l'**expéditeur** → comparer au numéro de l'acheteuse
  enregistré à la commande.
- Message de **rechargement** : aucune contrepartie. Rien à rapprocher.

Un numéro qui ne correspond pas est un **avertissement, jamais un refus**. La
double SIM et le paiement par un proche sont la norme au Cameroun. C'est la
contre-signature qui tranche.

### Le contrôle 5 est réseau-large, et c'est la base qui tranche

Un identifiant d'opérateur ne vaut qu'une fois **chez toutes les vendeuses**,
pas une fois par commande.

La séquence, dans cet ordre exact :

1. le domaine applique les six contrôles purs ; le n° 5 revient `"pending"` ;
2. si aucun `false`, la couche applicative **tente l'INSERT** de `payment_proof` ;
3. la contrainte `UNIQUE(operator, operator_tx_id)` accepte ou lève ;
4. une violation de contrainte est traduite en échec du contrôle n° 5.

**Ne jamais faire un SELECT suivi d'un IF.** Deux vendeuses qui collent le même
identifiant à la même seconde passeraient toutes les deux le SELECT : c'est
exactement la course que la contrainte existe pour empêcher. Le SELECT est
autorisé pour un seul usage — afficher un avertissement dans l'interface avant
soumission — et son résultat n'est jamais la décision.

### Le contrôle 4 et la date qui vient de l'identifiant

Chez Orange, `at` provient du **décodage de l'identifiant**, pas du texte. Si le
décodage échoue, `at` vaut `null` et le contrôle 4 échoue avec le message
« aucun horodatage exploitable — l'identifiant annonce une date impossible ».
Ne jamais appeler `toLocaleString` sans avoir vérifié `at instanceof Date`.

---

## 6. Fixtures obligatoires

Ces cas doivent tous exister en test, avec exactement ces attentes. Ce sont eux
qui empêchent une régression silencieuse le jour où quelqu'un « nettoie » une
expression régulière.

| Entrée | Motif attendu | Attente |
|---|---|---|
| MTN paiement sortant réel | `mtn.sortant.paiement` | contrepartie non exploitable → contrôle 3 en avertissement |
| MTN transfert sortant réel | `mtn.sortant.transfert` | 9 chiffres, espace avant le point géré |
| MTN réception réel | `mtn.entrant` | 12 chiffres normalisés en 9, raison sociale extraite |
| Orange rechargement réel | `om.rechargement` | montant entier, solde décimal signalé, date lue dans l'ID |
| Orange réception **reconstitué** (texte ci-dessous) | `om.entrant` | `aConfirmer` → verdict plafonné à « sous réserve » |
| Orange identifiant `MP269932.1403.C73941` | `om.entrant` | contrôles 4 et 6 en échec |
| Identifiant en minuscules `mp260623.1403.c73941` | `om.entrant` | normalisé en majuscules, contrôle 6 s'applique |
| Montant `1,500` avec virgule de milliers | selon le motif | `xafInt` renvoie 1500, jamais NaN |
| `You have received 650 FCFA of` seul | **aucun** | non reconnu — la troncature ne doit pas passer |
| Texte libre tapé à la main | **aucun** | non reconnu |
| Même identifiant collé deux fois | — | second refus par le contrôle 5 |
| SMS avec espaces insécables et retours à la ligne | inchangé | la normalisation absorbe tout |

### Le texte de la fixture Orange de réception

Ce message **n'existe pas**. Il est fabriqué, ici et une seule fois, pour donner
au motif `om.entrant` de quoi être exercé. Il est reproduit dans ce fichier
plutôt que laissé à l'invention de qui écrit le test — ainsi personne ne le
prend pour une capture, et tout le monde teste la même chose.

```
You have received 17000 FCFA of 237677000001, ID transaction: MP260623.1403.C73941, Frais: 0 FCFA, Nouveau solde: 108762.45 FCFA
```

Ce qui vient de la capture réelle : l'amorce `You have received`, la devise
`FCFA`, la préposition `of`. **Tout le reste est déduit** — la présence d'un
numéro, la ponctuation, l'ordre des champs, le libellé `ID transaction`, la
présence même d'un solde. C'est pourquoi le motif porte `aConfirmer`.

Dans le fichier de fixtures, cette entrée porte en commentaire, sur sa première
ligne : `// RECONSTITUÉ — ne prouve pas le format, voir docs/formats-sms-operateurs.md §7`.

### Trois tests de non-régression en plus

- **Appariement des motifs** : chaque fixture s'apparie à son motif et à lui
  seul. Le test échoue si un motif futur en intercepte une autre.
- **Aucun flottant** : un test de propriété vérifie que tout montant sorti d'un
  analyseur satisfait `Number.isInteger`.
- **Fuseau** : les tests tournent sous `TZ=Africa/Douala` et un test échoue
  explicitement si `Intl.DateTimeFormat().resolvedOptions().timeZone` est autre.

---

## 7. Ce qu'il faut demander au terrain

Deux manques, aucun bloquant.

1. **Le SMS Orange de réception, en entier.** C'est un screenshot déroulé vers
   le bas. Tant qu'il manque, `om.entrant` reste `aConfirmer`.
2. **Le SMS Orange d'envoi.** Aucune capture. Le motif n'existe pas et ne doit
   pas être inventé.

Quand une capture arrive : mettre à jour ce fichier **d'abord**, puis le code,
puis les fixtures. Ce fichier est la source ; le code en découle.
