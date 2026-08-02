-- ADR 0032 : la memoire post-achat du fil. Nullable, sans cle etrangere —
-- une commande purgee ne doit pas empecher la conversation d'exister.
ALTER TABLE "bot_conversation" ADD COLUMN "derniere_commande_id" TEXT;
