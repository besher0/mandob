-- Run AFTER the generated CORE SQL and optional ARCHIVE SQL.
-- Counts cover all companies; choose the imported company row.
SELECT c.id AS company_id,
       c.name AS company,
       (SELECT COUNT(*) FROM "Area" a WHERE a."companyId" = c.id) AS areas,
       (SELECT COUNT(*) FROM "AreaGroup" a WHERE a."companyId" = c.id) AS area_groups,
       (SELECT COUNT(*) FROM "Team" a WHERE a."companyId" = c.id) AS teams,
       (SELECT COUNT(*) FROM "Doctor" a WHERE a."companyId" = c.id) AS doctors,
       (SELECT COUNT(*) FROM "Pharmacy" a WHERE a."companyId" = c.id) AS pharmacies,
       (SELECT COUNT(*) FROM "Hospital" a WHERE a."companyId" = c.id) AS hospitals,
       (SELECT COUNT(*) FROM "Product" a WHERE a."companyId" = c.id) AS products,
       (SELECT COUNT(*) FROM "User" a WHERE a."companyId" = c.id) AS users
FROM "Company" c ORDER BY c."createdAt" DESC;

SELECT u.role, u.active, COUNT(*) AS total
FROM "User" u
WHERE u."companyId" IS NOT NULL
GROUP BY u.role, u.active
ORDER BY u.role, u.active;

SELECT COUNT(*) AS doctor_area_links FROM "DoctorArea";
SELECT COUNT(*) AS rep_area_links FROM "RepArea";

-- Run this last query ONLY after running the archive file (schema is optional).
-- SELECT source_table, COUNT(*) AS rows_stored
-- FROM mandob_legacy.records
-- GROUP BY source_table ORDER BY source_table;
