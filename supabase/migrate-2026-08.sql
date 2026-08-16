-- ============================================================
-- PeerFlow — everything outstanding, in one paste
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- It takes a few seconds. You should see "Success. No rows returned".
--
-- Safe to run twice. Every statement in here is guarded — `if not exists`,
-- `create or replace`, `drop ... if exists` — so if you already ran some of
-- these separately, running this changes nothing that is already correct.
-- If you are not sure what you have run, run this. That is what it is for.
--
-- It assumes schema.sql and migration-mvp.sql are already in. If the app has
-- ever worked for you, they are.
--
-- WHAT IS IN IT, and what stays broken until you run it
--
--   migration-goal.sql
--       the weekly goal you pick on your profile.
--       Without it the app assumes two sessions a week and the setting
--       silently does nothing.
--
--   migration-plan.sql
--       your own twelve weeks.
--       Without it Edit weeks cannot save.
--
--   migration-reliability.sql
--       the reliability score.
--       Without it no percentage appears anywhere.
--
--   migration-room-per-session.sql
--       one video room per session instead of one per partnership.
--       Until it runs, every session with the same person reuses one URL,
--       so the room is a standing key to the partnership rather than to
--       the booking.
--
--   migration-attendance.sql
--       who actually turned up.
--       The room page writes through this. Without it nothing ever fills
--       attended or joined_at, and the reliability score above stays blank
--       no matter how many sessions you sit.
--
-- The files above are still there and still the source of truth — each one
-- carries the reasoning for what it does. This file is only their contents
-- concatenated in the order they were written, so that running them is one
-- action rather than five. If you edit a migration, rebuild this from the
-- originals rather than editing it here.
--
-- Generated 2026-08-16 from:
--   supabase/migration-goal.sql
--   supabase/migration-plan.sql
--   supabase/migration-reliability.sql
--   supabase/migration-room-per-session.sql
--   supabase/migration-attendance.sql
-- ============================================================


-- ============================================================
-- BEGIN migration-goal.sql
-- ============================================================

-- ============================================================
-- PeerFlow — a weekly goal
--
-- Run this once in the Supabase SQL editor, after schema.sql.
-- Additive: one column. Without it the app assumes two sessions a week and
-- the setting on the profile page quietly does nothing.
--
-- WHY
-- The streak is counted in weeks, and a ring that fills as the week goes is
-- what stops the feedback loop being seven days long — you can see where you
-- stand on Wednesday rather than finding out on Monday. A ring needs a
-- denominator, and the only honest one is a number the person chose.
--
-- Two is the default because one session a week is not a habit and three is
-- most people's aspiration rather than their diary.
-- ============================================================

alter table public.profiles
  add column if not exists sessions_per_week int not null default 2;

alter table public.profiles drop constraint if exists sessions_per_week_range;
alter table public.profiles
  add constraint sessions_per_week_range
  check (sessions_per_week between 1 and 5);

-- ---------- END migration-goal.sql ----------


-- ============================================================
-- BEGIN migration-plan.sql
-- ============================================================

-- ============================================================
-- PeerFlow — your own twelve weeks
--
-- Run this once in the Supabase SQL editor, after schema.sql.
-- Additive: one column. Without it the plan is read-only and the Edit
-- button says so rather than appearing and then failing.
--
-- WHY
-- The twelve weeks in plans.js are a default, not a curriculum — the point
-- of them was always that PeerFlow holds the order while somebody else holds
-- the material. A default nobody can change is a curriculum, though, and the
-- person who knows what they need to learn in week seven is the person doing
-- the learning.
--
-- Stored as jsonb rather than a row per week: a plan is read and written as
-- one whole thing, always by one person, and a twelve-row table for that
-- would be a join and a transaction to save a list somebody just retyped.
-- Null means "use the default for my track", which is also what every
-- existing row means today.
-- ============================================================

alter table public.profiles
  add column if not exists plan_weeks jsonb;

-- A plan is a list of strings, and a short one. The check keeps a client bug
-- or a hand-written insert from parking a megabyte of anything in a column
-- every page load reads.
--
-- The per-week rule is written as a jsonpath rather than the `not exists
-- (select ...)` it reads like, because Postgres will not take a subquery in a
-- check constraint. jsonb_path_exists is an ordinary function call, so it is
-- allowed: it asks "is there any element that is not a string, or is longer
-- than 120 characters", and the constraint holds when the answer is no.
--
-- Three details, each of which let something through when it was missing:
--   * `strict` — the default is lax, and lax mode flattens nested arrays, so
--     ["ok", ["nope"]] would be read as two harmless strings.
--   * `flag "s"` — like_regex is XQuery, not POSIX, so `.` skips newlines
--     unless dot-all is on, and 200 newlines would have counted as length 0.
--   * `case` rather than `and` — Postgres does not promise to evaluate AND
--     left to right, and `strict $[*]` against a non-array raises rather than
--     returning false. CASE is short-circuiting by definition, so the type
--     test really does happen first and a bad value fails as a violation
--     instead of an error about jsonpath.
alter table public.profiles drop constraint if exists plan_weeks_shape;
alter table public.profiles
  add constraint plan_weeks_shape check (
    plan_weeks is null or case
      when jsonb_typeof(plan_weeks) <> 'array' then false
      when jsonb_array_length(plan_weeks) not between 1 and 24 then false
      else not jsonb_path_exists(
        plan_weeks,
        'strict $[*] ? (@.type() <> "string" || @ like_regex ".{121}" flag "s")'
      )
    end
  );

-- ---------- END migration-plan.sql ----------


-- ============================================================
-- BEGIN migration-reliability.sql
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

-- ---------- END migration-reliability.sql ----------


-- ============================================================
-- BEGIN migration-room-per-session.sql
-- ============================================================

-- ============================================================
-- One room per session, not one room per partnership.
--
-- room_url was doing two jobs. It is the video room, and it is also
-- the only thing tying a booking's two rows together — which is why
-- answer_session and drop_session key on (starts_at, room_url) — and
-- on top of that it was being used as the partner identifier, because
-- every session with the same person reused the same URL:
--
--     https://meet.jit.si/PeerFlow-<partner_request id>
--
-- That made the URL a standing key to the partnership. Block someone
-- and they still hold a working address for every future call the two
-- of you ever book, because the room name never changes. Jitsi's own
-- guidance is a fresh room name per meeting.
--
-- So the room becomes per-booking and random, and the partnership
-- moves to a column of its own. room_url keeps its other job — it is
-- still shared by a booking's two rows and the two RPCs still key on
-- it — so neither SECURITY DEFINER function changes.
--
-- Safe to run more than once.
-- ============================================================

-- ---------- the partnership, as its own column ----------
alter table public.sessions
  add column if not exists pair_id uuid
  references public.partner_requests(id) on delete set null;

-- Streaks, session counts and the pair's history all filter by partner.
create index if not exists sessions_user_pair on public.sessions (user_id, pair_id);

-- ---------- backfill ----------
-- Every existing row already names its partnership: the room URL is the
-- literal string 'https://meet.jit.si/PeerFlow-' followed by the
-- partner_requests id. Joining on that exact shape rather than parsing a
-- uuid out of the text means a row can only ever be matched to a request
-- that really exists, so the new foreign key cannot be violated — and the
-- older rows built from a user id instead of a request id are simply left
-- null, which every reader already treats as "no partner history".
update public.sessions s
   set pair_id = pr.id
  from public.partner_requests pr
 where s.pair_id is null
   and s.room_url = 'https://meet.jit.si/PeerFlow-' || pr.id::text;

-- Rooms already in the database keep the names they have. Rewriting them
-- would break any session currently in progress and would rename rooms
-- for bookings the other person has already been told about; the point of
-- this change is that the *next* booking gets a fresh room, and from here
-- every booking does.

-- ---------- END migration-room-per-session.sql ----------


-- ============================================================
-- BEGIN migration-attendance.sql
-- ============================================================

-- ============================================================
-- PeerFlow — who actually turned up
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migration-reliability.sql and
-- migration-room-per-session.sql. Additive: two functions, no new columns.
-- Safe to run more than once.
--
-- WHY
-- The reliability score reads `attended` and `joined_at`, and until now
-- nothing on earth wrote them. Both columns existed, every query treated them
-- as meaningful, and both were null on every row that has ever been created —
-- so the score could never reach the five graded sessions it needs and would
-- have stayed blank forever. The score was not wrong; it was starved.
--
-- It was starved because the call was somewhere else. A session handed you a
-- meet.jit.si link and you left the site, so PeerFlow never found out whether
-- you arrived. app-room.html puts the call back inside the app, and these two
-- functions are what it writes through.
--
-- TWO WAYS A SESSION GETS GRADED
--
-- join_session is the happy one: the room page calls it the moment the video
-- connects, and it stamps your own row — only ever your own row, since
-- reliability is tracked per participant and the two rows of a booking are
-- graded separately.
--
-- settle_sessions is the sad one, and it is deliberately reluctant. Somebody
-- who never showed leaves a row that is null forever, and a null is not
-- counted, so a no-show would cost them nothing. But marking every unjoined
-- session as a no-show is worse: two people who met on Zoom that day, or over
-- coffee, would both be branded for it. So the rule is evidence-based —
--
--     you are marked absent only if your partner was present.
--
-- If neither of you used the room, nothing is recorded and the session simply
-- does not count for either of you. That is the honest reading of what we
-- know. It costs us some real no-shows, and it never invents one.
--
-- WHY NOT A CRON
-- settle_sessions is called by the app on load rather than run on a schedule.
-- Supabase gives you pg_cron, but a scheduled job is one more thing that can
-- be silently not running, and this has no deadline: a session settles the
-- next time either person opens PeerFlow, which is exactly when the number
-- would be looked at. It only ever touches the caller's own rows, so it stays
-- honest about who is allowed to write what.
-- ============================================================


-- ---------- arriving ----------
-- Returns the time you arrived, which the page shows back to you. Raises if
-- the session is not yours, is not confirmed, or is not open yet: without the
-- window a person could call this a fortnight early and be graded on time.
create or replace function public.join_session(
  p_starts_at timestamptz,
  p_room      text
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz;
begin
  update public.sessions s
     set joined_at = coalesce(s.joined_at, now()),
         attended  = true
   where s.user_id   = auth.uid()
     and s.starts_at = p_starts_at
     and s.room_url  = p_room
     and s.status    = 'confirmed'
     /* The same window the Join button obeys: a quarter of an hour before,
        until a quarter of an hour after it should have ended. */
     and now() >= s.starts_at - interval '15 minutes'
     and now() <= s.starts_at + make_interval(mins => s.duration_min) + interval '15 minutes'
  returning s.joined_at into t;

  if t is null then
    raise exception 'no session open for this user';
  end if;
  return t;
end $$;

revoke all on function public.join_session(timestamptz, text) from public, anon;
grant execute on function public.join_session(timestamptz, text) to authenticated;


-- ---------- not arriving ----------
-- Only your own rows, only sessions that have finished, only where the other
-- person can be shown to have been there. Returns how many it settled.
create or replace function public.settle_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.sessions s
     set attended = false
   where s.user_id   = auth.uid()
     and s.status    = 'confirmed'
     and s.attended  is null
     and s.joined_at is null
     and now() > s.starts_at + make_interval(mins => s.duration_min)
     and exists (
       select 1
         from public.sessions o
        where o.room_url  = s.room_url
          and o.starts_at = s.starts_at
          and o.user_id  <> s.user_id
          and o.joined_at is not null
     );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.settle_sessions() from public, anon;
grant execute on function public.settle_sessions() to authenticated;

-- ---------- END migration-attendance.sql ----------


