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

--   migration-no-double-booking.sql the database refusing to put two agreed
--                                   sessions on one person at one time.
--                                   Without it that rule is advice given by
--                                   the browser, which cannot see the other
--                                   person's calendar and loses the race
--                                   between two devices. It also stops the
--                                   standing slot booking on top of sessions
--                                   you had already agreed to.
--
--   migration-video.sql             the call, in PeerFlow. Adds the room name
--                                   and the rule for who may join it. Without
--                                   it, pressing Join says calls are not set
--                                   up on this site yet. This one needs more
--                                   than a paste — a LiveKit project and two
--                                   edge functions as well, in docs/VIDEO.md.

--   migration-standing.sql          the standing weekly slot. Without it the
--                                   rail card cannot be used AND every page
--                                   load 400s on partner_requests, because the
--                                   columns it selects are not there. The data
--                                   layer recovers and reads the narrower set,
--                                   so partners still load — but a red request
--                                   in the console on every load is how a
--                                   working page comes to look broken.

--   migration-chat.sql              the messages table behind the Chat tab.
--                                   Without it Chat says messaging is not
--                                   switched on.
--
-- The seven files above are still there and still the source of truth — each
-- one carries the reasoning for what it does. This file is only their contents
-- concatenated in the order they were written, so that running them is one
-- action rather than seven. If you edit a migration, rebuild this from the
-- originals rather than editing it here.
--
-- Generated 2026-08-16 from:
--   supabase/migration-goal.sql
--   supabase/migration-plan.sql
--   supabase/migration-reliability.sql
--   supabase/migration-room-per-session.sql
--   supabase/migration-video.sql
--   supabase/migration-standing.sql
--   supabase/migration-chat.sql
--   supabase/migration-no-double-booking.sql
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
  room_id  text;
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

  -- 4. There is a room to join.
  --
  --    The backfill above is a one-shot, and there is a window where it is
  --    not enough: run this migration, then book a session from a copy of
  --    the site that has not been redeployed yet, and you get a row written
  --    by the old code — a room_url ending in a uuid, and no room_name,
  --    because the backfill had already been and gone. The booking is
  --    perfectly good and the room is unreachable, which reads as "this one
  --    was booked before PeerFlow had its own room" about a session made
  --    five minutes ago.
  --
  --    So the name is derived here when the column is empty, on the same
  --    terms the backfill uses: a uuid at the end of room_url, held by at
  --    most the booking's own two rows. Both people derive the same name,
  --    because both rows carry the same room_url.
  --
  --    And it is written back rather than only returned. The webhook finds
  --    its rows by room_name, so a room that exists only in this function's
  --    return value would let people into a call whose attendance could
  --    never be recorded.
  room_id := s.room_name;

  if room_id is null and s.room_url ~ '[0-9a-fA-F-]{36}$'
     and (select count(*) from public.sessions o where o.room_url = s.room_url) <= 2 then
    room_id := 'pf-' || substring(s.room_url from '([0-9a-fA-F-]{36})$');
    update public.sessions
       set room_name = room_id
     where room_url = s.room_url
       and room_name is null;
  end if;

  --    Genuinely nothing to join: one of the very old rooms shared by every
  --    session with the same person, where a derived name would drop several
  --    bookings into one call.
  if room_id is null then
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

  -- A call that somebody sat through is over — but only once the hour it was
  -- booked for is actually over.
  --
  -- LiveKit ends a room the moment the last person leaves it, which is not
  -- the same thing as the session ending. Somebody steps out to find a
  -- charger, a connection drops, one of you joins early and leaves again
  -- before the other arrives: the room finishes, and this used to move the
  -- booking to 'completed' three minutes into a fifty-minute session. The
  -- dashboard lists sessions by status, so the Join button vanished from a
  -- call that was still open, and the only way back in was a link nobody
  -- had.
  --
  -- Attendance above is recorded either way, because that part really was
  -- observed. This is only the question of whether the booking is finished,
  -- and the booking is finished when its own clock says so.
  update public.sessions
     set status = 'completed'
   where room_name = p_room
     and status = 'confirmed'
     and starts_at + (duration_min || ' minutes')::interval <= now()
     and exists (
       select 1 from public.sessions a
        where a.room_name = p_room and a.attended is true
     );

  return n;
end $$;

revoke all on function public.close_room(text) from public, anon, authenticated;

-- ---------- END migration-video.sql ----------


-- ============================================================
-- BEGIN migration-standing.sql
-- ============================================================

-- ============================================================
-- PeerFlow — standing weekly slots
--
-- Run this once in the Supabase SQL editor, after schema.sql.
-- Additive only: it adds columns and functions and does not change or drop
-- anything schema.sql created, so the app keeps working if you never run it
-- (db.js falls back when the columns are missing).
--
-- WHY THIS EXISTS
-- Every session is currently a fresh negotiation: propose, wait, accept.
-- That friction is paid once per session, which is exactly the wrong shape
-- for something you are trying to turn into a habit. A standing slot moves
-- the default from "nothing is booked" to "Thursday at 19:00 unless one of
-- you moves it".
--
-- WHERE IT LIVES
-- On partner_requests, not on a table of its own. The partnership row is
-- already readable by both people (the "read own requests" policy), so one
-- row serves both and there is no second copy to drift out of step — unlike
-- sessions, which need two rows and definer functions to keep them in step.
-- It also means ending a partnership takes its standing slot with it.
-- ============================================================

-- ---------- the slot ----------

-- The first occurrence, as an absolute instant, not a weekday and an hour.
-- Two partners in different timezones asked "which Thursday 19:00?" would
-- answer differently, and on the three weekends a year when one of them
-- changes clocks and the other doesn't, they would book different instants
-- and each end up alone in a room. An anchor plus seven days has exactly one
-- answer, and each person's screen renders it in their own time.
alter table public.partner_requests add column if not exists standing_anchor  timestamptz;
alter table public.partner_requests add column if not exists standing_minutes int not null default 50;
-- Who suggested it, and when the other one agreed. A recurring commitment on
-- somebody else's calendar is not something one person gets to make alone.
alter table public.partner_requests add column if not exists standing_by      uuid references auth.users(id) on delete set null;
alter table public.partner_requests add column if not exists standing_set_at  timestamptz;
alter table public.partner_requests add column if not exists standing_ok_at   timestamptz;

alter table public.partner_requests drop constraint if exists standing_minutes_range;
alter table public.partner_requests
  add constraint standing_minutes_range
  check (standing_minutes in (25, 50, 80));

-- ---------- one booking per person per slot ----------

-- materialise_standing runs on page load, so two tabs opening at once would
-- otherwise race and book the same hour twice. Existing duplicates are the
-- same booking counted twice; keep the physically-first row of each set so
-- the index can be built. ctid rather than created_at because two rows
-- inserted in one statement share a timestamp.
delete from public.sessions a
 using public.sessions b
 where a.user_id  = b.user_id
   and a.starts_at = b.starts_at
   and coalesce(a.room_url, '') = coalesce(b.room_url, '')
   and a.ctid > b.ctid;

create unique index if not exists sessions_one_per_slot
  on public.sessions (user_id, starts_at, (coalesce(room_url, '')));

-- ---------- setting and answering ----------

-- Suggest a standing slot. Replaces whatever was there, and always lands
-- unaccepted: changing the hour is a new thing to agree to, not an edit.
create or replace function public.set_standing_slot(
  p_request uuid,
  p_anchor  timestamptz,
  p_minutes int
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_minutes not in (25, 50, 80) then
    raise exception 'bad length';
  end if;
  -- An anchor in the past would materialise nothing and read as a silent
  -- failure; an anchor years out is a typo, not a plan.
  if p_anchor < now() - interval '1 hour' or p_anchor > now() + interval '90 days' then
    raise exception 'anchor out of range';
  end if;

  update public.partner_requests
     set standing_anchor  = p_anchor,
         standing_minutes = p_minutes,
         standing_by      = auth.uid(),
         standing_set_at  = now(),
         standing_ok_at   = null
   where id = p_request
     and status = 'accepted'
     and auth.uid() in (from_user, to_user);

  get diagnostics n = row_count;
  if n = 0 then raise exception 'no such partnership for this user'; end if;
  return n;
end $$;

-- Agree to it. Only the other person can: accepting your own suggestion
-- would make the whole handshake decorative.
create or replace function public.accept_standing_slot(p_request uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.partner_requests
     set standing_ok_at = now()
   where id = p_request
     and status = 'accepted'
     and standing_anchor is not null
     and standing_ok_at is null
     and auth.uid() in (from_user, to_user)
     and standing_by is distinct from auth.uid();

  get diagnostics n = row_count;
  if n = 0 then raise exception 'nothing of yours to accept'; end if;
  return n;
end $$;

-- Stop it. Either of you, at any time, without asking. Sessions already
-- booked stay booked — ending the arrangement is not the same as walking out
-- of the ones you agreed to, and cancelling those is a separate button.
create or replace function public.clear_standing_slot(p_request uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.partner_requests
     set standing_anchor = null, standing_by = null,
         standing_set_at = null, standing_ok_at = null
   where id = p_request
     and auth.uid() in (from_user, to_user);

  get diagnostics n = row_count;
  if n = 0 then raise exception 'no such partnership for this user'; end if;
  return n;
end $$;

-- ---------- turning the slot into bookings ----------

-- There is no scheduler: PeerFlow is a static site and Supabase's free tier
-- has no cron, so occurrences are created when somebody opens the app. That
-- is fine — a booking nobody has looked at yet has never mattered — but it
-- does mean this has to be safe to call on every page load. It is: it only
-- ever fills gaps in the next few weeks, and it never touches an occurrence
-- that already exists in any state.
--
-- Computed here rather than in the browser so there is exactly one authority
-- on when an occurrence falls. Two clients in two timezones agreeing to
-- within an hour is not agreeing.
create or replace function public.materialise_standing(
  p_request uuid,
  p_weeks   int default 4
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.partner_requests%rowtype;
  room      text;
  from_name text;
  to_name   text;
  t         timestamptz;
  step      int;
  have      int := 0;   -- upcoming occurrences that exist and still stand
  n         int := 0;   -- of those, the ones this call had to create
  guard     int := 0;
begin
  if p_weeks is null or p_weeks < 1 then p_weeks := 4; end if;
  if p_weeks > 8 then p_weeks := 8; end if;

  select * into r from public.partner_requests
   where id = p_request
     and status = 'accepted'
     and auth.uid() in (from_user, to_user);
  if not found then raise exception 'no such partnership for this user'; end if;

  -- Nothing agreed yet is not an error; it is the normal state of most
  -- partnerships, and the app calls this without checking first.
  if r.standing_anchor is null or r.standing_ok_at is null then return 0; end if;

  room := 'https://meet.jit.si/PeerFlow-' || r.id::text;
  select name into from_name from public.profiles where id = r.from_user;
  select name into to_name   from public.profiles where id = r.to_user;

  -- Jump straight to the first occurrence that has not already happened
  -- rather than walking a year of history one week at a time.
  step := greatest(0, ceil(extract(epoch from (now() - r.standing_anchor)) / 604800.0)::int);

  -- The target is "four weeks of this are on the calendar", not "book four
  -- more". Occurrences that are already there count towards it, or every
  -- page load would book another month.
  --
  -- guard, not have, bounds the loop: a cancelled week is stepped over and
  -- refilled from further out, and stepping over must not eat the quota.
  while have < p_weeks and guard < p_weeks + 12 loop
    t := r.standing_anchor + (step * interval '7 days');
    step  := step + 1;
    guard := guard + 1;

    if t < now() then continue; end if;

    if exists (
      select 1 from public.sessions
       where starts_at = t and room_url = room
         and user_id in (r.from_user, r.to_user)
    ) then
      -- Something is already here. It counts as one of the four only while
      -- it still stands: a cancelled occurrence is an answer, and putting it
      -- back on the next page load would be the app arguing with somebody
      -- who already said no.
      if exists (
        select 1 from public.sessions
         where starts_at = t and room_url = room
           and user_id in (r.from_user, r.to_user)
           and status in ('confirmed', 'proposed')
      ) then
        have := have + 1;
      end if;
      continue;
    end if;

    insert into public.sessions
      (user_id, partner_name, topic, starts_at, duration_min, room_url, status, proposed_by)
    values
      (r.from_user, to_name,   null, t, r.standing_minutes, room, 'confirmed', r.standing_by),
      (r.to_user,   from_name, null, t, r.standing_minutes, room, 'confirmed', r.standing_by)
    on conflict do nothing;

    have := have + 1;
    n    := n + 1;
  end loop;

  return n;
end $$;

-- ---------- who may call them ----------

revoke all on function public.set_standing_slot(uuid, timestamptz, int) from public, anon;
revoke all on function public.accept_standing_slot(uuid)                from public, anon;
revoke all on function public.clear_standing_slot(uuid)                 from public, anon;
revoke all on function public.materialise_standing(uuid, int)           from public, anon;

grant execute on function public.set_standing_slot(uuid, timestamptz, int) to authenticated;
grant execute on function public.accept_standing_slot(uuid)                to authenticated;
grant execute on function public.clear_standing_slot(uuid)                 to authenticated;
grant execute on function public.materialise_standing(uuid, int)           to authenticated;

-- ---------- END migration-standing.sql ----------


-- ============================================================
-- BEGIN migration-chat.sql
-- ============================================================

-- ============================================================
-- PeerFlow — direct messages
--
-- Run this once in the Supabase SQL editor, after schema.sql.
-- Additive only. Without it the Chat page says messaging is not switched on
-- and every other page carries on exactly as before.
--
-- WHO MAY MESSAGE WHOM
-- Anyone you already have a partner request with, in any state: you asked
-- them, or they asked you. That is the consent gate the product already has,
-- so this adds no new one — and it means a stranger cannot arrive in your
-- inbox uninvited, which on a site full of students matters more than the
-- convenience of open DMs. Widening it later is one line in one policy.
-- ============================================================

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  -- Set on the recipient's side only, by mark_thread_read below.
  read_at    timestamptz,
  constraint no_self_message check (from_user <> to_user),
  constraint body_not_empty  check (length(btrim(body)) > 0),
  constraint body_length     check (length(body) <= 2000)
);

-- Reading a thread is "everything between these two, oldest first", and the
-- unread badge is "anything to me that is unread". One index each.
create index if not exists messages_thread on public.messages (from_user, to_user, created_at);
create index if not exists messages_inbox  on public.messages (to_user, read_at);

alter table public.messages enable row level security;

drop policy if exists "read your own messages"    on public.messages;
drop policy if exists "message people you know"   on public.messages;

create policy "read your own messages"
  on public.messages for select
  using (auth.uid() in (from_user, to_user));

-- Send as yourself, and only to somebody one of you has already approached.
create policy "message people you know"
  on public.messages for insert with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.partner_requests r
      where (r.from_user = auth.uid() and r.to_user   = messages.to_user)
         or (r.to_user   = auth.uid() and r.from_user = messages.to_user)
    )
  );

-- No UPDATE or DELETE policy on purpose. Marking a thread read is the only
-- change anybody needs to make to a message that already exists, and it goes
-- through the function below — an UPDATE policy wide enough to set read_at
-- would also be wide enough to rewrite what somebody said.

create or replace function public.mark_thread_read(p_other uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.messages
     set read_at = now()
   where to_user = auth.uid()
     and from_user = p_other
     and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------- END migration-chat.sql ----------


-- ============================================================
-- BEGIN migration-no-double-booking.sql
-- ============================================================

-- ============================================================
-- PeerFlow — one session at a time, enforced by the database
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql and migrate-2026-08.sql. Safe to run more than once.
--
-- WHY
--
-- Nothing in the database has ever stopped a person being booked into two
-- sessions at the same moment. The only guard was `clashIn` in assets/db.js,
-- which reads the sessions the browser has already loaded and refuses to
-- send a proposal that overlaps one. That is a good thing to keep — it gives
-- an instant, specific answer without a round trip — but it is advice, not a
-- rule. It fails in three ways that matter:
--
--   * Two devices, or two tabs, proposing at the same moment both read a
--     clash-free calendar before either writes, so both writes land.
--   * It only ever sees *your* sessions. RLS limits SELECT to your own rows,
--     so the browser cannot tell whether the person you are booking is
--     already busy. You could always book a partner into a slot they had
--     already given to somebody else.
--   * It is client-side, so anything that is not the booking form — a
--     hand-written PostgREST request, or materialise_standing running inside
--     the database — bypassed it completely.
--
-- The third one was not theoretical. materialise_standing inserts *confirmed*
-- sessions on every page load and has never checked for a clash, so a
-- standing weekly slot would quietly book itself on top of a one-off session
-- the two of you had already agreed to.
--
-- WHAT THIS DOES
--
-- An exclusion constraint, which is the only mechanism here that is actually
-- race-proof: it is enforced by an index, inside the same lock that does the
-- insert, so two concurrent transactions cannot both pass it. A trigger alone
-- could not — under READ COMMITTED both transactions would look, see nothing,
-- and both commit.
--
-- The constraint covers 'confirmed' and 'completed' only. It deliberately
-- does NOT cover 'proposed', because a proposal is an offer rather than a
-- commitment: two different partners may each offer you Tuesday at three, and
-- you pick one. Making pending offers exclude each other would let anybody
-- squat your calendar with proposals you never answered. What must never
-- happen is two *agreed* sessions at once, and that is what is enforced.
--
-- The trigger on top of it is only there for the error message. A raw
-- exclusion violation reads "conflicting key value violates exclusion
-- constraint" and names an index, which is exactly the sort of thing db.js
-- exists to keep off the screen.
-- ============================================================


-- ---------- the span of a session, as something an index can hold ----------

-- An exclusion constraint needs its expressions marked IMMUTABLE, and
-- `starts_at + interval` is not: `timestamptz + interval` is STABLE, because
-- adding days or months has to know the session timezone to land on the right
-- side of a daylight-saving change.
--
-- That reasoning does not apply to us. Durations here are minutes and only
-- ever minutes (25, 50 or 80), and adding a pure-minutes interval to a
-- timestamptz is exact arithmetic on the underlying UTC instant — the same
-- answer in every timezone, including across a spring-forward. So this
-- wrapper is not a lie told to the planner to get the index built; it is
-- immutable in fact, for the inputs this column can hold.
--
-- coalesce and greatest keep the range non-empty. An empty range overlaps
-- nothing, so a row with a null or zero duration would slip past the
-- constraint rather than being caught by it.
create or replace function public.session_span(p_starts timestamptz, p_minutes int)
returns tstzrange
language sql
immutable
parallel safe
as $$
  select tstzrange(p_starts,
                   p_starts + make_interval(mins => greatest(coalesce(p_minutes, 50), 1)))
$$;


-- gist needs btree_gist to put a uuid and a range in one index: the `=` on
-- user_id is a btree operator, and without this extension gist cannot use it.
create extension if not exists btree_gist;


-- ---------- clear the way ----------

-- The constraint cannot be added while rows already break it, and unlike a
-- CHECK there is no NOT VALID to defer that — an exclusion constraint is an
-- index, and the index has to build. Overlaps almost certainly do exist,
-- because materialise_standing has been booking confirmed sessions with no
-- clash check on every page load for as long as standing slots have existed.
--
-- So: resolve them first, and say so. The newer booking of each overlapping
-- pair loses, because the older one is the one the two people have had longer
-- and are more likely to be planning around.
--
-- It is cancelled rather than deleted, and *both* of its rows are, which is
-- the same reasoning drop_session already follows: deleting a session clears
-- the other person's calendar with no explanation, which is indistinguishable
-- from the app losing it. A cancelled row stays visible and says what it is.
do $$
declare
  losers   text[];
  n        int;
begin
  -- Both rows of a booking share (starts_at, room_url), so the loser is
  -- identified by that pair rather than by row id. Comparing created_at and
  -- falling back to ctid matters because the two rows of one booking are
  -- inserted in a single statement and therefore share a timestamp.
  with overlapping as (
    select distinct
           case when (b.created_at, b.ctid) > (a.created_at, a.ctid)
                then b.starts_at else a.starts_at end as starts_at,
           case when (b.created_at, b.ctid) > (a.created_at, a.ctid)
                then b.room_url  else a.room_url  end as room_url
      from public.sessions a
      join public.sessions b
        on a.user_id = b.user_id
       and a.id <> b.id
       and a.status in ('confirmed', 'completed')
       and b.status in ('confirmed', 'completed')
       and public.session_span(a.starts_at, a.duration_min)
        && public.session_span(b.starts_at, b.duration_min)
  )
  update public.sessions s
     set status       = 'cancelled',
         cancelled_at = coalesce(s.cancelled_at, now())
    from overlapping o
   where s.starts_at = o.starts_at
     and coalesce(s.room_url, '') = coalesce(o.room_url, '')
     and s.status in ('confirmed', 'completed');

  get diagnostics n = row_count;

  if n > 0 then
    raise notice 'PeerFlow: cancelled % row(s) that were double-booked before this constraint existed. Both copies of each affected booking were cancelled, so nobody is left holding half a session.', n;
  else
    raise notice 'PeerFlow: no existing double bookings to clear.';
  end if;
end $$;


-- ---------- the rule ----------

alter table public.sessions drop constraint if exists sessions_no_overlap;
alter table public.sessions
  add constraint sessions_no_overlap
  exclude using gist (
    user_id                                        with =,
    public.session_span(starts_at, duration_min)   with &&
  )
  where (status in ('confirmed', 'completed'));


-- ---------- the same rule, in a sentence ----------

-- Everything below is about what the person sees. The constraint above is
-- what is actually true; this turns it into something db.js can put on the
-- screen without naming an index.
--
-- SECURITY DEFINER is load-bearing and easy to get wrong. A trigger function
-- runs as whoever did the insert, and "read own sessions" limits SELECT to
-- auth.uid()'s own rows — so a clash check written the obvious way would
-- simply not see the partner's other bookings and would pass every time,
-- silently, which is worse than not having it. Running as the definer means
-- it sees both sides, exactly as answer_session and drop_session already do.
create or replace function public.sessions_clash_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clash public.sessions%rowtype;
begin
  -- Proposals are offers and may pile up, so only a commitment is checked.
  -- But a proposal is checked *against* commitments: offering a time the
  -- other person has already agreed away to somebody else is an offer they
  -- could never accept, and the constraint would reject the acceptance
  -- rather than the proposal, which puts the error in front of the wrong
  -- person on the wrong day.
  if new.status not in ('proposed', 'confirmed', 'completed') then
    return new;
  end if;

  select * into clash
    from public.sessions s
   where s.user_id = new.user_id
     and s.id is distinct from new.id
     and s.status in ('confirmed', 'completed')
     and public.session_span(s.starts_at, s.duration_min)
      && public.session_span(new.starts_at, new.duration_min)
   limit 1;

  if found then
    -- Whose calendar is full changes the sentence, because a booking writes
    -- one row for each person and either of them can be the one that clashes.
    -- auth.uid() is null when this runs from an edge function on the service
    -- role, so that case gets the neutral wording rather than a wrong "you".
    if auth.uid() is not null and new.user_id = auth.uid() then
      raise exception 'You already have a session at that time.'
        using errcode = 'PF001';
    else
      raise exception 'They already have a session at that time.'
        using errcode = 'PF001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists sessions_clash_guard on public.sessions;
create trigger sessions_clash_guard
  before insert or update of starts_at, duration_min, status
  on public.sessions
  for each row
  execute function public.sessions_clash_guard();


-- ---------- accepting a proposal can now be refused ----------

-- Same contract as before — check the caller owns a copy, then move both rows
-- — with one addition: accepting is the moment a proposal becomes a
-- commitment, so it is the moment the clash rule starts applying to it. Two
-- people can each propose you the same hour quite legitimately; you may only
-- say yes to one of them, and this is where the second yes is refused.
--
-- The exception is caught and rephrased rather than left to propagate,
-- because what comes out of the constraint names an index and what comes out
-- of the trigger is written for the person doing the inserting. Here the
-- caller is the one accepting, and "that time is already taken" is true for
-- either side of the pair without having to work out which row failed.
create or replace function public.answer_session(
  p_starts_at timestamptz,
  p_room      text,
  p_status    text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_status not in ('confirmed', 'declined', 'cancelled', 'completed', 'no_show') then
    raise exception 'bad status';
  end if;
  if not exists (
    select 1 from public.sessions
    where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room
  ) then
    raise exception 'no such session for this user';
  end if;

  begin
    update public.sessions
       set status       = p_status,
           cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
           cancelled_at = case when p_status = 'cancelled' then now()      else cancelled_at end
     where starts_at = p_starts_at and room_url = p_room;
  exception
    when exclusion_violation or sqlstate 'PF001' then
      raise exception 'That time is no longer free — one of you has since agreed to something else then.'
        using errcode = 'PF001';
  end;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.answer_session(timestamptz, text, text) from public, anon;
grant execute on function public.answer_session(timestamptz, text, text) to authenticated;


-- ---------- the standing slot stops booking over things ----------

-- Unchanged except for the clash check, and the reason it needs one is worth
-- writing down. This inserts both rows of an occurrence in a single statement
-- with `on conflict do nothing`. That was fine against a unique index on the
-- exact slot, but against an exclusion constraint DO NOTHING skips only the
-- row that conflicts and inserts the other one — so an occurrence where just
-- one of you was busy would have written half a booking: a session on their
-- calendar and nothing on yours, with no way for either of you to tell.
--
-- So the clash is now checked before the insert, for both people, and a week
-- where either of you is already busy is skipped. Skipped, not counted: it
-- does not go towards the four weeks, so the slot fills in from further out
-- and you still end up with four, which is what somebody asking for a weekly
-- session actually wants.
create or replace function public.materialise_standing(
  p_request uuid,
  p_weeks   int default 4
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.partner_requests%rowtype;
  room      text;
  from_name text;
  to_name   text;
  t         timestamptz;
  step      int;
  have      int := 0;   -- upcoming occurrences that exist and still stand
  n         int := 0;   -- of those, the ones this call had to create
  guard     int := 0;
begin
  if p_weeks is null or p_weeks < 1 then p_weeks := 4; end if;
  if p_weeks > 8 then p_weeks := 8; end if;

  select * into r from public.partner_requests
   where id = p_request
     and status = 'accepted'
     and auth.uid() in (from_user, to_user);
  if not found then raise exception 'no such partnership for this user'; end if;

  -- Nothing agreed yet is not an error; it is the normal state of most
  -- partnerships, and the app calls this without checking first.
  if r.standing_anchor is null or r.standing_ok_at is null then return 0; end if;

  room := 'https://meet.jit.si/PeerFlow-' || r.id::text;
  select name into from_name from public.profiles where id = r.from_user;
  select name into to_name   from public.profiles where id = r.to_user;

  -- Jump straight to the first occurrence that has not already happened
  -- rather than walking a year of history one week at a time.
  step := greatest(0, ceil(extract(epoch from (now() - r.standing_anchor)) / 604800.0)::int);

  -- The target is "four weeks of this are on the calendar", not "book four
  -- more". Occurrences that are already there count towards it, or every
  -- page load would book another month.
  --
  -- guard, not have, bounds the loop: a cancelled week is stepped over and
  -- refilled from further out, and stepping over must not eat the quota.
  while have < p_weeks and guard < p_weeks + 12 loop
    t := r.standing_anchor + (step * interval '7 days');
    step  := step + 1;
    guard := guard + 1;

    if t < now() then continue; end if;

    if exists (
      select 1 from public.sessions
       where starts_at = t and room_url = room
         and user_id in (r.from_user, r.to_user)
    ) then
      -- Something is already here. It counts as one of the four only while
      -- it still stands: a cancelled occurrence is an answer, and putting it
      -- back on the next page load would be the app arguing with somebody
      -- who already said no.
      if exists (
        select 1 from public.sessions
         where starts_at = t and room_url = room
           and user_id in (r.from_user, r.to_user)
           and status in ('confirmed', 'proposed')
      ) then
        have := have + 1;
      end if;
      continue;
    end if;

    -- Either of you being busy skips the whole occurrence rather than half
    -- of it. Without this the insert below would write one row and drop the
    -- other, and nothing downstream would notice.
    if exists (
      select 1 from public.sessions s
       where s.user_id in (r.from_user, r.to_user)
         and s.status in ('confirmed', 'completed')
         and public.session_span(s.starts_at, s.duration_min)
          && public.session_span(t, r.standing_minutes)
    ) then
      continue;
    end if;

    insert into public.sessions
      (user_id, partner_name, topic, starts_at, duration_min, room_url, status, proposed_by)
    values
      (r.from_user, to_name,   null, t, r.standing_minutes, room, 'confirmed', r.standing_by),
      (r.to_user,   from_name, null, t, r.standing_minutes, room, 'confirmed', r.standing_by)
    on conflict do nothing;

    have := have + 1;
    n    := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.materialise_standing(uuid, int) from public, anon;
grant execute on function public.materialise_standing(uuid, int) to authenticated;

-- ---------- END migration-no-double-booking.sql ----------
