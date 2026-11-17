-- Persist submitted representative report snapshots for team managers.
-- Team assignment is recorded at submission time; historic visibility does not shift.
CREATE TABLE "RepReportSubmission" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "repId" TEXT NOT NULL,
  "teamIdAtSubmission" TEXT,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepReportSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RepReportSubmission_companyId_createdAt_id_idx"
  ON "RepReportSubmission"("companyId","createdAt","id");
CREATE INDEX "RepReportSubmission_companyId_teamIdAtSubmission_createdAt_idx"
  ON "RepReportSubmission"("companyId","teamIdAtSubmission","createdAt");
CREATE INDEX "RepReportSubmission_repId_createdAt_idx"
  ON "RepReportSubmission"("repId","createdAt");

ALTER TABLE "RepReportSubmission"
  ADD CONSTRAINT "RepReportSubmission_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepReportSubmission"
  ADD CONSTRAINT "RepReportSubmission_repId_fkey"
  FOREIGN KEY ("repId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
