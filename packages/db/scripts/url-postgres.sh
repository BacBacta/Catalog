#!/usr/bin/env bash
#
# Convertit une URL Prisma en URL que les outils PostgreSQL acceptent.
#
# ── Le piège, constaté à la première exécution ─────────────────────────────
#
#   pg_dump: error: invalid URI query parameter: "schema"
#
# Prisma ajoute à l'URL de connexion des paramètres qui lui sont propres :
# `schema`, `connection_limit`, `pool_timeout`, `pgbouncer`. `libpq` — donc
# `pg_dump`, `psql` et `pg_restore` — refuse tout paramètre qu'il ne connaît
# pas, et il refuse en ERREUR, pas en avertissement.
#
# C'est le genre de détail qui ne se découvre qu'en lançant le script, et qui se
# découvrirait sinon le jour de la restauration — c'est-à-dire le pire jour.
#
# `schema` n'est pas perdu : il devient `PGOPTIONS=--search_path=…`, qui est la
# façon dont libpq exprime la même chose.

# Paramètres que Prisma ajoute et que libpq refuse.
PRISMA_SEULEMENT='schema|connection_limit|pool_timeout|pgbouncer|socket_timeout|sslidentity|sslcert|sslpassword'

# Le schéma demandé dans l'URL, ou `public`.
schema_de_url() {
  local url="$1" schema
  schema="$(printf '%s' "$url" | sed -nE 's/.*[?&]schema=([^&]*).*/\1/p')"
  printf '%s' "${schema:-public}"
}

# L'URL débarrassée des paramètres propres à Prisma.
url_pour_libpq() {
  printf '%s' "$1" \
    | sed -E "s/([?&])(${PRISMA_SEULEMENT})=[^&]*//g" \
    | sed -E 's/\?&/?/; s/[?&]$//'
}

# Pose `PGOPTIONS` pour que le schéma de l'URL soit bien celui utilisé.
exporter_search_path() {
  local schema
  schema="$(schema_de_url "$1")"
  if [[ "$schema" != "public" ]]; then
    export PGOPTIONS="--search_path=${schema}"
  fi
}
