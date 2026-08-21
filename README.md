# PeerFlow

**Learning to code alone is hard. So don't.**

PeerFlow matches one student learning programming with one other student
learning the same thing. You meet one-on-one on video — cameras on, talking —
and learn it together. We're starting with cybersecurity.

This repository contains the PeerFlow website and the signed-in app — a fully
static site with no build step.

## Pages

| File | What it is |
|---|---|
| `index.html` | Landing page (hero, founder's note, how it works, demo slot, what we're starting with, signup) |
| `signup.html` | 2-step signup: create account, then what you're learning + when you're free |
| `login.html` | Log-in page |
| `reset.html` | Catches the password-reset link and sets a new password |
| `conduct.html` | Code of conduct |
| `app.html` | **Sessions** — the signed-in home. Proposals waiting on an answer, what's booked, and the form to propose a time |
| `app-sessions.html` | **Partner** — who you're paired with, and what you have in common |
| `app-people.html` | **People** — everyone signed up, closest match first, with *Send request* |
| `app-profile.html` | Your name, topic, stage, timezone and free times |
| `app-settings.html` | Password, account, sign out |
| `app-badges.html` | What you've done so far |
| `assets/` | Shared stylesheets and scripts |

`assets/tokens.css` holds every shared value — the ink and green ramps, the
grounds, the corner radii, the type scale, the focus ring. `assets/app.css`
(the signed-in app) and `assets/auth.css` (login, signup, reset, conduct)
link it before their own sheet and are layout and components only.

Three radii, and a fourth for glyph-scale graphics: `--r-control` (10px) for
anything you press, `--r-card` (16px) for anything holding content,
`--r-pill`, and `--r-mark` (3px) for legend swatches and sparkline bars,
which a control radius would turn into lozenges. Two primary buttons, on
purpose: dark ink on the signed-out pages, green in the app.

`assets/home.css` (the landing page) is the one surface still outside this.
It carries its own `:root` — its own greens, its own radii, its own focus
ring — so the landing page and the rest of the site are two systems that
happen to look similar rather than one that is shared. Folding it in is a
landing-page redesign, and worth doing as that rather than as a side effect
of a stylesheet change.

## Run it locally

No tooling needed — clone and open `index.html` in a browser. Everything is
plain HTML/CSS/JS with zero dependencies. Opening the files directly (file://)
runs in offline demo mode; the real auth and database need the deployed site.

## Deploy

Import this repo into [Vercel](https://vercel.com) or Netlify as-is (static
site, no build command). See `SETUP_GUIDE.md` for the step-by-step, including
Supabase, email and DNS.

## Backend (Supabase)

Auth, profiles, partner requests and sessions all live in Supabase. Everything
degrades gracefully: if Supabase is unreachable (offline, file://, schema not
created yet), pages fall back to a safe state rather than breaking.

- `supabase/schema.sql` ([raw file](https://raw.githubusercontent.com/mokhibakhon/peerflow/main/supabase/schema.sql)) — the only schema file;
  always use the version on `main`. Paste into Supabase → SQL Editor → Run.
  Creates `tracks`, `profiles`, `partner_requests`, `sessions` (plus the older
  `waitlist` and `matches`, which nothing reads any more), row-level security,
  a signup trigger, and the two functions below.
- `assets/supabase-config.js` — project URL + publishable key (public by
  design). `realOAuth: true` enables real Google sign-in; the GitHub button is
  hidden until that provider is configured.
- `assets/db.js` — the data layer. Every database error goes through one
  function that logs the real error to the console and returns a plain
  sentence, so nothing on screen ever names a table, column or policy.

### Why two SECURITY DEFINER functions

A session is two rows, one per person. Postgres applies `SELECT` policies to
`UPDATE` and `DELETE` as well, so a policy that lets you see only your own row
also silently limits an update to that row — accepting or cancelling moved one
side and left the other showing a session that no longer existed.
`answer_session` and `drop_session` move both rows, after checking that the
caller owns one of them. Both are revoked from `public` and `anon`, granted to
`authenticated`, and pin `search_path`.

For instant sign-ins, disable "Confirm email" in
Supabase → Authentication → Sign In / Providers → Email.

## How pairing works

There is no automatic matching engine, and no hand-editing of tables.

1. **People** ranks everyone by how close they are to what you're learning —
   same topic on the same path first, then the same path, then the same topic
   somewhere else, and hours in common break the ties. Those hours are worked
   out on a real week: everyone's weekly slots are stored in their own local
   time, so they are converted through each side's timezone before being
   compared. Comparing the slots as written makes two people twelve hours
   apart look like a perfect match.
2. You press **Send request** and can add a note. They get it in their bell.
3. They accept, and you're partners. Either of you can have more than one.
4. On **Sessions**, one of you proposes a time. Nothing is booked until the
   other accepts; they can also decline or suggest another time. Either side
   can cancel a booked session, and the other is told.

**The call happens in PeerFlow.** `call.html` is a LiveKit room, one per
booked session, that opens 15 minutes before the start and closes 20 minutes
after the end. Nobody gets in without a signed token, and the only thing that
mints one is the `call-token` edge function — which asks
`session_for_call()` in the database whether the person in front of it is
allowed in: your own booking, both of you agreed to it, it is time, the room
exists, and you are still partners. The browser never says which room it
wants; the room comes out of the booking.

That replaced a link to a public Jitsi address opened in another tab, which
anybody holding the URL could walk into and which PeerFlow could see nothing
about — not who joined, not when, not for how long. LiveKit's webhook now
fills `sessions.attended`, `joined_at` and `left_at`, so attendance is
observed rather than asked about, and `reliability_of()` finally has
something to score.

Setting it up takes a LiveKit project and two `supabase functions deploy`
commands — **[docs/VIDEO.md](docs/VIDEO.md)** has the six steps. Until they
are done, pressing Join says *"Calls are not set up on this site yet"*
rather than failing strangely.

**Nobody can be in two places at once.** An exclusion constraint
(`supabase/migration-no-double-booking.sql`) stops two agreed sessions
overlapping on one person's calendar. That rule used to live only in the
browser, in `clashIn`, which could not see the other person's bookings — RLS
hides them — and lost the race between two devices booking the same minute.
Proposals are deliberately left out of it: two partners may each offer you
Tuesday at three and you pick one, so only *agreed* sessions exclude each
other, and the second acceptance is what gets refused. The same migration
stops the standing weekly slot booking on top of sessions you had already
agreed to, which it had been doing quietly on every page load.

`dev/sql-tests.sh` runs the whole schema against a throwaway PostgreSQL 16 and
asserts on it; `PF_WITHOUT_FIX=1 dev/sql-tests.sh` re-runs it against the
schema as it was before that migration, so the cases can be seen to fail.
`node dev/livekit-tests.js` checks the hand-written JWTs in
`supabase/functions/_shared/livekit.ts` against Node's own crypto — a token
signed wrongly there surfaces as "could not join" on somebody's call, which is
a long way from the cause.

**Standing weekly sessions are joinable.** They were not, ever:
`materialise_standing` gave every occurrence of a weekly slot the same
`room_url` — one per partnership, still in the old `meet.jit.si` shape — and
`session_for_call` only derives a missing room name when at most two rows
share a url, since a room belongs to one booking. Four weeks is eight rows, so
nothing was derived and Join answered *"no room"* every time. It now mints a
room per occurrence and writes `room_name` and `pair_id` at insert, like every
other booking (`supabase/migration-no-jitsi.sql`, which also converts the
existing rows). Nothing in PeerFlow touches Jitsi any more.

Which partnership a session belongs to is `sessions.pair_id`
(`supabase/migration-room-per-session.sql`), so streaks and per-partner
history read a column instead of reading the room. Run that migration
alongside the others; without it the app still works — the insert drops the
column and the partnership is read back out of the older room names — but
new rooms are unindexed and the backfill hasn't run.

## Who turned up

**A study partner who actually shows up** is the promise, so every scheduled
person ends with one of five outcomes on their own half of the session
(`supabase/migration-attendance.sql`):

| | |
|---|---|
| `attended` | they were in the room |
| `cancelled_early` | called off with at least six hours' notice |
| `cancelled_late` | called off inside six hours |
| `no_show` | the room was open, they were not in it, and they said nothing |
| `excused` | nothing was asked of them — the other person called it off first |

Nothing decides an outcome from silence. A session neither of them joined is,
from inside the database, indistinguishable from a site whose LiveKit webhook
was never deployed, so it gets no verdict at all rather than two no-shows.
The case that *is* decided — one turns up and the other does not — is the one
nothing used to catch, because LiveKit only sends `room_finished` once a room
has existed and a room only exists once somebody joins.

The score is the last twenty graded outcomes, each older one counting 0.9 as
much as the one after it, over a prior of two invisible sessions at 85%.
Attending is full credit (0.8 if you came in more than ten minutes late), a
late cancellation 0.4, a no-show nothing. Cancelling early is not graded at
all — it is the behaviour PeerFlow wants, and a system that shaves a point off
it is arguing with itself. Under three graded sessions there is no percentage,
only **New partner**: a new member is not an unreliable one, and a blank
column between two people who have numbers reads as bad news.

Cancelling everything early is therefore not a way to keep a perfect record.
It is not a graded session, so the floor is never reached and the profile
reads "New partner" for as long as that continues.

`assets/reliability.js` is the same policy in the browser — the words, the
six-hour line so the Cancel button can say what it will cost *before* it is
pressed, and a readable copy of the formula. `reliability_of()` in the
database is the authority and always will be, because a score a browser can
compute is a score a browser can edit. The two are pinned to each other:
`dev/reliability-tests.js` and `dev/sql-tests.sh` build the same fixtures and
assert the same percentages, so changing the policy in one file turns both
suites red.

**Nobody writes their own attendance.** `schema.sql`'s "answer a proposal"
policy allows an UPDATE on your own session row, and `attended` is a column on
that row — so anybody who could open a console could mark themselves present
at every session they had ever booked. A trigger now refuses that, and it is
`SECURITY INVOKER` on purpose: a definer trigger runs as its owner whoever
called it, so `current_user` inside one would be the owner for everybody
including the browser it exists to stop.

Three missed sessions inside thirty days pauses **new partner requests** for
seven days, enforced by the insert policy on `partner_requests`. Nothing else
is affected — partners, sessions, messages and history all carry on — and it
lifts on its own.

After a session, Today asks two things and no more: did they show up, and do
you want to carry on. "Yes" can only ever fill an outcome nobody has yet, so
there is nothing to gain by lying. "No" is only acted on when the accuser was
demonstrably in the room and the accused demonstrably was not — you cannot
report an empty room you never entered, and you cannot contradict a join the
server watched happen. Where neither holds, the answer is kept and settles
nothing, and the page says so rather than pretending it landed.

Reminders go at 24 hours, 1 hour and 10 minutes. There is no scheduler behind
a static site, so the sweep runs from whoever opens the app — for both people
in a session, which is what makes it useful: your partner opening PeerFlow at
lunchtime is what reminds you about this evening. With `pg_cron` installed the
migration schedules it properly and the page-load path finds nothing to do.

## Status

Early, and live at [peerflow.dev](https://peerflow.dev). Email and Google
sign-in work, as do password resets. The GitHub button stays hidden until that
OAuth app is configured. Nothing notifies anyone by email yet — proposals,
accepts, cancellations, reminders and missed sessions only show up in the app.

Attendance needs `supabase/migration-attendance.sql` run, and it needs the
video side actually deployed (`docs/VIDEO.md`) to have anything to observe.
Without LiveKit reporting joins, no session is ever settled, the reliability
score stays blank for everybody, and the check-in's "did they show up" can
confirm somebody but never accuse them — which is the correct behaviour with
no evidence, and the reason the number is worth trusting when it does appear.
