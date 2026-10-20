-- Pharmacy and hospital archiving preserves entity IDs and all prior tour targets.
ALTER TABLE "Pharmacy" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Hospital" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Pharmacy_companyId_active_areaId_idx" ON "Pharmacy"("companyId","active","areaId");
CREATE INDEX "Hospital_companyId_active_areaId_idx" ON "Hospital"("companyId","active","areaId");
