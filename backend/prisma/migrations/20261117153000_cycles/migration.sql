CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cycle_companyId_startDate_endDate_key"
  ON "Cycle"("companyId","startDate","endDate");

CREATE INDEX "Cycle_companyId_startDate_endDate_idx"
  ON "Cycle"("companyId","startDate","endDate");

ALTER TABLE "Cycle"
  ADD CONSTRAINT "Cycle_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
