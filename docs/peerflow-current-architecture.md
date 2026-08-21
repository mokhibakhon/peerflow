# PeerFlow — current architecture

An audit of the repository as it stands. Nothing here was changed to make the
audit tidier; where something is missing or wrong it is recorded, not fixed.

Audited at commit `a99b4ef` on `main`.

---

## 0. The headline

**There is no framework, no build step, and no package manager.** PeerFlow is
eleven hand-written HTML pages sharing three stylesheets and seven scripts,
served as static files. The brief for this audit asked for "framework and
version", "component library", "server actions" and "type checking" — none of
those exist, and this document says so in each place rather than naming a
plausible-sounding tool.

That is not automatically a problem. The site is live, the pages work, and a
static site has no supply chain and nothing to keep patched. It does mean that
several of the questions below have "not applicable" as their honest answer,
and that the safety net most teams rely on — a compiler, a linter, a test run
— is absent. Section 5 covers what that costs.

---

## 1. Stack

| Question | Answer |
|---|---|
| Framework and version | **None.** No package.json, no bundler, no transpiler. Plain HTML5, CSS and ES5-style browser JavaScript. |
| Routing | **The filesystem.** Every page is a real `.html` file; navigation is ordinary `<a href>`. No client-side router, no history API use, no rewrites. |
| Styling system | **Three hand-written stylesheets**, split by surface, with CSS custom properties for colour and type. No Tailwind, no CSS-in-JS, no preprocessor. |
| Component library | **None.** Three shared scripts inject repeated chrome (`appshell.js`, `usermenu.js`, `notify.js`); everything else is markup written per page. |
| Authentication provider | **Supabase Auth** — email/password plus Google OAuth. GitHub is coded but disabled by config. |
| Database provider | **Supabase (Postgres)**, reached from the browser via `@supabase/supabase-js@2` loaded from jsDelivr. |
| Database schema | One file, `supabase/schema.sql`, applied by hand. See §4. |
| API routes / server actions | **None of the usual kind.** There is no server. The nearest equivalent is two Postgres `SECURITY DEFINER` functions called by RPC (`answer_session`, `drop_session`). |
| State management | **None as a library.** State is module-scoped variables inside each page's IIFE, the DOM itself, and six `localStorage` keys. |
| Analytics | **None.** No gtag, GA, Plausible, PostHog, Sentry or equivalent anywhere in the repo. |
| Tests | **None automated.** `TESTING.md` is a 150-line manual two-account script. No runner, no fixtures, no CI. |

### Third-party origins the browser contacts

```
cdn.jsdelivr.net              supabase-js v2
fonts.googleapis.com          Plus Jakarta Sans
fonts.gstatic.com             font files
ooolpkdqrfhnmcmdqhau.supabase.co   auth + data
cdn.jsdelivr.net              livekit-client (call.html only)
*.livekit.cloud               the call itself, over WebRTC (call.html only)
```

The browser no longer contacts `meet.jit.si` at all. The call used to be a
link to a public Jitsi address opened in another tab; it is a LiveKit room
inside `call.html` now, entered with a token minted by the `call-token` edge
function.

### Stylesheets, by surface

| File | Used by |
|---|---|
| `assets/home.css` | `index.html` only |
| `assets/app.css` | the six signed-in pages |
| `assets/styles.css` | `login`, `signup`, `reset`, `conduct` |

Kept apart deliberately: a change to the landing page cannot break signup.
The cost is three separate definitions of button, card and colour — see §7.

### Scripts, and the order they must load in

```
supabase-js (CDN)  →  supabase-config.js  →  db.js  →  authgate.js  →  appshell.js  →  usermenu.js / notify.js
```

`appshell.js` builds the top bar and must run before `usermenu.js` and
`notify.js`, both of which mount into `.nav-right`. The order is maintained by
hand in eleven files; nothing enforces it.

---

## 2. Where things live

| Responsibility | File |
|---|---|
| Public navigation | `index.html` (inline `<nav class="nav">`); `usermenu.js` adds the account chip when signed in |
| Signed-in navigation | `assets/appshell.js` — renders the whole top bar for all six app pages |
| Landing page | `index.html`, styled by `assets/home.css`, clock by `assets/home.js` |
| Registration and onboarding | `signup.html` — two steps in one file: account, then topic + availability |
| Sessions | `app.html` — proposals, bookings, and the propose-a-time form |
| Partner page | `app-sessions.html` (**note the mismatch — see §6**) |
| People page | `app-people.html` |
| Profile | `app-profile.html` |
| Settings | `app-settings.html` |
| Badges | `app-badges.html` + `assets/badges.js` |
| Authentication | `assets/db.js` (calls) + `assets/authgate.js` (redirect guard) + `assets/supabase-config.js` (keys) |
| Database queries | `assets/db.js` — every query in the product, ~700 lines, one module |
| Notifications | `assets/notify.js` — the bell, its panel, and request accept/decline |
| Schema | `supabase/schema.sql` |
| Step pictures | `assets/how-frames.html` renders `how-1-find.png` and `how-2-time.png` |

---

## 3. Route map

Routes are files. There is no rewrite config, so URLs carry `.html`.

| URL | Auth | Purpose |
|---|---|---|
| `/index.html` | public | Landing |
| `/signup.html` | public | Create account, then onboarding |
| `/login.html` | public | Sign in; honours `?next=` |
| `/reset.html` | recovery token | Set a new password |
| `/conduct.html` | public | Code of conduct |
| `/app.html` | required | **Sessions** — the signed-in home |
| `/app-sessions.html` | required | **Partner** |
| `/app-people.html` | required | **People** |
| `/app-profile.html` | required | **Profile** |
| `/app-settings.html` | required | **Settings** |
| `/app-badges.html` | required | **Badges** |
| `/assets/how-frames.html` | public | Internal: source for two landing images |

Guarding is client-side only. `authgate.js` asks Supabase for the current user
and, if there isn't one, replaces the location with
`login.html?next=<current page>`.

---

## 4. Database

Six tables. Four are live; two are legacy and read by nothing the app calls.

### `profiles` — one row per user, created by trigger on signup
`id` (PK → `auth.users`), `name`, `first_name`, `last_name`, `track_id`,
`topic`, `level`, `goal`, `timezone`, `availability` (jsonb, default `'[]'`),
`created_at`.

`availability` holds slots of the form `day-band`, e.g. `tue-evening`. Four
bands: morning 6–12, afternoon 12–17, evening 17–22, night 22–02. Twenty-eight
possible values.

### `partner_requests` — asking someone to be your partner
`id`, `from_user`, `to_user`, `message`, `status`
(`pending` / `accepted` / `declined`), `to_seen_at`, `from_seen_at`,
`created_at`. Unique on the pair. Two indexes. A `BEFORE UPDATE` trigger
(`guard_partner_request`) constrains who may change what.

### `sessions` — **two rows per meeting, one per person**
`id`, `user_id`, `partner_name`, `topic`, `starts_at`, `duration_min`,
`room_url`, `status` (`proposed`/`confirmed`/`declined`/`cancelled`),
`proposed_by`, `note`, `cancelled_by`, `created_at`.

The two-row shape is the single most important fact about this schema and the
cause of the trickiest bug in the project's history — see §6.

> **Stale from here down for this table.** `sessions` has gained a great deal
> since this section was written — `confirmed_at`, `goal`, `attended`,
> `joined_at`, `left_at`, `room_name`, `pair_id`, `cancelled_at`, and the
> `attendance` / `attendance_source` / `settled_at` trio that carries the
> settled outcome — along with `completed` and `no_show` statuses. The two-row
> shape above is still exactly right and is still the thing to understand
> first; the column list is not. `README.md` is current, and
> `supabase/migration-attendance.sql` carries the reasoning for the attendance
> half. This whole document is a snapshot from before the migrations existed
> and is worth a pass of its own rather than patching section by section.

### `tracks` — the eight paths
Seeded, RLS-readable by anyone. **The client never queries it**; `db.js`
carries a hardcoded `trackNames` map instead. Two sources of truth.

### `waitlist`, `matches` — legacy
Created, RLS'd, and reachable only through `joinWaitlist()` and `getMatch()`
in `db.js`, neither of which is called from any page. Dead.

### Migrations

**There are none.** `supabase/schema.sql` is a single idempotent file
(`create table if not exists`, `create or replace function`,
`add column if not exists`) pasted into the Supabase SQL editor by hand. There
is no `supabase/migrations/`, no version table, and no record of which
environment is at which revision. See §7.

---

## 5. Authentication flow

```
signup.html
  └─ pf.signUpEmail(email, password, name)
       └─ supabase.auth.signUp
            └─ trigger handle_new_user() → inserts profiles row
       └─ step two collects topic + availability → pf.saveProfile()
            (if there is no session yet — email confirmation on — the answers
             are parked in localStorage.pf_pending and flushed on first
             signed-in load by flushPending() in app.html)

login.html
  └─ pf.signInEmail / pf.signInOAuth('google')
       └─ on success → ?next= target, validated, else app.html

any app page
  └─ authgate.js → pf.currentUser()
       └─ null → location.replace('login.html?next=…')

reset.html
  └─ catches the recovery token in the URL fragment
  └─ polls pf.currentUser() 8×200ms for the exchanged session
  └─ strips the token from the address bar
  └─ pf.changePassword(new)
```

**Session storage** is Supabase's default: localStorage, shared across tabs of
the same browser profile. Two tabs are one identity — documented in
`TESTING.md` because it caused real confusion during testing.

**Cache guard.** `db.js` stamps `localStorage.pf_uid` with the signed-in user
id and clears `pf_name`, `pf_email`, `pf_track`, `pf_topic`, `pf_pending` the
moment it changes, so switching accounts cannot leak the previous person's
name into the new session's first paint.

---

## 6. Existing problems

Recorded, not fixed, per the brief.

### P1 — The Partner page lives at `app-sessions.html`
The file named "sessions" is the **Partner** page; the actual Sessions page is
`app.html`. This is a rename that never happened. Every link, the shell nav and
`notify.js` all point correctly, so nothing is broken — but it misleads every
reader, and it is the kind of thing that causes a wrong-file edit.
**Cost to fix:** low. **Risk of leaving:** ongoing confusion.

### P2 — No automated test covers the two-row session logic
Accept, decline, cancel and "suggest another time" each have to move *both*
rows of a meeting. This has broken before (see P3) and can only regress
silently. `TESTING.md` covers it manually, with two accounts, by hand.

### P3 — The bug the schema is shaped around
Postgres applies `SELECT` policies to `UPDATE` and `DELETE`. Because
`read own sessions` limits SELECT to `auth.uid() = user_id`, a browser-side
update touched only the caller's row and left the partner's behind — an
accepted session still showing as proposed for one person, a cancelled one
that never left the other's calendar. Fixed by moving both operations into
`SECURITY DEFINER` functions. **This is working correctly now**; it is
recorded because anyone adding a new session mutation will hit it again unless
they go through the same door.

### P4 — Dead code and dead tables
`joinWaitlist()` and `getMatch()` in `db.js` have no callers. The `waitlist`
and `matches` tables back only those. `tracks` is created and seeded but never
read — `trackNames` in `db.js` duplicates it. `assets/logo.svg` is
unreferenced (pages use an inline data-URI favicon).

### P5 — No email notifications
Proposals, accepts, declines and cancellations appear only in the in-app bell.
Someone who does not open the site does not learn their session was cancelled.
SMTP is configured (Resend, verified on `send.peerflow.dev`) and used for
password resets, so the transport exists — nothing sends product mail.

### P6 — Script order is maintained by hand
Eleven files each list six or seven `<script>` tags in an order that matters.
Adding a page means copying it correctly. Nothing checks.

### P7 — Three stylesheets, three definitions of the same things
`.btn` exists in `home.css`, `app.css` and `styles.css` with different padding,
radius and shadow. The split protects each surface from the others; the cost is
that a brand change is three edits, and they drift.

### P8 — `PEERFLOW_OVERVIEW.md` describes a different product
It talks about "Study With Me sessions" and four launch tracks. It is a
strategy document, not a description of the code, but it is in the repo
alongside accurate docs and will mislead a new reader.

---

## 7. Security

### What is in place, and correct

- **RLS is enabled on all six tables**, with explicit policies per operation.
- **The two RPCs are locked down.** `answer_session` and `drop_session` are
  `revoke all … from public, anon`, `grant execute … to authenticated`, pin
  `set search_path = public`, and each begins by verifying the caller owns a
  copy of that exact meeting before touching either row.
- **Session writes require a real partnership.** Insert, update and delete
  policies on `sessions` each check for an `accepted` row in
  `partner_requests` joining the two users.
- **Database errors never reach the screen.** One `fail()` function in `db.js`
  logs the real Postgres error to the console and returns a fixed sentence, so
  no table, column, constraint or policy name is ever shown to a visitor. This
  was a deliberate response to an error message that named `schema.sql`.
- **Login failure is one message** regardless of cause, and password reset
  gives the same answer whether or not the account exists — neither confirms
  which addresses are registered.
- **`?next=` is validated** against `/^[A-Za-z0-9_.-]+\.html(\?[^#]*)?$/`, so
  it cannot be used for an open redirect to another origin.
- **No secrets in the repo.** Only the Supabase publishable key, which is
  designed to ship to browsers. The Resend API key lives in Supabase's SMTP
  settings and appears nowhere in git.

### Risks

**S1 — All authorization is in the database. There is no server.**
Every rule that matters is an RLS policy or a function guard. That is a
defensible design for this app, but it means one bad policy is a live data
breach with nothing in front of it. The policies should be reviewed by someone
other than their author before the user count grows.

**S2 — `profiles` is world-readable to any authenticated user.**
The `profiles are viewable` policy is what makes the People page work. It also
means any signed-up account can read every user's name, topic, level, timezone
and availability. That is the product working as intended, but it is worth
stating plainly: **availability is a weekly pattern of when a person is at
their computer, and it is visible to every registered user.** Nothing rate-limits
account creation.

**S3 — No Content-Security-Policy, and no security headers at all.**
The site is static on Vercel with no `vercel.json`. There is no CSP, no
`X-Frame-Options`, no `Referrer-Policy`. Scripts load from jsDelivr, so any
compromise of that CDN executes with full access to the Supabase session in
localStorage.

**S4 — The auth token is in localStorage.**
Supabase's default. It is readable by any script that manages to run on the
page, which is what makes S3 matter more than it otherwise would.

**S5 — No rate limiting on partner requests.**
Supabase rate-limits auth endpoints. Nothing limits how many requests one
account can send; the only guard is a unique constraint on the pair.

**S6 — The schema is applied by hand.**
Nobody can prove which policies are live in production. The file in git is the
intent; the database is the truth, and there is no way to diff them.

---

## 8. Technical debt

Ordered by what it costs, not by size.

1. **No migrations.** Schema changes are copy-paste. No rollback, no history,
   no environment parity. Everything else on this list is recoverable; this one
   compounds.
2. **No automated tests.** Eleven pages of browser JavaScript with no runner.
   The riskiest logic in the product (both-rows session mutations) is verified
   by a human with two browser profiles.
3. **No type checking and no linter.** No compiler catches a typo in a property
   name; the failure mode is `undefined` at runtime in a promise, which the
   pages swallow.
4. **No CI.** Nothing runs on push. Deployment is Vercel on `main`, unguarded.
5. **`db.js` is one 700-line module** holding auth, profiles, requests,
   sessions, badges and stats.
6. **Duplicated design tokens** across three stylesheets (P7).
7. **Hand-maintained script order** across eleven pages (P6).
8. **Dead code and tables** (P4).
9. **Naming mismatch** on the Partner page (P1).

---

## 9. Tool runs

Run as requested. Every one of them fails for the same reason: the commands
assume a Node project, and there isn't one.

| Command | Result |
|---|---|
| `npm run build` | **ENOENT — no package.json.** There is no build; the repo *is* the deployable artifact. |
| `npx tsc --noEmit` | Prints its help text. No `tsconfig.json`, no TypeScript in the project. |
| `npx eslint .` | "Oops! Something went wrong" — no ESLint config exists. |
| `npx vitest run` | Refuses to install. No test runner, no tests. |

### What was run instead

Since there is no toolchain, the site was verified by loading every page in
headless Chromium with a stubbed data layer, at both required widths.

**Result: all eleven pages pass at 390px and at 1440px.** No horizontal
scroll, no uncaught exceptions, no console errors, no broken images.

```
index.html             390:ok   1440:ok
signup.html            390:ok   1440:ok
login.html             390:ok   1440:ok
reset.html             390:ok   1440:ok
conduct.html           390:ok   1440:ok
app.html               390:ok   1440:ok
app-sessions.html      390:ok   1440:ok
app-people.html        390:ok   1440:ok
app-profile.html       390:ok   1440:ok
app-settings.html      390:ok   1440:ok
app-badges.html        390:ok   1440:ok
```

Signed-in pages were loaded with a stub standing in for `window.pf`, because
`authgate.js` redirects a signed-out visitor to the login page. The stub
supplies two partners, one proposal and one booked session.

**"Does the build pass" has no yes-or-no answer here.** There is no build. The
static site loads and runs correctly, which is the closest equivalent, and it
does.

---

## 10. Recommended implementation order

Sequenced so each step makes the next one safe. Nothing here has been done.

**Before anything else**

1. **Dump the live schema and commit it.** Until the file in git provably
   matches production, no schema work is trustworthy. `supabase db pull` into
   `supabase/migrations/`, then diff against `schema.sql` and reconcile. This
   unblocks 2 and de-risks every future change.
2. **Add security headers.** A `vercel.json` with CSP, `X-Frame-Options`,
   `Referrer-Policy` and `X-Content-Type-Options`. Cheap, static, and it is the
   only thing standing between a CDN compromise and every user's session. Pin
   the supabase-js version with SRI while you are there.

**Then, the safety net**

3. **Playwright against a Supabase test project**, covering the four session
   mutations from both sides. This is the test that pays for itself: it is the
   logic that has broken before and the only place a silent regression costs a
   user their meeting.
4. **A linter.** ESLint with `eslint:recommended` over `assets/*.js` and the
   inline scripts. No TypeScript migration — the value is catching typos and
   unused bindings, not a rewrite.
5. **CI on push:** lint, then the Playwright run. Vercel already deploys; make
   it deploy only what passed.

**Then, the product debt**

6. **Email notifications** for proposal, accept, decline and cancel. A Supabase
   Edge Function calling Resend. The transport is already configured and
   verified. This is the largest gap between what the product promises and what
   it does.
7. **Delete the dead code:** `joinWaitlist`, `getMatch`, `waitlist`, `matches`,
   `logo.svg`. Decide whether `tracks` becomes the source of truth or goes.
8. **Rename `app-sessions.html` → `app-partner.html`** with redirects. Do it
   after 3 and 5, so the test suite proves nothing broke.

**Only then, structural work**

9. **Split `db.js`** along the seams it already has (auth / profiles /
   requests / sessions / stats).
10. **Unify the design tokens** into one file the three stylesheets import,
    keeping the surface split but ending the triplication.

**Deliberately not recommended:** migrating to a framework. Nothing in this
audit is caused by the absence of one, and the rebuild would put every page at
risk to fix problems that a `vercel.json`, a linter and a test file address
directly.

---

## Appendix — the `pf` API surface

Everything `assets/db.js` exposes. Callers are the eleven pages and
`notify.js` / `badges.js`.

**Auth** `ready` · `signUpEmail` · `signInEmail` · `signInOAuth` ·
`currentUser` · `signOut` · `changePassword` · `sendPasswordReset`

**Profile** `getProfile` · `saveProfile`

**People** `fetchPeers` · `sendPartnerRequest` · `myRequests` ·
`respondToRequest` · `markRequestsSeen` · `acceptedPartners`

**Sessions** `fetchSessions` · `proposeSession` · `acceptSession` ·
`declineSession` · `cancelBooked` · `cancelSession`

**Stats** `badgeStats` · `learnerStats` · `trackCounts` · `trackNames`

**Diagnostics** `check` — console helper; reports whether the RPCs exist

**Dead** `joinWaitlist` · `getMatch`
