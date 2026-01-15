ALTER TABLE "Case"
ADD COLUMN "memoryRebuildInProgress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "memoryRebuildRequestedAt" TIMESTAMP(3);

ALTER TABLE "Document"
ADD COLUMN "documentType" TEXT;
