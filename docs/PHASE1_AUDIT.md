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

Updated 2026-10-23. This document tracks **code quality and product parity**, not production deployment.

## Verified technical baseline

- Active backend: Express 5 + Prisma + PostgreSQL, with server-side sessions and company/team/representative role scoping.
- Core endpoints: companies, administrators, teams, representatives/users, areas, doctors, pharmacies, hospitals, products, visits, leave requests, settings and frequency analytics.
- The current implementation supports **two independent doctor goals per cycle**: one target for team+doctor (combining its members' visits by visit-time team), and optional individual targets for rep+doctor (only that rep's visits). A visit contributes to both progress calculations if both goals exist, without duplicating visit data. Legacy grade-based team targets remain the default when no explicit team goal is set.
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
| Area groups, area details, sync from doctors | Company-scoped area groups, area editing/details and multi-area doctors in API/React | Manual sync is obsolete with FK-backed areas; legacy area coverage formula needs an owner decision |
| Products and specialties | Rep TEAM/CUSTOM restrictions enforced for new doctor visits | Personal/team goal targets are independently configurable per doctor and cycle |
| Cycle frequency analytics | Shared team-doctor Frequency plus explicit team overrides and per-rep doctor quotas; report and XLSX separate progress | High-volume live verification pending |
| Weekly visits count | Saturday–Friday target counter for reps and managers in API/React | Confirm local timezone for long-term reporting |
| Settings annual leave/working days/cycle | Consolidated into GET/PATCH /api/settings | Test mixed/partial updates and configuration validity |
| Leave requests and manager approval | Ported | Exhaustive overlap, annual entitlement and concurrent approvals tests |
| Legacy report export/manager dashboards | Date-range visits XLSX, Frequency XLSX, weekly counter, medical entity XLSX | Per-area coverage formula needs separate approval |
| Existing plain HTML/JS screens | React role dashboards, medical editor, groups/details, full-directory search/pages, history filters, targeted doctors and mobile fixes | Exact old modal/round choreography and manual mobile UAT not yet verified |

## Safe engineering work completed or underway

- [x] Initial authn/authz and entity ownership checks.
- [x] Doctor tour authorization now re-checks the rep's current TEAM/CUSTOM specialty mode and assigned areas transactionally; mixed allowed+denied doctor tours fail atomically, frontend shows only authorized doctors.
- [x] Atomic mutation/audit writes.
- [x] Integration test coverage for basic company isolation, team manager restrictions, session revocation, GPS tours and leave requests.
- [x] Team-level frequency aggregation and separate reporting per team.
- [x] Expanded syntax checks to active backend services.
- [x] Inventory all 49 active v2 route registrations and verify anonymous + SUPER_ADMIN / COMPANY_ADMIN / TEAM_MANAGER / REP route permissions in a database-backed HTTP matrix; include cross-tenant IDs, team-area scoping and denied-write side effects (2026-11-05).
- [ ] Exhaustive malformed/invalid-input coverage for every writable route (validation audit, separate from RBAC).
- [ ] Consistent request validation and error handling for every route.
- [ ] Verify queries with realistic high volumes and add pagination/index tuning where needed.
- [ ] Extend audit coverage for all mutation paths and sensitive actions.
- [ ] Replace/retire legacy server.js and frontend files once parity is verified.
- [ ] Finish the missing React screens and permitted editing flows.

## Owner-approved rules (implemented)
- Visit counts stay with the original team when a representative changes teams; new visits count for the new team.
- Existing doctor Frequency remains shared by team; visits are still individually attributed to the rep and the team at visit time. The owner clarified that some visit targets are individual and some team-based, but the exact types are not yet specified.
- Doctors, pharmacies and hospitals are archived through status-only changes, retaining history.
- A doctor can belong to multiple areas with one Doctor ID; team-doctor frequency aggregates all those visits. Existing primary area and historical IDs are preserved.
- XLSX duplicate names are **reviewed by the company manager** with three options: link the same doctor to a new area, create a distinct doctor, or skip. No automatic merge or asking the doctor.
- The owner explicitly said to leave **all team and area archive/workflow ideas untouched**.

## Pending business-flow questions (no coding until approval)
- **2026-11-04 (resolved):** The owner provided team doctor D target 5, individual A target 3 and B target 2; implemented independently configurable per-cycle goals, with single-visit credit to both matching scopes. See [Doctor Goals](DOCTOR_GOALS.md).
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

- [x] Added rep TEAM/CUSTOM specialty preferences and solo rep product memberships with atomic RBAC checks, a read-only targeted doctor list, area groups/area details and Saturday–Friday weekly count.
- [x] Added complete medical directory XLSX exports, search/pagination, scoped visit/leave date/type/status filters, NewVisit selection search/filter and same-client-ID retry, and mobile logout.
- [ ] Exact legacy round UX and per-area coverage calculations have intentionally not been rewritten without behavior approval. See [Legacy Parity Status](LEGACY_PARITY_STATUS.md).

## Phase 2 (separately tracked)
Permanent PostgreSQL environment, staging/prod deployment, Nginx/HTTPS, backups, live manual testing, and release approval.

## 2026-11-04 security and response-shape hardening (phase 1)

- [x] Replaced the login limiter's global `attempts.clear()` at 2,500 entries with bounded tracking that only prunes expired entries and refuses new keys when saturated; active identity lockouts no longer disappear when unrelated usernames are tried.
- [x] Added a separate per-source-IP failure budget (50 failures per 15 minutes) to reduce username-rotation attacks. The original per-IP+username budget remains five failures per 15 minutes; successful login resets only that identity's failure history.
- [x] Added tests for lockout persistence, expiry, capacity, reset isolation, username rotation and a live HTTP API 429 response after repeated invalid logins.
- [x] Corrected the unassigned team manager's Frequency empty response to include `personalItems`, `personalCompleted` and `personalTotal`, matching the normal API contract, and added a regression test.
- [ ] Continue endpoint-by-endpoint invalid-input/role-matrix audits, broad application performance tests and manual role/UI parity checks before phase 1 sign-off.
- [ ] Operational hardening (multi-instance/shared rate limiting, reverse-proxy IP configuration, staging and load tests) belongs to production readiness; this limiter is process-local and is not a distributed deployment control.

These changes do not alter visit submission, team-at-visit history, doctor specialties, target frequency arithmetic, leave rules or medical archival.

## 2026-11-05 — RBAC route audit completed (step 1)

- Enumerated all 49 active `registerRoutes` routes, including the dynamic doctor/pharmacy/hospital edit endpoints and XLSX import preview, in `backend/test-v2/rbac-matrix.test.js`. The test fails if a route is added or removed without updating the executable matrix.
- PostgreSQL-backed integration test checks anonymous (401) and the four project roles against every route. For permitted routes, the matrix verifies that role authorization does not reject them; separate feature tests cover meaningful allowed requests. `/api/login`, `/api/me` and `/api/logout` are defined by the authentication layer, not the route inventory.
- Fixed a verified authorization/privacy issue: team managers previously received every area-group name and all associated area counts across their company. `GET /api/area-groups` now returns only groups with areas assigned to the manager's team representatives, and returns a filtered count of accessible areas.
- Hardened related team-area visibility predicates to require company-owned users with role `REP`; legacy `RepArea` rows belonging to a `TEAM_MANAGER` no longer grant unintended visibility through the team scope. Existing rep/team business rules and visit-time attribution are unchanged.
- Fixed area-details RBAC: archived doctors, pharmacies and hospitals are now excluded from the `TEAM_MANAGER` detailed area view; the `COMPANY_ADMIN` retains full archived visibility for administrative work. Added specific API regressions for all three entity types.
- Tested a shared group with both visible and hidden team areas, a private group, a separate company, direct cross-tenant writes and foreign representative IDs. Denied writes leave business data/audit entries unchanged.
- Checked by GitHub Actions: PostgreSQL migrations, syntax validation, all API tests and React build. Live production/staging permission reviews and malformed input coverage remain separate release/validation work, not claimed by this code audit.
