-- ============================================================
-- PeerFlow — count visits without a visitor
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run twice. Run it after migration-funnel.sql, which creates the
-- app_admins table this file's readers check against.
--
-- You must already have named yourself in app_admins for any of the read
-- functions below to return anything. migration-funnel.sql explains how.
--
-- WHAT THIS IS
--
-- Enough to answer one question — where do people arrive from — without
-- keeping anything in anybody's browser and without a third party.
--
-- privacy.html said, until this shipped, "no analytics — not Google
-- Analytics, not a self-hosted substitute, nothing; nobody here knows which
-- pages you looked at". That was true and this makes part of it false, so
-- privacy.html changes in the same commit. It now says what this actually
-- does. The sentence that mattered most is still true and is still there:
-- nothing is kept in your browser.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No visitor id, no cookie, no localStorage, no fingerprint. A row is one
-- page view and there is no column that ties it to the row before it. That
-- is a real cost and it is worth stating plainly rather than discovering
-- later: "unique visitors" cannot be computed from this table, and neither
-- can a journey. What can be computed is how many views, from which sources,
-- to which pages, on which days — which is the question that was actually
-- being asked.
--
-- No IP address, no user agent string. IP is the identifier most analytics
-- quietly retains and it is the one with the clearest legal weight; the user
-- agent is a fingerprint in one column. Instead the browser sends two coarse
-- values it derives itself — a device class and a browser family from a
-- fixed list — and the IANA timezone, which is the "approximate location"
-- and is approximate in the honest sense: Asia/Tashkent is a region, not a
-- person.
--
-- No full referring URL. Only its host. The path of the page somebody came
-- from can carry a search query, a session token or a private document name,
-- and none of that is needed to know that they came from dev.to.
--
-- THE SEAM FOR LATER
--
-- visitor_id exists, is always NULL, and nothing writes it. It is here so
-- that a decision to add a persistent id later is an ALTER of behaviour
-- rather than a migration of data. Adding one is not a small change: a
-- persistent id in a browser is an online identifier under GDPR, analytics
-- is not strictly necessary, and in the EU that means asking first. Do not
-- start writing this column without doing that work.
-- ============================================================


-- ---------- the table ----------
-- Every ordinary caller may INSERT and nobody may SELECT. That asymmetry is
-- the whole design: the publishable key ships in the browser by definition,
-- so whatever can write here is public, and the way to make that safe is for
-- the table to be write-only to everyone except a SECURITY DEFINER function.
--
-- Being writable by anyone holding the key does mean somebody could fill it
-- with junk. The constraints below bound the shape of that junk — a row
-- cannot be long, cannot claim an unknown device, cannot smuggle a URL into
-- a column meant for a hostname — but they cannot bound the volume, and no
-- amount of client-side cleverness would, because the client is the
-- attacker. If it ever happens, the answer is Supabase's own rate limiting
-- and a delete, not a schema change.
create table if not exists public.visits (
  id          bigint generated always as identity primary key,

  -- Set by the trigger below, never by the caller, so the ordering of this
  -- table is the server's clock and not a claim made by a browser.
  at          timestamptz not null default now(),

  -- The page that was viewed. Path only: index.html is '/', and a query
  -- string is dropped before it gets here except for the utm_* fields, which
  -- are pulled out into their own columns.
  path        text not null,

  -- Hostname of document.referrer, or NULL for a direct arrival. Never the
  -- full URL — see the header.
  ref_host    text,

  utm_source   text,
  utm_medium   text,
  utm_campaign text,

  -- Derived in the browser from a small fixed list rather than sent raw, so
  -- this column cannot become a fingerprint however the browser evolves.
  device      text,
  browser     text,

  -- IANA zone. The approximate location, and approximate on purpose.
  tz          text,

  -- Always NULL. See "the seam for later" in the header.
  visitor_id  uuid,

  constraint visits_path_shape    check (path like '/%' and length(path) <= 512),
  constraint visits_ref_len       check (ref_host is null or length(ref_host) <= 253),
  constraint visits_ref_is_host   check (ref_host is null or ref_host not like '%/%'),
  constraint visits_utm_len       check (
    coalesce(length(utm_source), 0)   <= 128 and
    coalesce(length(utm_medium), 0)   <= 128 and
    coalesce(length(utm_campaign), 0) <= 128),
  constraint visits_device_known  check (device is null or device in ('mobile','tablet','desktop')),
  constraint visits_browser_known check (browser is null or browser in
    ('chrome','safari','firefox','edge','opera','samsung','other')),
  constraint visits_tz_len        check (tz is null or length(tz) <= 64)
);

-- The three reads this table gets are "recent", "grouped by day" and
-- "grouped by source", and all of them are bounded by a date window.
create index if not exists visits_at_idx on public.visits (at desc);


-- ---------- what the caller may not decide ----------
-- A browser insert names the columns it should and the trigger overwrites
-- the two it must not. `at` because an attacker who can backdate rows can
-- make a launch look like a slow burn or the reverse, and because rows
-- arriving out of order would make every window below wrong. visitor_id
-- because it is the seam described above and nothing may start filling it
-- by accident — including a well-meaning edit to visit.js.
create or replace function public.visits_server_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.at := now();
  new.visitor_id := null;
  return new;
end;
$$;

drop trigger if exists visits_server_fields on public.visits;
create trigger visits_server_fields
  before insert on public.visits
  for each row execute function public.visits_server_fields();


-- ---------- who may write, and who may read ----------
-- RLS on, one policy, and it is INSERT only. With no SELECT policy every
-- ordinary caller reads zero rows, which is the same shape app_admins uses:
-- the table is invisible to the publishable key while remaining writable by
-- it. The table grant matches — INSERT and nothing else.
alter table public.visits enable row level security;

revoke all on table public.visits from public, anon, authenticated;
grant insert on table public.visits to anon, authenticated;

drop policy if exists "anyone may record a visit" on public.visits;
create policy "anyone may record a visit"
  on public.visits for insert
  to anon, authenticated
  with check (true);


-- ---------- the numbers ----------
-- Same shape as funnel_counts(): one row for an admin, no row for anybody
-- else, so db.js can treat "not yours" as an empty result rather than an
-- error on screen. The scalar subqueries may be evaluated before the WHERE
-- is applied — they are computed and discarded, so the work is wasted rather
-- than the numbers leaked.
create or replace function public.visit_counts()
returns table (
  views          bigint,  -- page views, all time
  views_7d       bigint,
  views_prev_7d  bigint,  -- the seven before that, to compare
  views_30d      bigint,
  days_with_data bigint,  -- distinct days seen, so a rate can be read honestly
  first_at       timestamptz
)
language sql
security definer
stable
-- pg_temp named explicitly and last, for the reason migration-funnel.sql
-- gives at length: it is searched first for relations whether or not it
-- appears, and naming it last pushes it behind the real schema.
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.visits),
    (select count(*) from public.visits where at >= now() - interval '7 days'),
    (select count(*) from public.visits
      where at >= now() - interval '14 days' and at < now() - interval '7 days'),
    (select count(*) from public.visits where at >= now() - interval '30 days'),
    (select count(distinct date_trunc('day', at)) from public.visits),
    (select min(at) from public.visits)
  where exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.visit_counts() from public, anon;
grant execute on function public.visit_counts() to authenticated;


-- ---------- day by day ----------
-- generate_series rather than grouping the rows, so a day nobody visited is a
-- zero in the series instead of a missing point a chart would draw straight
-- through. Same reasoning as funnel_daily().
create or replace function public.visit_daily()
returns table (day date, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select d::date,
         (select count(*) from public.visits v
           where v.at >= d and v.at < d + interval '1 day')
    from generate_series(
           date_trunc('day', now() - interval '29 days'),
           date_trunc('day', now()),
           interval '1 day') d
   where exists (
     select 1 from public.app_admins a where a.user_id = auth.uid()
   )
   order by d;
$$;

revoke all on function public.visit_daily() from public, anon;
grant execute on function public.visit_daily() to authenticated;


-- ---------- where they came from ----------
-- utm_source wins over the referrer host when both are present, because a
-- utm_source is something somebody deliberately tagged and the referrer is
-- whatever the browser happened to send. A direct arrival — no referrer, no
-- campaign — is labelled rather than dropped, because "most of them typed it
-- in" is a finding and a missing row is not.
create or replace function public.visit_sources(p_days int default 30)
returns table (source text, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(v.utm_source, ''), nullif(v.ref_host, ''), 'direct') as source,
         count(*) as views
    from public.visits v
   where v.at >= now() - (greatest(p_days, 1) || ' days')::interval
     and exists (
       select 1 from public.app_admins a where a.user_id = auth.uid()
     )
   group by 1
   order by 2 desc, 1
   limit 50;
$$;

revoke all on function public.visit_sources(int) from public, anon;
grant execute on function public.visit_sources(int) to authenticated;


-- ---------- what they looked at ----------
create or replace function public.visit_pages(p_days int default 30)
returns table (path text, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select v.path, count(*) as views
    from public.visits v
   where v.at >= now() - (greatest(p_days, 1) || ' days')::interval
     and exists (
       select 1 from public.app_admins a where a.user_id = auth.uid()
     )
   group by 1
   order by 2 desc, 1
   limit 50;
$$;

revoke all on function public.visit_pages(int) from public, anon;
grant execute on function public.visit_pages(int) to authenticated;


-- ---------- who they are, coarsely ----------
-- Device, browser and timezone in one call rather than three, because the
-- page draws them as three small lists side by side and three round trips
-- for that is silly. `kind` says which list a row belongs to.
create or replace function public.visit_context(p_days int default 30)
returns table (kind text, label text, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with allowed as (
    select 1 where exists (
      select 1 from public.app_admins a where a.user_id = auth.uid()
    )
  ),
  win as (
    select v.* from public.visits v, allowed
     where v.at >= now() - (greatest(p_days, 1) || ' days')::interval
  )
  select 'device'  as kind, coalesce(device, 'unknown'),  count(*) from win group by 2
  union all
  select 'browser' as kind, coalesce(browser, 'unknown'), count(*) from win group by 2
  union all
  select 'tz'      as kind, coalesce(tz, 'unknown'),      count(*) from win group by 2
   order by 1, 3 desc, 2;
$$;

revoke all on function public.visit_context(int) from public, anon;
grant execute on function public.visit_context(int) to authenticated;


-- ---------- the campaigns, when there are any ----------
-- utm_medium and utm_campaign have been recorded since day one and were shown
-- nowhere, which made them collected-and-unused: the worst state for a column
-- to be in, because it is data held for no reason. This is the reason.
--
-- Only rows carrying at least one utm_* field. An untagged arrival is already
-- in visit_sources(); repeating it here under three nulls would bury the
-- handful of rows this list exists to show. So a site that has never tagged a
-- link gets an empty result and app-metrics.html hides the card rather than
-- drawing an empty one.
create or replace function public.visit_campaigns(p_days int default 30)
returns table (source text, medium text, campaign text, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(v.utm_source, ''),   '—'),
         coalesce(nullif(v.utm_medium, ''),   '—'),
         coalesce(nullif(v.utm_campaign, ''), '—'),
         count(*)
    from public.visits v
   where v.at >= now() - (greatest(p_days, 1) || ' days')::interval
     and (nullif(v.utm_source, '')   is not null
       or nullif(v.utm_medium, '')   is not null
       or nullif(v.utm_campaign, '') is not null)
     and exists (
       select 1 from public.app_admins a where a.user_id = auth.uid()
     )
   group by 1, 2, 3
   order by 4 desc, 1, 2, 3
   limit 50;
$$;

revoke all on function public.visit_campaigns(int) from public, anon;
grant execute on function public.visit_campaigns(int) to authenticated;


-- ---------- when they came, where they were ----------
-- Hour of day and day of week, in the VISITOR's local time rather than UTC or
-- the owner's. That is the whole point of the question — "is my audience awake
-- at nine in the evening" is a question about their evening, and this is a
-- product whose entire job is matching people across timezones. `at` is a
-- timestamptz and every row already carries the zone the browser reported, so
-- no new data is collected to answer it.
--
-- The zone is joined against pg_timezone_names rather than trusted. tz arrives
-- from a browser through a column anybody holding the publishable key can
-- write, and `at at time zone 'nonsense'` raises rather than returning null —
-- one crafted row would take the whole function down. Rows with an unknown or
-- missing zone are dropped from this breakdown; they are still counted
-- everywhere else, and dropping them is honest because there is no local hour
-- to place them at.
--
-- generate_series supplies all 24 hours and all 7 days, so a quiet hour is a
-- zero rather than a gap — the same reason visit_daily() does it.
create or replace function public.visit_timing(p_days int default 30)
returns table (kind text, slot int, label text, views bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with allowed as (
    select 1 where exists (
      select 1 from public.app_admins a where a.user_id = auth.uid()
    )
  ),
  local as (
    select (v.at at time zone z.name) as lt
      from public.visits v
      join pg_timezone_names z on z.name = v.tz,
           allowed
     where v.at >= now() - (greatest(p_days, 1) || ' days')::interval
  )
  select 'hour', h::int, lpad(h::text, 2, '0') || ':00',
         (select count(*) from local where extract(hour from lt) = h)
    from generate_series(0, 23) h, allowed
  union all
  select 'dow', d::int,
         to_char(date '2026-08-31' + d, 'Dy'),   -- 2026-08-31 is a Monday
         (select count(*) from local
           where extract(isodow from lt) = d + 1)
    from generate_series(0, 6) d, allowed
   order by 1, 2;
$$;

revoke all on function public.visit_timing(int) from public, anon;
grant execute on function public.visit_timing(int) to authenticated;


-- ---------- forgetting ----------
-- Nothing here needs to be kept for a year. Ninety days is longer than any
-- question this table answers and short enough that the pile does not become
-- something worth stealing.
--
-- This does not run itself. Either call it from the SQL editor now and then,
-- or schedule it if pg_cron is enabled on the project:
--
--   select cron.schedule('prune-visits', '0 4 * * *',
--                        $c$select public.prune_visits()$c$);
create or replace function public.prune_visits(p_keep_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n bigint;
begin
  if not exists (select 1 from public.app_admins a where a.user_id = auth.uid())
     and auth.uid() is not null then
    -- A signed-in non-admin gets nothing. auth.uid() IS NULL is the cron
    -- case, which has no session and is allowed: it runs as the owner from
    -- inside the database rather than through PostgREST.
    return 0;
  end if;
  delete from public.visits where at < now() - (greatest(p_keep_days, 1) || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.prune_visits(int) from public, anon;
grant execute on function public.prune_visits(int) to authenticated;
