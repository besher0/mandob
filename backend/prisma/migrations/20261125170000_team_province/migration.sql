-- Explicit province ownership for teams. Legacy teams remain unassigned unless
-- all their currently assigned representative areas identify one province.
ALTER TABLE "Team" ADD COLUMN "provinceId" TEXT;
CREATE INDEX "Team_companyId_provinceId_idx" ON "Team"("companyId","provinceId");
ALTER TABLE "Team" ADD CONSTRAINT "Team_provinceId_fkey"
 FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
WITH team_provinces AS (
 SELECT u."teamId", MIN(a."provinceId") AS "provinceId"
 FROM "User" u JOIN "RepArea" ra ON ra."repId"=u."id"
 JOIN "Area" a ON a."id"=ra."areaId"
 WHERE u."role"='REP' AND u."teamId" IS NOT NULL AND a."provinceId" IS NOT NULL
 GROUP BY u."teamId"
 HAVING COUNT(DISTINCT a."provinceId")=1
)
UPDATE "Team" t SET "provinceId"=tp."provinceId"
FROM team_provinces tp WHERE t."id"=tp."teamId" AND t."provinceId" IS NULL;
