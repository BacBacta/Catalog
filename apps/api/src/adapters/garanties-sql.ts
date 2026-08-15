import type { PrismaClient } from "@catalog/db";

/**
 * Les garanties SQL du lot 3, constatees dans la base REELLE — residu A3 de
 * l'audit 2026-08.
 *
 * Les CHECK et les triggers vivent hors des migrations Prisma
 * (`packages/db/sql/0001_constraints.sql`, ADR 0014) : tous les chemins de
 * deploiement les appliquent (`db:migrate`, release_command Fly, CI,
 * restauration), mais rien ne VERIFIAIT en production qu'ils y sont — or ce
 * sont eux qui tiennent l'invariant d'argent
 * (`amount_paid_xaf + balance_xaf = total_xaf`) et l'ajout seul du journal.
 *
 * On sonde un echantillon SIGNATURE, pas la liste entiere : les quatre
 * triggers d'ajout seul et les deux CHECK dont tout le produit depend. S'ils
 * sont la, `apply-constraints` est passe ; s'il en manque UN, quelque chose
 * d'anormal est arrive et tout est a re-verifier.
 */
export async function garantiesSqlPosees(prisma: PrismaClient): Promise<boolean> {
  const [n] = await prisma.$queryRaw<Array<{ triggers: bigint; contraintes: bigint }>>`
    SELECT
      (SELECT count(*) FROM pg_trigger WHERE tgname IN
        ('ledger_no_update', 'ledger_no_delete', 'proof_no_update', 'proof_no_delete')
      ) AS triggers,
      (SELECT count(*) FROM pg_constraint WHERE conname IN
        ('order_amounts_balance', 'order_verification_code_shape')
      ) AS contraintes`;
  return n !== undefined && Number(n.triggers) === 4 && Number(n.contraintes) === 2;
}
