#!/bin/sh
# Remise a zero de la preproduction, en un seul geste — ADR 0071.
#
# Il tourne DANS la machine Fly, ou `DATABASE_URL` est chez elle. Les quatre
# pas se suivent dans cet ordre et aucun ne se saute :
#
#   1. remise-a-zero.mjs    supprime et recree les schemas (verrous compris) ;
#   2. prisma migrate deploy remonte les tables ;
#   3. apply-constraints.mjs remet les CHECK et les declencheurs d'ajout seul —
#      SANS lui, la base repart sans ses invariants, ce qui est pire que vide ;
#   4. inventaire.mjs        montre le resultat, pour ne pas croire sur parole.
#
# `set -e` : le premier echec arrete tout. Une migration qui echoue derriere un
# schema efface doit se voir immediatement, pas se decouvrir a la commande
# suivante d'une vendeuse.
set -e

cd /app/packages/db

echo "── 1/4 · Remise a zero des schemas ──────────────────────"
node scripts/remise-a-zero.mjs

echo ""
echo "── 2/4 · Migrations ─────────────────────────────────────"
./node_modules/.bin/prisma migrate deploy

echo ""
echo "── 3/4 · Contraintes et declencheurs (lot 3) ────────────"
node scripts/apply-constraints.mjs

echo ""
echo "── 4/4 · Inventaire apres coup ──────────────────────────"
node scripts/inventaire.mjs
