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
| `conduct.html` | Code of conduct |
| `signup.html` | 2-step signup: create account, then what you're learning + when you're free |
| `login.html` | Log-in page |
| `app.html` | Signed-in "Today" dashboard (match status + optional "improve my match") |
| `app-sessions.html` | "My partner" — your match and the button to start the call |
| `assets/` | Shared stylesheet and scripts |

## Run it locally

No tooling needed — clone and open `index.html` in a browser. Everything is
plain HTML/CSS/JS with zero dependencies. Opening the files directly (file://)
runs in offline demo mode; the real auth and database need the deployed site.

## Deploy

Import this repo into [Vercel](https://vercel.com) or Netlify as-is (static
site, no build command). See `SETUP_GUIDE.md` for the step-by-step, including
Supabase and OAuth setup.

## Backend (Supabase)

The site connects to Supabase for real email/Google auth, profiles, and the
home-page waitlist. Everything degrades gracefully: if Supabase is unreachable
(offline, file://, schema not created yet), pages fall back to a safe state
rather than breaking.

- `supabase/schema.sql` — paste into Supabase → SQL Editor → Run. Creates
  tables (`tracks`, `profiles`, `waitlist`, `matches`), row-level security, and
  a signup trigger, and seeds the cybersecurity track.
- `assets/supabase-config.js` — project URL + publishable key (public by
  design). `realOAuth: true` enables real Google sign-in; the GitHub button is
  hidden until that provider is configured.
- `assets/db.js` — the data layer: auth, profile upsert, waitlist insert, and
  reading your match.

For instant sign-ins, disable "Confirm email" in
Supabase → Authentication → Sign In / Providers → Email.

## Status

Early. Email and Google sign-in are live; the GitHub button is hidden until
that OAuth app is configured. Matching is done by hand for now — there is no
automatic matching engine yet. Until you pair someone, the app shows an honest
"finding your partner" state instead of a fabricated match. To pair two people,
insert a row per person into the `matches` table (each row holds the other
person's name, topic, free times, and a shared `room_url`); they'll then see
their partner and a button to start the call.
