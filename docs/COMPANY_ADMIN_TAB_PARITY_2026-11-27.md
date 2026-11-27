# Company admin tab parity tracker — 2026-11-27

**Scope:** `COMPANY_ADMIN` only. Keep `TEAM_MANAGER`, `REP`, `SUPER_ADMIN`, backend permissions, database semantics and existing historical data unchanged.

**Reference:** `besher0/mandob-v2`, branch `feature/mandob-full-role-ui-parity`, especially `apps/web/src/v2/Company.tsx` and `apps/web/src/v2/App.tsx`. This feature branch is a UI reference, not proof of functional equivalence with Mandob.

| Requested area | Current Mandob company route / section | Status / next verification |
| --- | --- | --- |
| التغطية | `/company/coverage` | Exists, company-only. Coverage cards now show achieved, target and remaining **area-level visit goals**. Visually compare layout against company shell; validate geography attribution against real visits. |
| تغطية المحافظات | Company dashboard `تغطية المحافظات` and `/company/governorates` | Existing province breakdown. Corrected `المتبقي`: it previously displayed count of low-coverage areas, now `max(0, target-done)`. Validate with real multi-area doctors. |
| المبيعات | No equivalent current company route/API | **Blocked:** v2 contains a sales backend module, but no `company-sales` page in the selected reference web UI; Mandob has no equivalent sales storage and endpoints. Do not add a dead tab, faux data, or calls to nonexistent endpoints. Separate domain/API/schema design and acceptance tests are required before introducing a functional sales screen. |
| السايكل | `/company/cycles` | Existing editable cycle period, A/B/C frequencies and workdays; v2 shows a cycle list built on a different API. Keep existing writes; no simulated auto-recurring cycles. Validate form behavior and responsive structure. |
| الإعدادات | `/company/settings` | Separate from cycle with independent save payload. Keep leave balance, coverage target, manager instructions. Check form layout, long strings, loading/error/success states. |
| الأدوار والموظفون | `/company/access` | Existing fixed roles and staff list. Added separate in-page headings and anchor navigation for roles/staff. V2 custom grants and STAFF role **not supported** by Mandob RBAC; do not imply that creation/edits to custom roles work. |
| التقارير | Former `/company/reports` menu entry | Hidden from company sidebar/mobile tabs only; route and stored reporting functionality retained. Other roles' reports tabs remain intact. |
| الأطباء | `/company/doctors` | Added specialty dropdown combined with province, area and search filters. |

## Acceptance checklist for remaining visual/functional parity

- Compare matching company-only pages on desktop and mobile with **realistic data**, including empty, loading, errors, long labels, 1/50/500 rows, and open dialogs.
- Verify counts for doctors assigned to several areas and reps/teams that cover multiple provinces; do not sum regional targets and call them unique team totals.
- Verify `/company/cycles` and `/company/settings` submit **only** their distinct allowed setting fields and do not reset unrelated fields.
- Verify company role/staff editor does not show unsupported custom RBAC controls; verify role filtering and "عرض المزيد" on the staff list.
- Scope **all** CSS and navigation changes to the company shell. Test unaffected manager, REP and super admin flows.
- Sales should become a separate backend-supported feature with its own schema, API, authorization, and integration tests. Its UI cannot be certified from v2's company frontend because no such page exists in the reference branch.
- Do not mark full parity complete based solely on passing visual smoke or synthetic-data CI. Do not deploy or merge pending changes solely from this tracker.
