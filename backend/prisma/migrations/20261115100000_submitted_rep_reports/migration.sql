-- An immutable snapshot of a representative's sent report, scoped to their company.
CREATE TABLE "SubmittedReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "teamIdAtSubmission" TEXT,
    "period" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmittedReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmittedReport_companyId_createdAt_id_idx" ON "SubmittedReport"("companyId","createdAt","id");
CREATE INDEX "SubmittedReport_companyId_teamIdAtSubmission_createdAt_id_idx" ON "SubmittedReport"("companyId","teamIdAtSubmission","createdAt","id");
CREATE INDEX "SubmittedReport_repId_createdAt_id_idx" ON "SubmittedReport"("repId","createdAt","id");

ALTER TABLE "SubmittedReport" ADD CONSTRAINT "SubmittedReport_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmittedReport" ADD CONSTRAINT "SubmittedReport_repId_fkey"
  FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
