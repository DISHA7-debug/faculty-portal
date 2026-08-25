# Faculty Profile Portal

Production faculty profile portal for a college. Teachers self-register with a college
email, maintain their academic profile through a private dashboard, and get a public
profile page. Admins approve signups and keep the data trustworthy.

## Quick start

```bash
cp .env.example .env          # dev defaults work as-is
docker compose up -d          # postgres + redis + mailpit
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

### Local services

| Service | Address | Notes |
|---|---|---|
| App | http://localhost:3000 | `npm run dev` |
| Postgres | `localhost:5432` | user/db `faculty` / `faculty_portal` |
| Redis | `localhost:6379` | rate limiting |
| **Mailpit SMTP** | `localhost:1025` | where the app sends mail in dev |
| **Mailpit web UI** | **http://localhost:8025** | **read every email the app "sent"** |

Mailpit is a dev SMTP sink: it accepts mail and never delivers it. Signup verification
and password-reset links are read from the web UI above. Production swaps `SMTP_HOST`
and `SMTP_PORT` for SES — `lib/mailer.ts` is the same code either way.

Seeded logins (development only):

| Email | Role |
|---|---|
| `admin@faculty.example.invalid` | SUPER_ADMIN |
| `suresh.menon@faculty.example.invalid` | DEPT_ADMIN (CSE) |
| `anita.sharma@faculty.example.invalid` | FACULTY |
| `pending.cse@faculty.example.invalid` | CSE approval queue |
| `pending.mech@faculty.example.invalid` | ME approval queue |

Password for all: `DevPassword123!`

The fixture domain is a reserved `.invalid` host so seeded accounts can never receive
real mail. It is derived from `ALLOWED_EMAIL_DOMAINS`, so changing that changes both.

## Documentation

| File | Contents |
|---|---|
| `CLAUDE.md` | Project context, stack, non-negotiable rules, conventions |
| `docs/PROJECT_PLAN.md` | Full spec: features, data model, auth design, risks |
| `docs/SECURITY.md` | Security requirements and pre-launch checklist |
| `docs/SPRINTS.md` | Sprint-by-sprint task backlog |
| `docs/PROMPTS.md` | How to drive Claude Code through the build |
| `docs/CUTOVER.md` | Checklist for pointing this at the real domain |

## Deployment

**No deployment has occurred yet and no domain is registered.** The domain is deferred
until the project is otherwise complete — see `docs/CUTOVER.md`.

The production stack runs with no public domain: `SITE_ADDRESS` defaults to `localhost`
and Caddy issues a certificate from its own internal CA, so the full four-service stack
can be exercised locally.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

That brings up postgres → `migrate` (one-shot `prisma migrate deploy`) → app → caddy.
The app only starts if the migration container exits 0, so a failed migration stops the
deploy instead of leaving code running against an old schema. Migrations need no separate
command.

### Verifying the production stack locally

The compose file sets `NODE_ENV=production`, which activates the startup assertions in
`lib/env.ts`. **The app will deliberately refuse to boot while `.env` still contains
`.env.example` placeholders** — that is the check working, not a misconfiguration. It
prints every offending variable.

For a local run, give the placeholder variables real-shaped values first:

```bash
cp .env.example .env
# Required before the prod stack will start:
#   AUTH_SECRET      -> openssl rand -base64 32
#   MAIL_FROM        -> anything not ending in .invalid
#   R2_PUBLIC_URL    -> e.g. http://localhost:9000  (no bucket needed until Sprint 3)
#   R2_ENDPOINT      -> e.g. http://localhost:9000
#   POSTGRES_PASSWORD-> anything other than the dev default
docker compose -f docker-compose.prod.yml up --build
curl -k https://localhost/api/health     # -k: Caddy's internal CA is not publicly trusted
```

`DATABASE_URL`, `REDIS_URL`, and `NODE_ENV` are overridden by the compose file itself, so
the `localhost` values in `.env` do not need editing — inside the network the hosts are
the service names `postgres` and `redis`.

Target is a single always-on VPS (DigitalOcean Bangalore), Docker Compose, Caddy for
automatic HTTPS. Nothing in this stack sleeps or scales to zero.

Always take a manual `pg_dump` before running migrations against production.
