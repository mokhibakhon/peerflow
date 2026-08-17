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
- **You cannot reach `www.peerflow.dev` or `vercel.com` from the container** —
  the agent proxy 403s them on CONNECT and curl returns an empty body. An empty
  body is not evidence the site is stale. Do not tell the user something isn't
  live based on a curl.
- **Two Vercel projects are connected**: `peerflow` (production,
  www.peerflow.dev) and `peerflow-apfq` (a duplicate that double-deploys every
  push). Deleting `peerflow-apfq` is pending with the user.
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
  `db.js` against a fresh `app.html` and behave like neither build. `vercel.json`
  sends `must-revalidate` on everything to stop it. `window.PF_BUILD` in
  `db.js` is logged on every load — **bump it when you change anything in
  `assets/`**, and ask for it before believing a bug report about behaviour you
  have already fixed.

- **Pushing to `main` does not deploy anything.** The Vercel project's GitHub
  connection is broken — its Git settings still name the repository
  `mokhibakhon/posfps`, which is what this repo was called before it was
  renamed, and no push has produced a deployment since. Production tracks
  `main` and simply never hears about it. Deploy by hand from the user's
  clone:

      git pull && npx vercel --prod

  This cost most of a day. Several correct fixes appeared to do nothing,
  because the live site was serving a build from before the video work
  existed, and the hunt went through the code instead of the deploy. **If a
  fix you have verified does not show up live, ask for `PF_BUILD` from the
  browser console before writing another line.** Reconnecting the repository
  in Vercel → Settings → Git is still to do.

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
