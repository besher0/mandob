-- Explicit per-doctor goals may belong to a TEAM or an individual REP.
-- Existing visits, historical team snapshots and implicit grade targets are untouched.
CREATE TABLE "DoctorVisitGoal" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "cycleStart" DATE NOT NULL,
  "cycleEnd" DATE NOT NULL,
  "target" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorVisitGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorVisitGoal_scope_check" CHECK ("scope" IN ('TEAM','REP')),
  CONSTRAINT "DoctorVisitGoal_target_check" CHECK ("target" >= 1 AND "target" <= 3650),
  CONSTRAINT "DoctorVisitGoal_cycle_check" CHECK ("cycleEnd" >= "cycleStart")
);
CREATE UNIQUE INDEX "DoctorVisitGoal_unique_scope_owner_doctor_cycle"
 ON "DoctorVisitGoal"("companyId","scope","ownerId","doctorId","cycleStart","cycleEnd");
CREATE INDEX "DoctorVisitGoal_companyId_cycleStart_cycleEnd_idx"
 ON "DoctorVisitGoal"("companyId","cycleStart","cycleEnd");
CREATE INDEX "DoctorVisitGoal_companyId_scope_ownerId_idx"
 ON "DoctorVisitGoal"("companyId","scope","ownerId");
ALTER TABLE "DoctorVisitGoal" ADD CONSTRAINT "DoctorVisitGoal_companyId_fkey"
 FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorVisitGoal" ADD CONSTRAINT "DoctorVisitGoal_doctorId_fkey"
 FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
