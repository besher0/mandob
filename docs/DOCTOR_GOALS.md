# Mandob doctor visit goals: TEAM and REP (approved 2026-11-04)

The project owner confirmed that targets can be assigned to a **team** or an **individual representative**, and both target types can coexist for the same doctor during one cycle.

## Example: one doctor, two reps

The team has representatives **A** and **B**. The manager sets:
- Doctor D — **TEAM** target = **5** visits.
- Doctor D — **REP** target for A = **3** visits.
- Doctor D — **REP** target for B = **2** visits.

After A completes 2 doctor visits and B completes 2:
- Team progress = **4 / 5**.
- A personal progress = **2 / 3**.
- B personal progress = **2 / 2**, already achieved.

After A makes one more visit: team **5 / 5**, A **3 / 3**, B **2 / 2**. These are **five actual visits**, not ten. One VisitTarget can contribute once to each applicable counter. The sum of personal targets is not forced to equal the team target, and fulfilling the team target does not automatically fulfill a personal quota.

## Data model

`DoctorVisitGoal` is a per-company, per-doctor, per-cycle table. `scope` is `TEAM` or `REP`; `ownerId` is the corresponding Team ID or representative User ID. Unique key: `companyId,scope,ownerId,doctorId,cycleStart,cycleEnd`. Targets are positive integers 1–3650, and scope/target/check constraints are enforced by PostgreSQL.

- **Team progress:** count doctor VisitTarget rows whose parent Visit has `teamIdAtVisit` equal to the goal's team ID. Different teams never share credit, even after representative transfers.
- **Personal progress:** count doctor VisitTarget rows whose parent Visit has `repId` equal to the goal's representative. A representative's personally performed visits remain theirs even if they later transfer teams. Current team managers see only personal goals of currently assigned reps, while a rep sees only their own.
- **Team default:** if no explicit TEAM goal is configured for a doctor, the existing A/B/C settings supply its grade-based target. An explicit TEAM goal overrides this default for that team, doctor, and cycle. Personal goals are **not** implicitly created from grade defaults.
- **Archived doctors:** new tours remain forbidden; historic doctor visits and goal records remain intact.
- **Cycles:** bounds use `CompanySettings.cycleStart`/`cycleEnd`; if not set, the legacy report bounds 2000-01-01 to 2100-01-01 apply. Set cycle dates first for production data. Changing the cycle does not copy old goals or alter saved visits.

## Endpoints, roles and user interface

- `GET /api/doctor-goals` — Company Admin, current cycle, with doctor's display name.
- `PUT /api/doctor-goals` — Company Admin only, body `{ "scope":"TEAM"|"REP", "ownerId":"UUID", "doctorId":"UUID", "target":5 }`. Repeated calls update one goal; `target:null` removes the explicit goal and leaves visit history untouched. The server validates company ownership, active doctor for new goals, REP doctor-eligibility for individual assignments, and rejects foreign tenant IDs. Changes and audit events are atomic.
- `GET /api/analytics/frequency` — existing team `items` plus `personalItems`, `personalCompleted` and `personalTotal`. Roles are scoped: company admin all, team manager own team/current reps, rep shared team and own personal goals.
- `GET /api/analytics/frequency.xlsx` — worksheet **Frequency** for team targets and worksheet **Individual goals** for per-rep targets.
- React: Frequency screen separates team and personal progress. Company Admin gets a goal editor with doctor search, TEAM/REP selector, owner dropdown, count, and controls to update/remove goals.

Goals change only **targets and reporting**, never the historical Visit or VisitTarget rows, visit-time team attribution, or doctor/team/area archive behavior. Doctor tour permission remains the approved TEAM/CUSTOM specialty plus assigned area rule.

## Acceptance tests

Real PostgreSQL integration tests exercise the exact 5/3/2 example, role/tenant ownership, invalid goal inputs, changes/removal without deleting visits, cycle boundaries, Excel output, team vs individual credit and visibility. React build is also checked by CI. No production or manual staging test is claimed.
