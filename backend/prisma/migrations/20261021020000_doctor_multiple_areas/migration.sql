-- Keep the original Doctor.areaId intact and add extra area memberships.
CREATE TABLE "DoctorArea" (
 "doctorId" TEXT NOT NULL,
 "areaId" TEXT NOT NULL,
 CONSTRAINT "DoctorArea_pkey" PRIMARY KEY ("doctorId","areaId")
);
CREATE INDEX "DoctorArea_areaId_doctorId_idx" ON "DoctorArea"("areaId","doctorId");
ALTER TABLE "DoctorArea" ADD CONSTRAINT "DoctorArea_doctorId_fkey"
 FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorArea" ADD CONSTRAINT "DoctorArea_areaId_fkey"
 FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "DoctorArea" ("doctorId","areaId")
SELECT "id","areaId" FROM "Doctor" ON CONFLICT DO NOTHING;
