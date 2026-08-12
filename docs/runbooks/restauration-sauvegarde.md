# Restauration d'une sauvegarde

> Rare, et grave. C'est le seul runbook de cette liste dont la procédure doit
> avoir été **jouée pour de vrai** avant d'en avoir besoin. Une sauvegarde
> jamais restaurée n'est pas une sauvegarde : c'est un fichier.

## Avant tout : la clé de chiffrement

`payment_proof.raw_sms` est chiffré, et **la clé n'est pas dans la base**. Elle
vit dans l'environnement.

- Une archive restaurée **sans** la clé donne une base complète dont les SMS
  sont illisibles. C'est voulu : une archive volée ne doit pas livrer les soldes
  des vendeuses.
- **Perdre la clé rend les SMS irrécupérables**, avec toutes les sauvegardes du
  monde. Elle se sauvegarde ailleurs, par un autre chemin, dans un coffre.

Tout le reste — identifiants d'opérateur, montants, verdicts, journal — est en
clair et se restaure normalement. Une base restaurée sans la clé reste donc
**pleinement exploitable pour la preuve** : c'est l'identifiant qui fait foi, pas
le texte.

## Symptômes

- La base ne répond plus, ou répond avec des données manifestement fausses.
- Une migration destructive est passée — ce qui ne devrait pas arriver, les
  migrations sont en expand/contract, mais le runbook existe pour ce qui ne
  devrait pas arriver.
- Une corruption est signalée par PostgreSQL au démarrage.

## Diagnostic

**1. Est-ce vraiment un problème de données ?**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM \"order\";"
psql "$DATABASE_URL" -c "SELECT count(*) FROM payment_proof;"
```

Une base qui répond avec des volumes cohérents n'a pas besoin d'être restaurée.
Chercher ailleurs — l'API, le réseau, la configuration.

**2. Quelle archive ?**

```bash
ls -la "${BACKUP_DIR:-/var/backups/catalog}"/catalog-*.dump
```

Les noms portent l'horodatage **en heure de Douala**. Prendre la plus récente
**antérieure à l'incident**, pas la plus récente tout court : une sauvegarde
prise après le début d'une corruption la contient.

**3. Que perd-on ?**

L'écart entre l'horodatage de l'archive et maintenant, c'est le nombre d'heures
de commandes perdues. Le noter **avant** de restaurer : c'est ce qu'il faudra
annoncer, et c'est ce qui alimente l'objectif de perte de données maximale.

## Actions

**On ne restaure jamais sur la production.** On restaure ailleurs, on vérifie,
on bascule. Le script refuse d'ailleurs d'écrire dans la base pointée par
`DATABASE_URL`.

### 1. Créer une base neuve

```bash
createdb catalog_restauration
export TARGET_DATABASE_URL="postgresql://…/catalog_restauration"
```

### 2. Restaurer

```bash
./packages/db/scripts/restauration.sh /var/backups/catalog/catalog-2026-07-31T0300.dump
```

Le script fait, dans cet ordre : vérification de l'archive, refus si la cible
n'est pas vide, restauration parallèle, **réapplication des contraintes SQL du
lot 3**, puis trois contrôles d'intégrité :

| Contrôle | Ce qu'il attrape |
|---|---|
| `amount_paid + balance = total` | Une restauration partielle sur les montants |
| Unicité `(operator, operator_tx_id)` | La contrainte du contrôle n° 5 non rétablie |
| Aucune commande orpheline | Une restauration incomplète des vendeuses |

Il termine en affichant **la durée** et la volumétrie par table.

### 3. Vérifier à la main ce que le script ne peut pas vérifier

- La commande la plus récente correspond-elle à l'horodatage attendu ?
  ```sql
  SELECT ref, created_at FROM "order" ORDER BY created_at DESC LIMIT 5;
  ```
- Une preuve prise au hasard porte-t-elle son identifiant et son verdict ?
- Si la clé de chiffrement est disponible, un déchiffrement de contrôle sur
  **une** ligne suffit. Ne pas en faire plus : le texte porte un solde.

### 4. Basculer

1. Arrêter l'API — sinon elle écrit dans l'ancienne base pendant la bascule.
2. Renommer, ou repointer `DATABASE_URL` vers la base restaurée.
3. Redémarrer l'API, vérifier `/health`.
4. **Ne pas supprimer l'ancienne base.** La renommer. Elle contient les heures
   perdues, et c'est la seule copie qui en existe.

### 5. Après

- Prévenir les vendeuses dont les commandes tombent dans la fenêtre perdue. Le
  faire même si elles ne s'en rendront pas compte : une commande disparue se
  découvre au pire moment, quand l'acheteuse réclame.
- Les preuves de la fenêtre perdue **peuvent être recollées** : l'identifiant
  d'opérateur n'ayant plus de ligne, le contrôle n° 5 ne s'y opposera pas.

## Critère de sortie

- [ ] Les trois contrôles d'intégrité du script sont passés.
- [ ] La commande la plus récente en base correspond à l'horodatage de
      l'archive, à quelques minutes près.
- [ ] `/health` répond, et une preuve réelle passe de bout en bout.
- [ ] L'ancienne base est **renommée, pas supprimée**.
- [ ] La fenêtre perdue est chiffrée en heures, et les vendeuses concernées
      prévenues.
- [ ] La durée de la restauration est reportée ci-dessous.

## Durée réellement constatée

| Date | Volumétrie | Durée | Par |
|---|---|---|---|
| — | — | **non mesurée** | — |

> **Cette ligne est vide, et c'est un manque, pas un oubli.** La procédure
> ci-dessus a été écrite et le script a été exercé sur une base de
> développement ; il n'a jamais été joué sur un volume réel, et le délai de
> remise en service n'est donc pas connu. Tant que cette ligne est vide, toute
> annonce de délai est une supposition.
>
> C'est le premier des trois points que la définition de terminé du lot 14
> réserve explicitement à un humain, hors session.

## Mettre en place la sauvegarde quotidienne

Le script existe ; **le programmer est une décision d'infrastructure**, qui
dépend de l'hébergeur et qui ne se fait pas depuis ce dépôt.

```cron
# 03:00 à Douala, avant l'ouverture des boutiques.
0 3 * * * cd /srv/catalog && DATABASE_URL=… BACKUP_DIR=/var/backups/catalog \
          ./packages/db/scripts/sauvegarde.sh >> /var/log/catalog-backup.log 2>&1
```

Trois choses à régler en même temps, et qu'aucun script ne peut régler seul :

1. **Le stockage est ailleurs que la base.** Une sauvegarde sur le même disque
   ne protège que de l'erreur humaine, pas de la panne matérielle.
2. **La clé de chiffrement des SMS est sauvegardée séparément**, dans un coffre.
3. **L'échec du script réveille quelqu'un.** Une sauvegarde qui échoue en
   silence pendant deux semaines est le scénario classique — et il ne se
   découvre que le jour de la restauration.
