-- Soft-archive doctors without deleting visits or changing doctor identifiers.
ALTER TABLE "Doctor" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Doctor_companyId_active_areaId_idx"
  ON "Doctor"("companyId", "active", "areaId");
