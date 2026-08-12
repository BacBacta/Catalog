-- ADR 0033, en expand : la description facultative d'un article (fiche du bot)
-- et la langue du fil acheteuse. Rien n'est retire, rien n'est obligatoire.
ALTER TABLE "product" ADD COLUMN "description" TEXT;
ALTER TABLE "bot_conversation" ADD COLUMN "langue" TEXT NOT NULL DEFAULT 'fr';
