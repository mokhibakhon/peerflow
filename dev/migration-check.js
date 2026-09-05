#!/usr/bin/env node
/*
 * What is actually in the database, checked against what the repository says
 * should be.
 *
 *     node dev/migration-check.js           the SQL to paste into Supabase
 *     node dev/migration-check.js --list    just the apply order
 *
 * WHY THIS EXISTS
 *
 * supabase/*.sql are pasted in by hand and nothing in CI applies them, so a
 * merged migration is dormant until somebody runs it. That gap has caused two
 * near-misses already, and both had the same shape: the page looked right and
 * was not. migration-funnel.sql's app_admins insert matches on email and
 * inserts nothing at all if that address is not yet in auth.users, which looks
 * exactly like the migration never running. migration-visits.sql was run in an
 * intermediate form and the metrics page came up complete apart from two cards
 * nobody would miss.
 *
 * "Looks correct, isn't" is the failure mode worth tooling against, because it
 * is the one a person cannot catch by looking.
 *
 * WHY IT PRINTS SQL INSTEAD OF CONNECTING
 *
 * The container cannot reach the Supabase REST host — the agent proxy 403s it
 * on CONNECT — so nothing in a session can query the real database. That is a
 * hard constraint and CLAUDE.md is emphatic about it. So this generates the
 * query rather than running it: paste the output into the SQL editor and read
 * what comes back. That also means it works for the owner on any machine with
 * a browser, which is the person who actually needs it.
 *
 * WHY IT DERIVES THE LIST INSTEAD OF STATING IT
 *
 * A hand-maintained list of expected objects is a second copy of the schema,
 * and the whole reason this file exists is that second copies go stale. So the
 * expectations are read out of supabase/*.sql at run time. Add a migration and
 * it is covered; nobody has to remember this file.
 *
 * A file counts as live unless it opens with a SUPERSEDED banner, which is the
 * same marker SETUP_GUIDE.md and the migration files themselves already use.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'supabase');

/* The order matters and cannot be derived from the filenames: schema.sql comes
   first, migration-mvp.sql second, and migrate-2026-08.sql folds in fourteen
   more and must land before anything that builds on them. Everything after
   that is additive and dated, so alphabetical-by-nothing would be wrong and
   the three anchors are named explicitly.

   Anything live that is not one of the three is applied after them, sorted by
   name, which is the order they were written in closely enough. If that ever
   stops being true the fix is to name it here rather than to guess. */
const ANCHORS = ['schema.sql', 'migration-mvp.sql', 'migrate-2026-08.sql'];

const isSuperseded = (file) =>
  /SUPERSEDED/i.test(fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 2000));

const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const live = all.filter((f) => !isSuperseded(f));
const rest = live.filter((f) => !ANCHORS.includes(f));
const order = [...ANCHORS.filter((f) => live.includes(f)), ...rest];

if (process.argv.includes('--list')) {
  console.log('\nApply in this order. Each is safe to run more than once.\n');
  order.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. supabase/${f}`));
  console.log(`\n${all.length - live.length} superseded file(s) are folded into migrate-2026-08.sql`);
  console.log('and must NOT be run separately — create or replace means an older');
  console.log('paste silently wins over a newer one.\n');
  process.exit(0);
}

/* What the files create. Tables and functions only: they are what a page
   actually calls, and a missing column inside a table that exists shows up as
   a missing function nine times out of ten here, because the readers are all
   functions. Policies are deliberately not checked — a policy's NAME existing
   proves nothing about what it evaluates to, and dev/sql-tests.sh already
   tests the behaviour against real Postgres. */
const tables = new Set();
const functions = new Set();

for (const f of order) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    /* Comments first, or a create inside a commented-out block or an
       explanatory paragraph counts as a real object and the check reports a
       thing that was never supposed to exist. */
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    functions.add(m[1].toLowerCase());
  }
}

/* Dropped on purpose, so their absence is correct and their presence means an
   old paste landed after a new one — the create-or-replace hazard, seen from
   the other side. visit_timing is the worked example: migration-visits.sql
   drops it, and finding it still there says the file was run in an earlier
   form.
 *
 * A name is only really dropped if nothing in the live set creates it. Most
 * drops here are not removals at all: "drop function ...; create or replace
 * function ..." is how a signature gets changed, because create or replace
 * cannot alter the argument list. The first version of this file treated every
 * dropped name as one that must be absent, and reported reliability_of — which
 * is dropped and immediately recreated on the next line — as a database fault
 * on a database that was perfectly correct. Subtracting what is created is the
 * whole fix, and it is why this runs against a real Postgres below rather than
 * being reasoned about. */
const droppedRaw = new Set();
for (const f of order) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, ' ');
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    droppedRaw.add(m[1].toLowerCase());
  }
}
const dropped = new Set([...droppedRaw].filter((n) => !functions.has(n)));

const list = (s) => [...s].sort().map((n) => `    ('${n}')`).join(',\n');

console.log(`-- PeerFlow migration check — generated by dev/migration-check.js
-- Derived from ${order.length} live migration file(s) in supabase/.
--
-- Paste the whole thing into Supabase -> SQL Editor -> Run.
-- It writes nothing. Every row that comes back is something missing.
-- No rows means the database matches the repository.
--
-- Two statements, and the important one is SECOND on purpose. The Supabase SQL
-- editor shows the result of the LAST statement only, so the first time this
-- ran for real the owner saw "app_admins: 1 admin(s), fine" and the query that
-- actually lists missing objects had scrolled into nowhere. Whichever one goes
-- last is the one that gets read, so it has to be the one with something to
-- say.

-- ── 1. the owner is registered ─────────────────────────────────────────────
-- Not derived from the files, because it cannot be: the app_admins insert in
-- migration-funnel.sql matches on an email address and inserts nothing at all
-- if that address is not yet in auth.users. An empty table looks exactly like
-- the migration never having run, and it is why the metrics page can render
-- its not-yours screen to the person who owns the site.
--
-- On a database where the migrations have never been run this errors with
-- "relation public.app_admins does not exist", which is the correct answer
-- rather than a fault: statement 2 reports the table missing.
--
-- It is a separate statement rather than an arm of the union below because
-- Postgres binds every table in a statement when it PLANS it, not when a
-- branch is taken. Guarding it with "where exists (... information_schema ...)"
-- reads like it protects the reference, and does not: on a database where
-- app_admins had not been created the whole union failed to parse and the
-- check returned nothing at all. Same shape as the
-- EXECUTE-is-checked-at-prepare-time note in
-- docs/article-rls-publishable-key.md, and it cost the same confusion.
select case when count(*) = 0
            then 'app_admins IS EMPTY — the owner insert matched no auth.users row'
            else 'app_admins: ' || count(*)::text || ' admin(s), fine' end as app_admins
  from public.app_admins;


-- ── 2. everything the repository expects ───────────────────────────────────
-- This is the one whose result you read. No rows is the pass.
with expected_tables(name) as (values
${list(tables)}
), expected_functions(name) as (values
${list(functions)}
), should_be_gone(name) as (values
${list(dropped) || "    (null)"}
)
select 'MISSING TABLE' as problem, e.name
  from expected_tables e
 where not exists (
   select 1 from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = e.name)

union all

select 'MISSING FUNCTION', e.name
  from expected_functions e
 where not exists (
   select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = e.name)

union all

-- Present when it should have been dropped: an older paste landed on top of a
-- newer one, which is the failure the SUPERSEDED banners exist to prevent.
select 'SHOULD HAVE BEEN DROPPED', d.name
  from should_be_gone d
 where d.name is not null
   and exists (
   select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = d.name);
`);

console.error(`\n[${tables.size} tables, ${functions.size} functions, ${dropped.size} dropped, from ${order.length} live files]`);
console.error(`[apply order: node dev/migration-check.js --list]\n`);
