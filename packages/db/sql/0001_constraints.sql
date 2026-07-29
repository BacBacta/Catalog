-- Invariants que Prisma ne sait pas exprimer.
-- A appliquer apres chaque migration : pnpm --filter @catalog/db constraints
--
-- Tout ce qui est ici vit en BASE et non dans le code applicatif. Ce n'est pas
-- une preference de style : une regle d'argent verifiee par un `if` se contourne
-- par un chemin de code oublie, et une regle d'unicite verifiee par un SELECT
-- suivi d'un IF se perd a la premiere course.

/* ═══════════════ 1. Coherence comptable de la commande ═══════════════ */

-- L'invariant central : ce qui est paye plus ce qui reste du fait le total.
-- Exactement. C'est ce qui rend `splitDeposit` verifiable de bout en bout.
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_amounts_balance;
ALTER TABLE "order" ADD CONSTRAINT order_amounts_balance
  CHECK ("amount_paid_xaf" + "balance_xaf" = "total_xaf");

ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_amounts_positive;
ALTER TABLE "order" ADD CONSTRAINT order_amounts_positive
  CHECK ("total_xaf" >= 0 AND "amount_paid_xaf" >= 0 AND "balance_xaf" >= 0);

-- Format du code de verification : XXXX-XXXX sur l'alphabet non ambigu.
-- Ni O/0, ni I/1/L, ni B/8, ni S/5, ni Z/2 — un code se dicte au telephone.
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_verification_code_shape;
ALTER TABLE "order" ADD CONSTRAINT order_verification_code_shape
  CHECK ("verification_code" ~ '^[ACDEFGHJKMNPQRTUVWXY34679]{4}-[ACDEFGHJKMNPQRTUVWXY34679]{4}$');

/* ═══════════════ 2. Aucun montant negatif ═══════════════ */

ALTER TABLE "product" DROP CONSTRAINT IF EXISTS product_price_positive;
ALTER TABLE "product" ADD CONSTRAINT product_price_positive CHECK ("price_xaf" >= 0);

ALTER TABLE "payment_proof" DROP CONSTRAINT IF EXISTS proof_amount_positive;
ALTER TABLE "payment_proof" ADD CONSTRAINT proof_amount_positive CHECK ("amount_xaf" >= 0);

ALTER TABLE "ledger_entry" DROP CONSTRAINT IF EXISTS ledger_amount_positive;
ALTER TABLE "ledger_entry" ADD CONSTRAINT ledger_amount_positive CHECK ("amount_xaf" >= 0);

/* ═══════════════ 3. La preuve, et le controle n° 5 ═══════════════ */

-- L'identifiant d'operateur est stocke en MAJUSCULES. Sans cette contrainte,
-- `mp260729.1716.c73941` et `MP260729.1716.C73941` cohabitent dans la colonne
-- UNIQUE(operator, operator_tx_id) : le controle n° 5 se contourne alors d'une
-- simple touche majuscule, et c'est le controle qui empeche de reclamer deux
-- fois le meme paiement.
ALTER TABLE "payment_proof" DROP CONSTRAINT IF EXISTS proof_tx_id_upper;
ALTER TABLE "payment_proof" ADD CONSTRAINT proof_tx_id_upper
  CHECK ("operator_tx_id" = upper("operator_tx_id"));

-- Le numero de contrepartie est normalise a 9 chiffres, ou absent. Un numero
-- qui ne correspond pas est un AVERTISSEMENT metier, jamais un rejet — mais un
-- numero mal FORME est une erreur d'analyse, et celle-la doit se voir.
ALTER TABLE "payment_proof" DROP CONSTRAINT IF EXISTS proof_counterparty_shape;
ALTER TABLE "payment_proof" ADD CONSTRAINT proof_counterparty_shape
  CHECK ("counterparty_phone" IS NULL OR "counterparty_phone" ~ '^[62][0-9]{8}$');

/* ═══════════════ 4. Les journaux sont en AJOUT SEUL ═══════════════ */

-- Une preuve ne se corrige pas, elle se remplace par une autre. Si on pouvait
-- la reecrire apres coup, ce ne serait plus une preuve.
CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON "ledger_entry";
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS ledger_no_delete ON "ledger_entry";
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS proof_no_update ON "payment_proof";
CREATE TRIGGER proof_no_update BEFORE UPDATE ON "payment_proof"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS proof_no_delete ON "payment_proof";
CREATE TRIGGER proof_no_delete BEFORE DELETE ON "payment_proof"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Le journal d'audit de la commande suit la meme regle (AGENTS.md §6 : tout ce
-- qui touche a l'argent ou au statut d'une commande ecrit en ajout seul).
DROP TRIGGER IF EXISTS order_event_no_update ON "order_event";
CREATE TRIGGER order_event_no_update BEFORE UPDATE ON "order_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS order_event_no_delete ON "order_event";
CREATE TRIGGER order_event_no_delete BEFORE DELETE ON "order_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Le journal d'audit de la vendeuse aussi. Il porte les changements de numero
-- de reversement — le champ qu'un attaquant chercherait a detourner — et chaque
-- tentative y figure, refusee comme acceptee. Un journal reecrivable ne prouve
-- rien : c'est precisement la trace d'une attaque qu'on voudrait effacer.
DROP TRIGGER IF EXISTS seller_audit_no_update ON "seller_audit_event";
CREATE TRIGGER seller_audit_no_update BEFORE UPDATE ON "seller_audit_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS seller_audit_no_delete ON "seller_audit_event";
CREATE TRIGGER seller_audit_no_delete BEFORE DELETE ON "seller_audit_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

/* ═══════════════ 5. Reputation ═══════════════ */

ALTER TABLE "review" DROP CONSTRAINT IF EXISTS review_rating_range;
ALTER TABLE "review" ADD CONSTRAINT review_rating_range
  CHECK ("rating" BETWEEN 1 AND 5);
