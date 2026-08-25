# Sprint Backlog

Work through these in order. Check items off as they merge. One sprint = 2 weeks,
solo developer, ~15 points committed against a 20-point capacity.

Full context in `docs/PROJECT_PLAN.md`. Security rules in `docs/SECURITY.md`.

---

## Sprint 1 — Foundation & Data Layer

**Goal:** A running app with the complete schema, seeded, deployed to staging over HTTPS.

- [ ] `create-next-app` with TypeScript, App Router, Tailwind; `strict: true` in tsconfig
- [ ] `output: 'standalone'` in `next.config.js` + security headers block
- [ ] Design tokens: colour scale, spacing, radii, shadows as CSS variables; dark mode from day one
- [ ] Fonts: display serif + body grotesque via `next/font`
- [ ] shadcn/ui init; install Button, Input, Dialog, Select, Tabs, Toast, Card
- [ ] `lib/db.ts` — Prisma singleton with dev hot-reload guard
- [ ] Apply `prisma/schema.prisma`, run initial migration
- [ ] Apply `prisma/migrations/manual/001_search_vector.sql` as a Prisma migration
- [ ] `prisma/seed.ts` runs clean; `npm run db:seed` wired in package.json — 4 departments,
      10 varied faculty profiles, 1 SUPER_ADMIN, 1 DEPT_ADMIN, 2 PENDING_APPROVAL accounts
      in different departments (see `docs/PROJECT_PLAN.md` §8 Sprint 1)
- [ ] `docker compose up -d` gives working Postgres + Redis + Mailpit locally
- [ ] **DEFERRED — Provision VPS, install Docker, clone repo, `docker-compose.prod.yml` up**
- [ ] **DEFERRED — Caddy serving staging subdomain with valid TLS**
- [ ] Local production-stack verification (replaces the two deferred items above):
      `docker-compose.prod.yml up --build` with all four services, app served through
      Caddy over TLS via its internal CA, `migrate` one-shot applying migrations,
      `/api/health` 200 through the proxy, Redis reachable from the app container
- [ ] `/api/health` returning DB connectivity status
- [ ] GitHub Actions: typecheck + lint + audit + hostname check + build on push

> **Why the two VPS items are deferred.** The domain purchase is postponed until the
> project is otherwise complete, so there is no hostname to point a staging subdomain at
> and no way to obtain a publicly trusted certificate. Provisioning a VPS now would mean
> paying for an idle box and re-doing the TLS step at cutover anyway.
>
> The risk this defers is *deployment risk* — the class of bug that only appears in a
> container: missing runtime dependencies, wrong bind address, absent env, services that
> cannot reach each other. Running the real `docker-compose.prod.yml` locally exercises
> exactly that, because `SITE_ADDRESS` defaults to `localhost` and Caddy falls back to its
> internal CA. What it does **not** cover: public DNS, ACME issuance, SES deliverability,
> and firewall rules. Those move to `docs/CUTOVER.md`.

**Definition of done:** ~~seeded staging site loads over HTTPS on the real domain~~ —
revised: the full production stack builds and serves over TLS locally from
`docker-compose.prod.yml`, with migrations applied by the one-shot container.
The original wording is unreachable until the domain exists; see `docs/CUTOVER.md`.

---

## Sprint 2 — Authentication

**Goal:** A teacher can sign up and sign in with an emailed one-time code, securely.

> **Revised mid-project.** This sprint originally specified passwords with argon2id, a
> reset flow, and account lockout. Authentication is now emailed one-time codes, matching
> how the college builds its other projects. The change DELETED more than it added — the
> password, its hashing, its reset flow, its lockout, and the separate verification screen
> all went. What did NOT change is the session layer.

- [x] Emailed 6-digit login codes — `crypto.randomInt`, 10-minute TTL, single-use
- [x] Codes stored as HMAC-SHA256 keyed with `AUTH_SECRET`, never raw
      (plain SHA-256 of a 6-digit value is reversible in about a second)
- [x] **5 attempts per code, then the code is destroyed.** Counter is a durable column,
      not Redis — a restart must not hand back a fresh budget of guesses
- [x] Issuing a code invalidates any outstanding one for that user
- [x] Database session strategy — `Session` table, SHA-256 token hashing, `__Host-` cookie
      **(unchanged by the auth switch, and deliberately so)**
- [x] `lib/auth/session.ts` — `requireSession()`, `requireRole()`, `getOptionalSession()`
- [x] `lib/auth/ownership.ts` — `assertOwnsProfileRow()`, `canAdminister()`
- [x] Signup: name, email, department. Domain check, Zod validation. **No password**
- [x] `lib/mailer.ts` — nodemailer adapter; login-code, approval, and rejection templates
- [ ] SPF, DKIM, DMARC records published on the college domain **(blocked: no domain yet —
      docs/CUTOVER.md §3. Now MORE urgent: mail is on the critical path for every sign-in)**
- [x] Sign-in with no email enumeration — requesting a code answers identically whether or
      not the account exists
- [x] `lib/rate-limit.ts` — Redis; hard caps on IP, escalating delays on email
- [x] **NO automatic account lockout** — repeated failure is answered with an escalating
      delay with a ceiling. A hard limit keyed on a published email address lets a stranger
      lock out a colleague. `failedAttempts`/`lockedUntil` remain in the schema, unused by
      any access decision. Reasoning: `docs/SECURITY.md` §3, `CLAUDE.md` §3.7
- [x] `proxy.ts` — route guards for `/dashboard` (FACULTY+) and `/admin` (DEPT_ADMIN+).
      Next 16 renamed `middleware.ts` to `proxy.ts`; the export is `proxy`. Do not create a
      `middleware.ts` — it is no longer picked up
- [x] Nonce-based CSP for `/dashboard` and `/admin`, issued from `proxy.ts`
- [x] Auth pages: sign in, code entry, sign up, awaiting approval — designed, not default

**Deleted by the switch to codes:** password hashing and parameters · forgot-password page
and action · reset-password page and action · `PASSWORD_RESET` token type · the
check-your-email holding screen · link-based verification · the dummy-hash timing
equalisation · `User.passwordHash`.

**Definition of done:** you cannot access an account you don't own, and codes arrive.

---

## Sprint 3 — Profile Editor

**Goal:** A logged-in teacher can fill in every section.

- [x] Dashboard layout: sidebar + tabbed nav, `layoutId` animated indicator
- [x] Completeness calculation in `lib/completeness.ts`, recomputed on every save
- [x] Personal details form — Server Action, Zod, field allow-list. ORCID validated by
      CHECK DIGIT, not shape: a mistyped iD that passes a regex points a public page at
      the wrong researcher
- [x] `lib/storage.ts` — R2/S3 adapter: `upload()`, `remove()`, `getPublicUrl()`
- [x] Upload route: magic-byte sniffing, size limits, sharp re-encode, `FileObject` row
- [x] Photo upload with client-side crop (square, 512×512 output). The crop is a
      convenience; sharp enforces the output size server-side regardless
- [x] CV upload (magic-byte sniffed; the literal %PDF- check is unreachable and
      documented as such in `lib/uploads.ts`)
- [x] Research interests tag input — fully keyboard operable, capped at 15
- [x] **Generic `<RepeatableSection>` component** — list, inline add, edit, delete, reorder
- [x] Wire all eight sections through it: Education, Publication, Position, Award, Course, ResearchProject, Guidance, Membership
- [x] Drag-to-reorder with optimistic UI and visible rollback, persisting `sortOrder`;
      arrow-button reorder as the keyboard-accessible primary control
- [x] Every mutation calls `assertOwnsProfileRow` — 32 of them, enforced in CI by
      `npm run check:ownership`
- [x] Loading, empty, and error states for every list

- [x] Draft/publish toggle wired to `assertCanPublishProfile` (moved forward from Sprint 4;
      unpublishing is deliberately NOT gated on account status)

> **`/dashboard/preview` moved to Sprint 4.**
>
> The preview renders the PUBLIC profile from draft data. Building it in Sprint 3 would
> have meant inventing a public profile layout, then rewriting or duplicating it a week
> later when the real one landed — and the copy that fell behind would be the one showing
> faculty what their page "will" look like, which is the one place a divergence is most
> damaging.
>
> It now sits immediately after the public profile in Sprint 4 and reuses the same
> components, so preview and published output cannot drift.

**Definition of done:** a seeded user reaches 100% completeness without touching the DB.

---

## Sprint 4 — Public Site & Admin

**Goal:** Profiles publicly visible, searchable, administratively controlled.

- [x] Sign out — nothing in the UI could end a session; closed via `app/dashboard/actions.ts`
      (`signOutAction`, a plain form action: destroys the Session row, clears the cookie,
      redirects) and `components/dashboard/sign-out-button.tsx`, placed in the sidebar
      HEADER block rather than inside `<DashboardNav>` — that list scrolls horizontally
      below `lg` with no scroll affordance, and burying the one control that ends a session
      in an undiscoverable scroller is how it goes unused.
- [x] Public profile `/faculty/[slug]` — Server Component, full-bleed hero, sticky sub-nav.
      SSG via `generateStaticParams`, `revalidate = 300`, `dynamicParams = true` (a profile
      published between deploys must not 404 — reasoning in the route file). Reachable only
      when `isPublished` AND the owner is ACTIVE; draft, PENDING_APPROVAL and SUSPENDED all
      404 identically, so the response cannot be used to enumerate unpublished accounts.
- [x] Scroll-spy section navigation — the current section is the last one whose top has
      passed its own `scroll-margin-top`. The first implementation used IntersectionObserver
      and highlighted the PREVIOUS item on every click; see the note in
      `components/public/profile-nav.tsx`.
- [x] Directory `/faculty` — responsive grid, pagination, `whileInView` reveal. Dynamic
      (it reads searchParams) and deliberately has NO `loading.tsx`: a Suspense boundary
      streams late content inside a hidden container that only JS can reveal, which broke
      the page entirely with scripts off. See the note in the route file.
- [x] Department filter + designation filter — a real GET form, so both work without
      JavaScript; empty fields are dropped so the shared URL carries only the choice made
- [x] Full-text search against `searchVector` with ranked results, via
      `websearch_to_tsquery` (which cannot throw on user input, unlike `to_tsquery`)
- [x] Department pages `/departments/[slug]` — statically rendered, own title and canonical
      URL rather than a redirect to a filtered query
- [x] Landing page — replaces the Sprint 1 placeholder that still said "authentication
      arrives in Sprint 2"
- [x] Site header and footer on every public route (was logged as a gap)
- [x] Draft vs published: `isPublished` toggle, blocked unless `status === ACTIVE`
      (built in Sprint 3). Publishing and unpublishing now also `revalidatePath` the public
      URL, so taking a page down is immediate rather than waiting out the 300s window.
- [x] `/dashboard/preview` — renders the public page from draft data, reusing the SAME
      components as `/faculty/[slug]` (moved from Sprint 3 — see the note there).
      `npm run verify:preview` diffs the two page bodies section by section; a divergence
      fails rather than being noticed after someone publishes.
- [x] Admin approval queue — `/admin/approvals`: list, approve, reject with a required
      reason (min. 10 characters, emailed verbatim), email on both outcomes
      (`lib/email-templates.ts`'s existing `approvalEmail`/`rejectionEmail`). DEPT_ADMIN
      sees only their department's queue.
- [ ] Admin department CRUD — not built. Was not asked for alongside the other three
      admin screens; departments are currently seeded, not admin-managed.
- [x] Admin faculty list — `/admin/faculty`: search by name/email, filter by status and
      (SUPER_ADMIN only) department, suspend/reactivate. **Role change is SUPER_ADMIN-only,
      not DEPT_ADMIN as originally asked for — a deliberate, documented narrowing.**
      `Role` is the primary privilege axis in this system; a DEPT_ADMIN able to grant
      `SUPER_ADMIN` would bypass the `administersDepartmentId` restriction entirely rather
      than respect it. See docs/SECURITY.md §1.5 for the full reasoning, including the
      department+role scoping that stops a DEPT_ADMIN from acting on another admin whose
      own profile happens to share their department.
- [x] `AuditLog` written on every admin action — `user.approve`, `user.reject`,
      `user.suspend`, `user.reactivate`, `user.role_change`, all carrying a before/after
      diff in `metadata`.
- [x] Audit log viewer — `/admin/logs`, SUPER_ADMIN only: paginated, filterable by action
      type (derived from the real distinct values in the table, not a maintained list) and
      by date range.
- [x] 404 page, designed — `app/(public)/not-found.tsx` (inherits the site header/footer
      from that segment) and `app/not-found.tsx` (root fallback for a URL matching no route
      at all; supplies its own copies of the same header/footer). Shared content in
      `components/public/not-found-content.tsx` so the two can never say different things.
      Includes a search box, not just links out.
- [x] **Sign out.** Was missing from every sprint list (the password-to-OTP migration
      deleted the auth screens that would have carried it) — closed via
      `app/dashboard/actions.ts`'s `signOutAction` and `SignOutButton`, placed in the
      sidebar HEADER rather than inside the horizontally-scrolling mobile nav, so it is
      never one un-hinted swipe away from unreachable.
- [x] **Site header and footer on public pages.** Done with the directory.

> **Verification scripts for this sprint**
>
> - `npm run seed:stress` — the three fixtures the profile layout is designed against: a
>   200-word publication title with an 85-character unbroken token, a profile with sixty
>   publications across twelve years, and a profile with only a name. Plus the three
>   must-not-render cases (draft, pending, suspended).
> - `npm run verify:profile` — geometry in a real browser at 360/768/1440: horizontal
>   overflow, sticky behaviour, scroll-spy, anchor landing, tap-target size.
> - `npm run verify:preview` — preview vs published, section by section.

**Definition of done:** an outsider finds a professor by research area in under three clicks.

---

## Sprint 5 — Differentiators, Hardening, Launch

**Goal:** Ship it.

**Committed:**
- [ ] `deploy/backup.sh` on cron; **run a full restore into a scratch DB and document it**
- [ ] UptimeRobot / BetterStack monitoring `/api/health`, alerting to two addresses
- [ ] CSP tightened and verified with no console violations
- [ ] Responsive pass at 360px / 768px / 1440px
- [ ] Accessibility audit: keyboard nav, focus rings, AA contrast, form labels, axe clean
- [ ] `prefers-reduced-motion` respected across all animations
- [ ] Framer Motion polish: page transitions, hover/tap microinteractions, AnimatePresence exits
- [ ] Security review checklist in `docs/SECURITY.md` §12, all items passed
- [ ] `docs/RUNBOOK.md` — deploy, restore, reset a password, add an admin, rotate secrets
- [ ] Handover: college owns domain, VPS, Cloudflare, R2, and billing

**Stretch (cut these first if time runs out):**
- [ ] DOI import via CrossRef API
- [ ] BibTeX bulk import
- [ ] JSON-LD `schema.org/Person` + sitemap.xml + robots.txt
- [ ] Public read-only JSON API
- [ ] ORCID publication sync
- [ ] PDF CV export from profile data

**Definition of done:** live on the college domain with real faculty onboarded.

---

## Per-feature Definition of Done

Applies to every checkbox above:

- [ ] Zod validation server-side, `.strict()`
- [ ] Ownership check on every mutation, 404 for foreign rows
- [ ] Audit log written where §9 of SECURITY.md requires it
- [ ] Works at 360px, tablet, desktop
- [ ] Keyboard navigable, visible focus, AA contrast
- [ ] Loading / empty / error states present
- [ ] Manually tested as FACULTY, DEPT_ADMIN, and logged-out
- [ ] `npm run typecheck && npm run lint && npm run build` all pass
