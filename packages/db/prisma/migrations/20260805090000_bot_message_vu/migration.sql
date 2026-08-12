-- ADR 0040 — expand.
--
-- L'idempotence des messages entrants. WhatsApp et ses relais livrent AU MOINS
-- une fois : sans cette table, une relivraison rejoue le message dans la
-- machine de conversation, et un vieux « Bonjour » devient le nom d'une
-- boutique. Constate en bac a sable le 05/08/2026.
--
-- La cle est le `wamid` : l'identifiant que WhatsApp donne au message, unique
-- de bout en bout, et le seul point fixe d'une relivraison.
CREATE TABLE "bot_message_vu" (
  "id"         TEXT NOT NULL,
  "reclame_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "termine_le" TIMESTAMP(3),
  CONSTRAINT "bot_message_vu_pkey" PRIMARY KEY ("id")
);

-- Sert la purge des vieilles lignes, pas une lecture chaude.
CREATE INDEX "bot_message_vu_reclame_le_idx" ON "bot_message_vu"("reclame_le");
