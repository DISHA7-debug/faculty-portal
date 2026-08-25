# Walkthrough — running and looking at the portal

Written to be followed without reading any code. Everything runs locally; nothing is
deployed anywhere.

---

## 1. Cold start

Four commands from the repository root. Each one has to finish before the next.

```bash
docker compose up -d          # postgres, redis, mailpit, minio
npx prisma migrate deploy     # create/patch the database schema
npm run db:seed               # WIPES and reseeds — dev only
npm run dev                   # http://localhost:3000
```

Then, optionally, the layout stress fixtures — three profiles built to break the design
rather than flatter it:

```bash
npm run seed:stress
```

Check the containers came up healthy before going further:

```bash
docker compose ps
```

All four of `postgres`, `redis`, `mailpit`, `minio` should say `Up`. If `postgres` is
missing, it exited — `docker compose up -d postgres` and check `docker compose logs postgres`.

> **Do not source `.env` into your shell before running `npm run build`.** It sets
> `NODE_ENV=development`, which makes the build fail with a stack trace that points nowhere
> near the cause. `docs/RUNBOOK.md` has the details.

### Supporting UIs

| What | URL | Credentials |
|---|---|---|
| The app | http://localhost:3000 | — |
| **Mailpit** — every email the app sends | http://localhost:8025 | none |
| **MinIO console** — uploaded photos and CVs | http://localhost:9001 | `minioadmin` / `minioadmin` |

No mail leaves your machine. Mailpit is a dead-end SMTP sink, and the seeded accounts use
a `.invalid` domain that can never resolve — so a misconfigured run cannot email a stranger.

---

## 2. Signing in — there is no password

The whole login is: type your address, read a 6-digit code out of Mailpit, type it in.

1. Go to **http://localhost:3000/login**
2. Enter `anita.sharma@faculty.example.invalid`
3. Press **Email me a sign-in code**. It pauses for a second or two — that is deliberate,
   not slowness. See the note at the end of this section.
4. Open **http://localhost:8025** in another tab. The newest message is the code.
5. Type the six digits back into the portal.

The code is valid for 10 minutes, works once, and dies after 5 wrong attempts. Requesting a
new code invalidates the previous one, so only ever use the newest message in Mailpit.

> **Why the pause.** The public faculty directory publishes every faculty email address. If
> requesting a code were rate-limited by a hard block, anyone could lock a named colleague
> out of their own account with a script. So it is a *delay* with a ceiling instead. You are
> feeling a security property, not a performance problem.

---

## 3. The seeded accounts

All use the domain `faculty.example.invalid`. Sign in to any of them the same way.

| Email (local part) | Role / state | What it demonstrates |
|---|---|---|
| `anita.sharma` | **FACULTY**, ACTIVE, published | The normal case: a complete profile, 81% completeness, a live public page |
| `deepa.krishnan` | FACULTY, ACTIVE, published | Deliberately has **no awards, no projects, no guidance** — the empty states |
| `suresh.menon` | **DEPT_ADMIN** for CSE, ACTIVE | Administers one department only. His admin *scope* comes from a field only a SUPER_ADMIN can write — not from his own profile, which he can edit |
| `admin` | **SUPER_ADMIN**, ACTIVE | Global authority. His own profile is unpublished |
| `pending.cse` | FACULTY, **PENDING_APPROVAL** | Can sign in and edit everything, cannot publish. Sits in the CSE approval queue |
| `pending.mech` | FACULTY, PENDING_APPROVAL | The same, in the ME queue — so you can see department-scoped admin later |

**Note on the two admin accounts:** the admin *screens* are the remaining half of Sprint 4
and do not exist yet. `suresh.menon` and `admin` currently sign in to the ordinary faculty
dashboard. Their roles are real in the database and enforced by the route guards; there is
just nothing admin-shaped to look at yet.

Plus, if you ran `npm run seed:stress`:

| Slug | What it is |
|---|---|
| `stress-heavy` | 60 publications, a 200-word title, an 85-character unbroken word. Mobile **and** phone |
| `stress-bare` | Only a name. Must look deliberate, not broken |
| `stress-draft`, `stress-pending`, `stress-suspended` | Must all 404 |

---

## 4. Where to go, in order

### Public, signed out

1. **http://localhost:3000/** — landing page. Search box, departments with live counts,
   and a few profiles.
2. **/faculty** — the directory. Search by research area, filter by department or
   designation. Every filter lands in the URL, so a filtered view is shareable. Try
   `machine learning` — results are ranked, with research interests weighted above
   biography text.
3. **/departments/computer-science-engineering** — a department's faculty, on its own URL.
4. **/faculty/anita-sharma** — a public profile. Hero, sticky sub-nav that tracks your
   scroll, contact rail. This is the page the whole project is for.
5. **/faculty/stress-heavy** — the same design under 60 publications and a 200-word title.
   Publications group by year with the year in a left rail. Narrow your window to phone
   width; nothing should scroll sideways.
6. **/faculty/stress-bare** — a profile with only a name. No empty headings, no sub-nav,
   no "none listed" filler.
7. **/faculty/stress-draft** — **404**. It is also absent from the directory and from its
   department's count, which is the same visibility rule applied in one place. So do `stress-pending` and `stress-suspended`. A
   visitor cannot tell an unpublished profile from a nonexistent one, which is the point:
   otherwise the response would confirm which addresses hold hidden profiles.

### Signing in

8. **/login** → **http://localhost:8025** → back to the portal. As above.

### The dashboard, as `anita.sharma`

7. **/dashboard** — completeness, what to improve next, section counts.
8. **/dashboard/profile** — personal details. Worth trying:
   - the **research-interest tags**: type and press Enter or comma; press Backspace on the
     empty field to select the last tag rather than delete it blind; arrow keys move between
     tags
   - the two **visibility toggles**, whose labels say what they do publicly
   - the **ORCID field**: type `0000-0000-0000-0000`. It passes any regex and is rejected
     here, because it is checksum-invalid and resolves to nobody
9. **/dashboard/publications** — press *Add* to open the inline form. All eight section
   editors are the same component; this is what each of them looks like.
10. **/dashboard/positions** — Positions and Memberships as two headed sections on one page.
11. **/dashboard/guidance** — note the per-student **name display** control. Ongoing
    students default to initials on the public page; completed ones to full names.
12. **/dashboard/preview** — your public page rendered from draft data, using the identical
    components. A hidden mobile number stays hidden here too.
13. **/dashboard/publish** — the draft/published toggle.

### The approval gate

14. **Sign out** first (button in the sidebar header, next to "Published"/"Not published"),
    then sign in as **`pending.cse@faculty.example.invalid`**.
15. **/dashboard** — the same shell, with a banner. Everything still saves.
16. **/dashboard/publish** — refused. A college email address plus a working mailbox does
    not prove somebody is staff; students have those too.

### Watching a file land

17. Back as `anita.sharma` (your first window still has that session), go to
    **/dashboard/profile** and upload a photo. Try a wide,
    non-square image — the cropper is keyboard-operable (arrow keys nudge, `+`/`-` zoom) and
    can be skipped entirely.
18. Open **http://localhost:9001**, sign in with `minioadmin` / `minioadmin`, and look in
    the **`faculty-portal-media`** bucket. The object is there as a **512×512 WebP**
    whatever you uploaded, with the original filename gone from the key and any EXIF —
    including the GPS coordinates a phone attaches by default — stripped.
19. Try uploading a PDF as a photo, or renaming a `.php` to `.jpg`. Both are rejected on
    the actual bytes, not the extension.

---

## 5. Screenshots

`docs/screenshots/` has every screen at 1440px and 360px, light and dark, with an index in
`docs/screenshots/README.md`. Regenerate with:

```bash
npm run build && npm start      # in one terminal
npm run screenshots             # in another
```

They are captured against a **production** build on purpose — `next dev` puts a badge in the
corner of every page, which is not part of the design.
