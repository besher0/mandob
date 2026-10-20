-- Safe retries: one immutable result per explicit manager import request.
CREATE TABLE "DoctorImportBatch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DoctorImportBatch_companyId_createdAt_idx"
  ON "DoctorImportBatch"("companyId","createdAt");
ALTER TABLE "DoctorImportBatch" ADD CONSTRAINT "DoctorImportBatch_companyId_fkey"
 FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
