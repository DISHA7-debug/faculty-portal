# How to drive Claude Code on this project

## Setup

```bash
mkdir faculty-portal && cd faculty-portal
git init
# copy CLAUDE.md, docs/, prisma/, deploy/, Dockerfile, docker-compose*.yml,
# .env.example, .gitignore into this folder
git add -A && git commit -m "Project plan, schema, and infrastructure config"
claude
```

`CLAUDE.md` is read automatically at the start of every session. You do not need to paste it.

---

## Rules for prompting

1. **One sprint task at a time.** "Build the whole app" produces plausible-looking code with
   the ownership checks quietly missing. Work down `docs/SPRINTS.md` checkbox by checkbox.
2. **Commit after every working task.** You need a point to roll back to.
3. **Point at the docs instead of re-explaining.** "Follow §5 of docs/SECURITY.md" is shorter
   and more reliable than describing the upload rules again.
4. **Run the quality gates yourself.** After each task:
   `npm run typecheck && npm run lint && npm run build`.
5. **Review the auth and ownership code line by line.** Everything else you can skim. Those
   two you cannot.

---

## Sprint 1

```
Read CLAUDE.md and docs/SPRINTS.md.

Scaffold Sprint 1. Start with the Next.js 15 app (TypeScript strict, App Router,
Tailwind), the design token system as CSS variables with dark mode, and next/font
setup. Do not build any pages beyond a placeholder landing page yet.

Then set up lib/db.ts, apply the Prisma schema, and get the seed script running
against the docker-compose Postgres.

Stop after that and show me the migration output.
```

```
Now convert prisma/migrations/manual/001_search_vector.sql into a proper Prisma
migration so the tsvector trigger is versioned with the rest of the schema.
```

```
Add /api/health that checks Prisma connectivity and returns 200/503, and a GitHub
Actions workflow running typecheck, lint, and build on push to main.
```

---

## Sprint 2

```
Implement authentication per docs/SECURITY.md §2, working through the Sprint 2
checklist in docs/SPRINTS.md.

Start with the core primitives only: lib/auth/session.ts, lib/auth/ownership.ts,
lib/auth/rbac.ts, and the Auth.js config with argon2id and database sessions.
Session tokens are stored as SHA-256 hashes — the raw value only ever lives in the
cookie.

Show me these files before building any UI on top of them.
```

```
Now the signup flow: domain restriction from ALLOWED_EMAIL_DOMAINS, Zod validation,
VerificationToken generation (32 random bytes, hashed at rest, 24h TTL, single use),
and lib/mailer.ts as the single adapter all email goes through.

The account must land in PENDING_VERIFICATION, then PENDING_APPROVAL after the email
is confirmed. It must not be publishable until an admin sets it ACTIVE.
```

```
Add lib/rate-limit.ts using Redis, then wire the limits from docs/SECURITY.md §3 to
login, signup, password reset, and verification resend. Include the failedAttempts /
lockedUntil lockout on the user row.
```

```
Build the auth pages — login, signup, check-your-email, verify, forgot-password,
reset-password. Follow the design direction in CLAUDE.md §7. These are the first
thing 500 faculty will see, so they should not look like default shadcn forms.
```

---

## Sprint 3

```
Build the dashboard shell: sidebar navigation, tabbed sections with a layoutId
animated indicator, and the completeness meter. Server Components by default.
```

```
Build lib/storage.ts as the R2 adapter and the upload route. Follow
docs/SECURITY.md §5 exactly — magic-byte sniffing, sharp re-encode, generated
filenames, FileObject rows, per-user quota. No route may import the S3 SDK directly.
```

```
Build ONE generic <RepeatableSection> component that handles list, inline add, edit,
delete, and drag-reorder for any profile-owned entity. Then wire Education and
Publication through it.

Do not write a separate editor per section — I want the other six to be
configuration, not new components.

Every mutation calls assertOwnsProfileRow. Show me where that happens.
```

```
Wire the remaining six sections (Position, Award, Course, ResearchProject, Guidance,
Membership) through the generic component.
```

---

## Sprint 4

```
Build the public profile page at /faculty/[slug] as a Server Component. Full-bleed
hero, photo left, name and designation and research tags right, then a sticky
in-page sub-nav that scroll-spies through the sections. Only published profiles are
reachable; anything else 404s.

Follow the design direction in CLAUDE.md §7. This should not look like a 2011
university admin panel.
```

```
Build the directory at /faculty: responsive grid, pagination, department and
designation filters, staggered whileInView reveal, hover lift on cards. Then add
full-text search against the searchVector column with ranked results.
```

```
Build the admin approval queue: pending list, approve, reject with a reason, and the
notification emails. DEPT_ADMIN sees only their own department — enforce that
server-side via canAdminister, not by hiding UI. Write an AuditLog row for every
action.
```

---

## Sprint 5

```
Harden for launch: apply the CSP and security headers from docs/SECURITY.md §7, run
through the §12 checklist, and fix whatever fails.
```

```
Write docs/RUNBOOK.md covering: deploying an update, restoring from a backup,
resetting a faculty password, promoting a user to admin, rotating secrets, and what
to check when the site is down. Assume the reader is a college IT staff member who
has never seen this codebase.
```

```
Add the DOI import: paste a DOI into the publications editor, fetch metadata from
the CrossRef API, prefill the form for the user to confirm. Respect the
@@unique([profileId, doi]) constraint so re-imports don't duplicate.
```

---

## When something goes wrong

```
This is failing: <paste error>. Before changing code, tell me what you think the
cause is and what you'd check first.
```

```
Review every mutating route and server action in this repo. For each one, tell me
whether it calls assertOwnsProfileRow and what happens if a FACULTY user passes an
ID belonging to someone else. List any that are unprotected.
```

Run that second one at the end of every sprint. It is the check that matters most.
