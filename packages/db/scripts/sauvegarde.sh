#!/usr/bin/env bash
#
# Sauvegarde quotidienne de PostgreSQL.
#
# ── Le format personnalisé, pas du SQL en clair ────────────────────────────
#
# `--format=custom` produit une archive compressée, restaurable **table par
# table** et **en parallèle**. Un dump SQL en clair ne se restaure qu'en entier,
# en séquentiel, en rejouant chaque INSERT : sur la base d'un jour de pic, la
# différence entre les deux se compte en heures, et ces heures-là sont
# exactement celles où la boutique est fermée.
#
# ── Ce qui n'est PAS dans cette sauvegarde ─────────────────────────────────
#
# **La clé de chiffrement des SMS.** Elle vit dans l'environnement, jamais dans
# la base. Une sauvegarde restaurée sans elle donne une base complète dont la
# colonne `raw_sms` est illisible — et c'est le comportement voulu : une archive
# volée ne doit pas livrer les soldes des vendeuses. Corollaire, à connaître
# avant d'en avoir besoin : **perdre la clé rend les SMS irrécupérables**, même
# avec toutes les sauvegardes du monde. Elle se sauvegarde ailleurs, par un
# autre chemin, dans un coffre.
#
# ── Vérifier n'est pas optionnel ───────────────────────────────────────────
#
# Le script relit l'archive qu'il vient d'écrire (`pg_restore --list`). Une
# sauvegarde qu'on n'a pas relue est une sauvegarde dont on ne sait rien : les
# corruptions silencieuses de disque existent, et on les découvre au pire
# moment.

set -euo pipefail

# shellcheck source=./url-postgres.sh
source "$(dirname "$0")/url-postgres.sh"

: "${DATABASE_URL:?DATABASE_URL est requis}"
# `libpq` refuse les parametres propres a Prisma — voir url-postgres.sh.
exporter_search_path "$DATABASE_URL"
URL_PG="$(url_pour_libpq "$DATABASE_URL")"
DESTINATION="${BACKUP_DIR:-/var/backups/catalog}"
# Le fuseau du produit, pour que le nom de fichier corresponde au jour vécu.
HORODATAGE="$(TZ=Africa/Douala date +%Y-%m-%dT%H%M)"
ARCHIVE="${DESTINATION}/catalog-${HORODATAGE}.dump"
# Quatorze jours : au-delà, une restauration ne sert plus à grand-chose — la
# base aurait dérivé au point que la remise en service serait pire que la panne.
RETENTION_JOURS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$DESTINATION"

echo "→ sauvegarde vers ${ARCHIVE}"
pg_dump \
  --dbname="$URL_PG" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$ARCHIVE"

# ── vérification ───────────────────────────────────────────────────────────
# Relire la table des matières prouve que l'archive est lisible de bout en bout.
echo "→ vérification de l'archive"
if ! pg_restore --list "$ARCHIVE" > /dev/null; then
  echo "✗ archive illisible : ${ARCHIVE}" >&2
  exit 1
fi

# Les tables qui portent l'argent et la preuve doivent y être. Une sauvegarde
# partielle passe `pg_restore --list` sans broncher.
for table in payment_proof "order" order_event ledger_entry seller; do
  if ! pg_restore --list "$ARCHIVE" | grep -q "TABLE DATA public ${table} "; then
    echo "✗ table absente de l'archive : ${table}" >&2
    exit 1
  fi
done

OCTETS="$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE")"
echo "✓ archive vérifiée : ${ARCHIVE} (${OCTETS} octets)"

# ── rotation ───────────────────────────────────────────────────────────────
# Après la vérification, jamais avant : une rotation qui s'exécuterait alors que
# la sauvegarde du jour a échoué supprimerait la dernière bonne archive.
find "$DESTINATION" -name 'catalog-*.dump' -type f -mtime "+${RETENTION_JOURS}" -print -delete

echo "✓ terminé. Archives conservées ${RETENTION_JOURS} jours dans ${DESTINATION}"
