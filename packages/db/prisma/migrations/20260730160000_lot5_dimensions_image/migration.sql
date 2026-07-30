-- Lot 5 — dimensions et poids de l'image stockee.
--
-- Additif. Ces trois colonnes ne sont pas decoratives :
--   * `image_width` / `image_height` seront posees sur <img width height> par la
--     boutique publique du lot 6, qui doit tenir un decalage visuel sous 0,1 ;
--   * `image_bytes` est ce qu'on affiche a la vendeuse (« 701 Ko -> 80 Ko ») :
--     c'est son forfait data.

ALTER TABLE "product" ADD COLUMN "image_width" INTEGER;
ALTER TABLE "product" ADD COLUMN "image_height" INTEGER;
ALTER TABLE "product" ADD COLUMN "image_bytes" INTEGER;
