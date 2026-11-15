-- Run this first in Neon > SQL Editor, on an isolated TEST branch.
-- All required entries should show table names, not NULL.
SELECT
  to_regclass('public."Company"') AS company_table,
  to_regclass('public."CompanySettings"') AS settings_table,
  to_regclass('public."Doctor"') AS doctor_table,
  to_regclass('public."DoctorArea"') AS doctor_area_table,
  to_regclass('public."User"') AS users_table,
  to_regclass('public."VisitTarget"') AS visit_targets_table,
  to_regclass('public."_prisma_migrations"') AS prisma_migrations_table;

-- The latest area-at-visit migration should be present and marked finished.
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 14;

-- Existing company names: import refuses to overwrite a company with the same name.
SELECT id, name, "createdAt"
FROM "Company"
ORDER BY "createdAt" DESC;
