-- Preserve all existing users; default matches the legacy 'TEAM' mode.
ALTER TABLE "User" ADD COLUMN "specialtyMode" TEXT NOT NULL DEFAULT 'TEAM';
CREATE TABLE "RepSpecialty" (
  "repId" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  CONSTRAINT "RepSpecialty_pkey" PRIMARY KEY ("repId","specialty")
);
ALTER TABLE "RepSpecialty" ADD CONSTRAINT "RepSpecialty_repId_fkey"
  FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
