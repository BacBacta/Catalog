-- CreateTable
CREATE TABLE "bot_conversation" (
    "phone" TEXT NOT NULL,
    "etat" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_conversation_pkey" PRIMARY KEY ("phone")
);
