-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "openaiFileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "vectorStoreId" DROP NOT NULL;
