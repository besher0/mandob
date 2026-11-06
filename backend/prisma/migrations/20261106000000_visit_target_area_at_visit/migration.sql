-- Keep pre-existing targets unattributed; historic area cannot be inferred
-- reliably from today's DoctorArea links or a tour's end-GPS coordinate.
ALTER TABLE "VisitTarget"
  ADD COLUMN "areaIdAtVisit" TEXT;

CREATE INDEX "VisitTarget_areaIdAtVisit_doctorId_idx"
  ON "VisitTarget"("areaIdAtVisit", "doctorId");

ALTER TABLE "VisitTarget"
  ADD CONSTRAINT "VisitTarget_areaIdAtVisit_fkey"
  FOREIGN KEY ("areaIdAtVisit") REFERENCES "Area"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
