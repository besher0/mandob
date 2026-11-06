# Mandob phase-one acceptance matrix

Updated: 2026-11-05. This is an **acceptance checklist**, not a declaration that
staging, mobile device, visual-parity or security-penetration testing has passed.

## Automated evidence

- [x] Backend has a database-backed authorization matrix covering all 49 active
  v2 application routes for anonymous, SUPER_ADMIN, COMPANY_ADMIN, TEAM_MANAGER
  and REP. See `backend/test-v2/rbac-matrix.test.js`.
- [x] Team/company scoping, archived-record visibility, visit-time team
  attribution, leave approvals, doctor import and dual goal calculations have
  database-backed regression tests in `backend/test-v2/integration.test.js`.
- [x] JSON mutation payloads reject unknown top-level fields; PATCH requests
  reject empty bodies; rejected requests do not create misleading audit events.
- [x] Write-route audit mechanism inventory is checked by
  `backend/test-v2/audit-coverage.test.js`. Runtime tests validate many
  transactions, but this source-level guard does not replace event sampling
  against a real operational deployment.
- [x] PostgreSQL synthetic performance smoke runs with 800 doctors, 2,400 visits
  and 1,500 leave requests in CI. Timings are observational, not load targets.
- [x] React TypeScript and production build pass CI. Backend launch points at
  `backend/src/server.js`; React build is sourced only from `frontend/react`.

## Manual functional acceptance — NOT YET SIGNED OFF

These are read-only/manual checks against the deployed v2 app; avoid using
production personal records or reusing live passwords in a test environment.

### SUPER_ADMIN

- [ ] Sign in and create a test company, then create its COMPANY_ADMIN.
- [ ] Confirm no direct tenant employee, visit or medical actions appear for
  the global administrator.

### COMPANY_ADMIN

- [ ] Create/edit team specialties and products; add a REP, then change the
  REP's team and areas. Previous visit attribution must not change.
- [ ] Import an XLSX with repeated doctor names. Choose separately: link same
  Doctor ID into new area; create a different doctor; skip. Retry unchanged
  import ID and ensure no duplicate records.
- [ ] Create, edit, archive and restore doctors, pharmacies, hospitals. Old
  visits must remain visible; archived targets must not be available for new
  tours. Dashboard active totals should track archive/restore.
- [ ] Change working days, visit cycle, Frequency A/B/C and annual leave
  balance. Verify response and UI after a reload.
- [ ] Create TEAM doctor D goal 5 and REP goals A=3, B=2 in one cycle. One
  saved visit must contribute to both relevant progress counters but create
  only one VisitTarget. Recheck after a team transfer.
- [ ] Export visits, Frequency and medical directories to XLSX. Open each
  workbook in the intended spreadsheet application.

### TEAM_MANAGER

- [ ] Confirm team-only user lists, assigned area groups/area totals and
  read-only doctors/pharmacies/hospitals; no edit/archive/create UI.
- [ ] A transferred REP's old visits must remain in the old manager's history.
  Leave approvals continue to use the REP's **current** team as approved.
- [ ] A manager with no team sees empty valid lists, not another team's data.
- [ ] Simulate a failed area-details request: show an actionable error with
  retry instead of a perpetual loading indicator.

### REP

- [ ] Targeted-doctor list uses current area and TEAM/CUSTOM specialty
  restrictions. Mixed permitted/forbidden targets must be rejected atomically.
- [ ] Complete a tour using a fresh GPS location, with the device consent
  prompt, over HTTPS. Choose one visit area for each selected target; a doctor
  linked to two selected areas requires an explicit choice. Check the area
  remains visible in visit history and area coverage.
- [ ] Interrupt the network after request send, then retry unchanged form.
  Confirm same clientVisitId does not create a second tour.
- [ ] Confirm a doctor/pharmacy/hospital archived in the meantime is excluded
  from new visits but remains in historical visits.
- [ ] Confirm an unavailable location blocks submission, as the *current*
  accepted policy. No offline location exception has been authorized.
- [ ] Submit an annual leave and verify manager review and overlap rejection.

## Visual and legacy workflow parity — NOT YET APPROVED

- [ ] Review old representative round selection and transition choreography
  against the new React tour-completion UX. No silent replacement of old
  business workflows or animation decisions.
- [ ] Compare company-manager geographic/grouping interactions, responsive
  mobile layouts and RTL labels against the legacy screens.
- [x] Approve actual-area attribution and deduplicated team Doctor IDs
  for *per-area* coverage, implemented with an additive nullable database
  migration; see [Area Coverage](AREA_COVERAGE.md).
- [ ] Verify on staging that visits in area A never increase area B's completed
  counts, including doctors attached to both A and B; verify historic
  unattributed tours remain visible but are not assigned a fabricated area.
- [ ] Decide whether repeated same-day doctor visits, GPS failure/offline
  exceptions or customized reporting timezone should behave differently.
- [ ] Only after approval and acceptance, authorize removal of legacy
  `backend/server.js` and `frontend/rep` reference sources.

## Phase-two handoff (explicitly NOT covered by phase one)

- [ ] Permanent PostgreSQL and backups with a tested restore.
- [ ] HTTPS/Nginx production config, secrets, proxy trust and multi-instance
  rate-limiting decisions.
- [ ] Manual four-role mobile acceptance, sustainable load tests with
  representative volume, and explicit release approval.

**Rule:** CI success verifies code and a bounded synthetic fixture; it is not
visual equivalence, a production penetration test or deployment approval.
