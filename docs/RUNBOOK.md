# Runbook

Operational procedures for the faculty portal.

**Audience: college IT.** These are written to be followed at 2am by somebody who did not
build this system and should not have to read its source to recover it.

Every command assumes a shell on the production host, in the directory containing
`docker-compose.prod.yml`.

---

## Before you run any query with dates in it

**Timestamps are `TIMESTAMPTZ` and date arithmetic Just Works.** You can write:

```sql
SELECT round(extract(epoch FROM ("expiresAt" - now()))/60) || ' minutes'
FROM "Session" ORDER BY "createdAt" DESC LIMIT 1;
```

and get the right answer. No timezone incantation is needed.

**This was not always true.** Before the `timestamptz` migration these columns were
`timestamp without time zone` holding UTC, while `now()` returned local time — so the query
above was wrong by the server's UTC offset, silently. It reported a live 30-minute session
as having expired five hours ago during break-glass verification, and looked exactly like a
bug in the code.

**It is still true of any backup taken before that migration.** If you restore an old dump
into a scratch database to investigate something, its timestamp columns are naive UTC and
you must write:

```sql
-- ONLY for a pre-migration dump restored into a scratch database
... ("expiresAt" - (now() AT TIME ZONE 'utc')) ...
```

Check first — one query tells you which world you are in:

```sql
SELECT data_type FROM information_schema.columns
WHERE table_name='Session' AND column_name='expiresAt';
```

`timestamp with time zone` → arithmetic is safe as written.
`timestamp without time zone` → add `AT TIME ZONE 'utc'` to every `now()`.

---

## Nobody can sign in

**Symptom:** faculty report that the sign-in code never arrives, or that entering a code
does nothing. The site itself loads normally.

This is the failure mode the portal is most exposed to. Authentication is by emailed
one-time code, so **email is on the critical path for every sign-in** — not just for
registration. If mail delivery stops, nobody can get in, including you.

### Step 1 — confirm the site itself is up

```bash
curl -k https://localhost/api/health
```

Expected: `{"status":"ok","database":"up",...}`

- `database: down` → this is a database problem, not a mail problem. Go to
  **Database is unreachable** below.
- No response at all → go to **The site is down**.
- `status: ok` → the application is healthy. Continue.

### Step 2 — confirm mail is actually the cause

Do not reach for break glass until you have checked this. The symptom "I can't sign in"
also covers a mistyped address, an unapproved account, and a suspended one.

**a. Is the app trying to send at all?**

```bash
docker compose -f docker-compose.prod.yml logs app --since 30m | grep -i "login code failed to send"
```

Log lines here mean the app tried and SMTP refused — mail is the problem. **No lines does
not clear mail**: delivery can fail silently after SES accepts the message.

**b. Can the app reach the mail server?**

```bash
docker compose -f docker-compose.prod.yml exec app \
  node -e "require('net').createConnection({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT},()=>{console.log('SMTP reachable');process.exit(0)}).on('error',e=>{console.log('SMTP UNREACHABLE:',e.message);process.exit(1)})"
```

**c. Is SES rejecting or bouncing?**

Check the SES console for the sending domain: bounce rate, complaint rate, and whether
sending has been paused. A paused account accepts nothing and is the most common cause of
a sudden total failure.

**d. Test the whole path with an address you control:**

Request a code for your own account at `/login` and watch:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

**If all four checks pass, mail is probably NOT the cause.** Verify the specific account
instead:

```bash
# Timestamps are TIMESTAMPTZ — no timezone handling needed. See the note at the top.
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT email, status, \"emailVerifiedAt\" FROM \"User\" WHERE email = 'someone@domain';"
```

- `PENDING_APPROVAL` → they can sign in but cannot publish. Working as designed.
- `SUSPENDED` / `REJECTED` → they cannot sign in. Working as designed.
- No row → they never registered, or mistyped their address.

### Step 3 — break glass

Only once you have established that mail is broken **and** you need administrator access to
fix it.

```bash
docker compose -f docker-compose.prod.yml exec app \
  node --import tsx scripts/break-glass.ts admin@<your-domain>
```

This prints a session token and instructions for setting it as a cookie. The session lasts
**30 minutes**.

It refuses unless the account is `SUPER_ADMIN` and `ACTIVE`. It writes an audit row before
printing anything — that row is expected and is not itself a sign of compromise; check who
was working at that time.

**Do not paste the token into chat, a ticket, or a shared document.** It is a live
credential until it expires. If you do, end it immediately:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "DELETE FROM \"Session\" WHERE \"userId\" = (SELECT id FROM \"User\" WHERE email='admin@<your-domain>');"
```

### Step 4 — after mail is restored

Confirm end to end by requesting a code at `/login` and receiving it. Then review:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT \"createdAt\", metadata FROM \"AuditLog\" WHERE action='auth.break_glass' ORDER BY \"createdAt\" DESC LIMIT 10;"
```

Every row should correspond to a known incident. One that does not is a security event.

---

## The dev and production stacks are separate Docker projects

`docker-compose.yml` is `faculty-dev`; `docker-compose.prod.yml` is `faculty-prod`. The
`name:` at the top of each is load-bearing — both files live in the same directory, and
without it they share a default project name, so **starting one silently replaces the
other's containers.** That is not hypothetical: it swapped the dev Redis for the
production one, and every host-side test then failed closed against an unreachable Redis
while appearing to be a code regression.

If you have a local Postgres on 5432, note that the dev compose also publishes 5432 and
the host one wins. Two servers on one port is a good way to debug the wrong database:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN          # who actually owns the port
psql ... -c "SELECT version();"           # 'Homebrew' vs 'alpine' tells you which
```

---

## `npm run build` fails with "Cannot read properties of null (reading 'useContext')"

The prerender dies inside Next's own `layout-router.js`, on pages that have nothing in
common — `/`, `/dashboard`, `/_global-error`. It looks like a React version conflict. It is
almost always this instead:

    NODE_ENV=development is exported in the shell you ran the build from.

`.env` contains `NODE_ENV=development` for host-side tooling, so anything that sources it —
`set -a; . ./.env` in a terminal, a Makefile, a CI step trying to be helpful — leaks it into
`next build`. Next then links React's PRODUCTION build against react-dom's DEVELOPMENT
server renderer, the hooks dispatcher is null across the two, and every prerender throws.
Nothing in the message points at the cause.

Check it:

    echo "NODE_ENV=[$NODE_ENV]"      # must be empty before `npm run build`

Fix it by not exporting it. Scripts that need the file should use Node's own flag, which
scopes the variables to that process instead of the shell:

    node --env-file-if-exists=.env scripts/whatever.mjs

The production image is unaffected — `docker-compose.prod.yml` sets `NODE_ENV: production`
explicitly for exactly this reason.

Related: `next build` and `next dev` share `.next/`. Running a build while the dev server is
up produces a different, equally confusing set of prerender errors. Stop dev first.

## The site is down

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs app --tail 100
```

Containers restart automatically (`restart: unless-stopped`). If `app` is restarting in a
loop, read the first error after each restart — the most common cause is a refused startup
from `lib/env.ts`, which prints exactly which environment variable is wrong. That is
deliberate: the app refuses to run half-configured rather than serving placeholder data.

```bash
docker compose -f docker-compose.prod.yml restart app
```

---

## Database is unreachable

```bash
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs postgres --tail 50
df -h                     # a full disk stops Postgres accepting writes
```

Postgres is not published to the host and is reachable only on the internal Docker
network. That is intentional; do not expose it to debug.

---

## Deploying a change

```bash
# ALWAYS take a dump first, before anything else
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F-%H%M).sql.gz

git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically: the `migrate` container executes `prisma migrate deploy` and
the app only starts if it exits successfully. A failed migration therefore stops the deploy
rather than leaving new code against an old schema.

---

## Restoring from backup

```bash
gunzip -c backup-<date>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Practise this into a scratch database **before** you need it. An untested backup is not a
backup.

---

## Approving a faculty account without the admin UI

Should only be needed if the admin interface is broken.

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "UPDATE \"User\" SET status='ACTIVE' WHERE email='someone@domain' AND status='PENDING_APPROVAL';"
```

Approving by hand writes **no audit row**. Note what you did and why, somewhere durable.

---

## Suspending an account immediately

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "UPDATE \"User\" SET status='SUSPENDED' WHERE email='someone@domain';
   DELETE FROM \"Session\" WHERE \"userId\" = (SELECT id FROM \"User\" WHERE email='someone@domain');"
```

Both statements matter. Changing the status alone stops future sign-ins; deleting the
sessions ends the ones already live. Sessions are database rows precisely so that this
works instantly — this is why the portal does not use stateless tokens.
