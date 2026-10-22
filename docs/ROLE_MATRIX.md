# Mandob v2 — Current role permissions

Source: backend/src/auth.js, backend/src/routes.js, backend/src/visit-service.js, backend/src/leave-service.js.
Documented as-built on 2026-10-21. This is not an authorization to change project flows.

| Route family | Super Admin | Company Admin | Team Manager | Rep |
|---|---|---|---|---|
| Companies and company administrators | Create/list/provision | Denied | Denied | Denied |
| Dashboard | Denied | Company | Scoped team | Self/assigned |
| Teams list | Denied | Company | Own team | Denied |
| Teams create/edit name, specialties and product links | Denied | Allowed | Denied | Denied |
| Users list | Denied | Company | Current team | Denied |
| Users create/edit | Denied | REP or TEAM_MANAGER within company | Denied | Denied |
| Areas list | Denied | Company | Current team via rep areas | Own assigned |
| Areas create | Denied | Allowed | Denied | Denied |
| Medical entities list | Denied | Company, can include archived | Team-associated, active | Assigned area, active |
| Medical entities create, archive, restore | Denied | Company | Denied | Denied |
| Products list | Denied | Company | Company | Company |
| Products create | Denied | Allowed | Denied | Denied |
| Visits list | Denied | Company | Stored visit-time team | Own visits |
| Visits create | Denied | Denied | Denied | Assigned active targets plus valid GPS |
| Leaves list | Denied | Company | Members of current team | Own |
| Leaves request | Denied | Denied | Denied | Allowed |
| Leaves approve/reject | Denied | Company | Current team requests | Denied |
| Settings read | Denied | Company | Company | Company |
| Settings update | Denied | Allowed | Denied | Denied |
| Team-doctor frequency report | Denied | All company teams | Own team | Shared current team |

## Security invariants

- Every company API route requires a server session except login.
- The global super-admin does not impersonate individual company users.
- Company admin may modify only company-owned REP/TEAM_MANAGER records.
- Historic tours stay associated with the team captured at completion; leave reviews currently follow a rep's **current** team.
- Archived medical entities retain visits, may not be used in new tours, and are only visible as archived to the company admin.
- Visit/leave pagination keeps the original role filters.
- Automated tests are not a substitute for later live deployment, load tests or manual device testing.
- **No team/area archival, deletion workflow or active-state changes are permitted by the owner's decision.**

## Quality gaps

- Expand endpoint and manager-team boundary coverage.
- Investigate performance with representative data volume.
- Check responsive and slow-network UI during manual staging testing.
- Clarify import field mapping and report flows before implementation.
