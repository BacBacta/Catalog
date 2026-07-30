-- CreateTable
CREATE TABLE "otp_attempt" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_attempt_phone_at_idx" ON "otp_attempt"("phone", "at");

-- CreateIndex
CREATE INDEX "otp_attempt_ip_at_idx" ON "otp_attempt"("ip", "at");

-- CreateIndex
CREATE INDEX "otp_attempt_at_idx" ON "otp_attempt"("at");
