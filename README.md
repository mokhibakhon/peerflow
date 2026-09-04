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
| `404.html` | Served for any address that is not one of these, with a 404 status. The one dark page on the public site |
| `app.html` | **Sessions** — the signed-in home. Proposals waiting on an answer, what's booked, and the form to propose a time |
| `app-sessions.html` | **Partner** — who you're paired with, and what you have in common |
| `app-people.html` | **People** — everyone signed up, closest match first, with *Send request* |
| `app-profile.html` | Your name, topic, stage, timezone and free times |
| `app-settings.html` | Password, account, sign out |
| `app-badges.html` | What you've done so far |
| `app-progress.html` | **Progress** — the streak ring, the record, and the twelve-week plan |
| `app-chat.html` | Messages with a partner |
| `app-person.html` | One person's profile, as somebody else sees it |
| `app-metrics.html` | **Metrics** — how far people get, for the site owner only. Linked from nowhere: `appshell.js` builds the nav from a fixed tab list, so it does not appear in it, and `funnel_counts()` answers nobody who is not named in `app_admins`. Reach it by typing the address |
| `assets/` | Shared stylesheets and scripts |

`assets/tokens.css` holds every shared value — the ink and green ramps, the
grounds, the corner radii, the type scale, the focus ring. `assets/app.css`
(the signed-in app) and `assets/auth.css` (login, signup, reset, conduct,
not found)
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

### What is actually applied, as of 2026-09-02

Nothing in CI applies `supabase/*.sql`, so "run it by hand" below is a real
instruction and a merged migration is dormant until somebody pastes it. That
makes the run state a fact you cannot read off the code, which is why it is
written here. **Anything added after this date is not covered by this list —
ask the owner rather than assuming.** A migration that has been merged but not
run belongs in the table too, marked as such: the gap between merging and
pasting is exactly where this file stops being able to tell you the truth, and
leaving the row out reads as "no such migration" rather than "not yet run".

| Applied | How it was confirmed |
|---|---|
| `schema.sql`, `migration-mvp.sql`, `migrate-2026-08.sql` | the site works; these predate this list |
| `migration-forgery.sql` | owner ran it and reported the expected `true true false` |
| `migration-actor-rules.sql` | same run, same report |
| `migration-profiles-private.sql` | verified against production: an anonymous `select` on `profiles` with the publishable key returns `[]`, and `rpc/track_counts` still returns per-track rows |
| `migration-blocked-ids.sql` | owner ran it on 2026-09-03 and reported it applied; not independently verified, because the container cannot reach the Supabase host. It is a performance change only: it adds `blocked_ids()` and rewrites the `profiles` SELECT policy to gather the set of blocked accounts once instead of calling `blocked_with(id)` per row — measured at 1999 calls for a 2000-row read against a real PostgreSQL 16 with `track_functions=all`, and 1 call after. `dev/sql-tests.sh` covers it, and the case named "the profiles policy asks about blocks once, not once per row" is the one that goes red without it. The live numbers moved with it and with pg_cron in the same sitting: the slowest query on Today went from 1180ms to 514ms and nothing was left above 514ms, measured in the browser rather than here |
| **`migration-funnel.sql` — NOT applied** | merged 2026-09-01 and never pasted in. Until it is, `funnel_counts()` and `funnel_daily()` do not exist, both readers in `db.js` return null, and `app-metrics.html` shows its owner-only screen to everybody including the owner. That is the designed degraded state rather than a fault, which is why merging it ahead of the migration carried no risk — but the page is inert until somebody runs it. It also needs the one-line `app_admins` insert in its own header, naming the owner by email; the insert is silent when the email matches no row in `auth.users`, so `select count(*) from public.app_admins` is the check that it took |

Also deployed on that date: `supabase functions deploy livekit-webhook`, which
is the version whose `call()` helper throws on a failed RPC instead of
discarding the error.

The container cannot reach the Supabase REST host — the agent proxy 403s it on
CONNECT — so none of this is checkable from a session. The two curls that
confirmed the last row have to be run by the owner; `CLAUDE.md` has them.

- `supabase/schema.sql` ([raw file](https://raw.githubusercontent.com/mokhibakhon/peerflow/main/supabase/schema.sql)) — the only schema file;
  always use the version on `main`. Paste into Supabase → SQL Editor → Run.
  It is the first of three pastes, not the whole story — **SETUP_GUIDE.md has
  the list and the order**. Migration files named below are cited to explain
  what a change does; all fourteen are folded into `migrate-2026-08.sql` and
  open with a SUPERSEDED banner saying not to run them, because
  `create or replace` means an old paste silently wins over a newer one.
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
   The accept notifies the person who asked — a real row in `notifications`,
   so it survives and is emailed — and both sides get a **Plan your first
   session** link. It points at `app.html?plan=<their account id>`, which
   opens the booking form with that person and a suggested hour already in it.
4. On **Sessions**, one of you proposes a time. Nothing is booked until the
   other accepts; they can also decline or suggest another time. Either side
   can cancel a booked session, and the other is told.
5. After a session, **Study again** proposes the next one rather than only
   recording that you would like there to be one: it opens the same form on
   the same partner, at the standing slot if you have one and otherwise the
   next hour you share, skipping anything already on your calendar. It is
   still a proposal — the other person still accepts.
6. If a partnership that was working goes quiet — a real session behind it,
   nothing on either calendar, and **fourteen days** of neither of them
   proposing anything — the dashboard says so once and offers to book the next
   one, with a **Not now** that puts the pair away for three weeks. The person
   who is *not* looking gets the notification, because the person who is
   looking is reading the band. `supabase/migration-dormancy.sql`.
7. **Reschedule** moves a session you had both agreed to, rather than
   cancelling it and hoping somebody books another. It is one
   `SECURITY DEFINER` function and one transaction — both copies of the old
   hour come off, both copies of the new one go on as a proposal — so it
   either happens completely or the original booking is exactly as it was.
   The partner is told once, naming both times, and still has to accept.
   Needs `supabase/migration-reschedule.sql`; until that is run the button is
   not drawn at all rather than drawn and refusing.

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

**Who may move a session, and to where.** `supabase/migration-actor-rules.sql`
— **run it by hand, after migration-forgery.sql.** `sessions_truth_guard` stops
a browser writing status or attendance directly and is well made, but it has a
structural blind spot that is not a flaw in it: the definer RPCs run as the
owner, so the guard waves them through by design, and every rule about *who*
may do *what* has to live inside each RPC. `answer_session` had almost none —
it checked the caller owned a row of the session and nothing else. So the
person who proposed a time could accept it themselves; anyone could pass
`completed`, which the session count and streak read; and anyone could pass
`no_show`, which `reliability_of` reads as a zero on the *other* person's
record. The app has only ever sent `confirmed`, `declined` and `cancelled`, so
dropping the other two costs nothing. `drop_session` now refuses a session both
people agreed to — its own comment always said it was for withdrawing an
unanswered proposal — and `finish_session`, which nothing calls, is revoked.

Run `dev/sql-tests.sh` without that file in its `FILES` list and eight cases
fail; that is the exploit, and it is the reason the file exists.

**Two forgeries, closed.** `supabase/migration-forgery.sql` — **run it by
hand; nothing in CI applies these files, and until it is run both problems
below are live.** `guard_partner_request` stopped the sender answering their
own request but never stopped anybody changing *who the request was from*: the
update policy passes as long as the caller is on one side, and the recipient
always is, so a recipient could accept a request while swapping the sender for
somebody who never asked. The participant columns, the id and `created_at` are
now immutable after insert, for everybody including the definer functions,
because carving out an exception is how this reopens. Riding along is a
one-word bug in `session_for_call`: it repaired a missing room name into a
local variable, wrote it back to the table, and returned the null it had read
beforehand — so the repair worked and Join still said "no room".

`dev/sql-tests.sh` runs the whole schema against a throwaway PostgreSQL 16 and
asserts on it; `PF_WITHOUT_FIX=1 dev/sql-tests.sh` re-runs it against the
schema as it was before that migration, so the cases can be seen to fail.
`node dev/livekit-tests.js` checks the hand-written JWTs in
`supabase/functions/_shared/livekit.ts` against Node's own crypto — a token
signed wrongly there surfaces as "could not join" on somebody's call, which is
a long way from the cause.

`node dev/dormancy-tests.js` covers the band a partnership gets once it has
gone quiet — including the two things that are easy to get wrong and invisible
in the source: that it never reads as an accusation (nobody did anything
wrong), and that opening the app repeatedly does not turn one nudge into fifty.
The rules themselves are in `dev/sql-tests.sh`.

`node dev/reschedule-tests.js` covers the half of moving a session that only
exists on screen: that Reschedule is offered before Cancel and not offered at
all where the migration is missing, that the form says which session it took,
that a refused move leaves the booking untouched, and that the calendar and the
sessions card never disagree about what happened. `dev/sql-tests.sh` has the
primitive itself, including the case that matters most — every refusal rolls
back, so nothing can half-move.

`node dev/retention-tests.js` (with `PF_STUB=1 node dev/serve.js` running)
covers the two places a partnership used to go quiet: accepting a request, and
"Study again" after a session. Both are states one account cannot reach, and
both are the same shape of bug — the database does the right thing and the page
comes back looking identical — so every check is about what is on screen after
the press. The edge cases are most of the file: a second press, a second visit
to the same emailed link, a partnership that has since ended, and an hour that
is already booked all have to end somewhere and none of them may produce a
second session.

`node dev/seo-tests.js` checks the public pages: canonicals, titles and
descriptions and their uniqueness, social metadata, structured data, internal
linking, robots.txt, the sitemap and the IndexNow key file. It also guards
two things that are not SEO but decide whether any of it ships: that
`vercel.json` keeps its build command empty, and that `PF_BUILD` never lands
behind the value on `main` — it went backwards once, when a branch bumped it
blind and wrote an older marker over a newer one, and a marker that names a
build from before the fix is worse than no marker at all. Changing anything
under `assets/` without moving it fails the same check. And it resolves every
`var()` against the stylesheets each page actually links — a custom property
nobody declared does not warn and does not fall back, the whole declaration is
just dropped, which is how the room button asked for a nonexistent `--p7` and
had no hover colour for as long as the room had existed. It derives the list
of public pages by reading the robots meta tag off every page rather than
holding its own copy, because the copy it used to hold went stale — the three
legal pages were never in it, so nothing noticed that they pointed their
canonicals at the bare apex domain while the rest of the site had moved to
`www`, or that they were missing from the sitemap entirely. A new landing page
is covered the moment it is committed.

`node dev/sitemap-build.js` regenerates `sitemap.xml` from those same pages,
with `lastmod` taken from git rather than the filesystem, since a fresh clone
stamps every file with the checkout time. Run it after changing page content;
`dev/seo-tests.js` fails if the committed sitemap no longer matches.

**A wrong address lands on PeerFlow, not on Vercel.** `404.html` at the repo
root is what Vercel serves for any path matching no file and no rewrite, and it
keeps the 404 status — a catch-all rewrite would answer 200 instead, which
makes every mistyped URL an indexable duplicate of the not-found page, so
`dev/seo-tests.js` fails if one is ever added. It keeps the site's nav, prints
the address back so the typo is visible, and offers the page the address looks
like when there is one: `/privacy`, `/frontend` and `/singup` all resolve to a
real page in one click rather than a dead end, which matters more here than on
most sites because URLs carry `.html` and the extensionless form of every page
is a 404.

It is also the one page on the public site with a dark ground, which is a cost
taken deliberately: arriving here changes the colour of the site under somebody
who has just mistyped an address. What it buys is a 404 people do not mind
landing on. The number is 207 cells, 23 by 9, each one the PeerFlow mark painted
as a CSS mask over the cell's own colour — so the graphic is the site's own logo
repeated rather than an illustration to own and redraw. Two earlier versions
filled the cells with characters and neither read as a number: one-cell strokes
cannot be told from the noise around them, and code punctuation
(`{ } < > / ( ) [ ] = + *`) carries such uneven ink that the eye never joins a
row of it into a bar. `node dev/404-field.js` regenerates the markup from a
seeded PRNG — run it if the mark or the digits change, rather than editing 207
elements by hand.

**A typed address works, and the canonical stays where it is.** URLs here carry
`.html`, so `/privacy` was a 404 that the not-found page rescued in one extra
click. `vercel.json` now redirects the bare name of every root page to its file
— 24 of them, generated from the files rather than curated, so a new page cannot
be forgotten. Three are deliberately absent and `dev/seo-tests.js` asserts each
one stays absent: `index.html` is served at `/` and already redirects the other
way, `draft.html` is a rewrite so `/draft` keeps its own address, and
`404.html` must never answer 200 anywhere — a `/404` that served it would be
the soft 404 that page exists to avoid.

The direction matters more than the feature. Vercel's `cleanUrls` would also
308 `/privacy.html` to `/privacy`, which points all 12 canonicals, 11 sitemap
entries and 217 internal links at redirecting URLs — a rewrite of the whole URL
surface that has to land in one commit, not a config flag. Redirecting the other
way costs 24 lines and moves nothing else. `dev/serve.js` reads the redirect and
rewrite tables out of `vercel.json` rather than restating them, so development
cannot route differently from production, and it throws rather than guessing if
a source is ever something other than a literal path.

The eight learning paths also answer to the nickname they already had. Every
landing page links `signup.html?path=frontend`, so `/frontend` redirects to
`frontend-study-partner.html` and the other seven likewise — the alias is read
off the page rather than invented, which is what stops the URL and the signup
form ever meaning different things.

`dev/live-check.sh` asks whether production matches this checkout: the IndexNow
key returns its own key, `PF_BUILD` is the one in your working tree, every URL
in the sitemap answers 200, the typed addresses redirect and — the one that
matters most — the `.html` addresses still answer **directly**. If one of those
ever redirects, the redirects have been pointed the wrong way and the site is
advertising URLs that bounce. It is curl and nothing else, because it has to run
on a laptop: the agent container cannot reach `www.peerflow.dev` at all. Pass an
origin to point it somewhere else — `dev/live-check.sh http://127.0.0.1:9000` is
how the script itself gets tested.

`node dev/notfound-tests.js` (with `node dev/serve.js` running — no `PF_STUB`,
there is no data layer on this page) covers what reads fine in the markup and is
wrong in a browser: that the status is really 404 and not a soft 200; that the
field is 23 columns by 9 rows of square, masked, textless cells, because the ways
a graphic like that breaks are geometric — digits wrapping to a tenth row, or a
mask that never loaded leaving 117 invisible squares — and none of them show in
the DOM; that its links are root-relative, since it is the one page served *at*
whatever address was asked for, so a relative `href` under `/a/b/c` points back
into a directory that does not exist; and that the address it prints, which is
whoever-sent-the-link's text, goes in through `textContent` and stays inert.

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

**`pg_cron` is installed as of 2026-09-03** — `select jobname, schedule from
cron.job` returns `peerflow-attendance` on `*/5 * * * *`. So the second half of
that paragraph is the live arrangement, not the hypothetical one: the browser
still calls all three RPCs on Today, and they now come back in 354-399ms
having found nothing to do, against 1073ms when they were doing the work.

## Counting your own funnel without tracking anybody

There is no analytics on this site and none is being added. `privacy.html`
promises it in unusually plain terms — "not Google Analytics, not a self-hosted
substitute, nothing" — and nothing here weakens it: no script, no beacon, no
page-view, no third party, not one byte of new data collected.

What `app-metrics.html` does is count rows the database already holds and that
`privacy.html` already names as what the platform holds: the account somebody
made, the profile they filled in, the sessions they booked. Reading your own
database is not surveillance, and the difference it makes is between a launch
that teaches you something and a launch that produces a spike nobody can
explain.

It counts **people, not events**, and the reason is structural rather than a
preference. A session is two rows, one per person, so counting rows reports two
people for every meeting between two — and reports two for a proposal nobody
answered exactly as readily as for a session both attended. Counting distinct
`user_id` at each step sidesteps that, and every step is a subset of the one
above it, so the gaps are real drop-off.

`app_admins` has row-level security on and deliberately **no policies at all**,
which is what protects it rather than the revoke beside it: with RLS enabled and
no policy every ordinary caller sees an empty table whatever their grants say,
and Supabase grants on the public schema broadly enough that a revoke alone
would not have been doing the work. There is no "you can see yourself" policy
either, because that answers "am I an admin" for anybody who asks it. The
owner's account id is not in the repository — `supabase/migration-funnel.sql`
carries the one-line insert to run once.

`dev/sql-tests.sh` has nine cases that try to prise it open, and they run under
a harness deliberately more permissive than production: the suite grants
`authenticated` select, insert, update and delete on every table in `public`,
which real Supabase does not. So what they demonstrate is that a member cannot
write themselves into `app_admins` even holding an explicit INSERT grant, cannot
read it holding SELECT, and cannot shadow it with a temp table — `pg_temp` is
searched first for relations whether or not `search_path` names it, and what
defeats that is every table reference in both functions being schema-qualified.

## Two suites that measure rectangles

Some bugs here are invisible in the DOM, and two of them cost real time before
they got suites of their own.

`node dev/nav-tests.js` measures the top bar at twenty widths. `.tabs` is
`overflow-x:auto` with the scrollbar hidden, so when the five tabs are wider
than the room left for them nothing breaks and nothing warns: the markup stays
perfect, every link is present and focusable, and the last tab is cut off
mid-word with no affordance saying it can be scrolled to. Progress was invisible
on any laptop under about 1150px and on a phone, and the only symptom was a
screenshot. A test asserting "five links exist" would have passed throughout. It
also asserts that nothing was lost making things fit, because a nav that fits
because Progress is gone is not fixed and the overflow check alone would call
that a pass.

`node dev/people-tests.js` pins the three answers the People directory can give,
two of which used to look identical. "Nobody else has signed up" and "the
directory could not be read" are different facts, and both figures at the top of
that page said the same thing about each: an em-dash. That is right for the
second and wrong for the first, where the true answer is 1 and 0 — so the first
account on the platform got two dashes above a paragraph telling them they were
first, which is what a broken page looks like. An ordinary directory is pinned
too, so that fixing the empty case by printing zeros unconditionally cannot
pass: that would be the same bug reversed, a failed read claiming the platform
is empty.

`node dev/prerender-tests.js` covers the one thing speculation rules can break.
`assets/appshell.js` asks Chrome to prerender the five nav tabs on hover, so a
click lands on a document that has already fetched its data. That is a good
trade for reads and a bad one for writes, and four things happen on load that
are writes about what a person has looked at: settling finished sessions,
marking partner requests seen, marking a chat thread read, and unlocking a
badge. Hovering People on the way to Chat would otherwise mark that inbox seen.
`pf.whenActive()` in `db.js` holds them until activation, and this suite is the
only thing that says so — every one of those writes is invisible in the
rendered page, so a regression would look exactly like working software. It
also checks the page still renders while prerendering, because a guard that
held the reads back too would make the click no faster and leave the suite
green. Chrome disables prerendering under automation, so no browser in a
container will really prerender at any eagerness; `window.__prerendering` in
`dev/db-stub.js` reaches the same branch deterministically.

`node dev/metrics-tests.js` covers the funnel page on the same principle —
nineteen cases, all geometry, including that a step nobody has reached draws no
bar at all rather than one of width zero. `.fun-bar` carries a `min-width` so
that a step somebody did reach never rounds away, and `min-width` applies just
as happily to a genuine zero; on a platform where nothing has happened yet that
drew seven small bars, a chart reporting activity on a page whose only job is
reporting what there has been.


## Status

Early, and live at [peerflow.dev](https://peerflow.dev). Email and Google
sign-in work, as do password resets. The GitHub button stays hidden until that
OAuth app is configured.

**Notifications leave the building.** A proposal, accept, decline or
cancellation raises a row in `public.notifications`, and the
`dispatch_note_email` trigger hands that row to the `notify-email` edge
function, which sends it through Resend. Confirmed against production on
2026-09-01: the trigger is on the table, and `net._http_response` holds a 200
for the send. What is still missing is listed at the end of `docs/EMAIL.md` —
no reminder mail before a session, and no batching, so four things happening in
one minute send four emails.

This section said the exact opposite — *"nothing notifies anyone by email
yet"* — and went on saying it after the trigger was deployed and working. It is
the failure `CLAUDE.md` spends its longest entry on: a claim about the world
outside the repository cannot be contradicted by anything inside it, so it
stays wrong until a person goes and looks. The dated confirmation above is
there so the next reader knows when somebody last did.

**The video side is deployed, and a real call has connected.** That was the
thing attendance was waiting on: LiveKit's webhook fills `sessions.attended`,
`joined_at` and `left_at`, so `reliability_of()` has something to score.

The instruction that used to stand here — run `supabase/migration-attendance.sql`
— was wrong on its own terms, whatever the video side was doing. That file
carries a SUPERSEDED banner telling you not to run it, because it is folded
into `migrate-2026-08.sql`, which has been applied since before the list above
was written. Running it separately would have been the `create or replace`
hazard that banner exists to prevent: an older paste silently winning over a
newer one.

The reliability score still reads **New partner** for everybody, and that is
the design rather than a fault. It needs three graded outcomes before it shows
a percentage, a session neither person joined is deliberately left ungraded,
and there has not yet been enough real usage to clear either bar. The number
starts moving when people start turning up.
