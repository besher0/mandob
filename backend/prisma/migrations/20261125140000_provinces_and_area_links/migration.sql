-- Preserve existing Area.city and historical VisitTarget.areaIdAtVisit.
CREATE TABLE "Province" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Province_companyId_name_key" ON "Province"("companyId","name");
CREATE INDEX "Province_companyId_idx" ON "Province"("companyId");
ALTER TABLE "Province" ADD CONSTRAINT "Province_companyId_fkey"
 FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Area" ADD COLUMN "provinceId" TEXT;
CREATE INDEX "Area_companyId_provinceId_idx" ON "Area"("companyId","provinceId");
ALTER TABLE "Area" ADD CONSTRAINT "Area_provinceId_fkey"
 FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "Province" ("id","companyId","name")
SELECT gen_random_uuid()::text, "companyId", BTRIM("city")
FROM "Area" WHERE "city" IS NOT NULL AND BTRIM("city") <> ''
GROUP BY "companyId",BTRIM("city")
ON CONFLICT ("companyId","name") DO NOTHING;
UPDATE "Area" a SET "provinceId"=p."id"
FROM "Province" p
WHERE a."companyId"=p."companyId" AND BTRIM(a."city")=p."name"
 AND a."provinceId" IS NULL;
