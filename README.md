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

## Status

Prototype. Sign-in flows are simulated (clearly labelled, no real accounts,
no passwords collected), session data is hardcoded, and onboarding state lives
in `localStorage`. The product plan, data model, and roadmap live in
`PEERFLOW_OVERVIEW.md`.
