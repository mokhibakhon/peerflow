# PeerFlow — project map

An exact technical map of the repository as it stands. Nothing was modified to
produce it.

Mapped at commit `6a66159` on `main`. Companion to
`docs/peerflow-current-architecture.md`, which covers the audit findings; this
document covers the structure.

> **Correction to the earlier audit.** `docs/peerflow-current-architecture.md`
> describes `profiles.availability` as `text[]`. It is **`jsonb`**
> (`not null default '[]'::jsonb`). This document is correct; that one was not.

---

## 1. Project tree

```text
/
├── assets/
│   ├── app.css                 signed-in app stylesheet          754 lines
│   ├── appshell.js             signed-in top bar                  75
│   ├── authgate.js             redirect guard for app pages       16
│   ├── badges.js               badge rules + rendering           202
│   ├── db.js                   the entire data layer             703
│   ├── home.css                landing stylesheet                358
│   ├── home.js                 landing pomodoro + path counts     76
│   ├── how-1-find.png          how-it-works step 1 picture
│   ├── how-2-time.png          how-it-works step 2 picture
│   ├── how-3-call.png          how-it-works step 3 picture (photo)
│   ├── how-frames.html         source that renders steps 1 and 2  130
│   ├── logo.svg                UNREFERENCED
│   ├── notify.js               notification bell + panel         228
│   ├── social.png              og:image / twitter:image
│   ├── styles.css              login/signup/reset/conduct        701
│   ├── supabase-config.js      project URL, publishable key       16
│   └── usermenu.js             account chip + dropdown           187
├── docs/
│   ├── peerflow-current-architecture.md
│   └── peerflow-project-map.md          (this file)
├── supabase/
│   └── schema.sql              all tables, RLS, functions        368
├── app-badges.html             Badges                             78
├── app-people.html             People                            326
├── app-profile.html            Profile                           256
├── app-sessions.html           **Partner** (see §3)              185
├── app-settings.html           Settings                          198
├── app.html                    **Sessions**                      959
├── conduct.html                Code of conduct                    86
├── index.html                  Landing                           370
├── login.html                  Log in                            235
├── reset.html                  Password reset                    162
├── signup.html                 Sign up + onboarding              542
├── PEERFLOW_OVERVIEW.md        product strategy (stale)
├── README.md                   repo readme
├── SETUP_GUIDE.md              Supabase / email / DNS setup
└── TESTING.md                  manual two-account test script
```

**8,376 lines total.** No `package.json`, no `vercel.json`, no `netlify.toml`,
no `_headers`, no `_redirects`, no CI config, no lockfile. Deployment is
Vercel's zero-config static import from `main`; there is no deployment file in
the repository at all.

---

## 2. Every file

| File | Purpose | Used by | Dependencies | Supabase access | Change risk |
|---|---|---|---|---|---|
| `index.html` | Landing: hero, how-it-works, eight paths, founder band | public | `home.css`, `db.js`, `home.js`, `usermenu.js` | none directly; `home.js` reads via `pf` | **Low** — self-contained; only `home.css` and the three step PNGs |
| `signup.html` | Two-step signup: account, then topic/level/goal/availability. 385 lines of inline JS | public | `styles.css`, `db.js` | writes `profiles` via `saveProfile`; `auth.signUp` | **Medium** — owns onboarding and the `pf_pending` localStorage contract that `app.html` flushes |
| `login.html` | Email + Google sign-in, forgot-password. 150 lines inline | public | `styles.css`, `db.js` | `auth.signInWithPassword`, `signInWithOAuth`, `resetPasswordForEmail` | **Medium** — holds the `?next=` validation regex |
| `reset.html` | Catches recovery token, polls for session, sets password. 94 lines inline | public (token) | `styles.css`, `db.js` | `auth.updateUser` | **Low** — nothing else links into it except the emailed link |
| `conduct.html` | Code of conduct. No JS at all | public | `styles.css` | none | **Lowest in the repo** — pure static text |
| `app.html` | **Sessions.** Hero, proposals, bookings, propose-a-time sentence, invite. 794 lines of inline JS — the largest file | authed | `app.css`, `db.js`, `authgate.js`, `appshell.js`, `usermenu.js`, `notify.js` | `fetchSessions`, `proposeSession`, `acceptSession`, `declineSession`, `cancelBooked`, `cancelSession`, `acceptedPartners`, `getProfile`, `saveProfile` | **High** — every session mutation lives here |
| `app-sessions.html` | **Partner.** Who you are paired with, what you share. 121 lines inline | authed | `app.css`, `db.js`, `authgate.js`, `appshell.js`, `usermenu.js`, `notify.js` | `acceptedPartners`, `getProfile`, `learnerStats` | **Low** — read-only page |
| `app-people.html` | **People.** Ranked list, ask-to-partner composer. 275 lines inline | authed | same shell set | `fetchPeers`, `myRequests`, `sendPartnerRequest`, `getProfile` | **Medium** — creates partner requests; ranking logic is here |
| `app-profile.html` | Name, topic, level, goal, timezone, availability grid. 146 lines inline | authed | same shell set | `getProfile`, `saveProfile` | **Medium** — writes the availability that People and Sessions both read |
| `app-settings.html` | Change password, account, sign out. 90 lines inline | authed | same shell set | `changePassword`, `getProfile`, `saveProfile` | **Medium** — touches auth |
| `app-badges.html` | Badge wall. Only 14 lines inline — logic is in `badges.js` | authed | same shell set + `badges.js` | `badgeStats` | **Low** — read-only |
| `assets/db.js` | **The entire data layer.** Every query and mutation in the product | all 10 JS-bearing pages, `notify.js` | `supabase-js` (CDN), `supabase-config.js` | all of it | **Highest in the repo** — a change here can break every page |
| `assets/supabase-config.js` | Project URL, publishable key, provider flags | every page that loads `db.js` | none | none | **Medium** — wrong values break the whole app silently |
| `assets/authgate.js` | Redirects signed-out visitors to `login.html?next=…` | the 6 app pages | `db.js` (`pf.currentUser`) | reads session | **High** — 16 lines standing between an app page and an unauthenticated viewer |
| `assets/appshell.js` | Builds the entire signed-in top bar: brand, path chip, three tabs, `.nav-right` mount point | the 6 app pages | `db.js` (`pf.getProfile`, `pf.trackNames`), `app.css` | reads `profiles` via `getProfile` | **High** — the only definition of signed-in navigation; must run before `usermenu.js` and `notify.js` |
| `assets/usermenu.js` | Account chip and dropdown; sign out | the 6 app pages **and** `index.html` | `db.js` (`currentUser`, `signOut`), a `.nav-right` element | reads session | **Medium** — shared across two different navigation systems |
| `assets/notify.js` | Bell, unread count, panel; accept/decline partner requests inline | the 6 app pages | `db.js` (`myRequests`, `fetchSessions`, `respondToRequest`, `markRequestsSeen`), `.nav-right` | reads + writes `partner_requests` | **Medium-High** — mutates requests from a component most people forget is there |
| `assets/badges.js` | Badge rules and rendering; exposes `window.pfBadges` | `app-badges.html` only | `app.css` | none — receives stats as an argument | **Low** — one consumer, pure function of its input |
| `assets/home.js` | Pomodoro clock on the landing hero; fills per-path signup counts | `index.html` only | `db.js` (`currentUser`, `trackCounts`) | reads `profiles` via `trackCounts` | **Low** — decorative plus one count |
| `assets/home.css` | Landing only | `index.html` | — | — | **Low** — one consumer |
| `assets/app.css` | The six signed-in pages | app pages | — | — | **High** — six pages at once; class names are generic (`.opt`, `.pop`, `.row`) and have collided before |
| `assets/styles.css` | Login, signup, reset, conduct | those four | — | — | **Medium** — four pages, including both auth entry points |
| `assets/how-frames.html` | Renders `how-1-find.png` and `how-2-time.png`. Not linked from the site | nothing at runtime | `app.css` | none | **None at runtime** — build-time source for two images |
| `supabase/schema.sql` | Every table, index, policy, trigger and function | applied by hand in the Supabase SQL editor | — | defines all of it | **Highest overall** — production is not verifiably in sync (see §6) |
| `assets/logo.svg` | Unreferenced | nothing | — | — | **None** — dead file |

---

## 3. Every page

### The naming problem, stated plainly

| File | What it actually is | Nav label |
|---|---|---|
| **`app.html`** | **Sessions** — proposals, bookings, propose-a-time | "Sessions" |
| **`app-sessions.html`** | **Partner** — who you're paired with | "Partner" |

`app-sessions.html` is **not** the sessions page. The filename is a leftover
from an earlier structure. Every link in the repo points correctly
(`appshell.js` maps `app-sessions.html → "Partner"`), so nothing is broken —
but the two most likely mistakes in this codebase are editing the wrong one of
these files, and "fixing" a link that was already right.

---

| | `index.html` |
|---|---|
| Access | Public |
| Purpose | Explain the product, drive signup |
| CSS | `home.css` |
| JS | `db.js`, `home.js`, `usermenu.js` |
| Supabase | `profiles` (via `trackCounts`), session read (via `currentUser`) |
| Links to | `signup.html`, `login.html`, `conduct.html`, `#how` |
| Mobile 390 | Hero stacks; nav text links hidden under 520px leaving logo + CTA; how-it-works cards stack one per row at 340px; paths grid 1 column |
| Desktop 1440 | `.wrap` capped at 1320px, 32px gutters; hero 2-col; how-it-works 3-col; paths 4-col |

| | `signup.html` |
|---|---|
| Access | Public |
| Purpose | Create account, then collect topic, level, goal, timezone, availability |
| CSS | `styles.css` |
| JS | `db.js` + 385 lines inline |
| Supabase | `auth.signUp`, `auth.signInWithOAuth`, `profiles` upsert |
| Links to | `login.html`, `index.html` |
| Mobile 390 | Availability grid reflows; step panels full width |
| Desktop 1440 | Centred column, capped |

| | `login.html` |
|---|---|
| Access | Public |
| Purpose | Sign in; request a reset link |
| CSS | `styles.css` |
| JS | `db.js` + 150 lines inline |
| Supabase | `auth.signInWithPassword`, `signInWithOAuth`, `resetPasswordForEmail` |
| Links to | `signup.html`, `index.html`, then `?next=` target or `app.html` |
| Mobile 390 | Single column |
| Desktop 1440 | Centred card |

| | `reset.html` |
|---|---|
| Access | Public, but useless without a recovery token |
| Purpose | Exchange the emailed token for a session, set a new password |
| CSS | `styles.css` |
| JS | `db.js` + 94 lines inline |
| Supabase | `auth.updateUser` |
| Links to | `login.html`, `index.html` |
| Mobile / Desktop | Single centred card at both |

| | `conduct.html` |
|---|---|
| Access | Public |
| Purpose | Code of conduct |
| CSS | `styles.css` |
| JS | **none** |
| Supabase | none |
| Links to | `index.html`, `login.html`, `signup.html` |
| Mobile / Desktop | Single prose column |

| | `app.html` — **Sessions** |
|---|---|
| Access | Authenticated (`authgate.js`) |
| Purpose | See proposals waiting on an answer, see what's booked, propose a time |
| CSS | `app.css` |
| JS | `db.js`, `authgate.js`, `appshell.js`, `usermenu.js`, `notify.js` + **794 lines inline** |
| Supabase | `sessions` (select/insert), `answer_session`, `drop_session`, `profiles`, `partner_requests` (via `acceptedPartners`) |
| Links to | `app-people.html`, `app-profile.html`, `app-sessions.html`, `login.html`, `signup.html`, `conduct.html` |
| Mobile 390 | Hero stacks; cards full width; propose sentence drops to 17px; menus size to `min(320px, 78vw)` |
| Desktop 1440 | `main` capped 1320px; hero 2-col; Sessions card hidden entirely when empty |

| | `app-sessions.html` — **Partner** |
|---|---|
| Access | Authenticated |
| Purpose | Show every accepted partner and what you have in common |
| CSS | `app.css` |
| JS | shell set + 121 lines inline |
| Supabase | `partner_requests` + `profiles` (via `acceptedPartners`), `profiles` (`learnerStats`) |
| Links to | `app.html`, `app-people.html` |
| Mobile 390 | Partner cards single column; green spine narrows to 64px under 560px |
| Desktop 1440 | Cards in a column, full width |

| | `app-people.html` — **People** |
|---|---|
| Access | Authenticated |
| Purpose | Rank everyone by closeness; send a partner request |
| CSS | `app.css` |
| JS | shell set + 275 lines inline |
| Supabase | `profiles` (select all), `partner_requests` (select + insert) |
| Links to | none outbound (nav only) |
| Mobile 390 | Table rows become stacked blocks with the action at the foot |
| Desktop 1440 | Top-pick card, then a 4-column table |

| | `app-profile.html` |
|---|---|
| Access | Authenticated |
| Purpose | Edit name, topic, level, goal, timezone, availability |
| CSS | `app.css` |
| JS | shell set + 146 lines inline |
| Supabase | `profiles` select + upsert |
| Links to | `app-people.html`, `login.html` |
| Mobile 390 | 28-cell availability grid reflows |
| Desktop 1440 | Form column, capped |

| | `app-settings.html` |
|---|---|
| Access | Authenticated |
| Purpose | Change password, account details, sign out |
| CSS | `app.css` |
| JS | shell set + 90 lines inline |
| Supabase | `auth.updateUser`, `profiles` |
| Links to | `app-profile.html`, `login.html` |
| Mobile / Desktop | Single column, capped |

| | `app-badges.html` |
|---|---|
| Access | Authenticated |
| Purpose | Show earned and unearned badges |
| CSS | `app.css` |
| JS | shell set + `badges.js` + 14 lines inline |
| Supabase | `profiles` + `sessions` counts (via `badgeStats`) |
| Links to | `app-profile.html`, `conduct.html`, `login.html` |
| Mobile 390 | Badge grid reflows |
| Desktop 1440 | Grid |

**Verified:** all eleven pages produce no horizontal scroll, no uncaught
exceptions and no console errors at both 390px and 1440px.

---

## 4. Navigation

There are **two entirely separate navigation systems**, plus one shared
component that mounts into both.

### Signed-out, desktop (≥520px)

Markup is **written directly in each HTML file**. There is no shared component.

```
index.html      <nav class="nav">      logo · How it works · Log in · [Find a partner]
conduct.html    <nav class="nav-links"> logo · How it works
login/signup/reset — minimal or no nav, written inline
```

### Signed-out, mobile (<520px)

`home.css` hides the text links, leaving logo and the green CTA:

```css
@media (max-width:520px){ .nav-right a:not(.btn){display:none} }
```

There is **no hamburger and no mobile menu**. "How it works" and "Log in" are
simply unreachable from the landing nav on a phone — Log in is still reachable
from the signup page.

### Signed-in, desktop and mobile

Markup is **generated entirely by `assets/appshell.js`**, which inserts a
`<header class="topbar">` as the first child of `<body>` on all six app pages.

```
[logo peerflow] [path chip] | Sessions · Partner · People | .nav-right ←
                                                              ↑
                            notify.js prepends the bell ──────┤
                            usermenu.js appends the account chip
```

Tabs come from one array in `appshell.js`:

```js
var TABS = [
  { href:'app.html',          label:'Sessions', icon:'sessions' },
  { href:'app-sessions.html', label:'Partner',  icon:'partner'  },
  { href:'app-people.html',   label:'People',   icon:'people'   }
];
```

The current tab is decided by comparing `location.pathname`'s last segment
against `t.href`. On mobile the tab strip becomes horizontally scrollable
(`.tabs{overflow-x:auto}`) and the icons are hidden under 560px; nothing
collapses into a menu. Profile, Settings and Badges are **not** tabs — they are
reachable only from the account dropdown built by `usermenu.js`.

### What must change if labels or destinations change

| Change | Files to edit |
|---|---|
| Signed-in tab label or destination | `assets/appshell.js` **only** (the `TABS` array) |
| Adding a signed-in tab | `assets/appshell.js` + a new `ICON` entry in the same file |
| Account-dropdown items (Profile, Settings, Badges, Sign out) | `assets/usermenu.js` |
| Signed-out nav | **`index.html` and `conduct.html` separately** — there is no shared file |
| Renaming `app-sessions.html` | `appshell.js`, `app.html`, `app-people.html`(nav only), `notify.js` link targets, `README.md`, `TESTING.md`, and a redirect for existing links |
| Bell behaviour or targets | `assets/notify.js` |

---

## 5. JavaScript responsibilities

### `assets/authgate.js` — 16 lines

- **Globals:** none (IIFE)
- **Public functions:** none
- **Listeners:** none
- **DOM expected:** none
- **Supabase:** `pf.currentUser()` (session read)
- **Auth assumption:** the page is for signed-in users only; a null user is
  redirected to `login.html?next=<file>`
- **Loaded on:** the six app pages
- **Note:** guards against a redirect loop by relying on `login.html` only
  redirecting *in* when a session exists

### `assets/appshell.js` — 75 lines

- **Globals:** `LOGO`, `ICON`, `TABS`, `here`, `bar`, `chip`, `track` (all IIFE-scoped)
- **Public functions:** `paintChip(id)` (internal)
- **Listeners:** none
- **DOM expected:** `document.body` (inserts before first child); creates `#pf-pathchip` and `.nav-right`
- **Supabase:** `pf.getProfile()` to resolve the path chip; `pf.trackNames` map
- **Auth assumption:** a signed-in user; renders regardless and fills the chip when the profile arrives
- **Loaded on:** the six app pages
- **Ordering constraint:** **must run before** `usermenu.js` and `notify.js`, which both look for `.nav-right`

### `assets/usermenu.js` — 187 lines

- **Globals:** `wrap`, `btn`, `menu`, `nameEl`, `mailEl`, `TONES`, `ok`
- **Functions:** `build`, `setUser`, `toggle`, `close`, `leave`, `face`, `firstName`, `initial`, `tone`, `esc`
- **Listeners:** 3 × `click` (button, document, menu), 1 × `keydown` (Escape)
- **DOM expected:** `.nav-right`; creates `#nav-av`, `#um-menu`, `#um-name`, `#um-mail`, `#um-face`, `#um-bigface`, `#um-label`, `#um-logout`
- **Supabase:** `pf.currentUser()`, `pf.signOut()`
- **Auth assumption:** hides itself when signed out — which is why it is safe to load on `index.html`
- **Loaded on:** all six app pages **and** `index.html`

### `assets/notify.js` — 228 lines

- **Globals:** `nav`, `wrap`, `bell`, `badge`, `panel`, `list`, `state`
- **Functions:** `unread`, `theirProposals`, `paintBadge`, `paintList`, `itemIncoming`, `itemOutgoing`, `itemProposal`, `whenLabel`, `load`, `esc`, `ago`
- **Listeners:** bell `click`, document `click` (close), document `keydown` (Escape), list `click` (accept/decline delegation), `setInterval` 60s refresh
- **DOM expected:** `.nav-right`; creates `#pf-bell`, `#pf-badge`, `#pf-panel`, `#pf-list`
- **Supabase reads:** `pf.myRequests()`, `pf.fetchSessions()`
- **Supabase writes:** `pf.respondToRequest()`, `pf.markRequestsSeen()`
- **Auth assumption:** hides itself if `pf.currentUser()` is null
- **Loaded on:** the six app pages
- **Note:** this is the **only mutation path outside a page's own inline
  script**, which makes it easy to overlook

### `assets/home.js` — 76 lines

- **Globals:** `el`, `arc`, `TOTAL`, `RING`, `reduced`, `slots`
- **Functions:** `paint`
- **Listeners:** none (uses `setInterval`)
- **DOM expected:** `#pf-count`, `#pf-arc`, `.waiting[data-track]`, `.nav-right a[href="login.html"]`, `.nav-right a[href="signup.html"]`
- **Supabase:** `pf.trackCounts()`, `pf.currentUser()`
- **Auth assumption:** swaps the nav CTAs when a session exists
- **Loaded on:** `index.html` only
- **Fragility:** it selects nav links **by their href**, so changing
  `login.html` or `signup.html` in the landing nav silently breaks the
  signed-in swap

### `assets/badges.js` — 202 lines

- **Globals:** `METAL`, `GLYPH`, `RULES`, `uid`
- **Public:** `window.pfBadges` — `{ evaluate, render }`
- **Listeners:** none
- **DOM expected:** none; returns HTML strings for the caller to mount
- **Supabase:** **none** — pure function of the stats object it is handed
- **Loaded on:** `app-badges.html` only

### `assets/db.js` — 703 lines — the whole data layer

Grouped by responsibility. Every function returns a promise and degrades to
`{demo:true}` or `null` when `client` is null (offline, `file://`, or missing
config).

| Group | Functions | Tables / RPC |
|---|---|---|
| **Infrastructure** | `ready`, `fail`, `currentUid`, `check` | — |
| **Authentication** | `signUpEmail`, `signInEmail`, `signInOAuth`, `currentUser`, `signOut`, `changePassword`, `sendPasswordReset` | `auth.*` |
| **Profile** | `getProfile`, `saveProfile` | `profiles` select / upsert |
| **People discovery** | `fetchPeers`, `learnerStats`, `trackCounts`, `trackNames` | `profiles` select |
| **Partner relationships** | `sendPartnerRequest`, `myRequests`, `respondToRequest`, `markRequestsSeen`, `acceptedPartners` | `partner_requests` select/insert/update, `profiles` select |
| **Session proposals** | `fetchSessions`, `proposeSession` | `sessions` select / insert |
| **Session acceptance & cancellation** | `answer` (private), `acceptSession`, `declineSession`, `cancelBooked`, `cancelSession` | `answer_session`, `drop_session` RPC |
| **Badges** | `badgeStats` | `profiles`, `sessions` counts |
| **Dead** | `joinWaitlist`, `getMatch` | `waitlist`, `matches` — **no callers** |

**Cross-cutting details worth knowing before touching it:**

- `fail(err, msg)` is the single funnel for every database error. It logs the
  real error to the console and returns a fixed sentence. **Any new query must
  go through it** or it will leak schema names to the screen.
- `currentUid()` reads `auth.getSession()` locally rather than
  `auth.getUser()` over the network. This was a deliberate performance fix;
  reverting it reintroduces eight round-trips per page load.
- A cache guard at module top stamps `localStorage.pf_uid` and clears
  `pf_name`, `pf_email`, `pf_track`, `pf_topic`, `pf_pending` when the user id
  changes, so account switching cannot leak the previous person's data.
- `acceptedPartners()` does not query directly — it derives from
  `myRequests()` and synthesises `roomUrl` as
  `https://meet.jit.si/PeerFlow-<requestId>`. **The room URL is not stored
  anywhere**; it is computed from the request id every time.

**Which functions should eventually be separated** (not refactored now):
`auth.js` (7 functions), `profile.js` (2), `people.js` (4),
`partners.js` (5), `sessions.js` (6), `badges-data.js` (1). The seams already
exist — the file is grouped by comment blocks in exactly these divisions.

---

## 6. Data model

### What is present in `supabase/schema.sql`

**`tracks`** — the eight paths
| Column | Type | Notes |
|---|---|---|
| `id` | text | **PK** |
| `name` | text | not null |
| `career` | text | not null |
| `sort` | int | not null default 0 |

**`profiles`** — one per user
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, **FK →** `auth.users(id)` on delete cascade |
| `name` | text | not null default `''` |
| `track_id` | text | **FK →** `tracks(id)` |
| `topic` | text | also re-added by ALTER (harmless duplicate) |
| `level` | text | check in `new, tutorials, builder, jobprep` |
| `goal` | text | check in `job, studies, switch` |
| `timezone` | text | |
| `availability` | **jsonb** | not null default `'[]'::jsonb` — array of `day-band` strings |
| `created_at` | timestamptz | not null default now() |
| `first_name`, `last_name` | text | added by ALTER |

**`partner_requests`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** default `gen_random_uuid()` |
| `from_user` | uuid | not null, **FK →** `auth.users` cascade |
| `to_user` | uuid | not null, **FK →** `auth.users` cascade |
| `message` | text | |
| `status` | text | not null default `pending`, check in `pending, accepted, declined` |
| `to_seen_at`, `from_seen_at` | timestamptz | |
| `created_at` | timestamptz | not null default now() |

Constraints: `no_self_request` check (`from_user <> to_user`), **unique
(`from_user`, `to_user`)**.
Indexes: `partner_requests_to (to_user, status)`, `partner_requests_from (from_user, status)`.

**`sessions`** — **two rows per meeting, one per person**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `user_id` | uuid | not null, **FK →** `auth.users` cascade |
| `partner_name`, `topic` | text | denormalised copies |
| `starts_at` | timestamptz | not null |
| `duration_min` | int | not null default 50 |
| `room_url` | text | |
| `created_at` | timestamptz | not null default now() |
| `status` | text | ALTER; default `confirmed`; check in `proposed, confirmed, declined, cancelled` |
| `proposed_by` | uuid | ALTER; FK → `auth.users` on delete set null |
| `note` | text | ALTER |
| `cancelled_by` | uuid | ALTER; FK → `auth.users` on delete set null |

Indexes: `sessions_user_starts (user_id, starts_at)`, `sessions_user_status (user_id, status)`.
**There is no unique constraint pairing the two rows of a meeting** — they are
matched by `(starts_at, room_url)`, which is what both RPCs key on.

**`waitlist`** (`id`, `email`, `interest`, `created_at`) and **`matches`**
(`user_id` PK/FK, `partner_name`, `partner_topic`, `partner_times`,
`room_url`, `created_at`) — legacy, no live callers.

### Functions

| Function | Signature | Returns | Security |
|---|---|---|---|
| `guard_partner_request()` | — | trigger | `security definer`, `search_path=public` |
| `handle_new_user()` | — | trigger | `security definer`, `search_path=public` |
| `answer_session(p_starts_at timestamptz, p_room text, p_status text)` | | integer (rows moved) | `security definer`, `search_path=public` |
| `drop_session(p_starts_at timestamptz, p_room text)` | | integer | `security definer`, `search_path=public` |

Grants: both RPCs `revoke all … from public, anon` and
`grant execute … to authenticated`.

### Triggers

- `partner_request_guard` — BEFORE UPDATE ON `partner_requests`, FOR EACH ROW
- `on_auth_user_created` — AFTER INSERT ON `auth.users`, FOR EACH ROW → creates the `profiles` row

### RLS policies (all six tables have RLS enabled)

| Policy | Table | Op | Rule |
|---|---|---|---|
| tracks are public | `tracks` | select | `true` |
| profiles are viewable | `profiles` | select | **`true`** — every authenticated user sees every profile |
| insert own profile | `profiles` | insert | `auth.uid() = id` |
| update own profile | `profiles` | update | `auth.uid() = id` |
| anyone can join the waitlist | `waitlist` | insert | `true` |
| read own match | `matches` | select | `auth.uid() = user_id` |
| read own sessions | `sessions` | select | `auth.uid() = user_id` |
| book with your partner | `sessions` | insert | own row **or** an `accepted` `partner_requests` row joining the two users |
| answer a proposal | `sessions` | update | same rule, in both `using` and `with check` |
| cancel a session | `sessions` | delete | same rule |
| read own requests | `partner_requests` | select | `auth.uid()` is `from_user` or `to_user` |
| send requests as yourself | `partner_requests` | insert | `auth.uid() = from_user` |
| answer or mark seen | `partner_requests` | update | `auth.uid()` is either party (narrowed further by the trigger) |

### Which browser functions touch which table

| Table | Read by | Written by |
|---|---|---|
| `profiles` | `getProfile`, `fetchPeers`, `myRequests`, `badgeStats`, `learnerStats`, `trackCounts` | `saveProfile` (upsert) |
| `partner_requests` | `myRequests`, `acceptedPartners` | `sendPartnerRequest`, `respondToRequest`, `markRequestsSeen` |
| `sessions` | `fetchSessions`, `badgeStats` | `proposeSession` (insert); `answer_session` / `drop_session` RPC for all other mutations |
| `tracks` | **nothing** — `trackNames` in `db.js` duplicates it | — |
| `waitlist` | — | `joinWaitlist` (no callers) |
| `matches` | `getMatch` (no callers) | — |

### Repository vs live database — what is and is not verified

| Claim | Status |
|---|---|
| The schema file defines the above | **Verified** — read from `supabase/schema.sql` at this commit |
| The live database matches it | **NOT VERIFIED, and not verifiable from here.** This sandbox cannot reach `ooolpkdqrfhnmcmdqhau.supabase.co`; the network gateway returns `403` to `CONNECT`. |
| Migrations exist | **Verified false** — there is no `supabase/migrations/`, no version table, no `supabase/config.toml` |
| The schema is idempotent | **Verified** — `create table if not exists`, `create or replace function`, `add column if not exists` throughout |

**Do not treat the repository schema as a description of production.** It is a
statement of intent that someone pasted into a SQL editor at an unknown number
of points in time. The only way to know what is live is `supabase db pull`.

---

## 7. User journeys

### Registration

```
signup.html  (step 1 form submit)
  └─ pf.signUpEmail(email, password, name)          assets/db.js:57
       └─ client.auth.signUp                        Supabase Auth
            └─ TRIGGER on_auth_user_created         schema.sql:178
                 └─ handle_new_user()               schema.sql:164
                      └─ INSERT INTO profiles       (id, name)

signup.html  (step 2: topic, level, goal, timezone, availability)
  └─ if a session exists:
       pf.saveProfile({...})                        assets/db.js:222
         └─ UPSERT profiles
  └─ if NOT (email confirmation on, no session yet):
       localStorage.pf_pending = JSON               ← the parked-answers contract

first signed-in load of app.html
  └─ flushPending()                                 app.html inline
       └─ pf.saveProfile(parked answers)
       └─ clears pf_pending

authgate.js on any app page
  └─ pf.currentUser() → null → login.html?next=…
```

**Tables:** `auth.users`, `profiles`. **Risk point:** the `pf_pending` handoff
is a contract between two files that share no code.

### Finding another learner

```
app-people.html  (load)
  └─ pf.getProfile()          → my topic/track/availability
  └─ pf.fetchPeers()          → SELECT * FROM profiles          db.js:602
  └─ pf.myRequests()          → SELECT partner_requests + profiles  db.js:463
  └─ score() / reason() / overlap()   ranking, inline in the page
  └─ render(): top-pick card + table; actionFor() decides
        button "Send request" | chip Asked / Partners / Declined / Waiting on you

  (press Send request)
  └─ composer opens inline
  └─ pf.sendPartnerRequest(uid, message)             db.js:441
       └─ INSERT INTO partner_requests               RLS: from_user = auth.uid()

other user, any app page
  └─ notify.js load() → pf.myRequests()
  └─ bell badge increments; panel shows the request with Accept / Decline
```

**Tables:** `profiles`, `partner_requests`.

> **Note on the brief's wording.** There is no "view profile" step and no
> "propose session" from People. People creates a *partner request*; proposing
> a session is only possible on `app.html` after that request is accepted.

### Accepting a session

```
app.html  (load)
  └─ pf.fetchSessions()                              db.js:301
       └─ SELECT … FROM sessions WHERE user_id = me
       └─ maps mine = proposed_by === uid, cancelledByMe = cancelled_by === uid
  └─ renderProposals() → cards with Accept / Decline / Suggest another time

  (press Accept)
  └─ pf.acceptSession(startsAt, room)                db.js:397
       └─ answer(startsAt, room, 'confirmed')        db.js:374
            └─ client.rpc('answer_session', …)
                 └─ FUNCTION answer_session          schema.sql:286
                      ├─ verifies caller owns a row with that (starts_at, room_url)
                      ├─ UPDATE both rows: status, cancelled_by
                      └─ RETURNS row count
  └─ on success → window.location.href = 'app.html'  (full reload)

other user
  └─ next load of app.html → fetchSessions() → status now 'confirmed' for both
```

**Why the RPC exists:** `read own sessions` limits SELECT to `auth.uid() =
user_id`, and Postgres applies SELECT policies to UPDATE and DELETE. A
browser-side update moved only the caller's row. The `SECURITY DEFINER`
function sees both. **Any new session mutation must go through the same door.**

**Tables/functions:** `sessions`, `answer_session`, `drop_session`.

### Partner relationship

```
partner_requests row reaches status = 'accepted'
  (via notify.js → pf.respondToRequest → UPDATE, guarded by partner_request_guard)

app-sessions.html  (Partner page, load)
  └─ pf.acceptedPartners()                           db.js:525
       └─ pf.myRequests()                            db.js:463
            └─ SELECT partner_requests WHERE from_user = me OR to_user = me
            └─ SELECT profiles for the other side (name, topic, level,
               timezone, availability)
       └─ filter status === 'accepted'
       └─ map → { requestId, profile, roomUrl: 'https://meet.jit.si/PeerFlow-'+id }
  └─ renderPartners(): a card per partner with facts built only from data
     actually present — Free together (overlap of availability), Stage, Timezone

app.html also calls acceptedPartners() to populate the propose-a-time "who with"
```

**Tables:** `partner_requests`, `profiles`. **No `partners` table exists** —
the relationship *is* an accepted request row.

---

## 8. Safe modification boundaries

### Low risk — visual only

| Area | Files | Why it is low risk |
|---|---|---|
| Landing copy and sections | `index.html`, `assets/home.css` | One page, one stylesheet, no other consumer |
| Code of conduct | `conduct.html` | No JavaScript at all |
| Colours and type | the `:root` blocks in each stylesheet | Custom properties; nothing reads them from JS |
| How-it-works pictures | `assets/how-frames.html` → re-render PNGs | Build-time only; nothing loads that file at runtime |
| Badge visuals | `assets/badges.js` (`METAL`, `GLYPH`) | One consumer, no data access |
| Card markup inside a single app page | that page's HTML | **Caveat:** only if you do not touch `app.css` |

### Medium risk — interaction

| Area | Files | Why |
|---|---|---|
| Signed-in navigation | `assets/appshell.js` | One file, but it renders on six pages at once |
| Account dropdown | `assets/usermenu.js` | Loaded on seven pages including the landing |
| Signed-out navigation | `index.html` **and** `conduct.html` | Duplicated; `home.js` selects the CTAs **by href**, so changing a destination silently breaks the signed-in swap |
| Profile editing | `app-profile.html` | Writes availability, which People ranking and Sessions both read |
| Availability display | `app-profile.html`, `app-people.html`, `app.html` | The `day-band` string format is parsed in three places independently |
| Forms | `signup.html`, `login.html`, `app-settings.html` | Hold the `?next=` regex and the `pf_pending` contract |
| **Anything in `app.css`** | `assets/app.css` | Six pages. Class names are generic (`.opt`, `.pop`, `.row`, `.b`) and a bare `.sent` rule has already collided with a dynamically-built `class="pstate " + kind` chip on People |

### High risk — product and data

| Area | Files | Why |
|---|---|---|
| Session mutations | `app.html` inline, `db.js` `answer`/`accept`/`decline`/`cancel*`, `answer_session`, `drop_session` | Two rows must move together. This has broken in production before and fails **silently** — one user sees a cancelled session that the other still has booked |
| Authentication | `db.js` auth group, `authgate.js`, `login.html`, `signup.html`, `reset.html` | 16 lines of `authgate.js` are the only thing between an app page and an unauthenticated viewer |
| RLS policies | `supabase/schema.sql` | There is no server. A wrong policy is a live data breach with nothing in front of it |
| Partner creation | `notify.js`, `db.js` `respondToRequest`, `guard_partner_request` trigger | An accepted request is what authorises every session write for that pair |
| Database functions | `answer_session`, `drop_session` | `SECURITY DEFINER` — they bypass RLS by design and carry their own ownership check |
| Schema changes | `supabase/schema.sql` | Applied by hand, no migrations, no rollback, production state unverifiable |

---

## 9. Recommended approach for the redesign

### Recommendation: **(2) add a lightweight shared-component system — do not introduce a framework.**

Based on what is actually in this repository:

**What argues against staying purely as-is.** There is real duplication, and it
is in navigation and page chrome specifically. The signed-out nav is written
twice (`index.html`, `conduct.html`). The `<head>` block — eleven meta tags,
preconnects, the font preload trick, the favicon data-URI — is copy-pasted
eleven times. The six-script include order is maintained by hand in eleven
files and nothing checks it. Three stylesheets share **14 class names in all
three** and 56 between `app.css` and `styles.css`.

**What argues against a framework.** Nothing in the audit is caused by not
having one. The problems are: no migrations, no headers, no tests, no linter.
A framework fixes none of those and adds a build step, a dependency tree to
patch, and a rewrite of eleven working pages — including `app.html`'s 794
lines of session logic, which is the code least safe to touch and has no tests
to catch a regression. The current deployment has **zero** build risk: the repo
*is* the artifact. That is worth more than it sounds for a solo project.

**What the upcoming work needs.** Onboarding, matching and a pair workspace all
add pages and shared chrome — which is exactly what a component system helps
with — but none of them need reactive state, and the data complexity is six
tables with the interesting logic already in Postgres functions, not in the
client.

**Concretely, "lightweight" means:**

1. **Extend `appshell.js` into `shell.js`** — have it render the `<head>`
   contents, the script includes and the footer as well as the nav. Every page
   becomes markup plus one script tag. This removes the duplication that
   actually exists, in the place it exists, with no build step.
2. **One `tokens.css`** imported by the three stylesheets, holding the colour
   ramp, type scale and spacing. Keep the surface split — it has genuinely
   prevented landing changes from breaking signup — but end the triplication.
3. **Namespace app CSS.** Scope generic class names under a page or component
   id, as `#bk-sent` already does after the `.sent` collision.

If a framework ever becomes right, the trigger will be **client-side state that
outlives a page load** — a live pair workspace with presence, or optimistic UI.
Nothing on the current roadmap requires that yet. Revisit when it does.

---

## 10. Summary

### Five most important architectural observations

1. **A meeting is two rows and nothing in the type system says so.** Every
   mutation must move both, which is why `answer_session` and `drop_session`
   exist. This is the single highest-risk concept in the codebase, it has
   broken before, and it fails silently and asymmetrically.
2. **The repository schema is not a description of production.** No migrations,
   applied by hand, and unverifiable from here. Every other schema statement in
   this document is "what the file says", not "what is live".
3. **All authorization is in the database.** There is no server, so RLS is not
   defence in depth — it *is* the defence.
4. **There are two separate navigation systems**, and only the signed-in one is
   componentised. The signed-out nav is duplicated across two files, and
   `home.js` selects its links by `href`.
5. **`app-sessions.html` is the Partner page.** The two likeliest mistakes in
   this repo are editing the wrong file and "fixing" a link that was correct.

### Safest first implementation task

**Add `vercel.json` with security headers.** It is a new file, it touches no
application code, no page markup and no database, it cannot break a render, and
it closes the widest-open risk in the audit: there are currently no headers at
all while `supabase-js` loads from a CDN and the auth token sits in
localStorage.

**Files it would modify:** `vercel.json` (new) — and nothing else.

Runner-up if you want something visible: **delete the dead code**
(`joinWaitlist`, `getMatch`, `logo.svg`) — provably zero callers, but it does
touch `db.js`, so it ranks second.

### Information still missing before development begins

1. **The live database schema.** `supabase db pull`. Until then no schema work
   is trustworthy and §6 is intent, not fact.
2. **Which RLS policies are actually live**, and whether any were edited in the
   Supabase dashboard without being written back to the file.
3. **Whether Vercel is still deploying** now that the repository is private,
   and which branch/project it is connected to.
4. **Real usage numbers** — how many profiles, requests and sessions exist. The
   People page fetches *every* profile with no pagination, and whether that is
   a problem depends on a number nobody in this repo knows.
5. **Whether email notification is in scope**, since it is the largest gap
   between what the product implies and what it does.
6. **Confirmation of the two-tab caveat** — Supabase sessions live in
   localStorage, so two tabs are one identity. This shapes any multi-user
   feature and any test plan.
