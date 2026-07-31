#!/usr/bin/env bash
#
# Restauration d'une archive vers un environnement NEUF.
#
# ── Pourquoi « neuf » et pas « la base de production » ─────────────────────
#
# Ce script refuse d'écrire dans une base qui contient déjà des données. Ce
# n'est pas une précaution de confort : une restauration lancée par erreur sur
# la production écraserait les commandes arrivées depuis la sauvegarde,
# c'est-à-dire précisément celles que personne n'a encore vues et dont personne
# ne pourra dire ce qu'elles contenaient.
#
# La procédure de reprise est donc : restaurer AILLEURS, vérifier, puis
# basculer. Voir `docs/runbooks/restauration-sauvegarde.md`.
#
# ── Les contraintes SQL se réappliquent APRÈS ──────────────────────────────
#
# `pg_restore` rétablit les contraintes que le dump contient. Celles du lot 3
# — invariant `amount_paid + balance = total`, ajout seul sur `payment_proof`,
# forme du code de vérification — sont posées par `apply-constraints.mjs` et
# vivent hors du schéma Prisma. Le script les rejoue, et c'est ce qui fait la
# différence entre « les données sont là » et « la base est correcte ».

set -euo pipefail

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  echo "usage: restauration.sh <archive.dump>" >&2
  echo "  la cible est TARGET_DATABASE_URL, jamais DATABASE_URL." >&2
  exit 64
fi
[[ -f "$ARCHIVE" ]] || { echo "✗ archive introuvable : ${ARCHIVE}" >&2; exit 66; }

# ── La cible porte un nom DIFFÉRENT de la variable de production ───────────
# `DATABASE_URL` est ce que lit l'application. Exiger une autre variable rend
# impossible la restauration accidentelle « parce que l'environnement était déjà
# chargé dans le shell ».
# L'apostrophe est PROSCRITE dans ce message : bash analyse le texte de
# `${VAR:?message}` avec ses regles de citation, et un « n'est » y ouvre une
# chaine qui ne se referme jamais. Le script echoue alors a l'analyse, avec
# « unexpected EOF » sur une ligne qui n'a rien a voir.
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL est requis, et ce nom differe de DATABASE_URL}"

# shellcheck source=./url-postgres.sh
source "$(dirname "$0")/url-postgres.sh"
# `libpq` refuse les parametres propres a Prisma — voir url-postgres.sh.
exporter_search_path "$TARGET_DATABASE_URL"
CIBLE_PG="$(url_pour_libpq "$TARGET_DATABASE_URL")"

if [[ "${TARGET_DATABASE_URL}" == "${DATABASE_URL:-}" ]]; then
  echo "✗ la cible est la base de production. Restaurer ailleurs, puis basculer." >&2
  exit 1
fi

DEBUT="$(date +%s)"

echo "→ vérification de l'archive"
pg_restore --list "$ARCHIVE" > /dev/null || { echo "✗ archive illisible" >&2; exit 1; }

# ── la cible doit être vide ────────────────────────────────────────────────
echo "→ vérification que la cible est neuve"
TABLES="$(psql "$CIBLE_PG" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "$TABLES" != "0" ]]; then
  if [[ "${FORCE_ECRASER:-}" != "oui" ]]; then
    echo "✗ la cible contient déjà ${TABLES} table(s)." >&2
    echo "  Restaurer dans une base vide. Pour écraser sciemment : FORCE_ECRASER=oui" >&2
    exit 1
  fi
  echo "! cible non vide, écrasement demandé explicitement"
fi

# ── restauration ───────────────────────────────────────────────────────────
# `--jobs` : c'est le format personnalisé qui rend le parallélisme possible, et
# c'est là que se gagne le délai de remise en service.
JOBS="${RESTORE_JOBS:-4}"
echo "→ restauration (${JOBS} tâches parallèles)"
pg_restore \
  --dbname="$CIBLE_PG" \
  --jobs="$JOBS" \
  --no-owner \
  --no-privileges \
  ${FORCE_ECRASER:+--clean --if-exists} \
  "$ARCHIVE"

# ── contraintes hors schéma Prisma ─────────────────────────────────────────
echo "→ réapplication des contraintes SQL du lot 3"
DATABASE_URL="$TARGET_DATABASE_URL" node "$(dirname "$0")/apply-constraints.mjs"

# ── contrôles d'intégrité ──────────────────────────────────────────────────
echo "→ contrôles d'intégrité"

verifier() {
  local libelle="$1" requete="$2" attendu="$3"
  local obtenu
  obtenu="$(psql "$CIBLE_PG" -tAc "$requete" | tr -d '[:space:]')"
  if [[ "$obtenu" != "$attendu" ]]; then
    echo "✗ ${libelle} : attendu ${attendu}, obtenu ${obtenu}" >&2
    return 1
  fi
  echo "  ✓ ${libelle}"
}

ECHECS=0
# L'invariant d'argent. Il est garanti par une contrainte, mais une restauration
# est justement le moment où l'on vérifie que la contrainte est bien revenue.
verifier "invariant amount_paid + balance = total" \
  'SELECT count(*) FROM "order" WHERE amount_paid_xaf + balance_xaf <> total_xaf' 0 || ECHECS=1

# Le contrôle n° 5 est une contrainte UNIQUE réseau-large. Deux lignes avec le
# même identifiant signifieraient que la contrainte n'a pas été rétablie.
verifier "unicité (operator, operator_tx_id)" \
  'SELECT count(*) FROM (SELECT operator, operator_tx_id FROM payment_proof GROUP BY 1,2 HAVING count(*) > 1) d' 0 || ECHECS=1

# Aucune commande orpheline.
verifier "aucune commande sans vendeuse" \
  'SELECT count(*) FROM "order" o LEFT JOIN seller s ON s.id = o.seller_id WHERE s.id IS NULL' 0 || ECHECS=1

echo "→ volumétrie restaurée"
psql "$CIBLE_PG" -c "
  SELECT 'seller' AS table, count(*) FROM seller
  UNION ALL SELECT 'order', count(*) FROM \"order\"
  UNION ALL SELECT 'payment_proof', count(*) FROM payment_proof
  UNION ALL SELECT 'order_event', count(*) FROM order_event
  UNION ALL SELECT 'ledger_entry', count(*) FROM ledger_entry;"

DUREE=$(( $(date +%s) - DEBUT ))
echo ""
echo "⏱  durée de la restauration : ${DUREE} s"
echo "   → reporter ce chiffre dans docs/runbooks/restauration-sauvegarde.md"

if [[ "$ECHECS" != "0" ]]; then
  echo "✗ restauration terminée AVEC des contrôles en échec. Ne pas basculer." >&2
  exit 1
fi
echo "✓ restauration vérifiée."
