# Company admin tab parity tracker — 2026-11-27

**Scope:** Original company-admin UI parity plus explicitly requested **full sales functionality**. Introduces a separate `SALES_MANAGER` role and independent sales backend tables/APIs. Preserve `TEAM_MANAGER`, `REP`, `SUPER_ADMIN` views, their medical APIs and historical visit metrics. Sales may not be merged/deployed until latest CI and migration/test review.

**Reference:** `besher0/mandob-v2`, branch `feature/mandob-full-role-ui-parity`, especially `apps/web/src/v2/Company.tsx` and `apps/web/src/v2/App.tsx`. This feature branch is a UI reference, not proof of functional equivalence with Mandob.

| Requested area | Current Mandob company route / section | Status / next verification |
| --- | --- | --- |
| التغطية | `/company/coverage` | Exists, company-only. Coverage cards now show achieved, target and remaining **area-level visit goals**. Visually compare layout against company shell; validate geography attribution against real visits. |
| تغطية المحافظات | Company dashboard `تغطية المحافظات` and `/company/governorates` | Existing province breakdown. Corrected `المتبقي`: it previously displayed count of low-coverage areas, now `max(0, target-done)`. Validate with real multi-area doctors. |
| المبيعات | `/company/sales`, `/sales-manager/sales`, `/api/sales/*` | **Implemented on PR branch, NOT deployed:** sales agent/account CRUD, separate sales visits and orders, line-item snapshots, SYP prices, bonus/discount, list and summary filters, approve/reject, sales-manager own-only reads and submissions. Integration tests are present and latest CI/migration validation is required. v2 reference branch lacks a direct company-sales page, so visual parity cannot be claimed. |
| السايكل | `/company/cycles` | Existing editable cycle period, A/B/C frequencies and workdays; v2 shows a cycle list built on a different API. Keep existing writes; no simulated auto-recurring cycles. Validate form behavior and responsive structure. |
| الإعدادات | `/company/settings` | Separate from cycle with independent save payload. Keep leave balance, coverage target, manager instructions. Check form layout, long strings, loading/error/success states. |
| الأدوار والموظفون | `/company/access` | Existing fixed roles and staff list with in-page anchors. Added dedicated fixed `SALES_MANAGER` role; sales manager account create/disable/password reset is available under company sales. Custom grants and V2 STAFF role remain unsupported; no free-form role builder is promised. |
| التقارير | Former `/company/reports` menu entry | Hidden from company sidebar/mobile tabs only; route and stored reporting functionality retained. Other roles' reports tabs remain intact. |
| الأطباء | `/company/doctors` | Added specialty dropdown combined with province, area and search filters. |

## Acceptance checklist for remaining visual/functional parity

- Compare matching company-only pages on desktop and mobile with **realistic data**, including empty, loading, errors, long labels, 1/50/500 rows, and open dialogs.
- Verify counts for doctors assigned to several areas and reps/teams that cover multiple provinces; do not sum regional targets and call them unique team totals.
- Verify `/company/cycles` and `/company/settings` submit **only** their distinct allowed setting fields and do not reset unrelated fields.
- Verify company role/staff editor does not show unsupported custom RBAC controls; verify role filtering and "عرض المزيد" on the staff list.
- Scope **all** CSS and navigation changes to the company shell. Test unaffected manager, REP and super admin flows.
- Sales schema, migrations, API, authenticated sales-manager workspace and integration tests have been added to this PR. Verify the **latest commit** passes backend PostgreSQL CI, frontend builds, and role visual checks, then manually verify sales on staging before production migration/merge. Its UI cannot be certified from v2's company frontend because no such page exists in the reference branch.
- Validate sales data isolation between two companies and between two sales managers, pricing and discount math, repeated requests, simultaneous reviews, suspended account sessions, and medical visit separation.
- Do not mark full parity complete based solely on passing visual smoke or synthetic-data CI. Do not deploy or merge pending changes solely from this tracker.

## Sales work added after initial tracker

- New Prisma tables: `SalesAgent`, `SalesVisit`, `SalesOrder`, `SalesOrderItem`; schema/migrations under `backend/prisma`. `SalesVisit` is not the medical `Visit` table, so it is excluded from doctor/REP coverage.
- Sales APIs: `GET /api/sales/options`, `/agents`, `/accounts`, `/orders`, `/visits`, `/summary`; `POST` agents, accounts, visits and orders; `PATCH` agent status, sales-manager account and order review. Order line pricing is server-calculated in integer cents; server snapshots immutable line-level product name, unit price, discount, bonus and total.
- Manager role: `SALES_MANAGER` receives its own `/sales-manager/sales` single-tab interface. It may submit and view only its own sales, while the company admin can manage agents/accounts and approve or reject pending orders. All other API namespaces blocked for sales managers in `backend/src/app.js`.
- Risk: production PostgreSQL migration and smoke tests are pending; no merge/deploy in this PR as of this note. Creating an additional `SALES_MANAGER` enum value affects the shared role model but does not grant access to existing medical flows.
