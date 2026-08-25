# CLAUDE.md

Master context for this repository. Read this before writing any code.

---

## 1. What this project is

A production faculty profile portal for a college. Every teacher self-registers with a
college email, maintains their own academic profile through a private dashboard, and gets a
public profile page. An admin layer approves signups and keeps the data trustworthy.

This is **not a toy project**. It will run on the college's own domain and serve 500+ real
faculty members. Institutional data (publication histories built over decades) lives in it.
Treat data loss and unauthorized access as unacceptable outcomes.

Reference for scope (NOT for design quality): IIT (ISM) Dhanbad's faculty CMS. We are
building something with better features and a far better interface.

How to run it and look at it: `docs/WALKTHROUGH.md`
Full specification: `docs/PROJECT_PLAN.md`
Security rules: `docs/SECURITY.md`
Task breakdown: `docs/SPRINTS.md`
Domain cutover: `docs/CUTOVER.md`

---

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, TypeScript strict mode |
| Styling | Tailwind CSS + shadcn/ui |
| Animation | Framer Motion |
| Database | PostgreSQL 16 (self-hosted in Docker) |
| ORM | Prisma |
| Auth | **Emailed one-time codes.** No passwords. Own session layer — see below. NOT Auth.js. |
| Password hashing | *(none — there are no passwords)* |
| Validation | Zod |
| File storage | Cloudflare R2 via the S3 SDK |
| Email | Nodemailer → Amazon SES (Mumbai) or college SMTP |
| Rate limiting | Redis |
| Reverse proxy | Caddy (automatic HTTPS) |
| Hosting | Single always-on VPS, DigitalOcean Bangalore region |

**Deployment is a VPS, not Vercel.** Never use Vercel-only APIs (`@vercel/blob`,
`@vercel/kv`, edge runtime). Stay on the standard Node runtime and standard Postgres so the
deployment target remains swappable.

### How identity is proven: emailed one-time codes

There is no password anywhere in this system. A faculty member enters their college
address, receives a 6-digit code, and enters it. That code is their proof of identity.

What this buys, and why it is a simplification rather than a fashion:

- Nothing to hash, store, rotate, or leak. A database dump contains no credential that
  works anywhere, including here.
- No password reuse. The most likely way a faculty account gets compromised is a password
  the person also used on a site that was breached; that risk is now structurally absent.
- No reset flow. Signing in and recovering access are the same act, so an entire class of
  screens, tokens, and edge cases does not exist.
- Verification and sign-in are one step. A new account's first successful code IS its email
  verification.

What it costs, and it is not small: **email is now on the critical path for every sign-in,
not just registration.** If mail delivery breaks, nobody can get in — including the
administrator who would fix it. See PROJECT_PLAN §7.

Codes are 6 digits, valid 10 minutes, single-use, and capped at 5 attempts before the code
is destroyed. That cap is the security parameter: the code space is fixed at a million, so
attempts-per-code is the only lever. Details in docs/SECURITY.md §2.

**What did NOT change: the session layer.** Sessions are still rows in `Session`, keyed by
SHA-256 of a random cookie value, in a `__Host-` cookie, revocable by deleting the row.
That is deliberate and load-bearing — see below.

### Why Auth.js is not used

Auth.js v5 supports `session: { strategy: 'database' }` only for adapter-based OAuth and
email flows. Adopting it would have meant one of:

- **JWT sessions** — a stateless token cannot be revoked before it expires, so an admin
  suspending an account would not take effect for up to a week. Suspension is a moderation
  tool here, so that is disqualifying (§8).
- **Auth.js alongside a second session cookie** — two mechanisms that can disagree about
  who is signed in. That ambiguity is itself a vulnerability, and it survives review
  because both halves appear to work.

So the session layer is ours: `lib/auth/session.ts`, backed by the `Session` table, keyed
by SHA-256 of a 32-byte random token. Revocation is a row delete and takes effect on the
next request. **Do not "restore" Auth.js without re-reading this.**

The move to one-time codes changed how identity is PROVEN and nothing about what happens
afterwards. In particular: **do not replace the session with a JWT in localStorage.** The
admin approval queue and account suspension both require revoking a live session, and a
stateless token cannot be revoked before it expires.

If OAuth is ever wanted (college Google accounts), Auth.js can be added alongside — its
callback should mint a session via `createSession()` so this layer stays the single source
of truth.

---

## 3. Non-negotiable rules

These are the rules that matter most. Violating any of them is a bug, even if the feature works.

### 3.1 Ownership checks on every mutation

The single most likely vulnerability in this codebase is IDOR: a faculty member editing or
deleting another faculty member's records by changing an ID in the URL.

Every mutating route touching a profile-owned row MUST call the shared ownership helper:

```ts
// lib/auth/ownership.ts — simplified; see the file for the full version
export async function assertOwnsProfileRow<T extends { profileId: string }>(
  row: T | null,
  session: AppSession,
  options: OwnershipOptions = {},
): Promise<T> {
  if (!row) notFound();

  // ONLY SuperAdmin bypasses unconditionally.
  if (isSuperAdmin(session)) return row;

  if (row.profileId === session.profileId) return row;

  if (session.role === 'DEPT_ADMIN') {
    // Department is derived from the OWNING profile, not supplied by the caller.
    const ownerDepartmentId =
      options.ownerDepartmentId ?? (await loadDepartmentFromDb(row.profileId));
    if (!ownerDepartmentId) notFound();                     // fail closed
    if (canAdminister(session, { departmentId: ownerDepartmentId })) return row;
    notFound();
  }

  notFound();                                               // 404, NOT 403
}
```

**Never write `if (isAdmin(session)) return row;`.** `isAdmin` is true for `DEPT_ADMIN`,
so that bypass grants any department admin authority over every row in the institution,
silently contradicting §3.2. An earlier revision of this document contained exactly that
snippet; it was wrong.

The owning department is resolved **inside** the helper rather than passed in, because
this is called from ~40 mutation sites in Sprint 3 and a caller that passed a
request-supplied department id would let the attacker nominate the scope their own
authorization is checked against.

Return **404, not 403**, for rows the user does not own. A 403 confirms the record exists.

Hiding a button in the UI is not authorization. Every check happens server-side.

### 3.2 Admin scope

`DEPT_ADMIN` may only act on profiles in the department they administer. Check
`profile.departmentId === session.administersDepartmentId` before any admin action — in
practice call `canAdminister()` from `lib/auth/rbac.ts` rather than comparing by hand.
Only `SUPER_ADMIN` acts globally.

Route guards use the named sets in `lib/auth/rbac.ts` — `ROLES.ANY_AUTHENTICATED`,
`ROLES.ADMIN`, `ROLES.SUPER_ADMIN_ONLY` — never hand-rolled arrays. `requireRole` has no
implicit hierarchy, so `[Role.FACULTY]` on `/dashboard` would lock out both admin tiers,
who have profiles of their own to maintain.

`administersDepartmentId` lives on `User` and is writable only by `SUPER_ADMIN`. Do **not**
scope admin authority off the admin's own `profile.departmentId` — that field is editable by
the faculty member who owns it, so an admin could widen their own scope by editing their
profile. See `docs/SECURITY.md` §1.3.

### 3.3 Never trust the request body

- Zod schema on every input, `.strict()` so unknown keys are rejected.
- Explicit field allow-lists. Never `data: await req.json()` straight into Prisma.
- A profile update must not be able to set `role`, `status`, `isPublished`, or `userId`.

### 3.4 Never store raw tokens

Session tokens and email-change tokens are stored as SHA-256 hashes. Login codes are
stored as an HMAC keyed with `AUTH_SECRET` — plain SHA-256 of a six-digit value is
reversible by brute force in about a second, so the key is what makes the digest
protective. The raw value exists only in the cookie or the emailed message.

### 3.5 Never hard-delete a faculty account

Use `AccountStatus`. An institution needs an audit trail. Hard deletes are for the admin's
explicit "purge" action only, which does not exist in v1.

### 3.6 Audit everything consequential

Every admin action and every destructive user action writes an `AuditLog` row.

### 3.7 Hard limits on what an attacker owns; delays on what they merely know

Generalises past rate limiting — it applies to any control keyed on an identifier.

| The key is… | Example | Correct response |
|---|---|---|
| Something the attacker **owns** | their IP address, their own session | **Hard block.** Blocking it costs them, not a third party. |
| Something the attacker merely **knows** | a faculty email address from the public directory | **Delay only.** A hard block is a weapon anyone can point at any user. |

The public faculty directory publishes every faculty email address. Any hard limit keyed
on one is therefore a denial-of-service primitive handed to the internet, whatever the
counter is called. Three separate controls were originally specified that way — login
lockout, verification-mail budget, password-reset budget — and each would have let an
attacker disable a named colleague's account without ever guessing a password. All three
are now delays with a ceiling.

Watch for the same shape elsewhere: a hard cap on profile-slug attempts, on upload counts
keyed by profile rather than by user, or on any future "report this profile" action.

Ask of every new limit: *if a stranger spent this budget on someone else's behalf, what
would that person lose?* If the answer is "access", it must not be a hard block.

Note the corollary that a delay needs a **cap**. An unbounded escalating delay is a hard
lock in disguise. See `docs/SECURITY.md` §3.

### 3.8 No secrets in git

`.env.example` is committed with placeholder values. `.env` never is.

---

## 4. Directory structure

```
app/
  (public)/
    page.tsx                       landing
    faculty/page.tsx               directory
    faculty/[slug]/page.tsx        public profile
    departments/[slug]/page.tsx
  (auth)/
    login/  signup/  verify/  reset-password/
  dashboard/
    layout.tsx                     requires FACULTY+
    page.tsx                       completeness overview
    profile/ publications/ academics/ positions/
    awards/ teaching/ projects/ guidance/ preview/
  admin/
    layout.tsx                     requires DEPT_ADMIN+
    approvals/ faculty/ departments/ logs/
  api/
    auth/[...nextauth]/route.ts
    health/route.ts
    upload/route.ts
    public/faculty/route.ts        read-only JSON API
components/
  ui/                              shadcn primitives
  dashboard/                       editor components
  public/                          profile + directory components
  motion/                          shared Framer Motion variants
lib/
  db.ts                            Prisma singleton
  auth/                            config, session, ownership, rbac
  storage.ts                       R2 adapter — ALL uploads go through here
  mailer.ts                        nodemailer — ALL email goes through here
  rate-limit.ts                    Redis token bucket
  validation/                      Zod schemas, one file per entity
  completeness.ts                  profile completeness calculation
prisma/
  schema.prisma
  seed.ts
  migrations/
docs/
deploy/
```

**Adapter rule:** all file uploads go through `lib/storage.ts` and all email through
`lib/mailer.ts`. No route imports the S3 SDK or nodemailer directly. This keeps the
provider swappable.

---

## 5. Commands

```bash
# Local development
docker compose up -d              # postgres + redis
npm run dev

# Database
npx prisma migrate dev --name <name>
npx prisma studio
npm run db:seed                   # wipes and reseeds — dev only

# Quality gates — all must pass before a commit
npm run typecheck
npm run lint
npm run build

# Production (on the VPS)
docker compose -f docker-compose.prod.yml up -d --build
npx prisma migrate deploy         # ALWAYS pg_dump first
```

---

## 6. Code conventions

- **Server Components by default.** Add `'use client'` only where interactivity requires it.
- **Server Actions** for mutations in the dashboard; **Route Handlers** for the public API
  and file uploads.
- Data fetching happens in Server Components, never in `useEffect`.
- Every list UI needs four states: loading, empty, error, populated. Do not ship only the
  happy path.
- Repeatable sections (publications, awards, positions, etc.) share ONE generic CRUD
  component. Do not write eight near-identical editors.
- Tailwind only. No CSS modules, no styled-components, no inline style objects.
- Framer Motion: springs (`type: 'spring', stiffness: 100, damping: 20`), never linear
  easing. Use `staggerChildren` for grids and lists, `whileHover`/`whileTap` on interactive
  elements, `AnimatePresence` with real `exit` variants on anything that unmounts.
  Respect `prefers-reduced-motion`.
- Accessibility is a requirement, not a polish item: keyboard navigable, visible focus
  rings, WCAG AA contrast, labelled form fields.
- Mobile-first. Test at 360px.

---

## 7. Design direction

Sites in this category all look like 2011 admin panels. We are not doing that.

- Editorial layout, not card-soup. Generous whitespace.
- Type: a display serif for faculty names and page headings (Instrument Serif / Fraunces),
  a clean grotesque for body (Inter / Geist).
- Warm neutral background (`#FAFAF8`), not pure white. One deep institutional accent colour.
- Public profile: full-bleed hero, photo left / name + designation + research tags right,
  then a sticky in-page sub-nav that scroll-spies through sections.
- Directory: responsive grid, staggered `whileInView` reveal, hover lifts the card.
- Dashboard editor: split pane — form left, live preview right.
- Dark mode via CSS variables from day one.

---

## 8. Things to push back on

If asked to do any of these, say so rather than complying silently:

- Adding student features, events, or news modules — explicitly out of scope (see
  `docs/PROJECT_PLAN.md` §1.3).
- Storing files as base64 in the database.
- Using stateless JWTs for sessions (they cannot be revoked when an admin suspends an account).
- Skipping the admin approval gate — students hold college email addresses too, so
  domain-matching alone lets a student publish a fake professor page.
- Using `dangerouslySetInnerHTML` on unsanitized content.
- Adding a "quick fix" that bypasses `assertOwnsProfileRow`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
