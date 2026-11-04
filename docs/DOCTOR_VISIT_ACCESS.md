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

## Individual vs shared visit accounting (awaiting mapping)

The owner also said that **some visits count individually and others count at team level**. Existing facts in v2:

- Each Visit has a representative `repId` and immutable `teamIdAtVisit` snapshot. Individual performed-visit totals remain available by rep.
- The current Frequency target for doctors has been implemented as **shared per team-and-doctor** across the team's representatives, with independent goals for other teams.
- Reports by representative and historical team are both available without modifying stored visits.

The owner has **not yet specified which visit categories or goal definitions use individual credit and which use shared team credit**. No change to aggregation formulas or retroactive attribution is authorized by the statement alone. A concrete example or per-entity classification is needed before modifying the existing Frequency/area coverage algorithm.

Production data migration, staging/mobile testing and performance evaluation remain separate release work.
