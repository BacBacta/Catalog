-- CreateEnum
CREATE TYPE "seller_status" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('trial', 'active', 'past_due', 'cancelled');

-- CreateEnum
CREATE TYPE "pay_mode" AS ENUM ('integral', 'acompte', 'sans_prepaiement');

-- CreateEnum
CREATE TYPE "order_step" AS ENUM ('recue', 'preparee', 'chez_le_livreur', 'livree');

-- CreateEnum
CREATE TYPE "operator_key" AS ENUM ('mtn', 'orange');

-- CreateEnum
CREATE TYPE "proof_state" AS ENUM ('attendu', 'declare_non_trace', 'prouve', 'contresigne', 'conteste');

-- CreateEnum
CREATE TYPE "verdict" AS ENUM ('accepte', 'accepte_sous_reserve', 'refuse');

-- CreateTable
CREATE TABLE "seller" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "quartier" TEXT,
    "pickup_point" TEXT,
    "payout_phone" TEXT,
    "payout_operator" "operator_key",
    "payout_phone_verified_at" TIMESTAMP(3),
    "status" "seller_status" NOT NULL DEFAULT 'active',
    "subscription_status" "subscription_status" NOT NULL DEFAULT 'trial',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_xaf" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "variants" JSONB,
    "image_key" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_view" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_name" TEXT,
    "items" JSONB NOT NULL,
    "total_xaf" INTEGER NOT NULL,
    "amount_paid_xaf" INTEGER NOT NULL DEFAULT 0,
    "balance_xaf" INTEGER NOT NULL,
    "pay_mode" "pay_mode" NOT NULL,
    "step" "order_step" NOT NULL DEFAULT 'recue',
    "proof_state" "proof_state" NOT NULL DEFAULT 'attendu',
    "delivery" JSONB NOT NULL,
    "verification_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proof" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "operator" "operator_key" NOT NULL,
    "operator_tx_id" TEXT NOT NULL,
    "amount_xaf" INTEGER NOT NULL,
    "counterparty_phone" TEXT,
    "counterparty_name" TEXT,
    "occurred_at" TIMESTAMP(3),
    "pattern_id" TEXT NOT NULL,
    "pattern_a_confirmer" BOOLEAN NOT NULL,
    "raw_sms" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "verdict" "verdict" NOT NULL,
    "countersigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_event" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "proof_id" TEXT,
    "direction" TEXT NOT NULL,
    "amount_xaf" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_phone_key" ON "seller"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "seller_slug_key" ON "seller"("slug");

-- CreateIndex
CREATE INDEX "seller_status_idx" ON "seller"("status");

-- CreateIndex
CREATE INDEX "seller_payout_phone_idx" ON "seller"("payout_phone");

-- CreateIndex
CREATE INDEX "product_seller_id_position_idx" ON "product"("seller_id", "position");

-- CreateIndex
CREATE INDEX "product_seller_id_archived_at_idx" ON "product"("seller_id", "archived_at");

-- CreateIndex
CREATE INDEX "product_view_day_idx" ON "product_view"("day");

-- CreateIndex
CREATE UNIQUE INDEX "product_view_product_id_day_key" ON "product_view"("product_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "order_ref_key" ON "order"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "order_verification_code_key" ON "order"("verification_code");

-- CreateIndex
CREATE INDEX "order_seller_id_created_at_idx" ON "order"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "order_seller_id_step_idx" ON "order"("seller_id", "step");

-- CreateIndex
CREATE INDEX "order_seller_id_proof_state_idx" ON "order"("seller_id", "proof_state");

-- CreateIndex
CREATE INDEX "order_buyer_phone_idx" ON "order"("buyer_phone");

-- CreateIndex
CREATE INDEX "order_expires_at_idx" ON "order"("expires_at");

-- CreateIndex
CREATE INDEX "payment_proof_order_id_idx" ON "payment_proof"("order_id");

-- CreateIndex
CREATE INDEX "payment_proof_verdict_created_at_idx" ON "payment_proof"("verdict", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proof_operator_operator_tx_id_key" ON "payment_proof"("operator", "operator_tx_id");

-- CreateIndex
CREATE INDEX "order_event_order_id_at_idx" ON "order_event"("order_id", "at");

-- CreateIndex
CREATE INDEX "order_event_kind_at_idx" ON "order_event"("kind", "at");

-- CreateIndex
CREATE INDEX "ledger_entry_order_id_idx" ON "ledger_entry"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entry_recorded_at_idx" ON "ledger_entry"("recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_order_id_key" ON "review"("order_id");

-- CreateIndex
CREATE INDEX "review_seller_id_verified_idx" ON "review"("seller_id", "verified");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_view" ADD CONSTRAINT "product_view_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
