-- ADR 0036 — expand.
-- Une notification mise en attente hors fenetre de service doit porter ses
-- boutons jusqu'a sa remise : sans eux, la contre-signature et l'invitation a
-- noter disparaitraient pour toutes les acheteuses inactives.
ALTER TABLE "bot_notification" ADD COLUMN "boutons" JSONB;
