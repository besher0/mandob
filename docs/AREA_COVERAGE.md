# Area coverage — approved per-visit-area accounting (2026-11-06)

## Owner-approved rule

Every saved medical target contributes to **the one area where that target
was visited**, not all areas currently associated with that medical contact.
For a doctor linked to two areas, the representative must choose one visit
area for that doctor in the tour wizard. Multi-area tours may assign different
targets to different selected areas. The final GPS fix is taken **once** at
the end of the tour; it is not a location proof for each stop.

The team doctor target remains **one target per Doctor ID per team per cycle**.
If a doctor appears in multiple areas, the doctor contributes to each
area's **independent denominator**, but the overall team denominator includes
that Doctor ID only once.

## Example

Doctor D belongs to A and B, and the team target is 4 visits for D.
One actual visit recorded in A gives:

| Scope | Completed | Target | Percentage |
| --- | ---: | ---: | ---: |
| Area A | 1 | 4 | 25% |
| Area B | 0 | 4 | 0% |
| Whole team (unique Doctor ID) | 1 | 4 | 25% |

Another visit in B changes A to 25%, B to 25%, and the team to
2/4 = 50%. **Do not sum A and B's targets** to derive the team denominator.

Per-area coverage is calculated by summing, for each distinct eligible doctor
linked to the team/area:

`min(visits_for_doctor_in_this_area, doctor_team_target)` divided by the
sum of that doctor's team target in that area. The result is rounded to a
whole percentage. Team coverage sums capped visits and targets across
distinct Doctor IDs (regardless of area). Individual REP doctor goals remain
a separate indicator and do not enter these area-team denominators.

## Persistence and API

- Additive migration:
  `20261106000000_visit_target_area_at_visit`.
- Nullable `VisitTarget.areaIdAtVisit` references `Area.id`.
  For newly created visits, the API validates the selected area belongs
  to the authenticated representative's assigned areas **and** the target
  medical entity is linked to that exact area. Each target gets one area
  within the same serializable visit write transaction.
- `POST /api/visits` accepts
  `areaByTarget: { "<target UUID>": "<actual area UUID>" }` for every target.
  Old clients that omit the map can only save targets with **exactly one**
  permitted linked area. If a doctor has more than one permitted linked area,
  the API returns 400 instead of guessing. An invalid/foreign area returns
  400 or 403 and creates no visit or audit entry.
- The idempotency comparison includes an explicitly sent area map; reusing a
  clientVisitId with different area attribution is a 409 conflict.
- `GET /api/visits` lists `areaIdAtVisit` and the current area name per
  target, with null for old unattributed targets.
- `GET /api/analytics/area-coverage` shows per-team/per-area numerators and
  denominators, along with deduplicated team totals, for company managers,
  team managers and representatives under the existing Frequency authorization
  boundaries. React offers a dedicated **تغطية المناطق** navigation entry.
- Existing `GET /api/analytics/frequency` keeps its per-team and
  per-representative goal behavior untouched.

## Historic visits: do not guess or backfill

Old visits did not record a real area for each target, so the new column
is **NULL** for those rows. The source area of a doctor today and the
tour-end GPS position cannot reliably reconstruct the actual visit area.

Historic unattributed visits still count toward team/representative Frequency,
but do not increase a particular area's completed visit count. The area
coverage endpoint explicitly reports
`unattributedHistoricalVisits` so these omissions are visible.

## Status and release boundary

The migration, API validation, React area selection, reporting and
PostgreSQL-backed tests are committed. The GitHub Actions suite runs
`prisma migrate deploy` against a fresh PostgreSQL instance, unit/integration
tests and a React build. **No live database migration or mobile GPS acceptance
has been performed by these commits.**

For any staging/production DB, back up and review the exact migration before
running `npx prisma migrate deploy`, and perform a manual multi-area
doctor/visit/retry and historical-report acceptance run over HTTPS.
