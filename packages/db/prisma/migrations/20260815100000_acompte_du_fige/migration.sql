-- L'acompte du se fige a la creation — ADR 0094, constat A4 de l'audit
-- 2026-08. Expand seul : colonne nullable, les commandes anterieures
-- restent telles quelles et la lecture recalcule pour elles.
ALTER TABLE "order" ADD COLUMN "due_before_xaf" INTEGER;
