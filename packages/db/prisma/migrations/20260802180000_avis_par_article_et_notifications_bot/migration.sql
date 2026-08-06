-- ADR 0035 — expand, rien de destructif.

-- L'avis par article : la colonne nait maintenant, meme sans lecture — chaque
-- avis depose sans elle est perdu pour toujours pour la fiche article.
ALTER TABLE "review" ADD COLUMN "product_id" TEXT;
CREATE INDEX "review_product_id_idx" ON "review"("product_id");

-- La derniere commande d'un fil devient un chemin de LECTURE (notification
-- acheteuse au verdict de preuve) : il lui faut son index.
CREATE INDEX "bot_conversation_derniere_commande_id_idx"
  ON "bot_conversation"("derniere_commande_id");

-- La file d'attente des notifications hors fenetre de service. Ajout seul :
-- la remise se date, elle n'efface rien.
CREATE TABLE "bot_notification" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "corps" TEXT NOT NULL,
  "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remis_le" TIMESTAMP(3),
  CONSTRAINT "bot_notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bot_notification_phone_remis_le_idx"
  ON "bot_notification"("phone", "remis_le");
