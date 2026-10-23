-- Legacy area grouping only. No area/team archive or deletion flow is introduced.
CREATE TABLE "AreaGroup" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AreaGroup_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Area" ADD COLUMN "groupId" TEXT;
CREATE UNIQUE INDEX "AreaGroup_companyId_name_key" ON "AreaGroup"("companyId","name");
CREATE INDEX "AreaGroup_companyId_sortOrder_idx" ON "AreaGroup"("companyId","sortOrder");
CREATE INDEX "Area_companyId_groupId_idx" ON "Area"("companyId","groupId");
ALTER TABLE "AreaGroup" ADD CONSTRAINT "AreaGroup_companyId_fkey"
 FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Area" ADD CONSTRAINT "Area_groupId_fkey"
 FOREIGN KEY ("groupId") REFERENCES "AreaGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
