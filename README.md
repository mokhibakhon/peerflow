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

Three stylesheets, split by surface: `assets/home.css` (landing),
`assets/app.css` (signed-in app), `assets/styles.css` (login, signup, reset,
conduct).

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
   same topic first, then same path, then how many free windows you share.
2. You press **Send request** and can add a note. They get it in their bell.
3. They accept, and you're partners. Either of you can have more than one.
4. On **Sessions**, one of you proposes a time. Nothing is booked until the
   other accepts; they can also decline or suggest another time. Either side
   can cancel a booked session, and the other is told.

Video calls are Jitsi rooms, one per pair, and the link opens 15 minutes
before the session starts.

## Status

Early, and live at [peerflow.dev](https://peerflow.dev). Email and Google
sign-in work, as do password resets. The GitHub button stays hidden until that
OAuth app is configured. Nothing notifies anyone by email yet — proposals,
accepts and cancellations only show up in the app.
