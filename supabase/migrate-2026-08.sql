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
--   migration-goal.sql              the weekly goal you pick on your profile.
--                                   Without it the app assumes two sessions a
--                                   week and the setting silently does nothing.
--
--   migration-plan.sql              your own twelve weeks. Without it Edit
--                                   weeks cannot save.
--
--   migration-reliability.sql       the reliability score. Without it no
--                                   percentage appears anywhere.
--
--   migration-room-per-session.sql  one video room per session instead of one
--                                   per partnership. This is the one that
--                                   matters most: until it runs, every session
--                                   with the same person reuses one URL, so the
--                                   room is a standing key to the partnership
--                                   rather than to the booking.

--   migration-video.sql             the call, in PeerFlow. Adds the room name
--                                   and the rule for who may join it. Without
--                                   it, pressing Join says calls are not set
--                                   up on this site yet. This one needs more
--                                   than a paste — a LiveKit project and two
--                                   edge functions as well, in docs/VIDEO.md.
--
-- The five files above are still there and still the source of truth — each
-- one carries the reasoning for what it does. This file is only their contents
-- concatenated in the order they were written, so that running them is one
-- action rather than five. If you edit a migration, rebuild this from the
-- originals rather than editing it here.
--
-- Generated 2026-08-16 from:
--   supabase/migration-goal.sql
--   supabase/migration-plan.sql
--   supabase/migration-reliability.sql
--   supabase/migration-room-per-session.sql
--   supabase/migration-video.sql
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
-- BEGIN migration-video.sql
-- ============================================================

-- ============================================================
-- PeerFlow — the call, in PeerFlow
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migration-reliability.sql and
-- migration-room-per-session.sql. Safe to run more than once.
--
-- WHY
-- Until now the "call" was a link to a public Jitsi address opened in
-- another tab. Anybody holding the URL could walk in, and PeerFlow saw
-- nothing at all: not who joined, not when, not for how long. That is why
-- reliability has never shown a number, and why the session count is really
-- a count of bookings whose time has passed.
--
-- The room becomes ours. A LiveKit server admits nobody who has not been
-- handed a signed token, and the only thing that mints one is the
-- call-token edge function, which asks this file whether the person in
-- front of it is allowed in. So the answer to "who may join this call" is
-- written once, here, in the same place as every other rule about a
-- session — not in an edge function, and certainly not in a URL.
--
-- WHAT THIS ADDS
--   sessions.room_name   the LiveKit room, one per booking, shared by the
--                        booking's two rows
--   sessions.left_at     when the call let go of you
--   session_for_call()   may this person join this session, right now?
--   record_presence()    the room reporting back, via the webhook
-- ============================================================


-- ---------- the room ----------
-- room_url stays exactly as it is. It is still the thing that ties a
-- booking's two rows together, and answer_session and drop_session still key
-- on it, so nothing that already works has to change. What it stops being is
-- an address: a Jitsi URL is a standing invitation to anybody who has it,
-- and the new room is not addressable at all — you arrive by asking for a
-- token, or you do not arrive.
alter table public.sessions add column if not exists room_name text;

-- When the room let go of you. joined_at (from migration-reliability.sql)
-- and this bracket the time you were actually in the call, which is the
-- difference between "turned up" and "turned up for four minutes".
alter table public.sessions add column if not exists left_at timestamptz;

-- The webhook arrives knowing a room and a participant, and has to find two
-- rows from that alone.
create index if not exists sessions_room_name on public.sessions (room_name);

-- ---------- backfill ----------
-- Existing bookings keep their identity: the uuid already inside the Jitsi
-- URL becomes the room name, so a session booked before this migration and
-- held after it works, and both of its rows agree on the name because both
-- rows share room_url.
--
-- Rooms built the very old way — named after a user or a partner request
-- rather than per booking — would give two different sessions the same room,
-- so they are deliberately left null and get a name the next time anybody
-- books. A null room_name is also how every reader tells a session from
-- before the call was ours: no name, no observation, nothing to conclude
-- from silence.
update public.sessions s
   set room_name = 'pf-' || substring(s.room_url from '([0-9a-fA-F-]{36})$')
 where s.room_name is null
   -- Any room_url ending in a uuid, which covers both shapes that have
   -- existed: the old 'https://meet.jit.si/PeerFlow-<uuid>' and the 'pf:<uuid>'
   -- key that replaced it. Rows written while this migration was pending get
   -- their room the moment it is run.
   and s.room_url ~ '[0-9a-fA-F-]{36}$'
   -- A room belonging to one booking is held by exactly two rows. Anything
   -- shared more widely is one of the old partnership-wide rooms, and giving
   -- six sessions one room name would drop six calls into the same place.
   and (select count(*) from public.sessions o where o.room_url = s.room_url) <= 2;


-- ============================================================
-- May this person join this session, right now?
--
-- Five questions, and the edge function that mints the token asks no
-- others. It runs as the caller — auth.uid() is the person holding the
-- session, not a service key — so the answer cannot be talked into being
-- about somebody else by passing a different id.
--
-- It is security definer for one reason: question five reads the
-- partnership, and question four needs the booking rather than just your
-- half of it. RLS would allow neither, correctly, and both are facts about
-- a session you are already in.
--
-- It returns a reason rather than raising, because every refusal here is
-- something a person needs a sentence about — "you're early" is not an
-- error, it is the answer.
-- ============================================================
create or replace function public.session_for_call(p_session uuid)
returns table (
  ok        boolean,
  reason    text,
  room      text,
  identity  uuid,
  display   text,
  partner   text,
  topic     text,
  goal      text,
  starts_at timestamptz,
  ends_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.sessions%rowtype;
  me       uuid := auth.uid();
  opens    timestamptz;
  closes   timestamptz;
  my_name  text;
  paired   boolean;
begin
  -- 1. Signed in, and this is your own row of a session.
  --
  -- A session that is not yours and a session that does not exist give the
  -- same answer on purpose. Distinguishing them would turn this function
  -- into a way of asking whether a given id is a real booking.
  if me is null then
    return query select false, 'signed-out', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into s from public.sessions
   where id = p_session and user_id = me;

  if not found then
    return query select false, 'unknown', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 2. Both of you agreed to it. A proposal nobody answered is not a
  --    session, and a cancelled one is a session that was called off — in
  --    both cases the room should not exist, and the caller says which it
  --    is so the page can offer the right thing to do next.
  if s.status <> 'confirmed' and s.status <> 'completed' then
    return query select false, s.status, null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        s.starts_at, null::timestamptz;
    return;
  end if;

  -- 3. It is time. Fifteen minutes before, which is what the dashboard has
  --    always promised, and a grace period at the far end so that a call
  --    which started late is not shut down mid-sentence.
  opens  := s.starts_at - interval '15 minutes';
  closes := s.starts_at + (s.duration_min || ' minutes')::interval + interval '20 minutes';

  if now() < opens then
    return query select false, 'too-early', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        s.starts_at, closes;
    return;
  end if;
  if now() > closes then
    return query select false, 'too-late', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        s.starts_at, closes;
    return;
  end if;

  -- 4. There is a room to join. Sessions booked before this migration whose
  --    room could not be named uniquely have none, and no room means no
  --    call — the two of you still have the Jitsi link you were given when
  --    you booked, and the next booking gets a real room.
  if s.room_name is null then
    return query select false, 'no-room', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        s.starts_at, closes;
    return;
  end if;

  -- 5. You are still partners. Ending a partnership has to end the standing
  --    invitation that goes with it, otherwise every session the two of you
  --    ever booked stays walkable-into for as long as the calendar
  --    remembers it. Sessions from before pair_id existed cannot be checked
  --    this way and are let through on the strength of the other four —
  --    they are already yours, already agreed, and already in the window.
  if s.pair_id is null then
    paired := true;
  else
    select (pr.status = 'accepted' and pr.ended_at is null) into paired
      from public.partner_requests pr
     where pr.id = s.pair_id;
    paired := coalesce(paired, false);
  end if;

  if not paired then
    return query select false, 'not-partners', null::text, null::uuid,
                        null::text, null::text, null::text, null::text,
                        s.starts_at, closes;
    return;
  end if;

  select p.name into my_name from public.profiles p where p.id = me;

  return query select true, 'ok', s.room_name, me,
                      coalesce(nullif(my_name, ''), 'A partner'),
                      s.partner_name, s.topic, s.goal,
                      s.starts_at, closes;
end $$;

-- Only a signed-in person may ask, and the only thing that ever calls it is
-- the token endpoint, forwarding that person's own JWT.
revoke all on function public.session_for_call(uuid) from public, anon;
grant execute on function public.session_for_call(uuid) to authenticated;


-- ============================================================
-- The room, reporting back.
--
-- This is the whole point of owning the call. LiveKit sends a signed
-- webhook when somebody joins and when they leave; the webhook function
-- verifies the signature and calls this. It is the first thing in PeerFlow
-- that writes attendance, and it is not a question anybody is asked.
--
-- Called only by the webhook, which holds the service role, so there is no
-- auth.uid() here and nothing may execute it from a browser.
-- ============================================================
create or replace function public.record_presence(
  p_room   text,
  p_user   uuid,
  p_joined timestamptz default null,
  p_left   timestamptz default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_room is null or p_user is null then
    return 0;
  end if;

  update public.sessions
     set attended  = true,
         -- The first join is the one that counts. Somebody whose connection
         -- drops and who comes back twenty minutes later did not arrive
         -- twenty minutes late, and least() over the existing value is what
         -- keeps a reconnection from being scored as lateness.
         joined_at = least(coalesce(joined_at, p_joined), coalesce(p_joined, joined_at)),
         -- The last leave, by the same argument in reverse.
         left_at   = greatest(coalesce(left_at, p_left), coalesce(p_left, left_at))
   where room_name = p_room
     and user_id   = p_user;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.record_presence(text, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;


-- ============================================================
-- The room closing.
--
-- LiveKit ends a room when the last person leaves. At that moment anybody
-- who was going to turn up has turned up, so a row still holding null
-- attended is a no-show — observed, not assumed, which is the difference
-- between this and asking people whether they made it.
--
-- Only rows with a room_name are touched, so nothing from before the call
-- was ours is ever graded on evidence that was never collected.
-- ============================================================
create or replace function public.close_room(p_room text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_room is null then
    return 0;
  end if;

  update public.sessions
     set attended = false
   where room_name = p_room
     and attended is null
     -- Not a session somebody called off: a cancelled booking has no
     -- no-show in it, and reliability already scores the cancellation.
     and status in ('confirmed', 'completed');
  get diagnostics n = row_count;

  -- A call that somebody sat through is over, and 'completed' is what every
  -- reader already treats as a session that happened.
  update public.sessions
     set status = 'completed'
   where room_name = p_room
     and status = 'confirmed'
     and exists (
       select 1 from public.sessions a
        where a.room_name = p_room and a.attended is true
     );

  return n;
end $$;

revoke all on function public.close_room(text) from public, anon, authenticated;

-- ---------- END migration-video.sql ----------
