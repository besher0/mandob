-- Existing legacy area groups remain company-wide; new groups may be scoped to one province.
ALTER TABLE "AreaGroup" ADD COLUMN "provinceId" TEXT;
CREATE INDEX "AreaGroup_companyId_provinceId_idx" ON "AreaGroup"("companyId","provinceId");
ALTER TABLE "AreaGroup" ADD CONSTRAINT "AreaGroup_provinceId_fkey"
  FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
