# Faculty Profile Portal — Complete Project Plan

**Version:** 1.0
**Status:** Pre-development planning
**Owner:** Solo developer (you)
**Target:** Production deployment on college-owned domain

---

## 1. Project Definition

### 1.1 One-sentence goal

A production faculty portal where every teacher self-registers with a college email, maintains their own academic profile through a private dashboard, and gets a fast, well-designed public page — with an admin layer that keeps the data trustworthy.

### 1.2 Success criteria

| Criterion | Target |
|---|---|
| Faculty onboarded | 500+ accounts, 80%+ with a complete profile |
| Uptime | 99.5%+ measured over 90 days |
| Public page load | LCP under 1.5s on 4G from India |
| Data loss events | Zero — recoverable to within 24 hours at all times |
| Unauthorized profile edits | Zero |
| Handover | College can run it without you after graduation |

### 1.3 Explicit non-goals (v1)

Cutting these now prevents scope creep later. Say no to:

- Student-facing features (course registration, grades, attendance)
- Departmental news/events CMS
- Internal messaging between faculty
- Multi-language / i18n
- Mobile app
- Integration with the college ERP

---

## 2. Users and Roles

| Role | Who | Capabilities |
|---|---|---|
| `PUBLIC` | Anyone on the internet | View published profiles, search directory |
| `FACULTY` | A verified teacher | Full CRUD on **their own** profile only; publish/unpublish it |
| `DEPT_ADMIN` | HOD or department coordinator | Everything FACULTY has, plus approve/reject signups and unpublish profiles **within their own department** |
| `SUPER_ADMIN` | College IT / project owner | Everything, across all departments; manage departments, roles, view audit log, impersonate for support |

**Key rule that must be enforced on every single mutation:** a `FACULTY` user can only touch rows whose `profileId` matches their own session profile. This is the #1 vulnerability class in projects like this (IDOR — Insecure Direct Object Reference). It is not enough to hide the button in the UI.

---

## 3. Feature Specification

### 3.1 Priority key

- **P0** — Ship or the project fails
- **P1** — Ship for a credible v1
- **P2** — Differentiators; ship if time allows
- **P3** — Post-launch backlog

### 3.2 Authentication & account lifecycle

| ID | Feature | Priority |
|---|---|---|
| A1 | Self-signup restricted to college email domain(s) | P0 |
| A2 | Email verification — the first login code doubles as verification | P0 |
| A3 | Admin approval gate — profile invisible publicly until approved | P0 |
| A4 | Sign-in by emailed code, rate limited; 5 attempts per code, no account lockout | P0 |
| A5 | ~~Password reset~~ — **removed.** No password exists; signing in and recovering access are the same act | — |
| A6 | Session management — DB-backed, revocable | P0 |
| A7 | Change email (re-verification required) | P1 |
| A8 | Admin: bulk CSV pre-authorization of faculty emails | P1 |
| A9 | Admin: suspend / reactivate an account | P1 |
| A10 | "Active sessions" view — faculty can log out other devices | P2 |
| A11 | Optional 2FA (TOTP) for admin roles | P3 |

### 3.3 Faculty profile editor

| ID | Feature | Priority |
|---|---|---|
| P1a | Personal details — name, designation, department, contacts, about | P0 |
| P1b | Profile photo upload with client-side crop, server-side re-encode | P0 |
| P1c | CV upload (PDF, max 10 MB) | P0 |
| P1d | Research interests as tags | P0 |
| P1e | Education entries (degree, institution, year) | P0 |
| P1f | Publications (journal / conference / book / chapter) | P0 |
| P1g | Positions held | P0 |
| P1h | Awards and honours | P0 |
| P1i | Courses taught | P0 |
| P1j | Sponsored projects and consultancy | P1 |
| P1k | PhD / MTech guidance records | P1 |
| P1l | Professional memberships | P1 |
| P1m | Drag-to-reorder within every repeatable section | P1 |
| P1n | Draft vs published state — preview before going live | P1 |
| P1o | Profile completeness meter with nudges | P1 |
| P1p | Field-level visibility toggles (e.g. hide mobile number) | P1 |
| P1q | Autosave drafts | P2 |

### 3.4 Public site

| ID | Feature | Priority |
|---|---|---|
| U1 | Faculty directory with pagination | P0 |
| U2 | Individual profile page at `/faculty/[slug]` | P0 |
| U3 | Full-text search across name, interests, publication titles | P1 |
| U4 | Filter by department, designation, research area | P1 |
| U5 | Department landing pages | P1 |
| U6 | `schema.org/Person` JSON-LD for Google Scholar indexing | P1 |
| U7 | Sitemap.xml + robots.txt, auto-generated | P1 |
| U8 | Dark mode | P2 |
| U9 | Public read-only JSON API for embedding elsewhere | P2 |

### 3.5 Differentiators (these are what earn marks)

| ID | Feature | Priority |
|---|---|---|
| D1 | DOI import — paste a DOI, auto-fill publication via CrossRef API | P2 |
| D2 | BibTeX file import — bulk-add publications | P2 |
| D3 | ORCID sync — pull entire publication list with one click | P2 |
| D4 | Auto-generated CV as PDF from profile data | P2 |
| D5 | Citation counts pulled periodically | P3 |
| D6 | Per-profile view analytics for the faculty member | P3 |

### 3.6 Admin

| ID | Feature | Priority |
|---|---|---|
| M1 | Pending-approval queue with approve/reject + reason | P0 |
| M2 | Department CRUD | P0 |
| M3 | User list — search, filter by status, change role | P1 |
| M4 | Audit log viewer | P1 |
| M5 | Data export — full CSV/JSON dump of all profiles | P1 |
| M6 | Force-unpublish a profile (content policy) | P1 |
| M7 | Dashboard stats — signups, completeness distribution | P2 |

---

## 4. Data Architecture

### 4.1 Where each kind of data lives

| Data | Store | Reasoning |
|---|---|---|
| All structured profile data | PostgreSQL | Relational, queryable, transactional |
| Profile photos, CV PDFs | Cloudflare R2 (S3-compatible) | Binary blobs never belong in a DB; R2 has zero egress fees |
| Sessions | PostgreSQL | Revocable; survives app restart |
| Rate-limit counters | Redis | Ephemeral, high-write, fine to lose |
| Search index | PostgreSQL `tsvector` | At 500 profiles, a separate search engine is over-engineering |
| Logs | Files on disk, rotated | Shipped nowhere in v1; grep is fine at this scale |
| Backups | Cloudflare R2, separate bucket, encrypted | Off-machine, so a dead droplet isn't a dead project |

**Estimated total size at full adoption:** ~50 MB of Postgres data, ~2–4 GB of PDFs and images. Tiny. Do not over-architect for scale you will never see.

### 4.2 Complete Prisma schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============ ENUMS ============

enum Role {
  FACULTY
  DEPT_ADMIN
  SUPER_ADMIN
}

enum AccountStatus {
  PENDING_VERIFICATION  // signed up, email not yet confirmed
  PENDING_APPROVAL      // email confirmed, awaiting admin
  ACTIVE
  REJECTED
  SUSPENDED
}

enum PublicationType {
  JOURNAL
  CONFERENCE
  BOOK
  BOOK_CHAPTER
  PATENT
  OTHER
}

enum DegreeLevel {
  BACHELORS
  MASTERS
  MPHIL
  PHD
  POSTDOC
  DIPLOMA
  OTHER
}

enum CourseLevel {
  UG
  PG
  PHD
}

enum ProjectType {
  SPONSORED
  CONSULTANCY
  INTERNAL
}

enum ProjectStatus {
  ONGOING
  COMPLETED
  SANCTIONED
}

enum GuidanceDegree {
  PHD
  MTECH
  MSC
  BTECH
}

enum GuidanceStatus {
  ONGOING
  COMPLETED
  DISCONTINUED
}

enum TokenType {
  LOGIN_OTP      // 6-digit emailed code: first verification AND every sign-in
  EMAIL_CHANGE
}

// ============ IDENTITY ============

model User {
  id              String        @id @default(cuid())
  email           String        @unique              // lowercased at write time
  role            Role          @default(FACULTY)     // no password — see §5.1
  status          AccountStatus @default(PENDING_VERIFICATION)
  emailVerifiedAt DateTime?
  lastLoginAt     DateTime?
  failedAttempts  Int           @default(0)
  lockedUntil     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  // The department a DEPT_ADMIN administers. Deliberately separate from
  // profile.departmentId (user-editable) — see §4.3.
  administersDepartmentId String?
  administersDepartment   Department? @relation("DepartmentAdmins", fields: [administersDepartmentId], references: [id])

  profile   Profile?
  sessions  Session[]
  tokens    VerificationToken[]
  auditLogs AuditLog[]
  usedAllowedEmails AllowedEmail[]

  @@index([status])
  @@index([email, status])
  @@index([administersDepartmentId])
}

model Session {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique          // SHA-256 of the cookie value; raw token never stored
  userAgent  String?
  ipAddress  String?
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model VerificationToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique          // never store the raw token
  type      TokenType
  payload   String?                    // e.g. the new email for EMAIL_CHANGE
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
}

// Emails pre-authorized by admin (CSV import) — optional stricter gate than domain-only
model AllowedEmail {
  id           String   @id @default(cuid())
  email        String   @unique
  departmentId String?
  note         String?
  usedAt       DateTime?
  usedByUserId String?
  createdAt    DateTime @default(now())

  department Department? @relation(fields: [departmentId], references: [id])
  usedByUser User?       @relation(fields: [usedByUserId], references: [id])

  @@index([usedByUserId])
}

// ============ CORE PROFILE ============

model Department {
  id        String   @id @default(cuid())
  name      String   @unique
  code      String   @unique          // e.g. "CSE"
  slug      String   @unique
  about     String?  @db.Text
  createdAt DateTime @default(now())

  profiles      Profile[]
  allowedEmails AllowedEmail[]
  adminUsers    User[]    @relation("DepartmentAdmins")
}

model Profile {
  id           String  @id @default(cuid())
  userId       String  @unique
  departmentId String                  // required — department selection is mandatory at signup

  // Identity
  fullName    String
  slug        String  @unique          // "dr-anita-sharma"; immutable once published
  designation String?                  // Assistant Professor, Professor, ...
  photoKey    String?                  // R2 object key, not a URL
  photoBlurhash String?

  // Contact
  officeNo    String?
  mobile      String?
  altEmail    String?
  showMobile  Boolean @default(false)  // field-level privacy
  showAltEmail Boolean @default(true)

  // Narrative
  about             String?  @db.Text  // sanitized HTML or markdown
  researchInterests String[]           // Postgres text[]
  personalPageUrl   String?
  cvKey             String?            // R2 object key

  // Academic identifiers
  orcid             String?
  scopusId          String?
  googleScholarId   String?
  researcherId      String?
  linkedinUrl       String?

  // State
  isPublished    Boolean   @default(false)
  publishedAt    DateTime?
  completeness   Int       @default(0)  // 0-100, recomputed on save
  viewCount      Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  // Full-text search vector, maintained by a Postgres trigger
  searchVector Unsupported("tsvector")?

  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  department  Department    @relation(fields: [departmentId], references: [id])
  educations  Education[]
  publications Publication[]
  positions   Position[]
  awards      Award[]
  courses     Course[]
  projects    ResearchProject[]
  guidances   Guidance[]
  memberships Membership[]

  @@index([departmentId, isPublished])
  @@index([isPublished, fullName])
}

// ============ REPEATABLE SECTIONS ============
// Every one of these carries `sortOrder` so faculty can drag-reorder,
// and `profileId` so ownership can be checked on every mutation.

model Education {
  id          String      @id @default(cuid())
  profileId   String
  degree      String                    // "Ph.D."
  level       DegreeLevel
  field       String?                   // "Computer Science"
  institution String
  yearFrom    Int?
  yearTo      Int?
  sortOrder   Int         @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

model Publication {
  id        String          @id @default(cuid())
  profileId String
  type      PublicationType
  title     String          @db.Text
  authors   String          @db.Text    // "Sharma A., Verma B., Singh C."
  venue     String?                     // journal or conference name
  volume    String?
  issue     String?
  pages     String?
  year      Int?
  doi       String?
  url       String?
  publisher String?
  isbn      String?
  citations Int?
  importedFrom String?                  // "CROSSREF" | "ORCID" | "BIBTEX" | null
  sortOrder Int             @default(0)
  createdAt DateTime        @default(now())

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, year(sort: Desc)])
  @@index([profileId, type])
  @@unique([profileId, doi])            // prevents duplicate imports
}

model Position {
  id           String  @id @default(cuid())
  profileId    String
  title        String
  organisation String?
  startYear    Int?
  endYear      Int?
  isCurrent    Boolean @default(false)
  description  String? @db.Text
  sortOrder    Int     @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

model Award {
  id          String  @id @default(cuid())
  profileId   String
  title       String
  awardedBy   String?
  year        Int?
  description String? @db.Text
  sortOrder   Int     @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

model Course {
  id        String      @id @default(cuid())
  profileId String
  code      String?
  name      String
  level     CourseLevel
  semester  String?
  year      Int?
  sortOrder Int         @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

model ResearchProject {
  id          String        @id @default(cuid())
  profileId   String
  type        ProjectType
  title       String        @db.Text
  agency      String?                     // funding body
  amountLakhs Decimal?      @db.Decimal(12, 2)
  role        String?                     // "Principal Investigator"
  startDate   DateTime?
  endDate     DateTime?
  status      ProjectStatus @default(ONGOING)
  sortOrder   Int           @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

model Guidance {
  id          String         @id @default(cuid())
  profileId   String
  studentName String
  degree      GuidanceDegree
  topic       String?        @db.Text
  status      GuidanceStatus @default(ONGOING)
  startYear   Int?
  awardYear   Int?
  coGuide     String?
  sortOrder   Int            @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, status])
}

model Membership {
  id             String  @id @default(cuid())
  profileId      String
  body           String                    // "IEEE"
  membershipType String?                   // "Senior Member"
  sinceYear      Int?
  membershipNo   String?
  sortOrder      Int     @default(0)

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, sortOrder])
}

// ============ OPERATIONS ============

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String                        // "profile.publish", "user.approve"
  entity    String                        // "Publication"
  entityId  String?
  metadata  Json?                         // before/after diff
  ipAddress String?
  createdAt DateTime @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt(sort: Desc)])
  @@index([entity, entityId])
}

model FileObject {
  id           String   @id @default(cuid())
  key          String   @unique          // R2 object key
  ownerUserId  String?
  originalName String
  mimeType     String
  sizeBytes    Int
  createdAt    DateTime @default(now())

  @@index([ownerUserId])
}
```

### 4.3 Design decisions worth defending in a viva

| Decision | Why |
|---|---|
| Separate tables per section, not a JSON blob | Publications need to be sorted by year, filtered by type, deduplicated by DOI, and exported. JSON makes all of that painful. |
| `sortOrder` integers, renumbered on drag | Simple and correct at this scale. Fractional ranking is unnecessary complexity for lists of ~50 items. |
| `cuid()` not auto-increment integers | Sequential IDs leak how many records exist and make enumeration attacks trivial. |
| Object **keys** stored, not full URLs | Storage provider can change without a data migration. |
| `onDelete: Cascade` from Profile | Deleting a profile must not leave orphaned publications. |
| `@@unique([profileId, doi])` | Import the same ORCID list twice and you get no duplicates. |
| `searchVector` maintained by trigger | Search stays correct even if a write bypasses the app layer. |
| Soft state via `AccountStatus`, not deletion | An institution needs an audit trail. Never hard-delete a faculty account. |
| `User.administersDepartmentId` separate from `Profile.departmentId` | `Profile.departmentId` is user-editable by the faculty member who owns the row. A DEPT_ADMIN is also a faculty member with their own profile. If admin scope were derived from that editable field, an admin could grant themself authority over another department by editing their own profile. `administersDepartmentId` lives on `User`, is only ever written by `SUPER_ADMIN`, and is what `canAdminister()` checks — see `docs/SECURITY.md` §1.3. |
| `Profile.departmentId` required, not optional | Department selection is mandatory at signup. An unassigned profile would be administrable only by `SUPER_ADMIN`, defeating the point of department-scoped approval queues. |

### 4.3.1 Slug policy

`Profile.slug` is the public URL segment (`/faculty/dr-anita-sharma`) and is `@unique`.

- **Derivation:** auto-derived from `fullName` at profile creation — lowercase,
  transliterate to ASCII, strip non-alphanumeric characters, hyphenate.
- **Collisions:** on collision, append `-2`, `-3`, … in creation order.
- **Editable pre-publish:** the faculty member may edit their own slug freely while
  `publishedAt` is `null`.
- **Immutable post-publish:** once `publishedAt` is set, the slug is frozen. Changing it
  after publish breaks inbound links, citations, and Google Scholar indexing (see U6).
  Only `SUPER_ADMIN` may override, and doing so writes an `AuditLog` row.
- **Reserved words:** a blocklist (`login`, `admin`, `api`, `dashboard`, `faculty`,
  `departments`, `_next`, etc. — every top-level route segment) prevents a slug from
  shadowing an app route.

### 4.4 Full-text search setup

```sql
-- Migration: add the trigger that keeps searchVector current
CREATE INDEX profile_search_idx ON "Profile" USING GIN ("searchVector");

CREATE FUNCTION profile_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."fullName", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."researchInterests", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."designation", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."about", '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER profile_search_update
  BEFORE INSERT OR UPDATE ON "Profile"
  FOR EACH ROW EXECUTE FUNCTION profile_search_trigger();
```

---

## 5. Authentication Design

### 5.1 Signup and sign-in (one flow, no passwords)

Identity is proven by demonstrating control of a college mailbox. There is no password.

```
SIGN UP
1. User submits full name + college email + department
2. Server validates:
   - email matches an allowed domain (or exists in AllowedEmail, strict mode)
   - rate limit: 3 signups per IP per hour
3. Create User(status = PENDING_VERIFICATION) and its Profile in ONE transaction
4. Issue a 6-digit code: crypto.randomInt, stored as HMAC-SHA256 keyed with AUTH_SECRET,
   expiring in 10 minutes, replacing any outstanding code for that user
5. Email the code. The server never stores the raw value.

SIGN IN (and, on a new account, verification — they are the same act)
6. User submits their email -> a code is sent, whether or not the account exists
7. User enters the code
   - wrong        -> attempt counted; 5 failures destroy the code
   - expired      -> code deleted, request another
   - correct      -> code burned atomically, session created
8. First successful code sets emailVerifiedAt and moves PENDING_VERIFICATION
   -> PENDING_APPROVAL. Never to ACTIVE.
9. Admin approves -> ACTIVE -> faculty may publish
```

**Why the approval gate is not optional:** students hold college email addresses too.
Mailbox control proves the address is theirs; it does not prove they are staff. Domain
matching plus a working inbox would still let a student publish a fake professor page.

**What this deleted:** password hashing and its parameters, the reset-request and
reset-completion flows and their pages, the timing-equalisation dummy hash, the account
lockout logic, and the separate "check your email" holding screen. Verification and
sign-in collapsed into one screen.

### 5.2 Session strategy

Database-backed sessions, not stateless JWTs.

| Property | Value |
|---|---|
| Cookie | `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix |
| Stored | SHA-256 hash of the cookie value only |
| Lifetime | 7 days, rolling refresh on activity |
| Revocation | Delete the row — instant, works for password reset and admin suspension |

Stateless JWTs cannot be revoked before expiry. For a system where an admin may need to suspend an account immediately, that's disqualifying.

### 5.3 Brute-force defence

| Control | Rule |
|---|---|
| Code attempts | 5 per code, then the code is destroyed (not the account) |
| IP rate limit | 20 login attempts per IP per 15 min |
| Signup | 3 per IP per hour |
| Code requests | 15 per IP per hour; escalating delay per email, never a block |
| Response timing | Constant-time — never reveal whether an email exists |
| Reset behaviour | On successful reset, delete **all** sessions for that user |

## 6. Security Checklist

### 6.1 Authorization — the part most student projects get wrong

Every mutating endpoint must run three checks in order:

```ts
// 1. Authenticated?
const session = await requireSession();

// 2. Right role?
if (session.role !== 'FACULTY' && !isAdmin(session)) throw forbidden();

// 3. OWNS THIS SPECIFIC ROW?  <-- the one everyone forgets
const pub = await db.publication.findUnique({ where: { id: params.id } });
if (!pub || pub.profileId !== session.profileId) throw notFound(); // 404, not 403
```

Return **404, not 403**, for rows the user doesn't own — a 403 confirms the record exists.

Write one helper, `assertOwnsProfileRow(model, id, session)`, and call it in every route. Then write a test that fails if any route file lacks it.

### 6.2 Input validation

- **Zod schema on every input**, validated server-side. Client validation is UX, not security.
- Reject unknown keys (`.strict()`) so nobody can inject `role: 'SUPER_ADMIN'` into a profile update.
- Explicit allow-lists for updatable fields — never `data: req.body`.

### 6.3 File uploads

| Control | Rule |
|---|---|
| Type check | Sniff magic bytes, not the file extension or client MIME header |
| Allowed | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| Size | Images 5 MB, PDFs 10 MB, enforced at the proxy too |
| Filename | Discard the original; generate `{cuid}.{ext}` |
| Images | Re-encode server-side with sharp — strips EXIF and any embedded payload |
| Storage | R2 bucket, no public listing, served through the CDN |
| Quota | Max 60 objects per user |

### 6.4 Output safety

- The "About" field is the only rich-text input. Store markdown; render with a sanitizing renderer. If you allow HTML, run it through DOMPurify **server-side** before storage and again on render.
- Never `dangerouslySetInnerHTML` on unsanitized content.

### 6.5 HTTP hardening

```
Content-Security-Policy: default-src 'self'; img-src 'self' https://cdn.yourcollege.ac.in data:; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### 6.6 Other

- **SQL injection**: Prisma parameterizes. Never use `$queryRawUnsafe` with interpolated strings.
- **CSRF**: SameSite=Lax plus Auth.js's built-in token.
- **Secrets**: `.env` on the server only, `.env.example` in git, never real values. Rotate on handover.
- **Dependencies**: Dependabot on, `npm audit` in CI.
- **Admin actions**: every one writes an `AuditLog` row.
- **PII minimisation**: mobile number optional and hidden by default. Only collect what a public academic profile needs.

---

## 7. Reliability Plan

| Concern | Mitigation |
|---|---|
| Server dies | Docker `restart: unless-stopped`; droplet monitoring alert |
| App crashes | Health endpoint `/api/health` checking DB connectivity; UptimeRobot pings every 5 min, alerts you + college IT |
| Data loss | Nightly `pg_dump` → R2, 30-day retention, gzip + encrypted. **Weekly restore drill into a scratch DB** — an untested backup is not a backup |
| Bad deploy | Staging environment on a subdomain; migrations reviewed before running; deploy only from `main` |
| Migration breaks prod | Take a manual dump immediately before every `prisma migrate deploy` |
| Disk fills | Log rotation via logrotate; disk-usage alert at 80% |
| DB connection exhaustion | Prisma pool capped at 15; single app instance |
| Slow queries | `log: ['query']` in dev; add indexes before launch, not after complaints |
| **Email is now on the critical path for EVERY sign-in** | **Open risk, raised by the move to one-time codes.** Previously mail delivery only had to work for registration and password resets; a faculty member with a working password could always get in. Now a mail outage means **nobody can sign in at all** — including the administrator who would investigate it, and including anyone who could approve pending accounts. Deliverability is no longer a launch-week concern but a continuous availability dependency. Mitigations: SPF/DKIM/DMARC before launch (docs/CUTOVER.md §3); monitor SES bounce and complaint rates, not just uptime; and treat "codes are not arriving" as a **severity-one incident**, because it is a total outage of authentication even while the site itself is up. A break-glass path for administrators — a short-lived session minted from the server console — is worth building before the faculty count grows; it does not exist yet. |
| Email in spam | SPF + DKIM + DMARC on the college domain, configured in sprint 2, not week 10 |
| Bus factor = you | Handover doc + college owns all accounts and billing |
| **No deployment has occurred yet** | **Open risk.** The domain is deferred until the project is otherwise complete, so nothing has ever run on a VPS, no publicly trusted certificate has been issued, and no email has been delivered to a real inbox. Deployment risk is mitigated *partially* by running the real `docker-compose.prod.yml` locally with `SITE_ADDRESS=localhost` and Caddy's internal CA, which catches container-only failures (missing runtime deps, bind address, inter-service reachability). It does **not** catch DNS, ACME issuance, SES deliverability, or firewall exposure — all of which stay unvalidated until cutover. Every step and its failure mode is enumerated in `docs/CUTOVER.md`. The longest lead time is SES domain verification, which must start well before launch. |

**Definition of "recovered":** you can rebuild the entire production system from a fresh droplet, the git repo, and the latest R2 backup, in under 2 hours. Practice this once before launch.

---

## 8. Sprint Plan

**Team:** 1 developer (you) | **Sprint length:** 2 weeks | **Total:** 5 sprints / 10 weeks
**Capacity assumption:** ~20 hrs/week alongside classes → 40 hrs per sprint. 1 point ≈ 2 hrs. **Capacity = 20 pts, planned to 75% = 15 pts.**

---

### Sprint 1 — Foundation & Data Layer

**Goal:** A running app with the complete database schema, seeded, deployed to staging.

| Priority | Item | Est. |
|---|---|---|
| P0 | Repo, Next.js + TS + Tailwind, design tokens, fonts | 2 |
| P0 | Full `schema.prisma` + initial migration | 3 |
| P0 | Seed script — 4 departments; 10 faculty profiles with varied, deliberately uneven data (empty sections, long names/titles); 1 SUPER_ADMIN; 1 DEPT_ADMIN; 2 PENDING_APPROVAL accounts in different departments | 2 |
| P0 | `docker-compose.yml` mirroring production (app + postgres + redis) | 2 |
| P0 | Droplet provisioned, Caddy + HTTPS, staging subdomain live | 3 |
| P1 | Search vector trigger migration | 1 |
| P1 | CI: lint + typecheck + build on push | 2 |
| **Total** | | **15** |

**Done when:** a seeded staging site loads over HTTPS on the real domain.

---

### Sprint 2 — Authentication

**Goal:** A teacher can sign up, verify, get approved, log in, and reset a password — securely.

| Priority | Item | Est. |
|---|---|---|
| P0 | Emailed one-time codes + own DB-backed session layer (no Auth.js, no passwords) | 3 |
| P0 | Signup with domain restriction + Zod validation (name, email, department) | 2 |
| P0 | Login codes: HMAC at rest, 10-min TTL, single-use, 5-attempt cap | 2 |
| P0 | SES/SMTP integration + SPF/DKIM/DMARC records | 2 |
| P0 | ~~Password reset~~ — removed; no password exists | 0 |
| P0 | Rate limiting (Redis) on code request and code verification | 2 |
| P0 | Route guards in `proxy.ts` (Next 16's renamed middleware) on `/dashboard` and `/admin`, plus the nonce CSP for those routes | 2 |
| **Total** | | **15** |

**Done when:** you cannot break into an account you don't own, and no email lands in spam.

---

### Sprint 3 — Profile Editor

**Goal:** A logged-in teacher can fill in every section of their profile.

| Priority | Item | Est. |
|---|---|---|
| P0 | Dashboard shell + tabbed navigation with animated indicator | 2 |
| P0 | Personal details form + `assertOwnsProfileRow` helper | 2 |
| P0 | R2 upload pipeline — photo crop, sharp re-encode, PDF validation | 3 |
| P0 | Generic repeatable-section CRUD component (reused ×8) | 4 |
| P0 | All eight section editors wired to the generic component | 3 |
| P1 | Drag-to-reorder with optimistic updates | 1 |
| **Total** | | **15** |

**Done when:** a seeded user can fill a 100%-complete profile without touching the DB.

---

### Sprint 4 — Public Site & Admin

**Goal:** Profiles are publicly visible, searchable, and administratively controlled.

| Priority | Item | Est. |
|---|---|---|
| P0 | Public profile page `/faculty/[slug]` — server-rendered | 3 |
| P0 | Directory with pagination + department filter | 3 |
| P0 | Admin approval queue (approve / reject with reason + email) | 3 |
| P0 | Department CRUD | 1 |
| P1 | Full-text search UI | 2 |
| P1 | Draft/publish toggle + preview mode | 2 |
| P1 | Audit log writes on all admin actions | 1 |
| **Total** | | **15** |

**Done when:** an outsider can find a professor by research area in under three clicks.

---

### Sprint 5 — Differentiators, Hardening, Launch

**Goal:** Ship it, with the features that make it better than the reference site.

| Priority | Item | Est. |
|---|---|---|
| P0 | Backup cron → R2 + **tested restore** | 2 |
| P0 | Security headers, CSP, uptime monitoring | 2 |
| P0 | Responsive pass + accessibility audit (WCAG AA) | 2 |
| P0 | Handover doc + admin runbook | 2 |
| P1 | Framer Motion polish — page transitions, stagger, hover states | 2 |
| P2 | DOI import via CrossRef | 2 |
| P2 | JSON-LD + sitemap + SEO | 1 |
| P2 | **Stretch:** ORCID sync | 2 |
| P2 | **Stretch:** PDF CV export | 2 |
| **Total (P0/P1 committed)** | | **13 + stretch** |

**Done when:** production is live on the college domain with real faculty onboarded.

---

## 9. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Students self-register as faculty | Institutional embarrassment; fake profiles live on the college domain | Admin approval gate is P0, non-negotiable |
| College delays buying the domain | Can't configure email DNS, blocks sprint 2 | Start the purchase request in week 1; develop on a temporary domain |
| Faculty never fill their profiles | Project ships empty and looks like a failure | Completeness meter, seeded demo profiles, and a department-wise onboarding drive |
| Scope creep from other departments ("add events too") | Slips past 10 weeks | Non-goals section in §1.3, agreed with your guide in writing |
| Solo developer falls ill / exams | Whole project stalls | 75% capacity planning, stretch items designed to be cut |
| Hosting bill lapses after graduation | Site dies | College owns domain, droplet, and billing from day one |
| Data loss during a migration | Irrecoverable publication histories | Manual dump before every migration; tested restore |

---

## 10. Definition of Done (per feature)

- [ ] Zod validation on all inputs, server-side
- [ ] Ownership check on every mutation, returning 404 for foreign rows
- [ ] Audit log written for admin and destructive actions
- [ ] Works on 360px mobile, tablet, and desktop
- [ ] Keyboard navigable; visible focus states; AA contrast
- [ ] Loading, empty, and error states designed — not just the happy path
- [ ] Manually tested as FACULTY, DEPT_ADMIN, and logged-out
- [ ] Merged to `main`, deployed to staging, verified

---

## 11. Key Dates

| Week | Milestone |
|---|---|
| 0 | Plan signed off by project guide; domain purchase requested |
| 2 | Sprint 1 demo — schema + staging deployment |
| 4 | Sprint 2 demo — full auth flow |
| 6 | Sprint 3 demo — working profile editor |
| 8 | Sprint 4 demo — public site + admin |
| 9 | Restore drill; security review; pilot with 5 real faculty |
| 10 | Production launch + handover |

---

## 12. Immediate Next Steps

1. Get §1.3 (non-goals) and §2 (roles) approved by your project guide **in writing**.
2. Ask the college to start the domain purchase now — DNS propagation and email authentication are on the critical path.
3. Confirm the exact faculty email domain, and whether students share it.
4. Confirm who will act as `SUPER_ADMIN` after you graduate.
5. Begin Sprint 1.
