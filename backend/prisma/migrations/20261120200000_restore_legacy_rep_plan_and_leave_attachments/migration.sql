-- Restore real data behind the original representative plan and leave UI.
CREATE TYPE "ProductPriority" AS ENUM ('PRIMARY', 'SECONDARY', 'SUPPORT');

ALTER TABLE "Product"
  ADD COLUMN "priority" "ProductPriority" NOT NULL DEFAULT 'SUPPORT',
  ADD COLUMN "targetSpecialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Team"
  ADD COLUMN "managerInstructions" VARCHAR(1000);

ALTER TABLE "CompanySettings"
  ADD COLUMN "targetACoverage" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "managerInstructions" VARCHAR(1000);

CREATE TABLE "LeaveAttachment" (
  "id" TEXT NOT NULL,
  "leaveId" TEXT NOT NULL,
  "fileName" VARCHAR(120) NOT NULL,
  "mimeType" VARCHAR(40) NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveAttachment_leaveId_key" ON "LeaveAttachment"("leaveId");
ALTER TABLE "LeaveAttachment" ADD CONSTRAINT "LeaveAttachment_leaveId_fkey"
  FOREIGN KEY ("leaveId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
