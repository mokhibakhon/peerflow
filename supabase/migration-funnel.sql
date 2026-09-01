-- ============================================================
-- PeerFlow — count your own funnel without tracking anybody
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run twice.
--
-- Then, once, name yourself as the reader. Nothing else in the file does
-- this, because the owner's account id is not something the repository
-- should hold:
--
--   insert into public.app_admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
--
-- Until that row exists, funnel_counts() returns nothing to everybody
-- including you, and app-metrics.html says so rather than showing zeros.
--
-- WHAT THIS IS
--
-- PeerFlow has no analytics and is not getting any. privacy.html promises it
-- in unusually plain terms — "No analytics — not Google Analytics, not a
-- self-hosted substitute, nothing; nobody here knows which pages you looked
-- at" — and that promise is worth more than a funnel chart. Nothing here
-- weakens it: there is no script, no beacon, no page-view, no session
-- recording and no third party. Not one byte of new data is collected.
--
-- What this does is count rows PeerFlow already has, and already tells you it
-- has. Every number below is derived from the account you made, the profile
-- you filled in, and the sessions you booked — the three things privacy.html
-- already names as what the platform holds. Reading your own database is not
-- surveillance, and it is the difference between a launch that teaches you
-- something and a launch that produces a spike you cannot explain.
--
-- WHY IT IS A FUNNEL OF PEOPLE, NOT OF EVENTS
--
-- A session is two rows, one per person, so counting sessions doubles every
-- number and the doubling is not uniform — a proposal nobody answered is two
-- rows just as a session both people attended is. Counting distinct people at
-- each step sidesteps that entirely, and it is the more useful question
-- anyway. "Eleven accounts, four finished signing up" tells you where to
-- work. "Nineteen session rows" tells you nothing.
--
-- WHY IT IS OWNER-ONLY
--
-- These are aggregates and name nobody, so the risk is not to members. It is
-- that "PeerFlow has 11 accounts" is a fact about the business, and an early
-- product does not need it readable by anybody holding the publishable key.
-- track_counts() is public because the landing page has to say how many
-- people are on each path; nothing has to say this.
-- ============================================================


-- ---------- who may read it ----------
-- RLS on and deliberately no policies at all: with RLS enabled and no policy,
-- every ordinary caller sees zero rows, so the table is invisible to the
-- publishable key even though it exists. The only thing that can see inside
-- it is a SECURITY DEFINER function, which is exactly the one caller that
-- should. Adding a "you can see yourself" policy would let anybody probe
-- whether they are an admin, which is a question with no good reason to be
-- answerable.
create table if not exists public.app_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on table public.app_admins from public, anon, authenticated;


-- ---------- the funnel ----------
-- One row, or no row at all if the caller is not an admin. No row rather than
-- an exception on purpose: db.js turns an error into a sentence on screen,
-- and "not permitted" shown to a member who guessed the URL is noise. The
-- page treats an empty result as "this is not your page" and says so plainly.
--
-- The WHERE has no FROM to attach to, which is legal and is the whole trick:
-- a SELECT with no FROM returns exactly one row, or none when its WHERE is
-- false. Postgres is free to evaluate the scalar subqueries before it applies
-- that filter, and it probably does — but they are computed and discarded, so
-- the work is wasted rather than the numbers leaked.
--
-- Each step counts DISTINCT PEOPLE who ever reached it, not people currently
-- sitting there, so the numbers only ever go up and each one is a subset of
-- the one above it. That is what makes the gaps readable as drop-off.
create or replace function public.funnel_counts()
returns table (
  accounts          bigint,  -- an account exists
  profile_complete  bigint,  -- signup step 2 was finished
  request_sent      bigint,  -- asked at least one person to partner
  partnered         bigint,  -- has at least one accepted partnership
  session_proposed  bigint,  -- has at least one session row of any status
  session_booked    bigint,  -- both sides agreed to at least one
  session_attended  bigint,  -- was observed in the room at least once
  accounts_7d       bigint,  -- signed up in the last seven days
  accounts_prev_7d  bigint   -- and in the seven before that, to compare
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (select count(*) from public.profiles),

    /* The same five fields signup step 2 asks for, and the same rule
       fetchPeers uses for "finished signing up" — a profile missing any of
       them cannot be matched, so it is not a member yet however complete the
       row looks. availability is the one that is empty rather than null,
       because the column defaults to '[]' instead of NULL. */
    (select count(*) from public.profiles p
      where p.track_id is not null
        and coalesce(p.topic, '') <> ''
        and p.level is not null
        and coalesce(p.timezone, '') <> ''
        and jsonb_array_length(p.availability) > 0),

    (select count(distinct r.from_user) from public.partner_requests r),

    /* Both sides of an accepted request are partnered, and UNION dedupes
       somebody who is on both sides of two different accepted requests. */
    (select count(*) from (
       select r.from_user as person from public.partner_requests r where r.status = 'accepted'
       union
       select r.to_user            from public.partner_requests r where r.status = 'accepted'
     ) both_sides),

    (select count(distinct s.user_id) from public.sessions s),

    (select count(distinct s.user_id) from public.sessions s
      where s.status in ('confirmed', 'completed')),

    /* attendance is what LiveKit's webhook writes and is the authority;
       attended is the older boolean from the MVP migration, still true on
       rows settled before the webhook existed. Either counts, because the
       question is "has this person ever turned up", and a row that predates
       the current mechanism is not evidence that they did not. */
    (select count(distinct s.user_id) from public.sessions s
      where s.attendance = 'attended' or s.attended is true),

    (select count(*) from public.profiles p
      where p.created_at >= now() - interval '7 days'),

    (select count(*) from public.profiles p
      where p.created_at >= now() - interval '14 days'
        and p.created_at <  now() - interval '7 days')

  where exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.funnel_counts() from public, anon;
grant execute on function public.funnel_counts() to authenticated;


-- ---------- the same two numbers, day by day ----------
-- A launch is a one-day event, so a weekly series cannot see it. Thirty days
-- of daily accounts and daily completed profiles is enough to read one: the
-- gap between the two lines on the spike day is the thing worth knowing, and
-- it is the number that decides whether the next launch is worth doing.
--
-- generate_series rather than grouping the rows, so a day nobody signed up is
-- a zero in the series instead of a missing point that a chart would draw
-- straight through.
create or replace function public.funnel_daily()
returns table (day date, accounts bigint, profile_complete bigint)
language sql
security definer
stable
set search_path = public
as $$
  select d::date,
         (select count(*) from public.profiles p
           where p.created_at >= d and p.created_at < d + interval '1 day'),
         (select count(*) from public.profiles p
           where p.created_at >= d and p.created_at < d + interval '1 day'
             and p.track_id is not null
             and coalesce(p.topic, '') <> ''
             and p.level is not null
             and coalesce(p.timezone, '') <> ''
             and jsonb_array_length(p.availability) > 0)
    from generate_series(
           date_trunc('day', now() - interval '29 days'),
           date_trunc('day', now()),
           interval '1 day') d
   where exists (
     select 1 from public.app_admins a where a.user_id = auth.uid()
   )
   order by d;
$$;

revoke all on function public.funnel_daily() from public, anon;
grant execute on function public.funnel_daily() to authenticated;
