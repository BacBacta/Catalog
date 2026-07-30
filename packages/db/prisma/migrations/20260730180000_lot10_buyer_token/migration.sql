-- Lot 10 — le secret du lien de suivi de l'acheteuse.
--
-- EXPAND, premiere etape : la colonne est ajoutee NULLABLE. Les commandes
-- creees avant ce lot n'ont pas de jeton, et leur en fabriquer un dans une
-- migration serait fabriquer un secret sans que personne l'ait recu.
--
-- Pourquoi une colonne de plus alors que `verification_code` existe deja :
-- ce dernier IDENTIFIE, il n'autorise pas. Il est public des qu'un recu est
-- montre. Le faire servir de laissez-passer a la contre-signature reviendrait
-- a laisser contresigner quiconque a vu le recu, et la contre-signature
-- perdrait ce qui fait sa valeur : etre la voix de l'AUTRE partie.
ALTER TABLE "order" ADD COLUMN "buyer_token" TEXT;

CREATE UNIQUE INDEX "order_buyer_token_key" ON "order"("buyer_token");
