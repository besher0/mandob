# Mandob — status of phase-one legacy parity (2026-10-23)

This checklist is based on the existing v2 and legacy code and CI. It does **not** assert manual visual parity or production readiness.

## Implemented and verified automatically
- Roles, sessions, company isolation, company and administrator creation.
- Team create/edit and products/specialties; representative create/edit, TEAM/CUSTOM specialty preferences and solo representative products.
- Scoped read-only targeted doctor list; multi-area doctor identity; XLSX preview/three-choice duplicate import.
- Area creation, edit, organization into groups, detailed company/team-scoped lists of reps and medical entities.
- Medical create/edit/status-only archives for doctors, pharmacies and hospitals; historical visits remain linked.
- Completed tour submission with one GPS location, visit-time team snapshot and idempotency. React retries unchanged failed requests using the same clientVisitId and GPS payload.
- Doctor-per-team Frequency and XLSX, date-range manager visits and XLSX, Saturday–Friday rep target count, medical directory XLSX.
- Server-scoped medical list search and pagination, visit/leave filters before pagination, improved mobile layouts with visible logout.
- GitHub Actions runs PostgreSQL migrations, API integration tests and React build.

## Deliberately blocked by the owner's rule or unresolved business behavior
1. **Actual tour eligibility by TEAM/CUSTOM specialties.** The legacy rep-targeted view filtered doctors; changing the current V2 visit submission to reject doctors outside selected specialties would change live visit behavior. The targeting list remains read-only until explicitly approved.
2. **Legacy area coverage percentages.** Old code calculated targets independently per representative. Approved V2 Frequency is shared by all representatives of the same team per doctor. Reproducing the old percentage would contradict the agreed rule; area details currently show factual counts rather than an unapproved score.
3. **Doctor bulk permanent deletion** is deliberately excluded; historical references must survive. **Team and area archiving** are explicitly excluded.
4. **Doctor-to-area manual sync** is obsolete because PostgreSQL enforces linked areas and XLSX import already upserts any new area names.
5. **GPS/offline exceptions, altered leave periods and custom week timezone** still need decisions. Sat–Fri count retains the legacy boundary with date inputs.
6. **Exact old company-manager governorate UI, modal step choreography and representative round animations** are not fully recreated; key data/API features have been restored, but visual equivalence requires a design review.

## Staging acceptance remains separate from coding completion
- Exercise Super Admin, Company Admin, Team Manager and Rep roles on staging with real data.
- Validate actual mobile UX, GPS permission prompts, interrupted requests and duplicate retries with the same upload/test cases.
- Validate exports on real Excel, large volumes, timezones and completed rounds; run representative-size load testing.
- Deployment, legacy SQLite migration, backup/restore and release sign-off are phase two and are **not** yet complete.

No changes to archived team/area rules, team-shared Frequency arithmetic or historical team-at-visit accounting were made.
