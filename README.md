
# GameSloth Server v0.34.0

Production-hardened GameSloth backend for accounts, pending Closed Alpha approval, squads, Sloth Sync, plan entitlements, feedback, sponsor campaigns and Stripe subscriptions.

## v0.34.0 — Founding 50

- First 50 squad hosts who complete a Sloth Sync Moment with at least 2 ready POVs automatically receive Sloth+ for two calendar years.
- Rewards are independent from Stripe billing and creator grants, so a Pro grant is never downgraded.
- Founding 50 claims are race-safe and limited to one reward per account.
- Alpha Admin now has a dedicated Founding 50 view with live progress, winner details and a pause/resume control.
- Logged-in clients receive Founding 50 status through `/api/entitlements`; newly awarded hosts also receive a `founding_50_awarded` WebSocket event.
- `/api/public/stats` exposes only aggregate Founding 50 claim/remaining counts.
- The direct Windows download route from v0.33.6 remains included.


## v0.33.4 — Public Moment counter

The server now records successful multi-POV Moment reservations for every plan and exposes only the aggregate total through `GET /api/public/stats`. No account, handle or Moment details are exposed.

## v0.33.3 — Creator Access Admin

The existing `/alpha/admin` dashboard can now grant and revoke complimentary Sloth+/Sloth Pro access by GameSloth handle, including optional expiry and automatic Closed Alpha approval. See `V0.33.3-CREATOR-ACCESS-ADMIN.md`.

## New in v0.33.2

- Separate Ads, Feedback, Alpha and Backup admin-token support
- Strict browser-origin allowlist and security headers
- Password-reset flow with one-time links
- Optional email verification and transactional delivery through Resend
- Manual recovery-link generation from Alpha Admin when email delivery is not configured
- Encrypted scheduled database-backup workflow for GitHub Actions
- Public social API responses no longer expose account email addresses
- Registration and sign-in keep separate rate-limit buckets

Run `npm start`. The database schema is applied automatically during startup.

## Safe rollout

1. Deploy this server with `ALLOW_SHARED_ADMIN_TOKEN=true` so your existing token keeps working.
2. Confirm `/health` reports `0.34.0` and test registration, login and Alpha Admin.
3. Generate four separate secrets using `Create-Security-Secrets.ps1`, add them to Render, and then set `ALLOW_SHARED_ADMIN_TOKEN=false`.
4. Keep `EMAIL_VERIFICATION_REQUIRED=false` until email delivery has been tested and existing tester emails have been verified or manually marked verified.

See `SECURITY-MIGRATION-STEPS.md`, `RESEND-SETUP.md` and `BACKUP-SETUP.md`.
