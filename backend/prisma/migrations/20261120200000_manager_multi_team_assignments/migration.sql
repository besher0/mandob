-- Add manager-to-team assignments without changing REP.teamId or visit snapshots.
CREATE TABLE "ManagerTeamAssignment" (
  "managerId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagerTeamAssignment_pkey" PRIMARY KEY ("managerId","teamId")
);
CREATE INDEX "ManagerTeamAssignment_teamId_idx" ON "ManagerTeamAssignment"("teamId");
ALTER TABLE "ManagerTeamAssignment" ADD CONSTRAINT "ManagerTeamAssignment_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerTeamAssignment" ADD CONSTRAINT "ManagerTeamAssignment_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD COLUMN "activeManagerTeamId" TEXT;
-- Preserve current single-team managers as the first approved assignment.
INSERT INTO "ManagerTeamAssignment" ("managerId","teamId")
SELECT u."id", u."teamId" FROM "User" u
JOIN "Team" t ON t."id"=u."teamId" AND t."companyId"=u."companyId"
WHERE u."role"='TEAM_MANAGER' AND u."teamId" IS NOT NULL
ON CONFLICT DO NOTHING;
