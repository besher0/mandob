# Mandob v2 — PostgreSQL + React

The new application uses Express 5, PostgreSQL, Prisma 6, React 18, Vite and TypeScript.

## Setup
Prerequisites: Node.js 20.19+ / 22+, Docker or PostgreSQL, an HTTPS origin for GPS in production.

1. `docker compose up -d db`
2. `cd backend && cp .env.example .env && npm install`
3. `npx prisma generate && npx prisma migrate deploy` (initial local development ONLY; new empty PostgreSQL).
4. Create a first super admin using securely provided environment variables:
   `BOOTSTRAP_USERNAME=<username> BOOTSTRAP_NAME=<display-name> BOOTSTRAP_PASSWORD=<strong-password> npm run db:bootstrap`
   Password must be 12+ characters. Never commit real credentials.
5. `npm run dev` (API on localhost:3000)
6. In another terminal `cd frontend/react && npm install && npm run dev`; visit http://localhost:5173.

Vite proxies /api to localhost:3000. For production build React with `npm run build`, serve dist under HTTPS and reverse-proxy /api to Express. Set `WEB_ORIGIN`, `NODE_ENV=production`, `DATABASE_URL` and, only behind a trusted reverse proxy, `TRUST_PROXY=1`.

### Production database
The initial reviewed baseline migration is committed in `backend/prisma/migrations/20261020000000_init`. Apply using `npx prisma migrate deploy`. For later changes, create migrations using `npx prisma migrate dev --name <change>` on a development database, review, commit and deploy.

### Architecture and status
- SUPER_ADMIN: create companies and company-admin accounts
- COMPANY_ADMIN: company-scoped teams, users, areas, medical contacts and settings
- TEAM_MANAGER: team-scoped reps, visits, leave requests
- REP: only assigned medical contacts, own visits and leaves
- One high-accuracy GPS fix at the **end of each tour**, kept with the whole tour
- Client-generated unique round IDs for idempotency, and authenticated session cookies

Current React supports login, company provisioning, role-based dashboards, team/user management, area-group organization and details, searchable/paginated medical directories, review-based doctor XLSX import, permitted medical editing and soft archive/restore, visit submission with fresh GPS and stable retry IDs, visit/leave history with server-side filters, approvals, shared team Frequency, independently configurable team and individual doctor goals, company settings (including working days), scoped reports and Excel exports. Team managers have read-only access to their assigned-area medical directories.

**Remaining parity caveat:** exact legacy round-screen choreography, visual styling and per-area coverage formulas are not certified as equivalent. The old interface remains as a reference for deliberate review, not as an active application route. Production/mobile UAT, account-permission tests on deployed infrastructure and realistic sustained load are still required; passing CI does not certify a production rollout. See `docs/PHASE1_AUDIT.md` and `docs/LEGACY_PARITY_STATUS.md`.

The previous SQLite files contained fake/test data (as confirmed by project owner) and have been removed from the current HEAD. **Earlier git history still contains them.** Old SQLite server/pages remain as reference and are not the active startup path. No actual business records are migrated.

### Legacy boundary and safe cleanup
- The only supported API startup entry is `backend/src/server.js` via `npm start`; `backend/server.js` is a read-only legacy reference, **not** the v2 backend.
- The supported web app is `frontend/react`. Deploy only its Vite `dist/` output, not `frontend/rep` or static prototypes from the original UI.
- Historic legacy source stays in the repository until an explicit manual feature/visual parity review. Do not silently delete old round behavior or introduce team/area archive workflows.
- Git ignores machine metadata, *.db and local environment files. Previously tracked Finder metadata is removed; no database or historic visit data is deleted by this cleanup.

### Tests
`cd backend && npm run check && npm test && npx prisma validate`
`cd frontend/react && npm run build`

GitHub Actions runs a clean PostgreSQL migration, source checks, database-backed role/tenant and validation tests, authenticated GPS visit tests, a synthetic workload smoke (800 doctors / 2,400 visits / 1,500 leaves), and the React production build. The synthetic smoke reports observed timings; it is not an SLO or production load-test guarantee. Production load/security testing and manual four-role mobile review remain necessary.
