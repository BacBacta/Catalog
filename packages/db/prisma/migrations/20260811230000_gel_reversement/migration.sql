-- Le gel du reversement — ADR 0061, rang 2b.
--
-- Colonne ADDITIVE et nullable : phase *expand* de la migration
-- expand/contract (AGENTS.md §6). Rien ne la lit avant d'y avoir ete branche,
-- rien ne casse si un ancien processus l'ignore.
--
-- `NULL` = pas de gel, et c'est l'ecrasante majorite. La date sert a un humain
-- qui, un jour, devra dire quand le gel a commence.
ALTER TABLE "seller" ADD COLUMN "reversement_gele_depuis" TIMESTAMP(3);
