# PeerFlow — Platform Overview

> **PeerFlow** is a peer-learning platform where students studying IT and cybersecurity
> pick their future career path, get matched with peers on the same path, and learn
> together in live "Study With Me" sessions.

---

## 1. The Problem

Students learning IT skills (JavaScript, Python, cybersecurity, etc.) mostly study alone:

- **Isolation kills motivation.** Online courses have completion rates below 15%, and the
  single biggest predictor of dropping out is studying without accountability.
- **No sense of direction.** Beginners don't know *what* to learn for a specific career —
  a future pentester and a future frontend developer need completely different roadmaps,
  but most platforms treat everyone the same.
- **Finding study partners is luck.** Discord servers and Telegram groups are noisy and
  unstructured; there's no reliable way to find peers at *your* level, on *your* path,
  in *your* time zone.

## 2. The Solution

PeerFlow connects the three missing pieces:

1. **Career-first onboarding** — students select a target career (e.g., Frontend Developer,
   Backend Developer, Security Analyst / Pentester, Data Analyst), and the platform frames
   everything around that goal.
2. **Peer matching** — students are matched with others on the same career track, at a
   similar skill level, with compatible schedules.
3. **Study With Me sessions** — scheduled, focused co-study sessions (solo-work-together
   or collaborative), giving structure and accountability to self-study.

**One-line pitch:** *"Pick your career. Find your people. Study together."*

## 3. Target Users

| Segment | Description | Primary need |
|---|---|---|
| University students | Studying CS/IT, supplementing coursework | Structure + peers beyond their campus |
| Career switchers | Self-taught learners moving into tech | Roadmap + accountability |
| Cybersecurity learners | CTF players, cert-chasers (Security+, OSCP prep) | Practice partners, study groups |
| Bootcamp students | Between-cohort or post-bootcamp learners | Keep momentum after the program ends |

## 4. Core Concepts

### Career Tracks
A **track** is a curated career path a student commits to. Launch tracks:

- **Frontend Development** (JavaScript, HTML/CSS, React)
- **Backend Development** (Python or Node.js, databases, APIs)
- **Cybersecurity** (networking, Linux, security fundamentals, CTF practice)
- **Data / Analytics** (Python, SQL, data wrangling, visualization)

Each track defines the topics students on it study, which powers matching and session
discovery. Tracks are content-light at MVP — they are a *matching taxonomy first*,
a curriculum second.

### Peer Matching
Matching is based on:

- **Track** (same career goal)
- **Level** (self-assessed at signup: beginner / intermediate / advanced, refined over time)
- **Availability** (weekly schedule grid + time zone)
- **Language / region** (optional filter)

Output: suggested study partners and suggested groups (3–6 people), not just 1-to-1.
Small groups survive individual dropout much better than pairs.

### Study With Me Sessions
The core activity loop. A session has:

- **Type:** silent co-work (Pomodoro-style, cameras optional) or collaborative
  (pair programming, CTF walkthrough, mock interview, topic discussion)
- **Track + topic tag** (e.g., `cybersecurity / linux-basics`)
- **Schedule:** one-off or recurring
- **Capacity:** typically 2–8 participants
- **Structure:** built-in timer (e.g., 50 min focus / 10 min break), a shared session
  goal each participant declares at the start, and a quick check-out at the end
  ("did you finish what you planned?")

Sessions can be created by any user; the platform also auto-suggests sessions to fill
("3 peers on your track are free Tuesday 18:00 — start a session?").

## 5. User Journey (MVP)

1. **Sign up** → pick a career track → self-assess level → set weekly availability.
2. **Get matched** → see suggested peers and open sessions on your track.
3. **Join or create** a Study With Me session.
4. **Attend** → declare a goal → focus timer → check out with a result.
5. **Build streaks** → session history, hours studied, streak counter on profile.
6. **Form a squad** → recurring group with the same peers becomes a persistent study group.

The retention engine is step 6: converting one-off sessions into recurring squads.

## 6. Feature Scope

### MVP (validate the core loop)
- Auth + profile (track, level, availability, time zone)
- Track selection (4 launch tracks)
- Session board: browse / filter / create / join sessions
- Session room: video (or start with third-party links — Google Meet/Jitsi — to ship faster),
  shared timer, goal declaration, check-out
- Basic peer suggestions ("people on your track, free when you're free")
- Session history + streaks

### V2 (deepen engagement)
- Persistent study squads with group chat
- Smarter matching (level inferred from activity, not just self-report)
- Track roadmaps with milestones ("finish JS basics → build 3 projects → …")
- Gamification: badges, weekly leaderboards per track
- CTF / challenge integration for the cybersecurity track
- Mobile app

### Later
- Mentor layer (advanced students / professionals host sessions)
- Company / university partnerships
- Certificates of consistency (verified study hours) for CVs

### Explicitly *not* building at MVP
- Our own course content (link out to freeCodeCamp, TryHackMe, CS50, etc.)
- Our own video infrastructure (embed or link out first)
- Payments (validate engagement before monetizing)

## 7. Suggested Tech Stack

Optimized for a small student team shipping fast:

| Layer | Suggestion | Why |
|---|---|---|
| Frontend | React (or Next.js) + Tailwind | Huge ecosystem; also what many of your users are learning |
| Backend | Node.js/Express **or** Python/FastAPI | Pick whichever the team knows best — both fit |
| Database | PostgreSQL (via Supabase to start) | Supabase gives auth + realtime + DB in one, massively cuts MVP time |
| Realtime / presence | Supabase Realtime or Socket.IO | Session rooms, "who's online" |
| Video | Jitsi embed or Meet links at MVP; Daily.co/LiveKit later | Don't build video yourself |
| Hosting | Vercel (frontend) + Supabase/Railway (backend) | Free tiers cover MVP |

## 8. Data Model Sketch

```
User        (id, name, email, timezone, language, level, track_id, availability_json)
Track       (id, name, description, topic_tags[])
Session     (id, track_id, topic_tag, type, starts_at, duration, capacity,
             recurring_rule, host_user_id, video_url, status)
SessionMember (session_id, user_id, goal_text, goal_completed, joined_at)
Squad       (id, track_id, name, created_at)          -- V2
SquadMember (squad_id, user_id, role)                  -- V2
Streak/Stats derived from SessionMember history
```

## 9. Success Metrics

- **Activation:** % of signups who attend ≥1 session in their first week
- **Core retention:** % of users attending ≥2 sessions/week after 4 weeks
- **Squad formation:** % of users in a recurring group by week 4 (leading retention indicator)
- **Session fill rate:** % of created sessions that actually run with ≥2 attendees
- **North star:** weekly co-study hours per active user

## 10. Risks & Open Questions

- **Cold start:** matching needs density. Mitigation: launch one track (or one university /
  one community) at a time rather than all four everywhere; seed sessions yourselves daily
  for the first weeks.
- **No-shows:** empty sessions destroy trust fast. Mitigation: reminders, small capacity,
  visible reliability score ("attends 90% of joined sessions").
- **Level mismatch:** a beginner paired with an advanced student frustrates both.
  Mitigation: level filters at MVP, inferred levels later.
- **Moderation & safety:** live video with strangers needs report/block tooling from day one,
  and clear community guidelines.
- **Open question:** is the wedge silent co-working (broad appeal, low effort) or
  collaborative sessions (higher value, harder to run)? Worth A/B testing early —
  the cybersecurity track in particular may pull toward collaborative CTF-style sessions.

## 11. Suggested Next Steps

1. Pick **one** launch track and **one** seed community (e.g., your own university's
   cybersecurity club) to solve the cold-start problem.
2. Run 2–3 weeks of *manual* PeerFlow: match people in a spreadsheet, schedule sessions
   via Meet links, observe what works — before writing much code.
3. Build the MVP session board + profiles on Supabase; reuse learnings from the manual phase.
4. Define the activation metric dashboard from day one so you know if the loop works.
