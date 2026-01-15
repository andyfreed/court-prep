ALTER TABLE "TimelineEvent" ADD COLUMN "documentId" TEXT;
ALTER TABLE "CaseEntity" ADD COLUMN "documentId" TEXT;
ALTER TABLE "CaseFact" ADD COLUMN "documentId" TEXT;
ALTER TABLE "Obligation" ADD COLUMN "documentId" TEXT;

CREATE INDEX "TimelineEvent_caseId_documentId_idx" ON "TimelineEvent"("caseId", "documentId");
CREATE INDEX "CaseEntity_caseId_documentId_idx" ON "CaseEntity"("caseId", "documentId");
CREATE INDEX "CaseFact_caseId_documentId_idx" ON "CaseFact"("caseId", "documentId");
CREATE INDEX "Obligation_caseId_documentId_idx" ON "Obligation"("caseId", "documentId");
