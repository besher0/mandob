-- Persistent company additions to the default/sourced specialty catalog.
CREATE TABLE "CompanySpecialty" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanySpecialty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanySpecialty_companyId_name_key" ON "CompanySpecialty"("companyId","name");
CREATE INDEX "CompanySpecialty_companyId_name_idx" ON "CompanySpecialty"("companyId","name");
ALTER TABLE "CompanySpecialty" ADD CONSTRAINT "CompanySpecialty_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
