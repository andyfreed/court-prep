ALTER TABLE "CaseEntity"
ADD COLUMN "citationsJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "confidence" TEXT NOT NULL DEFAULT 'medium';
