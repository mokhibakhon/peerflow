# Working on PeerFlow

Read `README.md` first — it is current and it is the map. `docs/peerflow-current-architecture.md`
and `docs/peerflow-project-map.md` go deeper. This file is only the things you
cannot read off the code.

## What this is

A static site. No build step, no bundler, no framework, no `package.json` —
plain HTML, CSS and ES5-flavoured JS, served as files. Supabase is the whole
backend: auth, Postgres, RLS, and a handful of `SECURITY DEFINER` functions.

**Every database call goes through `assets/db.js`.** Pages never talk to
Supabase directly. If a page needs data that isn't there yet, add a function to
`db.js` and call that.

There is exactly one exception and it is `assets/visit.js`, which POSTs a page
view straight to PostgREST. It exists because the pages most worth counting —
the landing pages and the guides — load no JavaScript at all, and `db.js` needs
the ~110kB Supabase SDK, so routing one write through it would slow the pages
whose whole job is to load fast. It writes one table, has no reader, and
everything that reads visits is in `db.js` where it belongs. Do not treat it as
a precedent: a second file like this means the rule is gone.

## Before you change a page

Design changes go to **`draft.html`** first — it is served at `/draft` and is a
scratch surface, `noindex`, owned by whoever is working. Show it, get a
decision, then apply it to the real page. This is the user's standing request,
not a nicety: they want to see it before it reaches the platform. When you have
a judgement call, put two or three real options on /draft rather than
describing them in prose.

`/draft` gets overwritten by whoever drafts next. Don't expect yesterday's
draft to still be there.

## Looking at the signed-in pages

The app pages need an account, so they render as "Loading your sessions…" to
anyone without one. `dev/serve.js` plus `dev/db-stub.js` fix that:

    PF_STUB=1 node dev/serve.js        # http://127.0.0.1:9000, fully signed in

The stub has the same function names and shapes as `db.js`, with `window.__`
dials for each state a page can be in — partners, sessions, streak, goal,
unread count. They are listed at the top of `dev/db-stub.js`. **Add a dial
rather than editing a fixture**; the fixtures are shared.

Chromium and Playwright are already installed in the web container:

    node       /opt/node22/bin/node
    chromium   /opt/pw-browsers/chromium-*/chrome-linux/chrome
    playwright /opt/node22/lib/node_modules/playwright

Screenshot a component with `page.locator('#now').screenshot(...)` and actually
look at it. Assert on rendered geometry — line counts, element widths, which
parent a node landed in — not just on text; several bugs here were "the right
markup in the wrong cell" and read fine in the DOM.

`TESTING.md` is a different thing: a manual two-account script for the user.

## Prose

Comments explain **why**, in full sentences, and are worth writing at length
where the reasoning is not obvious — including what the code used to do and why
that was wrong. Commit messages read the same way. Match it; the codebase is
consistent about this and it is the main thing that makes it navigable.

UI copy is plain and unexcited. No exclamation marks, no "Oops", no
congratulating the user.

## Gotchas that have cost real time

- **`vercel.json` must keep `installCommand` and `buildCommand` empty.** There
  is nothing to build. A build command here once broke *every* production
  deploy for days while the merges looked fine on GitHub.
- **You cannot reach `www.peerflow.dev`, `vercel.com`, or the Supabase REST
  host from the container** — the agent proxy 403s them on CONNECT and curl
  returns an empty body. An empty body is not evidence the site is stale. Do
  not tell the user something isn't live based on a curl.

  The Supabase host is listed here because the entry named only the first two
  and a session went looking for the third anyway. Having finished a fix that
  made `profiles` unreadable without a session, the obvious verification is an
  anonymous read against `<project>.supabase.co/rest/v1/` with the publishable
  key — exactly the position the finding described. That is the right check and
  it is worth asking the user to run it; it is simply not runnable from here.
  `curl: (56) CONNECT tunnel failed, response 403` is the proxy, not the
  database.

  So a migration cannot be confirmed from inside the container at all. Hand
  the user the two curls — the read that should now return `[]`, and the RPC
  that should still return rows — and read their output. Nothing in the
  container can substitute for that.
- **One Vercel project, and it is `peerflow`.** It holds `www.peerflow.dev`,
  builds `main` of this repository, and `peerflow.dev` sits on the same project
  and 308s to www.

  There was a second, and this entry was wrong about it in both halves for a
  long time: it named the project `peerflow-apfq` and called it a duplicate that
  double-deployed every push. Neither survived a look at the account. The real
  one was `peer-flow-9fvn`, wired to `mokhibakhon/peer_flow` — the repository
  name from before the rename — and it had not built since August 2025, because
  nothing pushed there any more. It was deleted in August 2026, once the apex
  had been confirmed to be attached to `peerflow` and not to it.

  The durable lesson is about the entry rather than the project. This file
  exists for the things you cannot read off the code, which is exactly what
  makes a stale line in it expensive — two sentences here were wrong for months
  and nothing could contradict them. `dev/live-check.sh` answers most of what
  this section claims from outside, in one command, and is worth running before
  believing any of it.
- **Postgres `CHECK` constraints cannot contain subqueries.** Use `jsonb_path_exists`.
  In jsonpath, use `strict` — `lax` flattens nested arrays and lets bad shapes
  through — and remember `like_regex` is XQuery, so `.` skips newlines without
  `flag "s"`.
- **Postgres does not guarantee `AND` evaluation order.** Short-circuit with `CASE`.
- **`SET LOCAL` outside a transaction is a silent no-op**, so an RLS test can
  pass vacuously as superuser. Check that `auth.uid()` is not NULL before
  believing a policy test. The auth stub reads `request.jwt.claim.sub`.
- **CSS source order decides ties.** A media-query override at equal
  specificity must come *after* the rule it overrides, not earlier in the file.
- **Nothing in `assets/` is content-hashed**, so a browser can hold an old
  `db.js` against a fresh `app.html` and behave like neither build.
  `vercel.json` used to send `must-revalidate` on everything to stop it, and
  no longer does: pages still get it, `/assets/(.*)` gets `max-age=300`.

  That was not a small trade and it was made on measurement. `must-revalidate`
  on everything cost a conditional request per file per navigation — nine to
  eleven per page switch on a warm cache, all answered 304, none served from
  cache — which is most of why moving between tabs felt slow. Five minutes buys
  that back and bounds the exposure; there is deliberately no
  `stale-while-revalidate`, which would have stretched a five-minute window
  into a day for anyone returning after a gap.

  So the failure above is now possible again, for five minutes after a deploy.
  `window.PF_BUILD` in `db.js` is logged on every load and is how you tell —
  **bump it when you change anything in `assets/`**, and ask for it before
  believing a bug report about behaviour you have already fixed. A build string
  that is one behind, on a page loaded minutes after a deploy, is this window
  rather than a broken deploy.

- **Pushing to `main` deploys to production.** The Vercel Git connection works;
  it was reconnected after the repository rename. Treat a merge to `main` as a
  release, not as saving your work — there is no separate deploy step to
  forget, and no window between merging and it being live.

  **So anything that needs a migration must have the migration run first, or
  at least in the same sitting.** `supabase/*.sql` are pasted in by hand (see
  below) and nothing in CI applies them, so a merge can put code in front of
  users whose tables do not exist yet. Every reader in `db.js` falls back when
  a column or function is missing — but falling back is not free: a control
  that cannot save anything must not be drawn at all, rather than drawn and
  refusing. `checkinsDue()` in `app.html` is the worked example, and it exists
  because that exact thing shipped.

  This entry used to say the opposite — that the connection was broken and you
  had to run `npx vercel --prod` by hand — and it was wrong for long enough to
  cause the above. **If a fix you have verified does not show up live, ask for
  `PF_BUILD` from the browser console before writing another line**, and ask
  the owner rather than trusting this file about deployment.

## Migrations

`supabase/*.sql` are run by hand by the user in the Supabase SQL editor. They
are not applied automatically and nothing in CI checks them, so a merged
migration is dormant until the user runs it — say so explicitly when you merge
one, and don't assume an earlier one landed.

## Git

Develop on the branch you were given, commit, push with `-u origin <branch>`,
and open the PR as a **draft**. Never push to a different branch without asking.
After a squash merge the branch needs `--force-with-lease` to be reused.

More than one Claude session works on this repo at once. Fetch and rebase onto
`origin/main` before you start — the other session's work is often already
merged, and `main` may be well ahead of the branch you were handed.
