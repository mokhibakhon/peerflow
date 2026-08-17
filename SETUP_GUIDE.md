# PeerFlow — Account Setup Guide

Do these in order. Steps 1–3 now; step 4 is optional; steps 5–6 only when the
backend is being built.

**Golden rule:** the only values you ever paste into chat are the Supabase
*Project URL* and *anon public key*. Every other secret stays inside the
dashboards where it belongs.

---

## The migrations, in one paste

**Run `supabase/schema.sql`, then `supabase/migration-mvp.sql`, then
`supabase/migrate-2026-08.sql`.** That is all three, in that order, and the
third one now contains every migration written since: goal, plan, reliability,
room-per-session, video, standing and chat.

Each is additive and safe to run more than once, so re-running the whole set
after any change is the reliable move rather than trying to remember which
ones landed.

The sections below describe the individual files and what each one switches
on. They are still the source of truth for what a migration does — but you do
not have to run them one at a time.

**Skipping one does not fail loudly.** The data layer falls back to whatever
columns exist, so the page keeps working and the only sign is a red request in
the browser console. A missing `migration-standing.sql`, for instance, makes
every page load 400 on `partner_requests` while the dashboard carries on
working — which looks far more broken than it is.

---

## Database migration — required for the Progress page

`supabase/migration-mvp.sql` adds the columns and tables the Progress page
reads: `profiles.stage_index` for the twelve-week marker, and the
`achievements` and `notifications` tables so a badge is announced once rather
than on every page load. It also adds attendance columns to `sessions`, which
is where the attendance percentage comes from.

1. Supabase → **SQL Editor** → paste the whole of `supabase/migration-mvp.sql`
2. **Run**

It is additive and safe to run more than once. It does not drop or rewrite
anything created by `schema.sql`, and `answer_session` / `drop_session` keep
the behaviour they already had.

Without it, Progress still loads — hours, sessions and streaks are counted
from session rows — but attendance shows as a dash, the week marker will not
save, and achievements are recomputed silently each time. The data layer
detects the missing columns and logs a console warning rather than breaking.

---

## Database migration — required for standing weekly slots

`supabase/migration-standing.sql` adds the columns and functions behind the
**Standing slot** card on Today: agree one hour a week with your partner and
the next four weeks book themselves, instead of proposing and accepting a time
every single week.

1. Supabase → **SQL Editor** → paste the whole of `supabase/migration-standing.sql`
2. **Run**

Additive and safe to run more than once. Run it after `schema.sql`; it does not
depend on `migration-mvp.sql` and the two can be run in either order.

It stores the slot on the partnership row rather than in a table of its own, so
both people can already read it and ending a partnership takes its slot with
it. It also adds a unique index on `sessions (user_id, starts_at, room_url)` —
occurrences are created on page load, so two tabs opening at once would
otherwise book the same hour twice. Any pre-existing duplicate rows are the
same booking counted twice and are collapsed to one before the index is built.

There is no scheduler: a static site has nowhere to run one and Supabase's free
tier has no cron, so occurrences appear when somebody opens the app. Nobody
has looked at a booking before that anyway.

Without it, everything else works and the Standing slot card simply does not
appear. The data layer notices the missing columns and functions, logs a
console warning, and falls back to the older shape.

Verified against PostgreSQL 16: both files apply cleanly twice on a fresh
database.

---

## Database migration — required for chat

`supabase/migration-chat.sql` adds the `messages` table behind the **Chat**
tab.

1. Supabase → **SQL Editor** → paste the whole of `supabase/migration-chat.sql`
2. **Run**

Additive and safe to run more than once. Independent of the other two.

**Who may message whom is enforced in the database, not the page.** The insert
policy requires a partner request between the two of you in some direction —
you asked them, or they asked you. That is the consent gate the product
already has, so nothing new is being trusted, and a stranger cannot arrive in
somebody's inbox uninvited. Widening it later is one line in one policy.

Messages cannot be edited or deleted by anyone, including their author: there
is no UPDATE or DELETE policy. Marking a thread read goes through
`mark_thread_read`, because a policy wide enough to set `read_at` would also
be wide enough to rewrite what somebody said.

Without it, the Chat tab says messaging isn't switched on and every other page
is unaffected.

---

## Database migration — required for the call

`supabase/migration-video.sql` adds `sessions.room_name` and
`sessions.left_at`, and the three functions behind the room:
`session_for_call` (who may join, and why not), `record_presence` (the
webhook writing attendance) and `close_room`.

1. Supabase → **SQL Editor** → paste the whole of `supabase/migration-video.sql`
2. **Run**

Additive and safe to run more than once. Run it after `migration-mvp.sql`,
`migration-reliability.sql` and `migration-room-per-session.sql`.

**The migration on its own is not enough** — the room also needs a LiveKit
project and two edge functions deployed. That is four more steps, and they
are written out in **[docs/VIDEO.md](docs/VIDEO.md)**.

Until all of it is done, pressing **Join** says *"Calls are not set up on
this site yet"*. Nothing else on any page is affected.

Verified against PostgreSQL 16: applies cleanly twice on a fresh database,
and the 27 checks covering every refusal pass.

## 1. GitHub repository (2 min) — the prerequisite for everything

1. Go to **github.com/new**
2. Repository name: `peerflow`
3. Public or Private — your choice (Private is fine; Vercel can still deploy it)
4. Click **Create repository** — leave it empty, no README needed
5. Then tell Claude: **"add mokhibakhon/peerflow"** — the site gets pushed for you

## 2. Supabase — database + auth (5 min)

1. Go to **supabase.com** → **Start your project** → sign in **with GitHub**
2. **New project**:
   - Name: `peerflow`
   - Database password: click **Generate a password** and save it in a password
     manager. You'll almost never need it. **Never paste it into chat.**
   - Region: closest to your users (e.g. Frankfurt for Central Asia/Europe)
   - Plan: **Free**
3. Wait ~2 minutes while it provisions.
4. Go to **Settings → API** and copy exactly two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — the long string labelled `anon` `public`
5. Send those two to Claude. (They are designed to be public — they ship in
   every visitor's browser. The `service_role` key on the same page is NOT —
   never share that one.)

## 3. Vercel — hosting with auto-deploy (5 min)

1. Go to **vercel.com** → **Sign up** → **Continue with GitHub**
2. **Add New… → Project**
3. Find `peerflow` in your repository list → **Import**
4. Touch nothing (defaults are fine for a static site) → **Deploy**
5. ~30 seconds later you have `https://peerflow-<something>.vercel.app`

From now on, every push to the repo redeploys the site automatically.
No tokens to share — the GitHub connection does everything.

## 4. Domain (optional, ~$10/year)

1. Buy one at **Namecheap** or **Porkbun** (e.g. `peerflow.app`, `peerflow.dev`,
   or a local `.uz`)
2. In Vercel: your project → **Settings → Domains** → **Add** → type the domain
3. Vercel shows you 1–2 DNS records (an `A` record `76.76.21.21` and/or a
   `CNAME` to `cname.vercel-dns.com`)
4. In your registrar's DNS panel, add exactly those records
5. Wait 10 min – 24 h for DNS to propagate. Done — HTTPS is automatic.

Never share your registrar login with anyone.

## 5. Google OAuth app (do when the backend exists)

Makes "Continue with Google" real. Needs step 2 finished first.

1. Go to **console.cloud.google.com** → project dropdown → **New project** →
   name `PeerFlow`
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name `PeerFlow`, your email for both contact fields → Save through
     the remaining screens (no scopes to add manually)
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID**:
   - Application type: **Web application**, name `PeerFlow Web`
   - **Authorised redirect URIs** → Add:
     `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
     (replace with your real Supabase project URL from step 2)
   - Create → you get a **Client ID** and a **Client secret**
4. Open **Supabase → Authentication → Providers → Google** → toggle ON →
   paste Client ID and Client secret there → Save.
   **The secret goes only into that Supabase field — nowhere else, ever.**

## 6. GitHub OAuth app (same idea, 3 min)

1. **github.com/settings/developers** → **OAuth Apps** → **New OAuth App**
2. Application name: `PeerFlow`
   Homepage URL: your Vercel URL (or domain)
   Authorization callback URL: the same Supabase callback as above:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
3. **Register application** → **Generate a new client secret**
4. **Supabase → Authentication → Providers → GitHub** → toggle ON → paste
   Client ID + secret → Save. Same rule: the secret lives only there.

---

## Cheat sheet — what goes where

| Value | Send to Claude? | Where it lives |
|---|---|---|
| Supabase Project URL | ✅ yes | public anyway |
| Supabase anon/public key | ✅ yes | public anyway |
| Supabase service_role key | ❌ never | nowhere outside Supabase |
| Database password | ❌ never | your password manager |
| Google/GitHub Client ID | ✅ fine | public |
| Google/GitHub Client secret | ❌ never | Supabase Providers page only |
| Registrar/domain login | ❌ never | your password manager |
| Vercel tokens | ❌ not needed | GitHub connection replaces them |

---

# Email — do these in order

The site stays on Vercel. No Cloudflare, no nameserver move, nothing to pay
for. Two services: **ImprovMX** receives mail sent to `hello@peerflow.dev`,
**Resend** sends password resets to your users. About 35 minutes total.

**Every DNS record below goes in Porkbun, not Vercel.** `peerflow.dev` uses
Porkbun's nameservers, so Porkbun is what actually answers DNS queries for the
domain — records added anywhere else are ignored. Porkbun → **Domain
Management** → `peerflow.dev` → **DNS**. Leave the existing A/CNAME records
alone; those are what point the domain at Vercel.

## 1. Re-run the database schema (5 min) — do this first

Nothing below matters if the app itself is broken, and right now two features
are waiting on this.

There is one schema file and this is it — always the version on `main`:

**https://raw.githubusercontent.com/mokhibakhon/peerflow/main/supabase/schema.sql**

That link is the raw file, so it opens as plain text you can select all and
copy. Don't work from an older copy saved anywhere else.

1. Open the link above, select everything, copy.
2. **Supabase → SQL Editor → New query**, paste, **Run**.
3. Sanity check before you run it: the text you pasted should contain
   `proposed_by`. If it doesn't, you have an old copy.

Safe to re-run as many times as you like: every column is
`add column if not exists`, and existing sessions default to `confirmed` so
nothing already booked disappears.

This adds `first_name`/`last_name` to profiles, and `status`/`proposed_by`/
`note` to sessions — the columns propose-and-accept needs.

## 2. ImprovMX, so `hello@peerflow.dev` stops bouncing (10 min)

Six places on the site tell people to write to that address, including the
password-reset fallback on the login page. All of them currently bounce.

1. **improvmx.com** → enter `peerflow.dev` and the Gmail address you want mail
   forwarded to.
2. In **Porkbun → Domain Management → peerflow.dev → DNS**, add two records:

   | Type | Host | Priority | Answer |
   |---|---|---|---|
   | MX | *(leave empty)* | 10 | `mx1.improvmx.com` |
   | MX | *(leave empty)* | 20 | `mx2.improvmx.com` |

   Porkbun calls the value field **Answer**. An empty Host means the domain
   itself — do not type `@` or `peerflow.dev`. ImprovMX displays the values
   with a trailing dot (`mx1.improvmx.com.`); enter them without it. Leave TTL
   at the default.
3. If Porkbun's own **Email Forwarding** is switched on for this domain, turn
   it off — it adds competing MX records.
4. ImprovMX may also offer an SPF record. **Read step 4 before adding it.**
5. Back on the ImprovMX page, press **Check again**. It can take a few minutes
   for Porkbun to publish. Then send yourself a test from any other address; it
   should reach your Gmail within a minute.

Ignore the **Go Premium** banner. One-click setup is a convenience for people
who don't want to add two records by hand. Adding them by hand is two minutes
and costs nothing.

Forwarding is one-way: replies from Gmail go out as your Gmail address. Fine
for now. Buy a real mailbox when someone actually writes in.

## 3. Resend, so password reset works (15 min)

1. **resend.com** → sign up → **Domains → Add Domain** → `peerflow.dev`.
   If it offers to set things up on a subdomain like `send.peerflow.dev`,
   take it — it keeps Resend's records from colliding with ImprovMX's.
2. It gives you DNS records. Add them in the same Porkbun DNS panel.
   Wait for Resend to show the domain as **Verified** before continuing.
3. **API Keys → Create**, permission *Sending access*. Copy it now — it is
   shown once.
4. **Supabase → Authentication → Emails → SMTP Settings** → enable custom
   SMTP:
   - Host `smtp.resend.com`
   - Port `587`
   - Username `resend` (literally that word, not your email)
   - Password: the API key
   - Sender email `hello@send.peerflow.dev`
   - Sender name `PeerFlow`

   The sender address has to be **at the domain Resend verified**. We verified
   `send.peerflow.dev`, so `hello@peerflow.dev` will be rejected — Resend only
   signs mail for the exact domain it holds keys for. Recipients see the sender
   name, so their inbox says "PeerFlow" either way.

   `hello@peerflow.dev` stays the address on the site that people write *to*;
   ImprovMX forwards it. Sending and receiving are different domains here and
   that is fine.

### Porkbun's Host field appends the domain

Porkbun shows `.peerflow.dev` greyed out beside the Host box and adds it for
you. Resend lists its hosts relative to the root already, so type them exactly
as shown — `send.send`, not `send.send.peerflow.dev`. Pasting the full
hostname produces `send.send.peerflow.dev.peerflow.dev`, which never verifies
and gives no error explaining why.

### The SPF trap, avoided

**A domain can only have one SPF record**, and two is worse than none —
receiving servers treat it as an error and the mail goes to spam. Because
Resend is on `send.peerflow.dev`, its SPF sits at `send.send.peerflow.dev` and
the root is left free for ImprovMX. Nothing to merge. If you ever move Resend
to the root domain, the two have to become one record:

```
v=spf1 include:spf.improvmx.com include:amazonses.com ~all
```

## 4. DMARC (2 min)

Without this, anyone can send email that looks like it came from PeerFlow.
Resend hands you this one as `v=DMARC1; p=none;` — use its value as-is, at
Host `_dmarc`. Adding `rua=mailto:...` turns on aggregate reports, which arrive
as XML attachments that are unreadable without a parser. Skip it until you
have a reason to want them.

`p=none` means "watch, don't block" — nothing of yours gets bounced while you
find out what's passing. Once your own mail has been landing properly for a
couple of weeks, change `p=none` to `p=quarantine`.

## 5. Point Supabase at the reset page (1 min)

The reset link in the email has to be allowed to come back to your site, or
Supabase refuses to follow it.

**Supabase → Authentication → URL Configuration**

- **Site URL:** `https://peerflow.dev`
- **Redirect URLs:** add `https://peerflow.dev/reset.html`

If Site URL is still `localhost` or a Vercel preview address, every reset link
will bounce off it.

## 6. Check it actually works

1. Click **Forgot password** on your own login page with a real address.
2. If nothing arrives, open **Resend → Logs** first. It tells you whether the
   message left, bounced or was rejected — which says immediately whether the
   problem is Supabase or DNS.
3. Check the spam folder too. If it landed there, SPF/DKIM/DMARC aren't all
   passing yet.

## What this does not do

Supabase only sends **auth** email — confirmations, password resets, magic
links. It will not tell someone "Aziza proposed Tuesday evening." Right now a
proposal only reaches your partner when they open the app. Sending that needs
a Supabase Edge Function calling Resend when a session row is inserted — a
separate piece of work, worth doing once this is up and working.
