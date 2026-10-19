# Mandob: initial API security hardening

This commit is **phase 1**, not a production security certification.

## Mandatory steps before deploying

1. Preserve a verified private, offline backup of the existing medrep.db and test its restore.
2. The repository is currently PUBLIC and contains medrep.db and medrep.backup-before-cleanup.db (including Git history). Do not use committed database files in production. Make the repository private immediately in GitHub Settings, review exposed data, rotate affected credentials, and plan a coordinated history rewrite *after* an independent backup is verified. The files are deliberately not deleted by this commit to avoid losing the only known copies.
3. Legacy plaintext passwords are **disabled**. Create an administrator, or reset existing users, using these commands from the backend directory (provide variables securely and avoid shell-history disclosure):
   - ACCOUNT_USERNAME=... ACCOUNT_PASSWORD=... ACCOUNT_NAME=... node scripts/manage-account.js create-admin
   - ACCOUNT_USERNAME=... ACCOUNT_PASSWORD=... node scripts/manage-account.js reset
   The tool requires a password of at least 12 characters. Change all previously exposed credentials.
4. Serve the frontend from the same origin as the API using: cd backend && npm start; open /rep/login.html. In production serve the Node app behind HTTPS and set NODE_ENV=production and APP_ORIGIN=https://your-domain.example. Do not use the old localhost / LAN-IP URLs.
5. Existing TEAM_MANAGER accounts are intentionally denied legacy management endpoints until server-side team ownership and scoping are implemented. COMPANY_ADMIN is currently **single-tenant only**. Do not onboard multiple companies with this version.
6. After testing logins and existing workflows, finish tenant scoping and business-rule validation, run a complete dependency review, and implement safe Excel limits/cleanup before a public release.

## Included
- Password hashing using Node's built-in scrypt, with per-password random salt.
- Random HttpOnly/SameSite session cookies; only session token hashes are stored in SQLite, 8-hour expiration, logout and password-reset revocation.
- Login throttling, restricted browser Origin for unsafe requests, basic security headers and fail-closed RBAC.
- Representative self-access checks, restricted visits/leaves lists, constrained pharmacy/hospital views.
- Static frontend served by Express, API calls use relative /api paths.
- Node built-in tests for password hashing and permissions.

## Verification

    cd backend
    npm test
    npm run check

Do not use committed SQLite files for actual user data. A future task must handle secure off-repo backup, history rewrite and data/credential incident response.
