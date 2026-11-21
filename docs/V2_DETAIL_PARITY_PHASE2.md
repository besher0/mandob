# Mandob — phase 2 visual and interaction parity

## Direction and scope
- Target: `besher0/mandob` (React/Vite + existing Express/Prisma API).
- Visual comparison source: `besher0/mandob-v2` branch `feature/mandob-full-role-ui-parity`. The v2 `main` web gitlink is unresolved; this document does **not** certify equality with an unavailable source.
- This phase overlays visual styles and exposes existing filters. It does **not** migrate to NestJS, alter GPS flows, reassign teams, change database models or bypass permissions.
- All screenshots in CI use mocked fixture responses. Real-user testing and manual screenshot comparison are still necessary.

## Representative (REP)
| Area | Changes in phase 2 | Remaining verification |
|---|---|---|
| Medical directory | Cards, header, search, active filter badges, bottom-sheet modal, pagination, visit counts and latest-visit status styled consistently | Check every specialty, grade, area, empty state and 390px/1440px screenshot |
| New tour | Stepper, area controls, target selection, ambiguous-area selector, product quantities, review and action buttons themed | Test real GPS denial, slow fetch, duplicate retries, submitted visit and historical attribution |
| Analytics | Personal/team KPI cards, period tabs and coverage panels restyled | Match detailed breakdown contents, bar geometry, team vs personal values |
| Reports/history | Date fields, period tabs, preview, export/print/send action states, saved report cards | Actual print/PDF, manager receipt, offline/error and narrow screens |
| Filters | Existing local per-user stored filter state preserved; pressing Escape closes directory and tour filter sheets | Keyboard tab order and screen reader testing |

## Team manager (TEAM_MANAGER)
| Area | Changes in phase 2 | Remaining verification |
|---|---|---|
| Medical targets | Grade selector for doctors/pharmacies, category selector for hospitals, active filter chips and reset; uses existing server query params | Confirm backend category/grade filtering with real team data |
| Teams & reps | Cards, action groups, modals, tables, tabs and pagination styled | Assign manager to multiple teams; rep transfer permission and modal field comparison |
| Visits, leave approvals, reports | Detail dialogs, status and action buttons, review panels and tables themed | Test actual approvals, exports, team-at-visit history, concurrent edits |
| Dialogs | Medical detail/edit/create modals now dismiss using Escape | Trap keyboard focus, restore focus on close, mobile overlay scroll |

## Company manager (COMPANY_ADMIN)
| Area | Changes in phase 2 | Remaining verification |
|---|---|---|
| Team management | Team cards, tables, selection and manager dialog themes | Multi-team manager assignment and inherited team rules |
| Data | Search and municipality/area selectors labelled; removable chips, reset button, filtered result count, tabs, tables and action buttons | Large-directory server pagination, import/duplicate behavior, archive permissions |
| Cycle settings | Existing real cycle start/end, A/B/C frequency, working days and targets styled | v2 has an independent cycle screen not represented by an equivalent backend route |
| Roles / permissions | Existing secured staff/user functions preserved, error/disabled styling unified | v2 custom company-staff role editor **not implemented**: incompatible permissions model; do not add fake editor |
| Dialogs | CompanyModal uses role=dialog, accessible label and Escape dismissal | Full keyboard focus management and live CRUD |

## Super admin (SUPER_ADMIN)
| Area | Changes in phase 2 | Remaining verification |
|---|---|---|
| Companies | List rows, statuses, overflow, creation forms, validation and error banners styled | Verify duplicate-company errors, login fields, real admin creation |
| Company onboarding | Safe two-step existing API flow preserved | v2 one-step server transaction is not available in Mandob; do not pretend atomic creation |

## Verification gates
- `npm test` and `npm run build` in `frontend/react`.
- Existing PostgreSQL/Prisma backend tests.
- Playwright smoke capture of 49 authorized routes at desktop and mobile, 98 renders total.
- Playwright interactive checks for representative filters, manager class chips, company data search and creation modal, admin onboarding form.
- 48 reference screenshot pairs for visual review; creating images is not evidence of pixel equality.
- Re-check server role scope / tenant isolation for actual edits and real data before any production deployment.

**No page is marked pixel-perfect solely from this phase or from CI fixture screenshots.**
