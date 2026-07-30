-- Lot 4 — OTP de verification du numero de reversement.
--
-- Additif : aucune colonne existante n'est touchee, aucune donnee n'est
-- deplacee. Le code n'est jamais stocke en clair, seule une empreinte HMAC.

-- CreateTable
CREATE TABLE "payout_otp" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_otp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_otp_seller_id_created_at_idx" ON "payout_otp"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_otp_expires_at_idx" ON "payout_otp"("expires_at");

-- AddForeignKey
ALTER TABLE "payout_otp" ADD CONSTRAINT "payout_otp_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
