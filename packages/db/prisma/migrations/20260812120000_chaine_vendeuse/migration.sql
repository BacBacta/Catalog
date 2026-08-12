-- La chaine WhatsApp de la vendeuse — ADR 0061, rang 3b.
--
-- Colonne ADDITIVE et nullable : phase *expand* (AGENTS.md §6). `NULL` est
-- l'etat normal — une vendeuse n'a pas forcement de chaine, et n'en aura
-- peut-etre jamais.
ALTER TABLE "seller" ADD COLUMN "chaine_url" TEXT;
