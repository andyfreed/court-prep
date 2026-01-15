-- CreateEnum
CREATE TYPE "DocumentIngestStatus" AS ENUM (
  'queued',
  'uploaded',
  'extracting',
  'ready_to_index',
  'indexing',
  'done',
  'error'
);

-- CreateTable
CREATE TABLE "DocumentIngestJob" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "blobUrl" TEXT NOT NULL,
  "status" "DocumentIngestStatus" NOT NULL DEFAULT 'queued',
  "error" TEXT,
  "extractedTextBlobUrl" TEXT,
  "openaiFileId" TEXT,
  "documentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentIngestJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentIngestJob_documentId_key" ON "DocumentIngestJob"("documentId");

-- CreateIndex
CREATE INDEX "DocumentIngestJob_caseId_status_idx" ON "DocumentIngestJob"("caseId", "status");

-- AddForeignKey
ALTER TABLE "DocumentIngestJob" ADD CONSTRAINT "DocumentIngestJob_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentIngestJob" ADD CONSTRAINT "DocumentIngestJob_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
