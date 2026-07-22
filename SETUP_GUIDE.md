# PeerFlow — Account Setup Guide

Do these in order. Steps 1–3 now; step 4 is optional; steps 5–6 only when the
backend is being built.

**Golden rule:** the only values you ever paste into chat are the Supabase
*Project URL* and *anon public key*. Every other secret stays inside the
dashboards where it belongs.

---

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
