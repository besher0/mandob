## Owner approval: soft-archive pharmacies and hospitals
- [x] `Pharmacy.active` and `Hospital.active` default to true; migrations add indexes without deleting historical visits.
- [x] Only the company administrator may use `PATCH /api/pharmacies/:id/status` and `PATCH /api/hospitals/:id/status` with `{active:false}` to archive or `{active:true}` to restore.
- [x] Active medical lists hide archived records by default; admin may pass `includeArchived=true` to inspect them.
- [x] New tours require active targets for doctor, pharmacy and hospital types. Past visits retain their references and remain visible.
- [x] React company-manager medical directories support archive, restore and showing archived records for all three target types.
- [x] API integration tests cover archive, permissions, historical preservation, idempotent retries, audit and restoration.
- [ ] Staging/production tests belong to phase 2.

## Doctor archive rule — owner approved
- [x] Archiving a doctor is **not DELETE**: set `Doctor.active=false`, retain the same id and all `VisitTarget` history.
- [x] Archived doctors are excluded from new visit selection and new tours. Only the company admin can archive or reactivate a doctor.
- [x] Historical frequency retains archived doctors when they have recorded visits in the selected cycle; unvisited archived doctors are not counted as active pending targets.
- [x] React company-admin directory can show archived doctors and restore them.
- [x] Status-only archive/restore is also approved and implemented for pharmacies and hospitals.

## Team transfer attribution — approved

**Rule confirmed by project owner:** visits recorded before a representative changes teams keep counting toward their original team's doctor frequency; visits submitted after the transfer count toward the new team. The shared frequency target stays once per team and doctor (not per representative).

- New PostgreSQL column `Visit.teamIdAtVisit` captures the team at tour completion.
- Team-manager visit history uses this immutable snapshot; leave requests intentionally continue to follow their existing current-team rule until separately approved.
- The representative sees the shared frequency of their *current* team. Company administrators see independent frequency rows for each team.
- Company/team reports also include a doctor's historical team visits even if its representative later moves.
- **Historical data limitation:** the original v2 Visit schema did not record a team snapshot. The migration leaves pre-existing visits with `NULL`, rather than assigning a potentially incorrect team. Any existing pre-migration real visits require a manual historical attribution decision; test/dummy databases may be recreated from scratch.
- Unassigned representatives' visits are treated as separate personal frequency groups.

# Mandob — Phase 1 code audit and parity checklist

Updated 2026-10-21. This document tracks **code quality and product parity**, not production deployment.

## Verified technical baseline

- Active backend: Express 5 + Prisma + PostgreSQL, with server-side sessions and company/team/representative role scoping.
- Core endpoints: companies, administrators, teams, representatives/users, areas, doctors, pharmacies, hospitals, products, visits, leave requests, settings and frequency analytics.
- The current implementation calculates frequency **per team and doctor**. All visits by team members count toward one target for that team; other teams have independent targets.
- Recording a completed tour accepts one GPS position for the tour. The client-supplied idempotency key cannot be reused with different data.
- Management database mutations and audit-log events use the same transaction.
- CI runs a PostgreSQL service, deploys Prisma migrations and exercises the API/integration tests; it also builds React.
- Production deployment and manual cross-device testing are **not** complete.

## Legacy/new API inventory

The legacy Express file has 40 /api route declarations, while the v2 router currently has 30; these counts are **not** the number of missing product features because several endpoints were consolidated.

| Legacy surface | V2 state | Next action |
|---|---|---|
| Login, sessions, roles | Rebuilt in v2 | More threat-model and session tests |
| Team representative create/update/area/team assignment | Backend + React editing available | Broader user tests and UI polish pending |
| Teams create/update | Create and partial update of name, specialties, products restored from legacy | Broader UI tests and rep-level custom assignment parity pending |
| Doctors add/list/import/bulk deletion | Add/list, medical field editing, status-only archive/restore, XLSX import and multiple areas | Old bulk operations excluded; no hard-delete authorized |
| Pharmacy/hospital add/list | Add/list, field editing, archive/restore and React forms | Wider manual UI testing pending |
| Area groups, area details, sync from doctors | Not represented as independent v2 endpoints | Decide which features must remain |
| Products and specialties | Product list/create UI, team assignments, specialty suggestions derived from company doctors | Rep-specific products/specialty mode and standalone specialty administration pending |
| Cycle frequency analytics | Shared team-doctor frequency with team-at-visit history, React team column and Excel export | High-volume and additional edge tests pending |
| Weekly visits count | No separate v2 endpoint | Confirm exact week boundary and reporting requirements |
| Settings annual leave/working days/cycle | Consolidated into GET/PATCH /api/settings | Test mixed/partial updates and configuration validity |
| Leave requests and manager approval | Ported | Exhaustive overlap, annual entitlement and concurrent approvals tests |
| Legacy report export/manager dashboards | Date-range visit reports and XLSX export by rep and historic team available | Other legacy report types and exports pending |
| Existing plain HTML/JS screens | React role screens, medical editing and search, manager visit reports | Remaining parity, mobile/responsive manual testing pending |

## Safe engineering work completed or underway

- [x] Initial authn/authz and entity ownership checks.
- [x] Atomic mutation/audit writes.
- [x] Integration test coverage for basic company isolation, team manager restrictions, session revocation, GPS tours and leave requests.
- [x] Team-level frequency aggregation and separate reporting per team.
- [x] Expanded syntax checks to active backend services.
- [ ] Exhaustive endpoint/role test matrix including unauthorized IDs and bad inputs.
- [ ] Consistent request validation and error handling for every route.
- [ ] Verify queries with realistic high volumes and add pagination/index tuning where needed.
- [ ] Extend audit coverage for all mutation paths and sensitive actions.
- [ ] Replace/retire legacy server.js and frontend files once parity is verified.
- [ ] Finish the missing React screens and permitted editing flows.

## Owner-approved rules (implemented)
- Visit counts stay with the original team when a representative changes teams; new visits count for the new team.
- Frequency is shared for doctor-and-team, never across two different teams.
- Doctors, pharmacies and hospitals are archived through status-only changes, retaining history.
- A doctor can belong to multiple areas with one Doctor ID; team-doctor frequency aggregates all those visits. Existing primary area and historical IDs are preserved.
- XLSX duplicate names are **reviewed by the company manager** with three options: link the same doctor to a new area, create a distinct doctor, or skip. No automatic merge or asking the doctor.
- The owner explicitly said to leave **all team and area archive/workflow ideas untouched**.

## Pending business-flow questions (no coding until approval)
- Duplicate visits for one doctor on the same day: preserve current permissive behavior until confirmed.
- GPS unavailable or offline: currently a valid fresh location is required.
- Changes to leave categories/working-day rules or report period/time zones.
- Other legacy exports and imports beyond the approved XLSX doctor import; see [Excel import policy](DOCTOR_XLSX_IMPORT.md).
- Further editing rules for medical records; hard deletes of medical history are not authorized.

## Engineering progress
- Paginated visit and leave history, with React load-more and unchanged company/team scoping.
- Company-admin React editing for existing user fields.
- Team-labelled React Frequency rows with unique keys for shared doctors.
- Protection against showing stale data from a previous filter/refresh.
- Expanded integration RBAC suite for unauthorized users and cross-company admins.
- Real XLSX parsing, manager-review import decisions, same-Doctor-ID multi-area tours and frequency, atomic imports, retry-safe import IDs and regression tests.
- Medical editing panels and allowlisted backend PATCH for doctors, pharmacies and hospitals with company isolation and atomic audit.
- Date-filtered manager visit reports, historical team-at-visit grouping, actual Excel downloads, and React medical-directory search/loading.
- PostgreSQL tests cover medical editing/visits preservation, scoped report data, invalid dates, and XLSX output.
- Team creation and partial editing of name/specialties/product memberships, with validation for company-owned active products, atomic audits and a React admin product directory.
- Invalid or foreign product assignments roll back without altering the team, and the UI blocks team writes until products are loaded successfully.
- See [role authorization matrix](ROLE_MATRIX.md) for the route-level baseline.

## Phase 2 (separately tracked)
Permanent PostgreSQL environment, staging/prod deployment, Nginx/HTTPS, backups, live manual testing, and release approval.
