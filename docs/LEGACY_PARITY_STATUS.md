# Mandob — status of phase-one legacy parity (reviewed 2026-11-05)

This checklist is based on the existing v2 and legacy code and CI. It does **not** assert manual visual parity or production readiness.

## Implemented and verified automatically
- Roles, sessions, company isolation, company and administrator creation.
- Team create/edit and products/specialties; representative create/edit, TEAM/CUSTOM specialty preferences and solo representative products.
- Server-enforced TEAM/CUSTOM + assigned-area doctor eligibility for new tours, with the same rules in the representative's targeted-doctor list; multi-area doctor identity; XLSX review import.
- Area creation, edit, organization into groups, detailed company/team-scoped lists of reps and medical entities.
- Medical create/edit/status-only archives for doctors, pharmacies and hospitals; historical visits remain linked.
- Completed tour submission with one GPS location, visit-time team snapshot and idempotency. React retries unchanged failed requests using the same clientVisitId and GPS payload.
- Configurable doctor visit goals **per team or per representative, per cycle**; team progress counts all team-at-visit tours and personal progress counts only the representative's own tours; combined Frequency report and two-sheet XLSX; date reports and other exports.
- Server-scoped medical list search and pagination, visit/leave filters before pagination, improved mobile layouts with visible logout.
- GitHub Actions runs PostgreSQL migrations, API integration tests and React build.
- Real visit-time area attribution and independent per-area report are now covered by PostgreSQL and unit regressions, without changing team/individual frequency arithmetic.

## Deliberately blocked by the owner's rule or unresolved business behavior
1. **Doctor tour eligibility is approved and implemented (2026-11-04).** A new doctor visit requires the doctor to be active, in at least one of the rep's assigned areas, and in the rep's TEAM/CUSTOM specialty list. The server and React use the same rules. No eligible specialties means no new doctor tours. Previously saved visits remain intact, including idempotent retries after permission changes.
2. **Individual and team doctor goals approved and implemented (2026-11-04).** The manager may define a team goal for doctor D of 5 and, independently, a personal quota for rep A of 3 and rep B of 2 in the same cycle. One saved visit counts once towards its original team's doctor goal and once towards its author's personal quota (if configured), without duplicating VisitTarget. Team targets default to classification settings if no explicit team override exists; personal goals exist only if explicitly assigned. Old per-area coverage percentages still require review separately.
3. **Doctor bulk permanent deletion** is deliberately excluded; historical references must survive. **Team and area archiving** are explicitly excluded.
4. **Doctor-to-area manual sync** is obsolete because PostgreSQL enforces linked areas and XLSX import already upserts any new area names.
5. **GPS/offline exceptions, altered leave periods and custom week timezone** still need decisions. Sat–Fri count retains the legacy boundary with date inputs.
6. **Exact old company-manager governorate UI, modal step choreography and representative round animations** are not fully recreated; key data/API features have been restored, but visual equivalence requires a design review.

## Staging acceptance remains separate from coding completion
- Exercise Super Admin, Company Admin, Team Manager and Rep roles on staging with real data.
- Validate actual mobile UX, GPS permission prompts, interrupted requests and duplicate retries with the same upload/test cases.
- Validate exports on real Excel, large volumes, timezones and completed rounds; run representative-size load testing.
- Deployment, legacy SQLite migration, backup/restore and release sign-off are phase two and are **not** yet complete.

## Additional v2 parity and hardening verified in code (2026-11-05)

- Team managers can view scoped area groups, details and medical directories in React without create/edit/archive controls; API and database authorization remains authoritative.
- Company administrator can edit existing working days in React. New tour UI refuses more than 100 targets before requesting a GPS fix, matching the server limit.
- Area detail fetch errors can be retried rather than leaving an indefinite loading indicator. Dashboard medical totals reflect active directories; archives remain historically linked.
- Login/logout auditing and mutation-route inventory are enforced by regression checks. The supported runtime entrypoints and legacy boundary have a source-level CI check.
- `README.md` now documents the actual supported features. The old `backend/server.js` and `frontend/rep` sources stay available for comparison; only tracked Finder metadata has been removed.
- A four-role manual review checklist has been prepared in [Phase-one acceptance](PHASE1_ACCEPTANCE.md). Code-level CI is not a signed-off mobile visual comparison.

No changes to archived team/area rules, team-shared Frequency arithmetic or historical team-at-visit accounting were made.

## 2026-11-06 — Representative tour and area-screen comparison

Reviewed these concrete paths: legacy `frontend/rep/app.js`
(`renderRoundAreas`, `goSelectTargets`, `openRoundFinish`, `finishRound`)
versus React `frontend/react/src/App.tsx` (`NewVisit`) and
`AreaOrganization.tsx`.

- [x] Tour type (doctors, pharmacies, hospitals), target selection, date,
  submission with one final GPS position and an idempotency key are supported by
  the modern React and API implementation. A read-only summary now lists the
  selected targets before the existing submit button; it does not add a new
  mandatory step or alter the visit payload.
- [x] React's visit-date control now prevents selecting dates after the
  browser's current local day, consistent with the old form and the existing
  server-side future-date restriction.
- [x] Failed loading of selectable medical targets/areas, and failed loading
  of area groups/areas, now presents a retry action rather than an endless
  loading placeholder; no GPS or offline policy is changed.
- [x] **Approved 2026-11-06:** React now restores the original
  four-stage representative workflow: tour type → select one or multiple
  assigned areas → select target IDs in those areas → review + visit date +
  final GPS submission. Back navigation, selected-area/target counts and
  mobile step indicators are included. A doctor associated with two selected
  areas appears only once, by doctor ID; no automatic all-area fallback.
  The authorized API and original idempotent visit payload are unchanged.
  CI runs pure tests for multi-area target identity, distinct same-name doctors,
  and pruning selection after an area is deselected.
  Exact old transition animations and visual equivalence remain a manual UAT
  item; no mock/stale legacy data was reintroduced.
- [x] **Approved 2026-11-06:** each target's actual visited area is
  captured at visit time. Area-based doctor Frequency completion is attributed
  to that one area, and Doctor IDs are counted once in the overall team goal.
  The new server-backed area-coverage report replaces the old mock/static
  per-area calculation. See [Area Coverage](AREA_COVERAGE.md). Historical
  visits missing trustworthy area data are explicitly marked unattributed.
- [ ] Manual mobile and RTL checks remain needed: Android GPS consent and
  failures, network interruption followed by an identical idempotency retry,
  area detail navigation, XLSX review/import and all role-specific views.

These changes intentionally leave the original source in the repository.

## 2026-11-06 — Coverage calculation audit (explanation only)

The original `frontend/rep/app.js` function `calculateAreaStats(doctors,
repAreas)` grouped legacy doctor rows using `doctor.area === areaName`.
For each area it computed:
- `totalTarget = sum(Number(doctor.target || 0))`.
- `totalDone = sum(min(Number(doctor.done || 0), Number(doctor.target || 0)))`.
- `coverage = totalTarget > 0 ? round(totalDone / totalTarget * 100) : 0`.
- `unvisited` counted rows whose `status` equals `غير مزار` and `a` counted
  grade A doctors.
- Overall legacy workspace percentage used `round(sum(area.coverage *
  area.doctors) / sum(area.doctors))` (weighted by number of doctors in each
  area), which is **not** identical to a single totalDone/totalTarget ratio.

Current `backend/src/analytics-service.js` frequency reporting is instead
per team + doctor + configured cycle (and, separately, per representative +
doctor). It returns `coverage = min(100, round(done / target * 100))` for each
doctor, plus `completed/total` as the **number of target-achieving doctors**.
There is no approved `areaCoverage` field in the v2 API. These two measures
must not be labeled as the legacy per-area coverage.

Before adding legacy area percentages to v2, decide whether doctor visits
should count under each associated area or only the actual visited area,
how multiple teams and individual doctor goals contribute, and which cycle
supplies the `done` counts. These decisions are intentionally not changed
by the approved representative tour step restoration.
