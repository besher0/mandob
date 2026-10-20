-- Preserve historical team attribution at the time the tour was completed.
-- Old versions did not store this value. Existing visits cannot be historically
-- reconstructed from a rep's current membership. Leave old visits NULL and
-- require an explicit data reconciliation if existing production visits exist.
ALTER TABLE "Visit" ADD COLUMN "teamIdAtVisit" TEXT;
CREATE INDEX "Visit_companyId_teamIdAtVisit_visitDate_idx"
  ON "Visit"("companyId", "teamIdAtVisit", "visitDate");
