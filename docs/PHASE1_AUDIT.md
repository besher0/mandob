## Team transfer attribution — approved

**Rule confirmed by project owner:** visits recorded before a representative changes teams keep counting toward their original team's doctor frequency; visits submitted after the transfer count toward the new team. The shared frequency target stays once per team and doctor (not per representative).

- New PostgreSQL column `Visit.teamIdAtVisit` captures the team at tour completion.
- Team-manager visit history uses this immutable snapshot; leave requests intentionally continue to follow their existing current-team rule until separately approved.
- The representative sees the shared frequency of their *current* team. Company administrators see independent frequency rows for each team.
- Company/team reports also include a doctor's historical team visits even if its representative later moves.
- **Historical data limitation:** the original v2 Visit schema did not record a team snapshot. The migration leaves pre-existing visits with `NULL`, rather than assigning a potentially incorrect team. Any existing pre-migration real visits require a manual historical attribution decision; test/dummy databases may be recreated from scratch.
- Unassigned representatives' visits are treated as separate personal frequency groups.

# Mandob — Phase 1 code audit and parity checklist

Updated 2026-10-20. This document tracks **code quality and product parity**, not production deployment.

## Verified technical baseline

- Active backend: Express 5 + Prisma + PostgreSQL, with server-side sessions and company/team/representative role scoping.
- Core endpoints: companies, administrators, teams, representatives/users, areas, doctors, pharmacies, hospitals, products, visits, leave requests, settings and frequency analytics.
- The current implementation calculates frequency **per team and doctor**. All visits by team members count toward one target for that team; other teams have independent targets.
- Recording a completed tour accepts one GPS position for the tour. The client-supplied idempotency key cannot be reused with different data.
- Management database mutations and audit-log events use the same transaction.
- CI runs a PostgreSQL service, deploys Prisma migrations and exercises the API/integration tests; it also builds React.
- Production deployment and manual cross-device testing are **not** complete.

## Legacy/new API inventory

The legacy Express file has 40 /api route declarations, while the v2 router currently has 27; this is **not** 23 necessarily missing features because several endpoints were consolidated.

| Legacy surface | V2 state | Next action |
|---|---|---|
| Login, sessions, roles | Rebuilt in v2 | More threat-model and session tests |
| Team representative create/update/area/team assignment | Partially replaced by /api/users and PATCH /api/users/:id | Parity for all editing states and manager access |
| Teams create/update | Create implemented; old update workflow not yet ported | Implement update only after deciding edit semantics |
| Doctors add/list/import/bulk deletion | Add/list available | Import + safe edit/delete and bulk operations pending |
| Pharmacy/hospital add/list | Add/list available | Edit/delete, attribution checks and user-facing validation pending |
| Area groups, area details, sync from doctors | Not represented as independent v2 endpoints | Decide which features must remain |
| Products and specialties | Basic product creation/list; team-specialty storage exists | Product/team/rep assignments and specialty administration pending |
| Cycle frequency analytics | Rebuilt with shared team-doctor frequency | Test team membership history and edge cases |
| Weekly visits count | No separate v2 endpoint | Confirm exact week boundary and reporting requirements |
| Settings annual leave/working days/cycle | Consolidated into GET/PATCH /api/settings | Test mixed/partial updates and configuration validity |
| Leave requests and manager approval | Ported | Exhaustive overlap, annual entitlement and concurrent approvals tests |
| Legacy report export/manager dashboards | Only basic dashboard and frequency views ported | Audit report definitions, implement real data and exports |
| Existing plain HTML/JS screens | New React app has role-based dashboard scaffold | Complete parity/CRUD and responsive UX before removing legacy assets |

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

## Business-flow decisions — approval required **before any implementation**

1. **Representative moves teams:** Do visits already recorded count toward the **original team**, the **new team**, or both, in the current visit cycle? V2 currently determines the team by the representative's current membership.
2. **Entity deletion:** Can staff delete doctors/areas/teams with existing visits, or archive them without deleting history? Who may perform bulk operations?
3. **Doctor repeat visits:** Existing behavior allows a doctor to be visited in multiple tours on the same day; confirm whether all should count toward frequency.
4. **GPS unavailable/offline:** Must completing a tour fail, or can a pending/exception workflow be used?
5. **Leave calendar:** Working days, annual entitlement, leave categories and whether the manager can grant an exception.
6. **Week definition:** Start of reporting week and local-time rules.
7. **Legacy functions:** Should old area groups, doctor-to-area sync, imports and exports all be retained?

No code changes to the above business rules should be made without owner approval.

## Phase 2 (separately tracked)
Permanent PostgreSQL environment, staging/prod deployment, Nginx/HTTPS, backups, live manual testing, and release approval.
