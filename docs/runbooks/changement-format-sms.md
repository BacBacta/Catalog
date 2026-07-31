# Changement de format de SMS chez un opérateur

> **C'est la panne la plus probable de Catalog, et elle est silencieuse.**
> Rien ne tombe. Aucune erreur 500, aucune alerte d'infrastructure, aucun
> service indisponible. Les vendeuses collent leurs SMS comme d'habitude et se
> font refuser en bloc — et elles ne rappelleront pas. Elles arrêteront de
> coller, et la valeur numéro un du produit disparaîtra sans un bruit.

## Symptômes

Un seul signal compte, et il est dans les métriques :

- **`catalog.preuve.controle{controle=1, etat=fail}` bascule brutalement.**
  Le contrôle n° 1 est la reconnaissance de format. Une hausse graduelle est du
  bruit ; une marche d'escalier en quelques heures est un changement de format.
- **La bascule est ventilée par opérateur** — `operateur=mtn` ou
  `operateur=orange`, jamais les deux le même jour. C'est ce qui distingue un
  changement de format d'un incident chez nous : un défaut de notre code
  toucherait les deux.
- Le compteur `operateur=inconnu` monte en même temps : c'est là que tombent
  les messages qu'aucun motif n'apparie.

Signaux secondaires, qui confirment sans suffire :

- Les autres contrôles ne bougent pas. Si le n° 2 (montant) ou le n° 4
  (horodatage) montent aussi, ce n'est pas ça — voir plus bas.
- Le support reçoit des messages du type « ça ne marche plus », sans détail.

## Diagnostic

**1. Le dépôt n'a pas bougé.** C'est la première question, et le canari y répond.

```bash
pnpm --filter @catalog/api exec vitest run src/__tests__/canari-formats.test.ts
```

- **Vert** → les motifs du dépôt sont intacts. Le changement vient de
  l'extérieur. Continuer.
- **Rouge** → quelqu'un a modifié un motif sans passer par la spécification.
  Ce n'est pas cet incident-ci : revenir sur le commit fautif.

Le programme quotidien (`.github/workflows/canari.yml`) donne aussi la réponse
sans rien lancer : regarder la dernière exécution verte.

**2. Obtenir un message réel.** Rien ne remplace le texte.

Demander à une vendeuse dont la preuve a été refusée de **coller le SMS entier**
dans un canal de support. Attention : ce texte porte son **solde**. Il ne se
copie ni dans un ticket public, ni dans un commit, ni dans une trace.

**3. Comparer au motif.** Sur une machine de développement :

```bash
node --experimental-strip-types -e '
  const { analyserSms } = await import("./apps/api/src/domain/proof/motifs.ts");
  console.log(analyserSms(process.argv[1]));
' "<le message collé>"
```

`reconnu: false` avec `raison: "aucun_motif"` confirme le diagnostic. Comparer
alors le message à celui de `docs/formats-sms-operateurs.md` §2, mot pour mot :
c'est souvent une ponctuation, un libellé de champ, ou un espace.

**4. Écarter les fausses pistes.**

| Si en plus… | Alors ce n'est pas ça |
|---|---|
| Le contrôle n° 4 monte aussi | Décalage d'horloge — vérifier `TZ=Africa/Douala` sur le serveur |
| Le contrôle n° 2 monte aussi | Les montants attendus sont faux, pas les formats |
| Les deux opérateurs basculent | Défaut chez nous : regarder le dernier déploiement |
| `catalog.trace.fuites_evitees` monte | Autre incident, plus grave — voir l'ADR 0023 |

## Actions

**Dans cet ordre. La spécification d'abord, toujours.**

1. **Mettre à jour `docs/formats-sms-operateurs.md`.** Ajouter le nouveau
   message en §2, pseudonymisé — numéros, noms, identifiants et soldes
   remplacés par des valeurs de **forme strictement identique**. Noter la date
   de constatation et l'opérateur.

2. **Adapter le motif** dans `apps/api/src/domain/proof/motifs.ts`.
   - Si l'ancien format coexiste avec le nouveau — c'est le cas courant, les
     opérateurs migrent par vagues — **ajouter un motif, ne pas remplacer**.
     Une vendeuse qui colle un SMS d'il y a trois jours doit encore passer.
   - Le nouveau motif prend un identifiant explicite (`mtn.entrant.2027`).
   - S'il est reconstitué plutôt que constaté, il porte `aConfirmer: true`, et
     le verdict est alors plafonné à « accepté sous réserve ».

3. **Ajouter la fixture** dans `apps/api/src/__tests__/fixtures-sms.ts`, recopiée
   du fichier de spécification et non réinventée.

4. **Lancer le canari.** Il doit passer du rouge au vert sur le nouveau message.

5. **Déployer**, puis surveiller `catalog.preuve.controle{controle=1}` : la
   bascule doit s'inverser en quelques minutes.

6. **Rattraper les refus.** Les preuves refusées pendant la panne n'ont **rien
   écrit** — l'identifiant d'opérateur n'a pas été réservé, par construction
   (voir `preuve.ts`). Les vendeuses concernées peuvent donc simplement recoller
   leur SMS. Le leur dire : elles ne réessaieront pas d'elles-mêmes.

## Critère de sortie

Les quatre, ensemble :

- [ ] `catalog.preuve.controle{controle=1, etat=fail}` est revenu à son niveau
      d'avant la bascule, mesuré sur **deux heures pleines** — pas sur le pic qui
      suit le déploiement.
- [ ] Le canari de formats est vert, avec le nouveau message dans la
      spécification.
- [ ] Au moins une preuve réelle au nouveau format est passée en `accepte` (ou
      en `accepte_sous_reserve` si le motif est reconstitué).
- [ ] Les vendeuses refusées pendant la fenêtre ont été prévenues qu'elles
      peuvent recoller.

## Ce qu'il ne faut pas faire

- **Élargir un motif « pour être tolérant ».** Un motif qui accepte un début de
  message laisse entrer un paiement sans identifiant, et le contrôle n° 5 ne
  peut plus rien garantir. La spécification a un test dédié pour ça : la
  troncature `You have received 650 FCFA of…` doit rester refusée.
- **Réécrire un motif de mémoire.** Ils sont écrits contre des messages réels.
  Un motif écrit de mémoire se casse sur l'espace avant la parenthèse fermante,
  sur le numéro à douze chiffres, ou sur l'anglais.
- **Coller un SMS réel dans un ticket, un commit ou un test.** Il porte un solde.
