-- Invariants que Prisma ne sait pas exprimer.
-- A appliquer apres chaque `prisma migrate` : pnpm --filter @catalog/db constraints

-- 1. Coherence de la comptabilite d'une commande.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_amounts_balance;
ALTER TABLE "Order" ADD CONSTRAINT order_amounts_balance
  CHECK ("amountPaidXaf" + "balanceXaf" = "totalXaf");

-- 2. Aucun montant negatif nulle part.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_amounts_positive;
ALTER TABLE "Order" ADD CONSTRAINT order_amounts_positive
  CHECK ("totalXaf" >= 0 AND "amountPaidXaf" >= 0 AND "balanceXaf" >= 0);

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS product_price_positive;
ALTER TABLE "Product" ADD CONSTRAINT product_price_positive CHECK ("priceXaf" >= 0);

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS payment_amount_positive;
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_positive CHECK ("amountXaf" >= 0);

-- 3. Note d'avis dans les bornes.
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS review_rating_range;
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range
  CHECK ("rating" BETWEEN 1 AND 5);

-- 4. Le grand livre est en ajout seul.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry est en ajout seul : % interdit', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON "LedgerEntry";
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

DROP TRIGGER IF EXISTS ledger_no_delete ON "LedgerEntry";
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
