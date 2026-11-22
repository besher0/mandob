# Mandob ↔ mandob-v2 verification gate — 2026-11-22

## Authority and limits

- **Visual reference**: `besher0/mandob-v2`, branch `feature/mandob-full-role-ui-parity`, particularly `apps/web/src/v2`. The user's selected visual reference is **mandob-v2**.
- Runtime: `besher0/mandob`, `backend/src` and `frontend/react/src`.
- This audit distinguishes **code/integration validation**, **render/browser smoke tests**, and **pixel-level parity**. Browser smoke and saved screenshots do **not** prove pixel-perfect visual matching or production hardware behavior.
- Original route inventory: `docs/V2_ALL_ROLES_PAGE_AUDIT_2026-11-22.md`.

## Verified by code and integration tests

| Area | Status and evidence |
| --- | --- |
| Visit-time area attribution | **Covered by PostgreSQL tests.** `backend/test-v2/area-coverage-integration.test.js` asserts each target's `areaIdAtVisit` for one doctor linked to two areas; no area is inferred for unattributed historical visits. |
| Team deduplication and historical team | **Covered.** `backend/src/analytics-service.js` groups by `teamIdAtVisit`; `backend/src/area-coverage-service.js` de-duplicates the doctor in team totals but lets area rows keep their separate visit-attribution counts. Unit and integration tests cover both. |
| Manager responsible for multiple teams | **Covered for session-scoped switching and authorization.** `backend/test-v2/manager-multi-team.test.js` covers two teams, foreign-tenant rejection, active-team switch, revocation, and historic visit-team immutability. It is not a high-load concurrency test. |
| Medical lists beyond API paging caps | **Confirmed issue repaired in PR #16.** General endpoints paginate at max 500 rows; frontend previously loaded only page one. `frontend/react/src/medicalPages.mjs` now loads all authorized pages, cancels stale searches, validates ordering by unique IDs and fails visibly at a 10,000-record safety cap. REP area drilldown and company data are included. REP-specific doctor endpoint now supports opt-in stable pagination. Tests: `frontend/react/test/medicalPages.test.mjs`, `backend/test-v2/rep-medical-pagination.test.js`. |
| REP eligible specialty scope | **Confirmed issue repaired in PR #17.** Previously `doctorFilter` only used areas for REP directory/dashboard/report numerator/denominator; save visits applied `doctorTargetWhere` with TEAM/CUSTOM specialties. `scopedDoctorFilter` now reuses the visit-eligibility rule across those REP read paths. |
| GPS + idempotent visit writes | **Code and integration tests cover core invariants.** `backend/src/visit-service.js` validates GPS, transaction writes, doctor-area selection and `clientVisitId` replay; `frontend/react/src/locationFix.mjs` obtains fresh accurate location. Offline recovery on a physical phone remains untested. |
| Saved REP reports | **Server-authoritative snapshots and scoped reading verified in code and tests.** `backend/src/routes.js` recalculates report totals, persists `teamIdAtSubmission`, and controls access; `backend/test-v2/rep-report-submissions.test.js` validates access. `frontend/react/src/App.tsx` opens browser print to save as PDF, rather than serving a generated downloadable PDF. |
| Visual comparison | **Paired screenshots and browser-computed styles can now be measured** via `frontend/react/scripts/v2-side-by-side.mjs` and `v2-style-diff.mjs`. `css-differences-summary.json` reports mismatching sampled CSS/control values and worst pages. It is **not** a pixel/image-diff algorithm. |

## Open risks and known incomplete data wiring

1. **Manager teams table displays missing data for its province and coverage columns**: `frontend/react/src/App.tsx` `LegacyManagerTeamsPage` reads `item.province?.name` / `item.governorate?.name` and `item.coverage`, but `/api/manager/assigned-teams` in `backend/src/routes.js` returns `Team` records without those fields; the Prisma `Team` model does not define them. The visual cells are present, but their values render as `—`. Do not invent data or calculate coverage by averaging area percentages. Define a team-scoped aggregation from verified source tables before enabling these values.
2. **Actual PDF save/printing on mobile remains unverified**. The current button uses popup printing and the user's browser “Save as PDF”. Real browser popup blocking and print formatting must be UAT-tested.
3. **GPS loss, resume, and network disconnect require device testing**. Happy-path, invalid position, and idempotency tests cannot prove every device lifecycle or mobile OS permission edge case.
4. **Concurrent PostgreSQL write conflicts** were observed intermittently in a historical `rbac-matrix` workflow run (serialization 409). A rerun passed; this does not close the contention risk. Keep rejection/retry behavior, and investigate targeted concurrency stress before production claims.
5. **Large directories**: the new frontend safety ceiling is 10,000 records. Beyond it the system displays an explicit error; a real server-side filtered/snapshot-paginated UI is still needed for greater scale and for guaranteed consistency under concurrent inserts.
6. **REP submitted reports list returns latest 50 only**, by design in `GET /api/rep-reports`. Older records are persisted but cannot be browsed from this screen until pagination is introduced.
7. **Pixel-perfect parity remains open**. Previous “56/56 paired comparisons” were screenshots captured, not identical screenshots. New CSS metrics provide evidence but different DOM/text/data composition and dynamic page states need manual inspection or real screenshot-difference tooling.
8. **Company teams’ governorate is derived** from representatives' current area assignments, because legacy Team schema has no `provinceId`. Teams without assigned representatives may show `غير محددة`, unlike the v2 demo's explicit province. This is a data-model gap, not a CSS bug.

## Release constraints

- Do not delete additional runtime features merely because a `mandob-v2` demo route is absent.
- Do not change GPS, visit-time team/area attribution, team manager multiple-team switching or tenant RBAC to achieve purely visual parity.
- Use CI gates: `Mandob PostgreSQL and React checks` and `Four-role v2 visual smoke` before merging code. These gate basic correctness, not pixel-equivalence.
- Before shipping: test an actual REP round offline/retry on phone, manager switching two teams with representative history, both PDFs and stored-report access, medical search after 1,000+ records, and populated tables across permissions.
