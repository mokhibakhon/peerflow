# PeerFlow

**Pick your career. Find your people. Study together.**

PeerFlow is a peer-learning platform where students learning IT and
cybersecurity pick a career track, get matched with peers at their level and
timezone, and study together in live **Study With Me** sessions.

This repository contains the PeerFlow website and clickable product prototype —
a fully static site with no build step.

## Pages

| File | What it is |
|---|---|
| `index.html` | Landing page (hero, demo video slot, tracks, stories) |
| `how-it-works.html` | The method: 3 steps + session ritual |
| `tracks.html` | All 8 career tracks |
| `sessions.html` | Study With Me formats + session board preview |
| `students.html` | Student stories + code of conduct |
| `signup.html` | 5-step onboarding wizard (simulated Google/GitHub sign-in) |
| `login.html` | Log-in page |
| `app.html` | Logged-in "Today" dashboard (prototype) |
| `app-sessions.html` | Logged-in session board (prototype) |
| `assets/` | Shared stylesheet and scripts |

## Run it locally

No tooling needed — clone and open `index.html` in a browser. Everything is
plain HTML/CSS/JS with zero dependencies.

## Deploy

Import this repo into [Vercel](https://vercel.com) or Netlify as-is (static
site, no build command). See `SETUP_GUIDE.md` for the step-by-step, including
Supabase and OAuth setup for when the prototype becomes dynamic.

## Backend (Supabase)

The site connects to Supabase for real email auth, profiles, and the session
board. Everything degrades gracefully: if Supabase is unreachable (offline,
file://, schema not created yet), pages fall back to demo data automatically.

- `supabase/schema.sql` — paste into Supabase → SQL Editor → Run. Creates
  tables (`tracks`, `profiles`, `sessions`, `session_members`), row-level
  security, a signup trigger, and seeds the 8 tracks plus a week of sessions.
- `assets/supabase-config.js` — project URL + publishable key (public by
  design). Set `realOAuth: true` after configuring Google/GitHub providers
  in Supabase (see `SETUP_GUIDE.md` steps 5–6); until then those buttons run
  a clearly-labelled simulated flow.
- `assets/db.js` — the data layer: auth, profile upsert, session board.

For instant sign-ins during beta, disable "Confirm email" in
Supabase → Authentication → Sign In / Providers → Email.

## Status

Beta scaffolding. Email signup/login and the session board are wired to
Supabase; Google/GitHub sign-in is simulated until OAuth apps are configured;
streaks, squads, and matching are still prototype UI. The product plan, data
model, and roadmap live in `PEERFLOW_OVERVIEW.md`.
