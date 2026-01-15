-- Case memory layer
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "CaseEntityType" AS ENUM (
  'person',
  'child',
  'attorney',
  'judge',
  'org',
  'address'
);

CREATE TYPE "CaseFactType" AS ENUM (
  'parenting_rule',
  'custody',
  'support',
  'restriction',
  'definition',
  'asset',
  'debt',
  'schedule',
  'education',
  'medical',
  'travel',
  'communication',
  'other'
);

CREATE TYPE "ObligationType" AS ENUM (
  'payment',
  'exchange',
  'notice',
  'filing',
  'other'
);

ALTER TABLE "TimelineEvent"
ADD COLUMN "eventDate" TIMESTAMP(3),
ADD COLUMN "citationsJson" JSONB,
ADD COLUMN "confidence" TEXT;

CREATE TABLE "CaseEntity" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "type" "CaseEntityType" NOT NULL,
  "name" TEXT NOT NULL,
  "attributesJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseFact" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "type" "CaseFactType" NOT NULL,
  "key" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "citationsJson" JSONB NOT NULL,
  "confidence" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Obligation" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "obligationType" "ObligationType" NOT NULL,
  "dueDate" TIMESTAMP(3),
  "recurrence" TEXT,
  "description" TEXT NOT NULL,
  "citationsJson" JSONB NOT NULL,
  "confidence" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentChunk" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageNumber" INTEGER,
  "chunkIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "embedding" vector(1536),
  "embeddingJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseEntity_caseId_type_idx" ON "CaseEntity"("caseId", "type");
CREATE INDEX "CaseFact_caseId_type_idx" ON "CaseFact"("caseId", "type");
CREATE INDEX "CaseFact_caseId_key_idx" ON "CaseFact"("caseId", "key");
CREATE INDEX "Obligation_caseId_obligationType_idx" ON "Obligation"("caseId", "obligationType");
CREATE INDEX "DocumentChunk_caseId_documentId_idx" ON "DocumentChunk"("caseId", "documentId");
CREATE INDEX "DocumentChunk_documentId_pageNumber_idx" ON "DocumentChunk"("documentId", "pageNumber");

ALTER TABLE "CaseEntity" ADD CONSTRAINT "CaseEntity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseFact" ADD CONSTRAINT "CaseFact_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
