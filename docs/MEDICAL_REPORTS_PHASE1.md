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

React now provides server-side directory search/pagination, area grouping/details, report and medical exports and saved rep TEAM/CUSTOM preferences. Per-area coverage remains an explicit owner decision because the legacy rep-level model conflicts with approved team-shared Frequency.

Do not add team or area archiving. Staging, production database, deployment and live/manual device verification remain phase two.

## Extra legacy parity: specialties and Frequency export
- GET /api/specialties returns distinct active doctor specialties scoped to the authenticated company; no changes to team/rep specialty assignments.
- Doctor create/edit forms suggest the company's current specialties but still allow a new value.
- GET /api/analytics/frequency.xlsx exports the **existing, unchanged** team-doctor frequency calculation into an XLSX workbook, scoped by the same authorization logic as GET /api/analytics/frequency.
- The Excel workbook includes team, doctor, areas, grade, completed/target visits and coverage. Text is escaped against spreadsheet formula injection.
- PostgreSQL tests cover company isolation of specialty labels and XLSX results, workbook row counts and safe text handling.

## Additional exports and filters
- GET /api/reports/medical.xlsx?kind=doctors|pharmacies|hospitals (optional includeArchived=true) is COMPANY_ADMIN-only; includes doctors' multiple areas and caps exports at 5000 entries.
- Medical directory endpoints accept search, limit and offset and preserve company/team/rep scope. React fetches 100 results per page.
- Visits/leaves support role-scoped server date, type/status and rep filters prior to pagination.
