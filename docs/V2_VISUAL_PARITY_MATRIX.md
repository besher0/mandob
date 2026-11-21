# Mandob → mandob-v2: visual parity matrix

## Source of truth

- **Edit:** `besher0/mandob` branch `feat/v2-visual-parity-four-roles`.
- **Visual reference:** `besher0/mandob-v2` branch `feature/mandob-full-role-ui-parity`.
- Keep the existing React/Vite + Express/Prisma APIs and tenant/role authorization; **do not replace role checks with visuals**.
- **Status definitions:** `STRUCTURE` means the screenshot hierarchy was changed toward v2; `SHELL` means shared palette/navigation/header/controls CSS only, not pixel-perfect; `GAP` means no equivalent safe existing API/page; `MATCHED` requires manual screenshot review and real-action functional validation. **No route is yet certified MATCHED.**

## Representative (REP)

| v2 screen | Mandob route | Status | What to verify |
|---|---|---|---|
| Dashboard | `/rep/dashboard` | STRUCTURE | Cycle hero, four shortcuts, alerts, separate tour FAB and four-item bottom nav; compare weekly ratio and mobile spacing |
| Plan & products | `/rep/plan-products` | SHELL | Cycle progress, product priority rows, company instructions |
| Areas | `/rep/areas` | SHELL | Region cards, area-based tour CTA |
| Doctors | `/rep/doctors` | SHELL | Search, specialty/area/class filters, active chips, date of last visit |
| Pharmacies | `/rep/pharmacies` | SHELL | Same filters, paging, visit status |
| Hospitals | `/rep/hospitals` | SHELL | Same filters, paging, visit status |
| New round | `/rep/new-visit` | SHELL | Multi-step tour, GPS at save, location errors, visit products |
| Round history | `/rep/visits` | SHELL | Detailed visit cards, dates, round filters |
| Analytics | `/rep/analytics` | SHELL | Personal and team coverage and target grades |
| Reports | `/rep/reports` | SHELL | Tabs, preview, print/PDF, sending to manager |
| Leave requests | `/rep/leaves`, `/rep/new-leave` | SHELL | Request fields, balance, attachments |
| Notifications | No dedicated route | GAP | v2 has a screen; Mandob currently has a header alert menu, not notifications API |
| Account | `/rep/profile` | SHELL | Profile cards, logout, account settings |

Existing additional Mandob routes (e.g. analysis detail, frequency, area coverage) remain accessible as authorized. Do not silently delete or hide functioning screens to imitate v2.

## Team manager (TEAM_MANAGER)

| v2 screen | Mandob route | Status | What to verify |
|---|---|---|---|
| Dashboard | `/manager/dashboard` | STRUCTURE | Six summary cards, teams table, reps table, mobile topbar |
| Teams | `/manager/teams` | SHELL | One manager assigned to multiple teams; team switch/scoped data |
| Representatives | `/manager/users` | SHELL | Staff cards, actions, assigned areas, edit modal |
| Areas | `/manager/areas` | SHELL | Groups, selection, area totals |
| Medical targets | `/manager/doctors`, `pharmacies`, `hospitals` | SHELL | Tabs/search/class, add/edit/permissions |
| Rounds | `/manager/visits` | SHELL | Attribution and visibility by team at time of visit |
| Reports | `/manager/reports` | SHELL | Download/details/review controls and status |
| Leave approval | `/manager/leaves` | SHELL | Approve/reject only within managed team scope |

Additional manager screens remain, including analytics, products, settings and area coverage.

## Company manager (COMPANY_ADMIN, comparable to NATIONAL_MANAGER in v2)

| v2 screen | Mandob route | Status | What to verify |
|---|---|---|---|
| Dashboard | `/company/dashboard` | STRUCTURE | Five summary cards and province table |
| Teams and managers | `/company/teams` | SHELL | Multiple team assignments, manager changes, rep count |
| Catalog | `/company/data` | SHELL | Provinces, specialties, products, entity definitions |
| Cycles | Existing company settings/data area | GAP | No exact matching v2 cycles page workflow; do not add fictitious controls |
| Custom staff roles | Existing company settings/users | GAP | v2's permission editor differs from Mandob's existing access model |
| Provincial coverage | `/company/governorates`, `/company/coverage` | SHELL | Same totals and charts, scoping |

Other current company pages stay available pending review instead of being removed.

## System admin (SUPER_ADMIN)

| v2 screen | Mandob route | Status | What to verify |
|---|---|---|---|
| Companies | `/super-admin/companies` | STRUCTURE | Table labels, create company, create owner, forms, errors |

**Important API constraint:** v2 has combined create-company-with-owner. Mandob has separate POSTs, so the UI retains a two-step sequence instead of risking a non-atomic write while mimicking the visual arrangement.

## Visual QA / evidence

- `frontend/react/scripts/v2-role-visual-smoke.mjs`: screenshots for 49 authorized routes at desktop 1440×900 and mobile 390×844 = **98** screen captures with synthetic fixtures; tests v2's 270px white rail when desktop.
- Navigation synchronized with the reference branch's latest **four SVG icons** (home, analytics, reports, account) plus a distinct new-round FAB above the mobile footer; MedREP mobile brand and alert bell restored.
- `frontend/react/scripts/v2-side-by-side.mjs`: **48** side-by-side Chromium screenshot pairs between the actual v2 feature branch and this app.
- Artifacts saved by GitHub Actions workflow `Four-role v2 visual smoke`; review `index.html` from the side-by-side evidence.
- Screenshot inspections already identified and prompted fixes for manager mobile horizontal overflow, fixed-height topbar overlap and legacy dark sidebar fade.
- Real tenant test accounts, detailed interaction parity, accessible controls, responsive dialogs, and screenshot diff judgment **remain required before a production release**.

## Safety boundaries

No database schema, API authorization, GPS visit accuracy or reporting accounting was changed. Do not merge this draft visual PR based solely on screenshot smoke tests or static design tokens.
