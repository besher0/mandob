# Mandob v2 — PostgreSQL + React

The new application uses Express 5, PostgreSQL, Prisma 6, React 18, Vite and TypeScript.

## Setup
Prerequisites: Node.js 20.19+ / 22+, Docker or PostgreSQL, an HTTPS origin for GPS in production.

1. `docker compose up -d db`
2. `cd backend && cp .env.example .env && npm install`
3. `npx prisma generate && npx prisma db push` (initial local development ONLY; new empty PostgreSQL).
4. Create a first super admin using securely provided environment variables:
   `BOOTSTRAP_USERNAME=<username> BOOTSTRAP_NAME=<display-name> BOOTSTRAP_PASSWORD=<strong-password> npm run db:bootstrap`
   Password must be 12+ characters. Never commit real credentials.
5. `npm run dev` (API on localhost:3000)
6. In another terminal `cd frontend/react && npm install && npm run dev`; visit http://localhost:5173.

Vite proxies /api to localhost:3000. For production build React with `npm run build`, serve dist under HTTPS and reverse-proxy /api to Express. Set `WEB_ORIGIN`, `NODE_ENV=production`, `DATABASE_URL` and, only behind a trusted reverse proxy, `TRUST_PROXY=1`.

### Production database
Use migrations, not `db push`, for production. On a **fresh local PostgreSQL database**, run `npx prisma migrate dev --name init`, commit the generated migration, and deploy with `npx prisma migrate deploy`. The current repository schema is a first baseline; migrations still require review before production.

### Architecture and status
- SUPER_ADMIN: create companies and company-admin accounts
- COMPANY_ADMIN: company-scoped teams, users, areas, medical contacts and settings
- TEAM_MANAGER: team-scoped reps, visits, leave requests
- REP: only assigned medical contacts, own visits and leaves
- One high-accuracy GPS fix at the **end of each tour**, kept with the whole tour
- Client-generated unique round IDs for idempotency, and authenticated session cookies

Current React supports login, overview, company creation, role-based dashboards, CRUD creation for core entities, visit submission with GPS, leave approval and frequency overview. Some legacy functionality is **not yet migrated**: Excel import, extended legacy reporting, company visual branding and advanced editing. Do not treat this initial implementation as production-certified; run database-backed end-to-end and authorization tests before deployment.

The previous SQLite files contained fake/test data (as confirmed by project owner) and have been removed from the current HEAD. **Earlier git history still contains them.** Old SQLite server/pages remain as reference and are not the active startup path. No actual business records are migrated.

### Tests
`cd backend && npm run check && npm test && npx prisma validate`
`cd frontend/react && npm run build`

The Actions workflow checks build/schema and unit tests; live database integration tests and migrations are still needed.
