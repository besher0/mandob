# Mandob phase-one: medical edits and reports (2026-10-23)

Company administrators can edit only descriptive fields:
- Doctor: name, specialty, grade, city
- Pharmacy: name, grade, target, kind
- Hospital: name, category, specialty, target

PATCH /api/{doctors,pharmacies,hospitals}/:id uses allowlisted fields and rejects attempts to change area, status, ID or unknown properties. Each permitted change is audited in the same transaction. Visits and medical identities are not deleted.

Manager report: GET /api/reports/visits?from=YYYY-MM-DD&to=YYYY-MM-DD and /api/reports/visits.xlsx with the same query. Both dates are required; maximum 366 days and 5000 tours; returns 413 if a narrower range is required.
Company Admin can read only their company's visits. Team Manager can read only visits attributed to their team at completion, using the immutable visit-time team ID. REP and SUPER_ADMIN cannot use this detailed report.
The report aggregates tour counts (not per target) by representative, historical team and type, with recorded target names and location. XLSX is a real workbook and sanitizes leading formula operators in imported names.

Existing team-doctor Frequency cycle metrics are unchanged. Editing a doctor's grade changes the grade-based frequency target, not historical visit counts; managers should review any intended target changes.

React now has medical editing forms, client-side search for already-loaded directory rows, role-appropriate reports and Excel export. Remaining legacy specialty/product custom modes, area groups and other report types are not all ported.

Do not add team or area archiving. Staging, production database, deployment and live/manual device verification remain phase two.
