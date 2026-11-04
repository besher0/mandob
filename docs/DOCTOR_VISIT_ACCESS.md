# Approved doctor visit eligibility and personal/team reporting boundary

**Owner decision: 2026-11-04.**

## Doctor visit restrictions (implemented)

1. Only active REP accounts can submit a tour with a valid recent GPS position, as before.
2. For DOCTOR tours, every supplied Doctor ID must be active, owned by the representative's company, present in at least one area assigned to that representative (including extra DoctorArea links), and have a specialty permitted to that representative:
   - `TEAM` mode: specialty is among the specialties of the representative's **current team**.
   - `CUSTOM` mode: specialty is among `RepSpecialty` values assigned directly to that representative.
   - No assigned/selected specialty means no doctors eligible for a new tour. A TEAM-mode representative without a team does not receive implicit doctor access.
3. The client doctor selector uses `GET /api/reps/:repId/doctors`, and the server uses the exact same shared `doctorTargetWhere` predicate inside the serializable tour transaction. There is no client-side authorization override.
4. One forbidden doctor in a multi-doctor tour rejects **the entire** submission with 403; it does not create Visit, VisitTarget or a successful audit event.
5. Pharmacy and hospital tour restrictions remain as before (active entity, same company, assigned area). Neither historical visit records nor company/team/archive workflows were modified.
6. Replays of the identical successful `clientVisitId` remain idempotent after a specialty/team permission change; new visits use the current rules.
7. Tests include allowed, mismatched specialties, unassigned areas, no specialties, TEAM/CUSTOM changes, secondary DoctorArea memberships and mixed-target atomic rejection.

## Individual vs shared doctor visit goals (implemented on 2026-11-04)

The owner specified separate **explicit doctor goals** for teams and individual representatives. Example: team of A and B targets 5 doctor D visits, while A targets 3 and B targets 2. The new goal model is `DoctorVisitGoal` with scope `TEAM` or `REP` and a doctor+cycle unique key:

- Each Visit has a representative `repId` and immutable `teamIdAtVisit` snapshot. Individual progress counts visits by the actual author; team progress counts visits by stored visit-time team.
- Each team can have an explicit target for a doctor that overrides the grade-based default; each representative can have a separately assigned target for the same doctor. Both counters may advance from a single real visit, but no visit is duplicated.
- The Frequency API and Excel workbook expose team rows and personal rows independently; reps only see their own personal goal, managers see their appropriately scoped reps, and only company admins may modify targets.

Doctor-goal assignments are scoped to the configured frequency cycle. New cycles do not silently copy explicit targets; old visits and old team attribution remain intact. See [Doctor Goals](DOCTOR_GOALS.md). Legacy area-coverage percentages and non-doctor categories are not assumed to share this doctor-goal policy.

Production data migration, staging/mobile testing and performance evaluation remain separate release work.
