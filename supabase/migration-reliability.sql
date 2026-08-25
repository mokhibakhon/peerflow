-- ============================================================
-- SUPERSEDED — do not run this file.
--
-- Every statement below is already inside supabase/migrate-2026-08.sql, which
-- is the file that gets pasted into the SQL editor. This copy is kept because
-- it is the readable account of one change, and README.md links to it by name
-- to explain what that change was. It is documentation now, not a migration.
--
-- Running it is not a no-op and will not raise an error. These are
-- "create or replace" definitions, so the last paste wins: re-running an old
-- file replaces the current definition of whatever it defines with the older
-- one, silently. This file is the worked example — its reliability_of()
-- scores a fifteen-session window from the old attended/status booleans with
-- a hardcoded twelve-hour cancellation line. The live one scores twenty from
-- the attendance enum with pf_cancel_notice_hours(). Pasting this would
-- change every score in the product without saying so.
--
-- To set a database up, see SETUP_GUIDE.md. The short version is schema.sql,
-- then migration-mvp.sql, then migrate-2026-08.sql, then the migrations
-- written after it that are not folded in yet: migration-reschedule.sql and
-- migration-dormancy.sql.
-- ============================================================

-- ============================================================
-- PeerFlow — reliability
--
-- Run this once in the Supabase SQL editor, after schema.sql and
-- migration-mvp.sql. Additive: one column and one function. Without it the
-- score simply does not appear anywhere.
--
-- WHY
-- The one thing you need to know about a stranger before you agree to meet
-- them every week is whether they turn up. Everything else on a profile is
-- what they intend to do; this is the only part that is what they did.
--
-- WHY IT IS A FUNCTION AND NOT A COLUMN
-- Reliability is read about other people, and other people's session rows are
-- not readable — the RLS on public.sessions stops there, correctly, because a
-- calendar is private. A security-definer function is the way to answer "how
-- often does this person turn up" without also answering "when are they
-- busy": it returns four numbers per person and never a row.
--
-- A stored column would need a trigger on every write and would still be a
-- number nobody could recompute after a scoring change. This is derived on
-- read, from rows that already exist.
-- ============================================================

-- When somebody actually joined. Null until the call records it — which
-- nothing does yet, so every attended session currently scores as on time.
-- That is the honest default: we cannot call somebody late on evidence we
-- never collected. The grade below starts working the day this is written.
alter table public.sessions
  add column if not exists joined_at timestamptz;


-- ------------------------------------------------------------
-- The score
--
-- Grades, per the agreed scale:
--   turned up on time      1.0
--   turned up late         0.8   (more than ten minutes in)
--   cancelled early        0.8
--   cancelled late         0.4   (inside twelve hours)
--   no-show                0
--
-- Not counted at all:
--   * sessions the OTHER person cancelled — cancelled_by decides whose
--     record it lands on, so one flaky partner cannot drag down everybody
--     they booked with;
--   * proposals that were never confirmed, which is where a reschedule
--     lives: re-proposing a time leaves the old row unconfirmed, so a
--     mutual move costs neither person anything;
--   * past sessions nobody ever marked. An absent verdict is not a verdict
--     of absent — the same rule the Progress page already follows.
--
-- The average is weighted two ways. Recency: the newest session counts fully
-- and each older one 0.9 as much, over a window of the last fifteen, so a bad
-- month eight months ago stops following somebody around. And a prior: every
-- score starts as two invisible sessions at 85%, which is what stops the
-- first cancellation of somebody's life reading as 40% and stops three tidy
-- sessions reading as a perfect 100%.
--
-- Below five graded sessions the percentage is null. There is a real number
-- underneath, but publishing it would be arithmetic pretending to be
-- evidence, and it is somebody's reputation.
-- ------------------------------------------------------------

-- Dropped before it is created, which every other definition in this
-- repository gets away without.
--
-- `create or replace function` cannot change a function's return type, and
-- this one's changed: migration-attendance.sql replaced it with a version
-- returning more columns. So on the second run of migrate-2026-08.sql — which
-- the paste's own header tells people to do whenever they are not sure what
-- they have run — this statement met a nine-column function and raised
-- "cannot change return type of existing function", stopping the file dead
-- less than a tenth of the way in.
--
-- The drop makes the older definition land cleanly whatever is already there,
-- and the newer one further down the same file then replaces it, so the end
-- state is identical and running the paste twice is safe again.
drop function if exists public.reliability_of(uuid[]);

create or replace function public.reliability_of(p_users uuid[])
returns table (
  uid        uuid,
  pct        int,
  counted    int,
  attended_n int,
  noshow_n   int
)
language sql
stable
security definer
set search_path = public
as $$
  with graded as (
    select
      s.user_id as u,
      s.starts_at,
      case
        /* Their partner pulled out: not this person's record. */
        when s.status = 'cancelled' and s.cancelled_by is distinct from s.user_id then null
        when s.status = 'cancelled' and s.cancelled_at is not null
             and s.starts_at - s.cancelled_at < interval '12 hours' then 0.4
        when s.status = 'cancelled' then 0.8
        when s.status = 'no_show' or s.attended is false then 0.0
        when s.attended is true and s.joined_at is not null
             and s.joined_at > s.starts_at + interval '10 minutes' then 0.8
        when s.attended is true then 1.0
        else null
      end as g
    from public.sessions s
    where s.user_id = any(p_users)
      /* Confirmed only. An unanswered proposal is not a broken promise. */
      and s.confirmed_at is not null
  ),
  windowed as (
    select u, g,
           row_number() over (partition by u order by starts_at desc) as rn
      from graded
     where g is not null
  ),
  agg as (
    select u,
           sum(power(0.9::numeric, (rn - 1)::numeric) * g) as num,
           sum(power(0.9::numeric, (rn - 1)::numeric))     as den,
           count(*)                                        as n
      from windowed
     where rn <= 15
     group by u
  ),
  totals as (
    select s.user_id as u,
           count(*) filter (where s.attended is true)                          as att,
           count(*) filter (where s.attended is false or s.status = 'no_show') as ns
      from public.sessions s
     where s.user_id = any(p_users)
       and s.confirmed_at is not null
     group by s.user_id
  )
  select
    w.w as uid,
    case when coalesce(a.n, 0) >= 5
         then round(100 * ((coalesce(a.num, 0) + 2 * 0.85) / (coalesce(a.den, 0) + 2)))::int
         else null end as pct,
    coalesce(a.n, 0)::int   as counted,
    coalesce(t.att, 0)::int as attended_n,
    coalesce(t.ns, 0)::int  as noshow_n
  from unnest(p_users) as w(w)
  left join agg    a on a.u = w.w
  left join totals t on t.u = w.w;
$$;

-- Aggregates only, and only for signed-in people. This is the whole reason
-- the function exists: it answers "do they turn up" without ever handing back
-- a session row, so somebody's reputation is public and their diary is not.
revoke all on function public.reliability_of(uuid[]) from public, anon;
grant execute on function public.reliability_of(uuid[]) to authenticated;
