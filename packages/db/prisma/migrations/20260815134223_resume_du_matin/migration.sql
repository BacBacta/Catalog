-- AlterTable
ALTER TABLE "seller" ADD COLUMN     "resume_matin_stop_a" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "resume_matin" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "jour" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_matin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resume_matin_seller_id_jour_key" ON "resume_matin"("seller_id", "jour");

-- AddForeignKey
ALTER TABLE "resume_matin" ADD CONSTRAINT "resume_matin_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
