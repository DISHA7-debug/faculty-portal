# Cutover — pointing this at the real domain

**Status: not started. No deployment has occurred. No domain is registered.**

The stack is built to run with no public domain: `SITE_ADDRESS` defaults to `localhost`
and Caddy issues certificates from its own internal CA. Everything hostname-shaped is
read from the environment, and CI fails the build if a hostname is hardcoded in source
(`npm run check:hostnames`). Cutover is therefore a **configuration change, not a code
change** — that property is the whole point, and it is worth preserving.

Work the steps in order. Several have propagation delays measured in hours, and step 3
in particular is on the critical path for anything that sends email.

---

## 0. Prerequisites

| Need | Why |
|---|---|
| Registered domain, college-owned | Billing and ownership must outlive the student developer (PROJECT_PLAN §9) |
| DNS zone control | Steps 2 and 3 |
| VPS provisioned, Docker installed | Nothing has been deployed yet |
| Cloudflare account with R2 bucket | Step 4 |
| SES account out of sandbox, or college SMTP | Step 3 |

---

## 0.5 Database target: Neon vs VPS Postgres

Two options exist for where `DATABASE_URL` points in production. Switching between them
is **a connection-string change, not a code or schema change** — both `migrate` and `app`
in `docker-compose.prod.yml` just read `DATABASE_URL` from the environment.

| | **Neon (current deploy target)** | **VPS Postgres** |
|---|---|---|
| Cost | Free tier | Included in the VPS you're already paying for |
| Availability | Scales to zero after idle — a cold-start delay on the first request after a quiet period | Always-on, matches the "everything always-on" guarantee this stack states elsewhere |
| Where it lives | `docker-compose.prod.yml` has **no** `postgres` service; `migrate` and `app` both use `NEON_DATABASE_URL` (pooled, `-pooler` host) as `DATABASE_URL` | A `postgres` service in `docker-compose.prod.yml`, with `pgdata` volume, `pg_isready` healthcheck, and `depends_on: condition: service_healthy` on `migrate`/`app` — removed from the current file but recoverable from git history |
| Backups | `deploy/backup.sh` runs on the VPS host and `pg_dump`s `NEON_DATABASE_URL` directly (no container to `docker exec` into anymore) — see "Backups" below | The old `docker exec faculty_postgres pg_dump ...` still works, but only while the VPS Postgres path is what's live |
| Rotating the DB credential | Reset the role's password in the Neon console, update `NEON_DATABASE_URL` | Regenerate `POSTGRES_PASSWORD`, update `.env`, recreate the volume or `ALTER USER ... PASSWORD` (§6) |

**Revisit at real launch.** Neon's scale-to-zero directly conflicts with the "Everything
always-on" line at the top of `docker-compose.prod.yml` and with the health-check /
uptime-monitoring expectations in §8 — a monitor polling `/api/health` on a schedule will
incidentally keep it warm, but that's a side effect, not a guarantee. Once this is a scaled
production launch rather than an initial deploy, move `DATABASE_URL` to the VPS Postgres
path (or a paid always-on Neon tier) instead of relying on the free tier staying awake.

**Prisma + PgBouncer note:** Neon's pooled (`-pooler`) endpoint is PgBouncer in transaction
mode, which breaks Prisma's prepared-statement caching under concurrent traffic
("prepared statement already exists" errors). `NEON_DATABASE_URL` carries
`pgbouncer=true` for this reason, confirmed working with `prisma migrate status`/`deploy`
alongside `sslmode=require&channel_binding=require`. That flag is Prisma-specific, not a
real libpq parameter — anything using `NEON_DATABASE_URL` directly with `psql`/`pg_dump`
(e.g. the backup script below) must strip it first, or the connection is rejected
outright with `invalid connection option "pgbouncer"`.

**Backups.** Two independent mechanisms, deliberately redundant:

- **`deploy/backup.sh` (primary).** Runs on the VPS host via cron, `pg_dump`s
  `NEON_DATABASE_URL` (with `pgbouncer=true` stripped) straight over the network, gzips,
  GPG-encrypts, and ships to R2 — same shape as before, just no `docker exec` into a
  `postgres` container that no longer exists. It dumps inside a `postgres:18-alpine`
  container rather than via a host-installed `pg_dump`, because `pg_dump` refuses to
  dump a server major version newer than itself: **Neon currently runs Postgres 18**,
  not the 16 this repo's dev image and the VPS-Postgres alternative use, and a
  version-16 client cannot touch it. Confirmed working end-to-end against the live Neon
  database while wiring this up. If Neon's Postgres major version ever changes, bump the
  tag in the script.
- **Neon PITR/branching (secondary).** Automatic, needs no script, but **the free tier's
  history-retention window is short (on the order of ~24 hours as of writing) — check
  the current value on the Neon dashboard before relying on it.** That is materially
  worse than the 30-day retention `backup.sh` already gives you. Treat PITR as a
  fast-recovery convenience for "I broke something an hour ago," not as the real backup;
  `backup.sh`'s 30-day R2 archive is what satisfies "restore last night's backup"
  (§7, check 11) and the audit/data-loss posture in `CLAUDE.md` §1.

**Launch-time gap:** if the college ends up staying on Neon's free tier past initial
deploy rather than moving to VPS Postgres (§0.5) or a paid Neon tier, the short PITR
window means `backup.sh`'s nightly cron is not optional — confirm it's actually installed
and running on the VPS before treating any real faculty data as durable.

---

## 1. Environment variables

Set these in `.env` **on the server**. Never commit them.

| Variable | Dev default | Cutover value |
|---|---|---|
| `SITE_ADDRESS` | `localhost` | `faculty.<domain>` |
| `CADDY_TLS` | `internal` | an admin email address |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://faculty.<domain>` |
| `AUTH_URL` | `http://localhost:3000` | `https://faculty.<domain>` |
| `AUTH_SECRET` | `replace-me` | `openssl rand -base64 32` |
| `ALLOWED_EMAIL_DOMAINS` | `faculty.example.invalid` | the real faculty email domain |
| `MAIL_FROM` | `noreply@example.invalid` | `noreply@<domain>` |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` (Mailpit) | SES endpoint / `587` |
| `SMTP_USER` / `SMTP_PASSWORD` | empty | SES SMTP credentials |
| `R2_PUBLIC_URL` | `https://cdn.example.invalid` | `https://cdn.<domain>` |
| `R2_ENDPOINT` | `ACCOUNT_ID...` | real R2 endpoint |
| `NEON_DATABASE_URL` | unset | Neon pooled connection string — only if on the Neon path (§0.5) |
| `POSTGRES_PASSWORD` | `devpassword` | a generated password — only if on the VPS Postgres path (§0.5); irrelevant if serving `DATABASE_URL` from Neon |
| `NODE_ENV` | `development` | `production` |

`CADDY_TLS` takes an email because Caddy's `tls` directive accepts either `internal`
or an ACME account address — setting an email is what switches on Let's Encrypt.

**Skipped?** `lib/env.ts` refuses to boot the server in production if any of these still
contain a placeholder (`example.invalid`, `replace-me`, `ACCOUNT_ID`, `yourcollege`), or if
`REQUIRE_ADMIN_APPROVAL=false`. You get a hard startup failure listing every offender, not a
half-configured site. That check is the safety net for this entire page.

---

## 2. DNS records

| Record | Host | Points to |
|---|---|---|
| `A` | `faculty` | VPS IPv4 |
| `AAAA` | `faculty` | VPS IPv6, if any |
| `CNAME` | `cdn` | R2 custom-domain target (step 4) |

**Skipped?** Caddy cannot complete the ACME HTTP-01 challenge without a public A record
resolving to the box, so certificate issuance fails and the site is unreachable over HTTPS.
Caddy retries with backoff; repeated failures can hit Let's Encrypt rate limits (5 failures
per account/hostname/hour), which turns a five-minute DNS fix into an hour-long lockout.
**Confirm DNS resolves before starting Caddy with a real hostname.**

---

## 3. Email domain verification — start this first

Longest lead time on the page. SPF/DKIM/DMARC propagation plus SES verification can take
a day, and SES sandbox removal is a manual review.

| Record | Value |
|---|---|
| `TXT` @ | `v=spf1 include:amazonses.com ~all` |
| `CNAME` ×3 | DKIM tokens from the SES console |
| `TXT` `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@<domain>` |

Then: verify the domain in SES, request production access (sandbox only sends to verified
addresses), and generate SMTP credentials.

**Skipped?** Mail still sends but lands in spam. Because every account starts with an
emailed verification link (SECURITY.md §2.1), faculty never complete signup — and the
failure is invisible from the server side, since SES reports delivery success. This is the
single most likely cause of a launch that looks fine and onboards nobody. Send a test to a
Gmail and an Outlook address and confirm inbox placement before announcing the portal.

---

## 4. R2 custom domain

Attach `cdn.<domain>` to the bucket in the Cloudflare dashboard, then set `R2_PUBLIC_URL`
to match.

**Skipped?** Two failures, one silent. Photos and CVs 404 because the app builds URLs from
`R2_PUBLIC_URL`. Worse, the public CSP in `next.config.ts` derives `img-src` from that same
variable — a stale value means the browser blocks images from the real CDN and reports it
only in the console, so the page looks broken with no server-side error.

---

## 5. Caddy hostname

No file edit required — `deploy/Caddyfile` reads `{$SITE_ADDRESS}` and `{$CADDY_TLS}`.
Set both in `.env` and restart:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate caddy
docker compose -f docker-compose.prod.yml logs -f caddy   # watch certificate issuance
```

**Skipped?** Caddy serves on `localhost` with an internal-CA certificate. Every external
visitor gets a browser trust warning, and the portal is effectively unusable in public.

### The app must NEVER be served over plain HTTP

Not a preference — nobody can log in.

The session cookie is named `__Host-fp_session`. The `__Host-` prefix is what binds the
cookie to this exact origin, so no subdomain on a shared institutional domain can forge a
session. In exchange, the browser **silently discards** any `__Host-` cookie that does not
arrive with `Secure` over HTTPS. There is no error, no console warning on the server side,
and no failed request: login appears to succeed, the redirect happens, and the user lands
back at the login page because the cookie was never stored.

That failure looks exactly like "the login form is broken" and has cost people entire
afternoons. It happens if:

- Caddy is bypassed and the app container is exposed directly on port 3000
- TLS termination is moved to something that forwards plain HTTP without `X-Forwarded-Proto`
- Anyone "temporarily disables HTTPS to debug"

`http://localhost` is exempt — browsers treat loopback as a secure context — which is why
`npm run dev` works. **That exemption does not extend to an IP address or a LAN hostname**,
so testing the dev server from a phone on the same network over `http://192.168.x.x:3000`
will fail to log in for this reason and nothing else.

Keep Caddy in front, and keep `CADDY_TLS` set.

---

## 6. Rotate every secret

Cutover is also the handover boundary (PROJECT_PLAN §9: the college must own this after
graduation).

- `AUTH_SECRET` — `openssl rand -base64 32`
- DB credential (§0.5) — on Neon, reset the role's password in the Neon console and
  update `NEON_DATABASE_URL`; on VPS Postgres, regenerate `POSTGRES_PASSWORD`, update
  `.env`, and recreate the postgres volume or `ALTER USER ... PASSWORD`
- R2 access keys — new pair, revoke the old
- SES SMTP credentials — new pair
- `BACKUP_PASSPHRASE` — new value, and **verify a restore with it** before discarding
  the old one

**Skipped?** Any credential the student developer ever held stays valid against the
college's production system after they leave. Rotating `AUTH_SECRET` also invalidates all
existing sessions, which is desirable at cutover — do it before onboarding real faculty,
not after.

---

## 7. Smoke tests

Run against the real hostname, in this order:

| # | Check | Expected |
|---|---|---|
| 1 | `curl -I https://faculty.<domain>/` | `200`, valid public certificate |
| 2 | `curl https://faculty.<domain>/api/health` | `{"status":"ok","database":"up"}` |
| 3 | Response headers | CSP, HSTS, `X-Frame-Options`, no `X-Powered-By` |
| 4 | Sign up with a real faculty address | Verification email reaches the **inbox**, not spam |
| 5 | Complete verification, log in | Lands in dashboard as `PENDING_APPROVAL` |
| 6 | Attempt to publish while pending | Rejected |
| 7 | Approve as admin, publish | Public profile renders at `/faculty/<slug>` |
| 8 | Upload a photo and a CV | Both serve from `cdn.<domain>` |
| 9 | Browser console on a public page | No CSP violations |
| 10 | `nmap -p 5432,6379 <VPS IP>` | Both filtered/closed |
| 11 | Restore last night's backup into a scratch DB | Succeeds |

**Skipped?** Every one of these has failed silently in some deployment somewhere. 4 and 9
are the two that pass a casual look and still leave the portal broken for real users.

---

## 8. After cutover

- Point uptime monitoring at `https://faculty.<domain>/api/health`, alerting to **two**
  addresses (yours and college IT).
- Confirm the backup cron ran and the artefact is in R2.
- Run the full `docs/SECURITY.md` §12 checklist against production.
- Update `docs/SPRINTS.md` and PROJECT_PLAN §7 to remove "no deployment has occurred yet".
- Hand over domain, VPS, Cloudflare, R2, and SES ownership to the college.
