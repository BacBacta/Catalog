-- ADR 0034, en expand : l'attribution de parrainage et le canal d'ouverture
-- d'une boutique. Les deux sont des MESURES, pas des autorisations : aucune
-- recompense n'est calculee, aucun droit n'en depend.
ALTER TABLE "seller" ADD COLUMN "parrain_id" TEXT;
ALTER TABLE "seller" ADD COLUMN "canal_ouverture" TEXT NOT NULL DEFAULT 'web';
CREATE INDEX "seller_parrain_id_idx" ON "seller"("parrain_id");
