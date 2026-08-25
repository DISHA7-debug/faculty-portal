# Security Requirements

Every item here is a hard requirement, not a suggestion. If a feature works but violates
one of these, the feature is not done.

---

## 1. Authorization

### 1.1 The three checks

Every mutating endpoint runs these in order:

```ts
const session = await requireSession();                  // 1. authenticated?
requireRole(session, ROLES.ANY_AUTHENTICATED);           // 2. right role?
const row = await assertOwnsProfileRow(found, session);  // 3. owns THIS row?
```

Use the named sets from `lib/auth/rbac.ts` (`ROLES.ANY_AUTHENTICATED`, `ROLES.ADMIN`,
`ROLES.SUPER_ADMIN_ONLY`) rather than literal arrays. `requireRole` implements no role
hierarchy, so a hand-written `['FACULTY']` locks both admin tiers out of the dashboard —
they are faculty members with profiles of their own.

Step 3 takes no department argument. `assertOwnsProfileRow` resolves the owning profile's
department itself when the session is a `DEPT_ADMIN`. Callers may pass `ownerDepartmentId`
as an optimisation **only** when it came from a trusted database read of the row's owner —
never from the request, or the caller gets to nominate the scope it is checked against.

Check 3 is the one that gets skipped. It is the most exploitable bug in this class of
application: `DELETE /api/publications/abc123` that only verifies login lets any faculty
member delete any other's records by changing the ID.

### 1.2 Return 404, not 403

For a row the user does not own, return 404. A 403 confirms the record exists and leaks the
ID space.

### 1.3 Department scoping for DEPT_ADMIN

Scope comes from `session.administersDepartmentId` (set on `User`, writable only by
`SUPER_ADMIN`) — **never** from `session.profile.departmentId`. The two are deliberately
separate columns: `profile.departmentId` is a field the faculty member themself can edit,
and a DEPT_ADMIN is also a faculty member with their own profile. Deriving admin authority
from an editable field would let a DEPT_ADMIN grant themself scope over another department
just by editing their own profile.

```ts
export function canAdminister(
  session: AppSession,
  profile: { departmentId: string | null },
): boolean {
  if (isSuperAdmin(session)) return true;
  if (!isDeptAdmin(session)) return false;

  // Fail closed: null === null must never read as a match.
  if (!session.administersDepartmentId) return false;
  if (!profile.departmentId) return false;

  return profile.departmentId === session.administersDepartmentId;
}
```

### 1.4 Test that enforces it

Write a test that walks every file under `app/api/**` and `app/**/actions.ts` and fails if a
mutating handler does not reference the ownership helper. A convention only holds if it is
enforced mechanically.

### 1.5 Admin-panel mutations on `User` — not profile-owned, scoped by hand

`scripts/check-ownership.mjs` derives "profile-owned" from the schema: any model carrying a
`profileId`. `User` does not carry one — a `Profile` points AT its `User`, not the other way
round — so `assertOwnsProfileRow` structurally does not apply to `app/admin/approvals/actions.ts`
and `app/admin/faculty/actions.ts`, and the checker correctly reports nothing to verify
there. The script's own comment says not to read that silence as "verified" — this section
is that manual verification, written down so it doesn't have to be re-derived from the code
by the next person who wonders why five mutating handlers carry no ownership-helper call.

The equivalent guarantee is produced a different way, at the query, for approve / reject /
suspend / reactivate:

```ts
// lib/auth/admin-scope.ts, simplified
export function scopedUserWhere(session: AppSession): Prisma.UserWhereInput | null {
  if (isSuperAdmin(session)) return {};
  if (!session.administersDepartmentId) return null;      // fail closed, never {}
  return { role: Role.FACULTY, profile: { is: { departmentId: session.administersDepartmentId } } };
}
```

Every lookup by target `userId` folds this into its `where`, so a DEPT_ADMIN's `findFirst`
for a userId outside their department returns `null` — the exact same shape as a userId
that does not exist at all, which is what §1.2 requires. There is no branch anywhere in
these actions that can tell the two cases apart to produce a different error message.

`role: Role.FACULTY` is there for a reason worth stating explicitly: a DEPT_ADMIN's own
profile carries a `departmentId` like any faculty member's, and so — separately — does
`SUPER_ADMIN`'s (the seed data puts the super-admin account's profile in CSE). Scoping by
department alone would let a CSE department admin suspend the super-admin account, purely
because their profiles happen to share a department. Restricting a DEPT_ADMIN's queries to
`role: FACULTY` closes that: they administer the faculty in their department, never another
admin, whatever department that admin's own profile happens to list.

**Role changes are SUPER_ADMIN-only, unconditionally — not department-scoped at all.** This
is a deliberate narrowing of what the task that produced this code originally asked for
("DEPT_ADMIN … Actions: change role"). `Role` is the primary privilege axis in this entire
system, and `administersDepartmentId` is already documented (§1.3) as writable only by
`SUPER_ADMIN` specifically so a DEPT_ADMIN cannot widen their own scope. A DEPT_ADMIN able
to set anyone's `role` to `SUPER_ADMIN` would bypass that restriction outright — grant
global authority directly, department scoping never consulted — rather than respect it.
Department-scoping the ACTION the way suspend/reactivate are scoped would not close that
hole (the dangerous case is the escalation itself, not which department the target is in),
so `changeRoleAction` checks `session.role === SUPER_ADMIN` and nothing else. The faculty
table's role selector is likewise rendered only for a `SUPER_ADMIN` viewer — not as the
enforcement (CLAUDE.md §3.1: hiding a control is never the check), but so a DEPT_ADMIN is
never shown a control the server was always going to refuse.

Two smaller footguns closed the same way, both self-targeting: an admin cannot suspend
their own account (`destroyAllSessionsForUser` would end the session running the request
that asked for it, recoverable only through `scripts/break-glass.ts`) and cannot change
their own role (a `SUPER_ADMIN` demoting themself mid-session, then being unable to reach
the control that would undo it).

---

## 2. Authentication

Identity is proven by demonstrating control of a college mailbox. **There are no
passwords** — nothing to hash, store, rotate, reset, or leak.

| Control | Requirement |
|---|---|
| Credential | 6-digit numeric code, emailed |
| Code generation | `crypto.randomInt`, never `Math.random`; zero-padded so `000123` is valid |
| Code storage | HMAC-SHA256 keyed with `AUTH_SECRET`. **Not** plain SHA-256 — see §2.3 |
| Code TTL | 10 minutes |
| Single use | `usedAt`, enforced inside the same transaction as the check |
| Attempts per code | **5**, then the code is DESTROYED |
| Outstanding codes | One per user. Issuing a new code deletes the previous one |
| Session storage | Unchanged: database row, cookie holds a random token, DB holds SHA-256 |
| Cookie flags | Unchanged: `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix |
| Session lifetime | Unchanged: 7 days, rolling refresh |
| Revocation | Unchanged: delete the session row; instant |

### 2.1 The approval gate

```
signup → PENDING_VERIFICATION
  → first correct code → PENDING_APPROVAL   (signed in, can edit, CANNOT publish)
    → admin approves → ACTIVE               (can publish)
```

Verification and sign-in are now the same act: a new account's first successful code both
confirms the address and creates the session. The code can advance an account to
PENDING_APPROVAL and **never** to ACTIVE. Students hold college addresses too, so
domain-matching plus mailbox control still does not prove somebody is staff.

### 2.2 Enumeration resistance

Requesting a code returns the same result whether or not an account exists, and the browser
proceeds to the code screen either way. Signing up with an already-registered address is
now genuinely identical to signing in — both send a code to that address and show the same
screen — rather than merely being made to look alike.

Submitting a code for an address with NO account answers exactly as a wrong code does.

Failures at the code screen ARE distinguished (expired / wrong / exhausted). That is safe:
every one of them presupposes an outstanding code, which the person only learns of by
receiving the email. Telling the real user which case applies is the difference between one
more attempt and giving up.

### 2.3 Why codes are HMAC'd rather than SHA-256'd

> **Accepted deviation.** The specification for this change said codes should be "hashed at
> rest exactly like current tokens", i.e. plain SHA-256. That was raised as wrong during
> implementation and the deviation was reviewed and accepted. What follows is the standing
> decision, not an inconsistency to be tidied up: **do not "restore consistency" by
> switching login codes to plain SHA-256.**

The other tokens in this system are 32 random bytes, so SHA-256 of one is irreversible.
**A 6-digit code has one million possibilities.** An attacker with a database dump can hash
all one million candidates in under a second and read every outstanding code. Plain SHA-256
of a low-entropy secret is an encoding, not a protection.

Keying the digest with `AUTH_SECRET` means the database alone is not enough — the attacker
also needs the application secret, which lives in the server environment and not in
Postgres. That is the property "hashed at rest" is supposed to buy.

### 2.4 Why the attempt cap is the security parameter

The code length is fixed at six digits, so the only lever against brute force is how many
guesses a single code will tolerate. At 5 attempts, guessing costs an expected 200,000 code
requests, and requests are themselves throttled per IP.

The cap sits on the CODE, not the account. Exhausting it destroys the attacker's target,
not the victim's access — a fresh code can always be requested. That is what keeps this
consistent with §3.2: it is a hard limit on something the attacker is spending, not on the
victim's identity.

The counter lives in the database (`VerificationToken.attempts`), not Redis. Redis is
explicitly disposable (PROJECT_PLAN §4.1), and a restart would hand an attacker a fresh
budget of guesses against a still-live code.

**Boundary note.** The cap counts *checked* attempts, so a correct fifth guess still
succeeds; it is the fifth *failure* that destroys the code. Comparing `> MAX` after
incrementing silently grants a sixth guess — a 20% larger search space, with nothing
visibly misbehaving. This was an actual bug caught by an integration test, not a
hypothetical.

### 2.5 Break glass — and why it must not be removed

**The problem it solves.** Authentication is by emailed code, so email is on the critical
path for every sign-in. A mail outage is a total authentication outage: nobody can get in,
*including the administrator who would fix the mail problem*, and including anyone who
could approve pending accounts. The system deadlocks while looking perfectly healthy — the
site serves, the database is fine, and no one can log in.

`scripts/break-glass.ts` is the recovery path. Run on the production host:

```bash
docker compose -f docker-compose.prod.yml exec app \
  node --import tsx scripts/break-glass.ts admin@<domain>
```

It refuses unless the account exists, is `SUPER_ADMIN`, and is `ACTIVE`; mints a session
with a **30-minute** TTL rather than the usual seven days; writes an `AuditLog` row
**before** printing anything; and prints the raw token with instructions for setting it as
a cookie.

**Why this is acceptable.** It requires a shell on the production host. Anyone who has that
already has the database, `.env`, `AUTH_SECRET`, and the ability to run arbitrary SQL —
including inserting a `Session` row by hand, which is precisely what this does. It adds no
attack surface beyond what SSH access already implies. What it adds over hand-written SQL
is an audit trail and a short expiry.

**Why it must not be removed.** Deleting this during a security review does not close a
hole. It reintroduces a total-lockout deadlock whose only remaining remedy is editing the
database directly, during an incident, at speed, under pressure — which is strictly more
dangerous than a script that refuses non-admins and audits every use.

Properties that are load-bearing, and must survive any refactor:

| Property | Why |
|---|---|
| `SUPER_ADMIN` only | A compromised department admin must not be escalatable by anyone reaching this script. |
| `ACTIVE` only | Otherwise suspension becomes meaningless for exactly the most privileged accounts. |
| Audit written BEFORE the token is printed | A use cannot be hidden by killing the process at the right moment. If the audit write fails, no token is disclosed. |
| Audit records no token and no digest | The row proves a session was minted; it must never be a means of using it. |
| 30-minute TTL | A token pasted into a chat window or left in shell history stops working before the incident is over. |

Operational procedure: `docs/RUNBOOK.md`, "Nobody can sign in".

---

## 3. Rate limiting

Implemented in `lib/rate-limit.ts` against Redis.

### 3.1 Why login is NOT a per-email account lockout

The textbook rule — *"5 failed attempts for this email, then lock the account for 15
minutes"* — is a **denial-of-service vector in this specific application**, and it was
specified that way in an earlier revision of this document. That was wrong.

The reasoning:

1. The public faculty directory publishes every faculty member's email address. That is
   the whole point of the directory; it is not something to fix.
2. Therefore an attacker can scrape all ~500 addresses in one request.
3. With a per-email lockout, a trivial script makes 5 bad login attempts per address and
   locks out **the entire faculty**, indefinitely, re-running whenever locks expire.
4. No password is ever guessed. The lockout *is* the attack, and the account-recovery
   burden lands on the same administrator the portal exists to help.

A lockout keyed on something the attacker controls, protecting an identifier the attacker
already knows, is a weapon pointed at your own users.

### 3.2 The general rule: hard limits on what the attacker owns, delays on what they merely know

This is the principle every limit below follows.

| The key is… | Example | Response |
|---|---|---|
| Something the attacker **owns** | their IP address | **Hard block.** Blocking it costs them, not a third party. |
| Something the attacker merely **knows** | a faculty email from the public directory | **Delay only.** A hard block here is a weapon anyone can point at any user. |

An identifier published in the directory can be spent by anyone. Any hard limit keyed on
one is a denial-of-service primitive handed to the internet, whatever the counter is
called: login lockout, verification-mail budget, reset budget. All three were specified
that way originally; all three are now delays.

### 3.3 What is implemented

| Layer | Key | Response | Rationale |
|---|---|---|---|
| IP spray guard | IP | Hard, 20 per 15 min | Attacker-owned. |
| Signup | IP | Hard, 3 per hour | Attacker-owned. |
| Signup / code request | email | **Delay**, 0 ×3 then 1s→15s (cap) | Attacker-known. A hard cap would let anyone exhaust a faculty member's code budget and lock them out of signing in entirely. |
| Code request | IP | Hard, 15 per hour | Attacker-owned. |
| Code VERIFICATION | IP | Hard, 30 per 15 min | See §2.4 — plus the 5-attempt cap on the code itself. |
| Distributed failure | email | **Delay**, ≥8 distinct IPs → 1s, doubling to a 10s cap | See below. |

**There is no automatic account lockout.** `User.lockedUntil` remains in the schema and is
still honoured at login, but nothing sets it automatically; it is reserved for a deliberate
administrator action.

The distinct-IP rule went through two revisions. Locking after *N consecutive failures* is
a DoS, for the reason in §3.1. Locking after *N distinct source IPs* was the first fix —
but it only moves the cliff. **Renting eight addresses costs cents**, so a hard threshold
of 8 just relocates the same denial one step further away, and buys the attacker a cheaper
outcome than guessing a password. The response is therefore an escalating **delay with a
ceiling**: it degrades smoothly, costs the attacker time proportional to their effort, and
always leaves the real owner a slower-but-open path. The 10-second cap is load-bearing —
an unbounded delay is a hard lock wearing a disguise.

Distinct IPs are counted in a Redis SET per email with a one-hour TTL. Emails and IPs are
SHA-256 hashed into keys: Redis is not the system of record and is not encrypted at rest
here, so `INCR rl:login:anita.sharma@…` would turn a stray `KEYS *` into a roster of who
has been signing in.

### 3.4 All IP-keyed limits depend on `lib/request-ip.ts`

Every hard limit above is keyed on the client IP, so all of them are void if that IP can be
chosen by the client.

`X-Forwarded-For` is **appended** to, never replaced: a proxy adds the address it observed
to the end of whatever arrived. A client that sends `X-Forwarded-For: 1.2.3.4` therefore
produces `1.2.3.4, <real>` at the app — and the conventional "read the first entry" reads
the attacker's value. **Read the rightmost entry**, counting in by trusted-proxy depth.

Caddy is configured with `trusted_proxies static private_ranges` and overwrites `X-Real-IP`
with `{client_ip}`, which is what the app prefers because it cannot be influenced from
outside. `TRUSTED_PROXY_COUNT` must be raised if a CDN is ever placed in front, or all
traffic is attributed to the CDN's egress address and rate-limited as a single client.

### 3.5 Remaining limits

| Action | Limit |
|---|---|
| Password reset request | 10 per IP per hour (hard); per-email is a delay |
| File upload | 20 per user per hour |
| Public API | 60 per IP per minute |

Fail **closed** on Redis errors for auth routes — an outage must not open an unlimited
brute-force window. Fail **open** for the public API, where availability matters more.

---

## 4. Input validation

- Zod schema on **every** input, validated server-side. Client validation is UX only.
- `.strict()` on all object schemas so unknown keys are rejected.
- Explicit allow-lists. Never spread the request body into a Prisma `data` object.
- A profile update endpoint must not be able to set: `role`, `status`, `userId`,
  `isPublished` (that has its own guarded endpoint), `completeness`, `viewCount`.

```ts
// lib/validation/profile.ts
export const profileUpdateSchema = z.object({
  fullName: z.string().min(2).max(120),
  designation: z.string().max(120).optional(),
  officeNo: z.string().max(60).optional(),
  mobile: z.string().regex(/^[\d+\s()-]{7,20}$/).optional(),
  about: z.string().max(5000).optional(),
  researchInterests: z.array(z.string().max(60)).max(15),
  personalPageUrl: z.string().url().max(300).optional(),
  orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).optional(),
  showMobile: z.boolean(),
}).strict();
```

---

## 5. File uploads

All uploads go through `lib/storage.ts`. No route touches the S3 SDK directly.

| Control | Rule |
|---|---|
| Type detection | Magic-byte sniffing (`file-type`), never the extension or client MIME header |
| Allowed | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| Size | Images 5 MB, PDFs 10 MB — enforced in the app **and** in Caddy |
| Filename | Discard the original; store as `{userId}/{cuid}.{ext}` |
| Images | Re-encode with `sharp` — strips EXIF, GPS data, and any embedded payload |
| PDFs | Verify the `%PDF-` header; reject anything with embedded JavaScript |
| Bucket | No public listing; object keys are unguessable |
| Quota | Max 60 objects per user, enforced against `FileObject` |
| Orphans | Replacing a photo or CV removes the previous object only AFTER the profile points at the new one |
| Entry point | `POST /api/upload` — a Route Handler, not a Server Action (binaries do not belong in the RSC payload) |
| Dev storage | MinIO from `docker-compose.yml`, S3-compatible, so the same SDK calls run locally and against R2 |

### 5.1 Ordering, and why each step is where it is

```
requireSession → assertOwnsProfileRow → rate limit → quota
  → size → magic bytes → re-encode → storage write → database row
```

- **Size first.** Cheapest check, and it bounds the cost of everything after it — a 50 MB
  payload is refused without ever reaching an image decoder.
- **Magic bytes before anything trusts the file.** The client's `Content-Type` and the
  extension are both attacker-controlled and are never consulted.
- **Re-encode after sniffing.** Decoding and re-encoding is what actually strips EXIF
  (including the GPS coordinates phones attach by default) and destroys any appended
  payload. A polyglot that is both valid JPEG and valid script does not survive it.
- **Storage write BEFORE the database row.** Reversing these would leave a row pointing at
  an object that does not exist if the upload failed. This ordering leaves at worst an
  orphaned object — invisible to users and cheap to sweep. Prefer the failure that is not
  user-visible.
- **Old object removed last**, after the profile points at the replacement, so a failure
  leaves an orphan rather than a broken reference.

PDFs are stored as received. Re-encoding one safely requires a full PDF parser, which is a
larger attack surface than the problem it solves; the mitigation is that they are served
from a separate origin as downloads and never rendered inline by this application.

---

## 6. Output safety

- `about` is the only rich-text field. Store markdown; render through a sanitizing renderer.
- If HTML is ever allowed, sanitize with DOMPurify **server-side before storage** and again
  on render.
- `dangerouslySetInnerHTML` is banned outside the one audited sanitizer component.
- All user-supplied URLs are validated as `https:` and rendered with
  `rel="noopener noreferrer nofollow"`.

---

## 7. HTTP headers

These apply to every route, set in `next.config.ts` and reinforced in the Caddyfile:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### 7.1 Content-Security-Policy is split by route — this is deliberate

There is no single CSP for the whole site, because the two halves have genuinely
different constraints. **Read this before changing either half.**

**Public routes** (`/`, `/faculty/**`, `/departments/**`) — set in `next.config.ts`:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' <R2_PUBLIC_URL> data: blob:; font-src 'self'; connect-src 'self';
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

**Authenticated routes** (`/dashboard/**`, `/admin/**`) — set per-request in `proxy.ts`:

```
default-src 'self'; script-src 'self' 'nonce-<per-request>'; style-src 'self' 'unsafe-inline';
img-src 'self' <R2_PUBLIC_URL> data: blob:; font-src 'self'; connect-src 'self';
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

**Why the public half keeps `'unsafe-inline'`:** a nonce must be unique per request, and
a statically rendered page is generated once at build time and served identically to
everyone. Nonce and static rendering are mutually exclusive. The public pages are the
ones that must be fast for anonymous visitors on 4G (LCP under 1.5s — PROJECT_PLAN §1.2),
so they stay static and accept a weaker `script-src`.

**Why that is an acceptable trade on the public half specifically:**

- These routes render no session, no CSRF token, and no privileged data. The worst case
  for injected script is defacement of already-public information, not account takeover.
- The only user-authored rich text on them is `about`, which is sanitized **server-side
  before storage** and again on render (§6). Nothing else on a public page comes from a
  user without escaping.
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'`
  still hold, so the classic CSP-bypass pivots are closed on both halves.

**Why the authenticated half gets the strict policy:** `/dashboard` and `/admin` are
dynamic regardless — they read the session cookie and cannot be statically rendered — so
a per-request nonce costs nothing there. These are exactly the routes where injected
script could exfiltrate a session, mutate a profile, or drive an admin action.

### 7.2 Why the theme provider lives in subtree layouts

`components/providers.tsx` is rendered by `app/(public)/layout.tsx` and
`app/dashboard/layout.tsx`, **not** by the root layout. This looks like duplication worth
removing. It is not — removing it silently collapses the static half of the CSP split.

The chain:

1. next-themes renders an inline script that reads the stored theme and sets the class on
   `<html>` before first paint, preventing a flash of the wrong theme.
2. Under the strict CSP on `/dashboard` and `/admin`, that script needs the request nonce,
   which next-themes accepts as a `nonce` prop.
3. Reading the nonce requires `headers()`.
4. **Calling `headers()` in the ROOT layout marks every route in the application dynamic**,
   because every route renders through it.

Step 4 is the trap. It was measured, not assumed: moving the provider into the root layout
with a `nonce` prop turned `/` from `○ (Static)` into `ƒ (Dynamic)` in the build output.
Nothing fails, no test breaks, and no warning is printed — the public pages simply stop
being prerendered and start rendering per request, losing the LCP budget in
PROJECT_PLAN §1.2 and making the whole public/static rationale for §7.1 moot.

So the provider sits one level down, where only the authenticated subtree pays for
`headers()` — and that subtree is dynamic anyway because it reads the session cookie.

**If you consolidate these back into the root layout, check the build output for `○` on
`/`.** Losing it is the entire cost, and it is invisible at runtime.

**Do not:**

- Move `Providers` into the root layout to remove the duplication. See §7.2.
- Add `'unsafe-inline'` to the authenticated policy to fix a console warning. Find the
  inline script and give it the nonce instead.
- Delete `'unsafe-inline'` from the public policy without first making those routes
  dynamic — you will ship a site whose public pages do not hydrate.
- Collapse the two into one policy. That has been tried; whichever way it collapses is
  wrong for one half.

---

## 8. Database

- Prisma parameterizes queries. `$queryRawUnsafe` with interpolated strings is banned.
- `cuid()` IDs everywhere — sequential integers leak record counts and enable enumeration.
- Postgres is **not** published to the host in production; it lives on an internal Docker
  network only.
- Connection pool capped at 15.

---

## 9. Audit logging

Write an `AuditLog` row for:

- Every admin action (approve, reject, suspend, role change, force-unpublish)
- Profile publish / unpublish
- Password change and password reset completion
- Email change
- Any bulk delete

Record `userId`, `action`, `entity`, `entityId`, `ipAddress`, and a before/after diff in
`metadata`. Never log passwords, tokens, or full session values.

**`ipAddress` is not currently populated by any Server Action** — `dashboard/publish/actions.ts`
and the Sprint 4 admin actions (§1.5) all write `userId` / `action` / `entity` / `entityId`
/ `metadata` and omit it, matching each other but not this policy. `scripts/break-glass.ts`
is the one place that does set it, because a CLI script receives the connecting IP some
other way than a Server Action does. Populating it from Server Actions means threading
`headers()` into every one of them for `lib/request-ip.ts` — a real, cross-cutting change
affecting every action file in the app, not a one-line fix in whichever file is being
touched that day. Recorded here as a known gap rather than fixed as a drive-by inside an
unrelated change, which is how a partial, inconsistent version of it would otherwise creep
in one action file at a time.

---

## 10. Secrets and dependencies

- `.env` never committed; `.env.example` carries placeholders only.
- `AUTH_SECRET` generated with `openssl rand -base64 32`, unique per environment.
- All credentials rotated at handover to the college.
- Dependabot enabled; `npm audit --audit-level=high` runs in CI.

---

## 11. Privacy

- Mobile number is optional and hidden by default (`showMobile: false`).

### 11.1 Research students are third parties who never consented

The Guidance section is the only place this application publishes personal data about
someone who is **not a user of it**. A supervised student never signed up, never agreed to
a privacy notice, and cannot log in to change or remove what is said about them. They have
no route to object except asking their supervisor.

That asymmetry is worst for a **current** student: the relationship is ongoing and
unequal, so "my supervisor listed my full name and thesis topic on a public page" is not
something they are well placed to contest. A completed thesis is different — it is a
published document that already names its author, and being credited is a professional
benefit.

So `Guidance.nameDisplay` is per entry, with defaults that follow that reasoning:

| Status | Default | Why |
|---|---|---|
| `ONGOING` | `INITIALS` | Current student, ongoing power imbalance, no consent obtained. |
| `DISCONTINUED` | `INITIALS` | The most sensitive case — a supervision that ended badly must not be broadcast. |
| `COMPLETED` | `FULL_NAME` | The thesis is public and already names them; credit is warranted. |

The faculty member can override either way per entry — they may have actual permission,
or a particular student may prefer not to be named at all. The default is what applies
when nobody has thought about it, which is the case that matters.

Implementation notes that keep this true:

- The column default is `INITIALS`, not `FULL_NAME`. Any future write path — the Sprint 5
  importers, a bulk load, a manual `INSERT` — is private by default without having to
  remember this rule.
- `displayStudentName()` in `lib/validation/sections.ts` is the single renderer, used by
  both the editor and the public profile. Two implementations would eventually disagree,
  and the one that disagreed in the public direction would publish a name meant to be
  withheld.
- The editor shows the **public** form with the private full name beside it, so a faculty
  member can see at a glance that a current student is about to be named.
- The migration that added the column backfilled existing rows by the same rule rather
  than letting the column default silently re-hide completed students.
- Collect only what a public academic profile needs. No dates of birth, no home addresses,
  no government ID numbers, no salary information.
- The public JSON API exposes only published profiles and only fields marked visible.

---

## 12. Pre-launch security review

- [ ] Attempt to edit another user's publication by ID — must 404
- [ ] Attempt to set `role: SUPER_ADMIN` via the profile update endpoint — must reject
- [ ] Attempt to publish while `PENDING_APPROVAL` — must reject
- [ ] Upload a `.php` file renamed to `.jpg` — must reject
- [ ] Upload a 50 MB PDF — must reject at the proxy
- [ ] Brute-force 10 logins — must lock out
- [ ] Confirm reset tokens are single-use and expire
- [ ] Confirm sessions die on password reset
- [ ] Confirm Postgres is not reachable from the public internet (`nmap` the droplet)
- [ ] Confirm `.env` is not in the git history (`git log -p -- .env`)
- [ ] Run a restore from the latest backup into a scratch database
