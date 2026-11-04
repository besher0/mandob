# Mandob — status of phase-one legacy parity (2026-10-23)

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

No changes to archived team/area rules, team-shared Frequency arithmetic or historical team-at-visit accounting were made.
