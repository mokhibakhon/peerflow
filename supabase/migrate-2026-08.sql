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
--   migration-no-jitsi.sql          the last Jitsi url, and the reason
--                                   standing weekly sessions have never been
--                                   joinable: they all shared one room per
--                                   partnership, so no room name could be
--                                   derived and Join said there was no room.
--                                   Gives every occurrence its own room.
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
--   migration-notify.sql            session events raising notifications at
--                                   all. notify_partner() was written and
--                                   called from nowhere, so proposing a time
--                                   told your partner nothing — not even the
--                                   bell. Also the email dispatch behind
--                                   Settings → Email, in docs/EMAIL.md.
--
--   migration-safety.sql            report, block, and delete your account.
--                                   Until it runs, the code of conduct
--                                   promises one-tap report and block against
--                                   a database that has neither table, and
--                                   Settings offers no way out but an email
--                                   address.
--
--   migration-attendance.sql        who turned up. Until it runs, no session
--                                   ever gets an outcome, so the reliability
--                                   score has nothing to read and shows
--                                   nothing about anybody — which is the
--                                   state it has actually been in all along,
--                                   because the old reliability_of() filtered
--                                   on sessions.confirmed_at and nothing in
--                                   the app has ever written that column. It
--                                   also adds the cancellation rules, the
--                                   post-session check-in, the pause after
--                                   three missed sessions, session reminders,
--                                   and the trigger that stops a browser
--                                   writing its own attendance. Must be run
--                                   after everything above it, since it
--                                   replaces functions several of them
--                                   created.
--
--   migration-reschedule.sql        moving a booked session to another hour in
--                                   one atomic step, with one notification
--                                   rather than a cancellation and a proposal.
--                                   Without it the Reschedule control is not
--                                   drawn at all — a control that cannot save
--                                   anything is deliberately not offered.
--
--   migration-dormancy.sql           the nudge when an established partnership
--                                   goes quiet. Without it the gone-quiet band
--                                   never appears and nothing reaches the half
--                                   of the pair who is not looking. Must be run
--                                   after migration-reschedule.sql: it folds
--                                   its sweep into an attendance_tick() that
--                                   assumes what the reschedule file redefines.
--
-- The files above are still there and still the source of truth — each
-- one carries the reasoning for what it does. This file is only their contents
-- concatenated in the order they were written, so that running them is one
-- action rather than fourteen. If you edit a migration, rebuild this from the
-- originals rather than editing it here — and fold it in and band the original
-- as superseded in the same change, because a migration file that is not in
-- here and has no banner is indistinguishable from one that is, and the way
-- that goes wrong is somebody pasting an old definition over a newer one
-- without any error.
--
-- Generated 2026-08-19, extended 2026-08-25, from:
--   supabase/migration-goal.sql
--   supabase/migration-plan.sql
--   supabase/migration-reliability.sql
--   supabase/migration-room-per-session.sql
--   supabase/migration-video.sql
--   supabase/migration-standing.sql
--   supabase/migration-chat.sql
--   supabase/migration-no-double-booking.sql
--   supabase/migration-no-jitsi.sql
--   supabase/migration-notify.sql
--   supabase/migration-safety.sql
--   supabase/migration-attendance.sql
--   supabase/migration-reschedule.sql
--   supabase/migration-dormancy.sql
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


-- ============================================================
-- BEGIN migration-no-jitsi.sql
-- ============================================================

-- ============================================================
-- PeerFlow — the last of Jitsi, and the standing slot gets a room
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migrate-2026-08.sql and migration-no-double-booking.sql.
-- It must come after that last one: both redefine materialise_standing, and
-- whichever runs last wins. Safe to run more than once.
--
-- WHY
--
-- The call has been PeerFlow's own since migration-video.sql. Jitsi is not
-- used for anything any more — nothing links to it, nothing embeds it, and
-- room_url stopped being an address and became an opaque key that ties a
-- booking's two rows together.
--
-- One place never got the message. materialise_standing still builds
--
--     'https://meet.jit.si/PeerFlow-' || partner_request id
--
-- and writes it into room_url on every page load. That is not merely an ugly
-- leftover, and this is the part worth reading twice: it is one room_url for
-- the entire partnership, shared by every occurrence the standing slot has
-- ever created.
--
-- WHAT THAT BREAKS
--
-- session_for_call derives a missing room_name from the uuid at the end of
-- room_url, but only when at most two rows share that url — because a room
-- belonging to one booking is held by exactly two rows, and deriving one name
-- for a url shared more widely would drop several different calls into the
-- same room.
--
-- A standing slot holding four weeks is eight rows on one url. Eight is not
-- two. So the derivation is correctly refused, room_name stays null, and
-- session_for_call answers 'no-room'.
--
-- Standing weekly sessions have therefore never been joinable. Not "joinable
-- with a stale room" — the Join button says there is no room to join, for
-- every occurrence, for every partnership that ever agreed a weekly slot.
-- materialise_standing sets neither room_name nor pair_id, because it was
-- written before either column existed and was never revisited when they
-- arrived.
--
-- WHAT THIS DOES
--
-- Gives every occurrence its own room, which is what proposeSession has done
-- since migration-room-per-session.sql and what the whole design assumes. The
-- partnership-wide url goes, the per-booking one replaces it, and the standing
-- slot starts writing room_name and pair_id like every other booking.
-- ============================================================


-- ---------- existing occurrences get a room each ----------

-- One new identity per occurrence, not per row: both people's copies of the
-- same week must keep matching, because answer_session and drop_session find a
-- booking by (starts_at, room_url) and would otherwise move one side only.
-- Grouping by (old url, starts_at) is exactly "one occurrence", and
-- gen_random_uuid() is evaluated once per group because the group is one row.
--
-- room_name is derived from the same uuid so a room is legible next to its
-- key, matching the 'pf:<uuid>' / 'pf-<uuid>' pairing used everywhere else.
do $$
declare
  n int;
begin
  with occurrence as (
    select room_url as old_url,
           starts_at,
           gen_random_uuid() as fresh
      from public.sessions
     where room_url like 'https://meet.jit.si/PeerFlow-%'
     group by room_url, starts_at
  )
  update public.sessions s
     set room_url  = 'pf:' || o.fresh::text,
         room_name = coalesce(s.room_name, 'pf-' || o.fresh::text),
         -- The uuid in the old url is the partnership's id, which is what
         -- pair_id wants. Only adopt it if that partnership still exists,
         -- since pair_id is a foreign key and a partnership can be ended.
         pair_id   = coalesce(
                       s.pair_id,
                       (select pr.id from public.partner_requests pr
                         where pr.id::text = substring(o.old_url from '([0-9a-fA-F-]{36})$'))
                     )
    from occurrence o
   where s.room_url = o.old_url
     and s.starts_at = o.starts_at;

  get diagnostics n = row_count;
  if n > 0 then
    raise notice 'PeerFlow: gave % standing-session row(s) a room of their own. They were sharing one room per partnership and none of them could be joined.', n;
  else
    raise notice 'PeerFlow: no Jitsi-era room urls left to convert.';
  end if;
end $$;


-- ---------- and the standing slot stops making more of them ----------

-- Unchanged from the version in migration-no-double-booking.sql except for
-- the room, and the three things that follow from it.
--
-- The room is now minted per occurrence rather than derived from the
-- partnership, so room_url is unique to the booking, room_name is set at
-- insert instead of being left for a self-heal that could never fire, and
-- pair_id is written directly rather than being reverse-engineered out of the
-- url by a backfill.
--
-- Because the url is no longer derivable from the partnership, "is this week
-- already booked?" cannot be asked as `room_url = <the partnership's url>`
-- any more. It is asked by pair_id instead, which is what that column is for.
-- The legacy url is still matched alongside it, so a database where the
-- conversion above has not run — or where a row was written by the old code
-- between the two — is still recognised rather than booked over.
create or replace function public.materialise_standing(
  p_request uuid,
  p_weeks   int default 4
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.partner_requests%rowtype;
  legacy_url text;
  from_name  text;
  to_name    text;
  fresh      uuid;
  t          timestamptz;
  step       int;
  have       int := 0;   -- upcoming occurrences that exist and still stand
  n          int := 0;   -- of those, the ones this call had to create
  guard      int := 0;
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

  -- Only ever read, never written: it is how occurrences booked before this
  -- migration are still recognised.
  legacy_url := 'https://meet.jit.si/PeerFlow-' || r.id::text;

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
       where starts_at = t
         and user_id in (r.from_user, r.to_user)
         and (pair_id = r.id or room_url = legacy_url)
    ) then
      -- Something is already here. It counts as one of the four only while
      -- it still stands: a cancelled occurrence is an answer, and putting it
      -- back on the next page load would be the app arguing with somebody
      -- who already said no.
      if exists (
        select 1 from public.sessions
         where starts_at = t
           and user_id in (r.from_user, r.to_user)
           and (pair_id = r.id or room_url = legacy_url)
           and status in ('confirmed', 'proposed')
      ) then
        have := have + 1;
      end if;
      continue;
    end if;

    -- Either of you being busy skips the whole occurrence rather than half
    -- of it. Without this the insert below would write one row and drop the
    -- other, because `on conflict do nothing` skips only the row that
    -- actually conflicts with the no-overlap constraint.
    if exists (
      select 1 from public.sessions s
       where s.user_id in (r.from_user, r.to_user)
         and s.status in ('confirmed', 'completed')
         and public.session_span(s.starts_at, s.duration_min)
          && public.session_span(t, r.standing_minutes)
    ) then
      continue;
    end if;

    -- A room of its own, every week, exactly as proposeSession does it.
    fresh := gen_random_uuid();

    insert into public.sessions
      (user_id, partner_name, topic, starts_at, duration_min,
       room_url, room_name, pair_id, status, proposed_by)
    values
      (r.from_user, to_name,   null, t, r.standing_minutes,
       'pf:' || fresh::text, 'pf-' || fresh::text, r.id, 'confirmed', r.standing_by),
      (r.to_user,   from_name, null, t, r.standing_minutes,
       'pf:' || fresh::text, 'pf-' || fresh::text, r.id, 'confirmed', r.standing_by)
    on conflict do nothing;

    have := have + 1;
    n    := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.materialise_standing(uuid, int) from public, anon;
grant execute on function public.materialise_standing(uuid, int) to authenticated;

-- ---------- END migration-no-jitsi.sql ----------


-- ============================================================
-- BEGIN migration-notify.sql
-- ============================================================

-- ============================================================
-- PeerFlow — telling people things
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql and migrate-2026-08.sql. Safe to run more than once.
--
-- WHY
-- Two problems, and the second one hides the first.
--
-- Nothing tells anybody about a session. notify_partner() has been in the
-- database since the MVP migration — written, locked to real partnerships,
-- granted to authenticated — and is called from nowhere. Propose a time and
-- your partner learns about it the next time they happen to open PeerFlow.
-- Accept it and you learn the same way. The whole product is two people
-- agreeing an hour, and the agreeing half was silent.
--
-- And nothing leaves the site at all. Every notification is a row rendered by
-- the bell, so even once the bell rings you have to be looking at it. For
-- something that happens twice a week, that is not a notification.
--
-- So: the events raise notifications from triggers here, where no page can
-- forget them, and a notification worth an email posts itself to the
-- notify-email function. In-app works with no email set up at all.
-- ============================================================


-- ---------- who wants email ----------
-- On by default, because the notifications that trigger it are the ones a
-- session cannot happen without. Turned off in Settings.
alter table public.profiles
  add column if not exists email_notify boolean not null default true;

-- Stamped when the email goes, which is also what makes sending idempotent:
-- the function claims a row before it sends, so a retried or replayed call
-- finds nothing to do.
alter table public.notifications
  add column if not exists emailed_at timestamptz;


-- ============================================================
-- Raising a notification from inside the database.
--
-- notify_partner() cannot be used here: it checks auth.uid() against the
-- partnership, and a trigger firing during answer_session is already running
-- as somebody who has been checked. This one asks nothing, is callable by
-- nobody, and exists only for the triggers below.
-- ============================================================
create or replace function public.raise_note(
  p_to    uuid,
  p_kind  text,
  p_title text,
  p_body  text default null,
  p_href  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_to is null then return null; end if;
  insert into public.notifications (user_id, kind, title, body, href)
  values (p_to, p_kind, left(p_title, 200), left(p_body, 500), left(p_href, 200))
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.raise_note(uuid, text, text, text, text)
  from public, anon, authenticated;


-- The time, written in the reader's own clock.
--
-- A session is stored as an instant, and the two people are often in
-- different zones — telling somebody in Tashkent that their partner proposed
-- 14:00 UTC is telling them nothing. profiles.timezone holds an IANA name;
-- an empty or unrecognised one falls back to UTC rather than raising, because
-- a notification that fails to send is worse than one in the wrong zone.
create or replace function public.when_for(p_user uuid, p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
begin
  select nullif(timezone, '') into tz from public.profiles where id = p_user;
  begin
    return to_char(p_at at time zone coalesce(tz, 'UTC'), 'FMDay FMDD FMMon, HH12:MI AM');
  exception when others then
    return to_char(p_at at time zone 'UTC', 'FMDay FMDD FMMon, HH12:MI AM') || ' UTC';
  end;
end $$;


-- ============================================================
-- A time proposed.
--
-- A booking is two rows, one per person, inserted together. The row that is
-- news is the one belonging to whoever did NOT propose it — so exactly one
-- notification comes out of the pair, and nobody is told about their own
-- action.
-- ============================================================
create or replace function public.note_session_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'proposed'
     and new.proposed_by is not null
     and new.user_id <> new.proposed_by then
    perform public.raise_note(
      new.user_id, 'session',
      coalesce(nullif(new.partner_name, ''), 'Your partner') || ' proposed a session time',
      public.when_for(new.user_id, new.starts_at) ||
        coalesce(' · ' || nullif(new.topic, ''), '') ||
        '. Nothing is booked until you accept.',
      'app.html');
  end if;
  return null;
end $$;

drop trigger if exists session_proposed_note on public.sessions;
create trigger session_proposed_note
  after insert on public.sessions
  for each row execute function public.note_session_proposed();


-- ============================================================
-- A time answered.
--
-- answer_session moves both rows, so this fires twice. The row worth telling
-- somebody about is the one that is not the caller's, which is exactly one of
-- them — and when there is no caller at all (the webhook closing a room with
-- the service role) there is nobody to tell, so it stays quiet.
-- ============================================================
create or replace function public.note_session_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce(nullif(new.partner_name, ''), 'Your partner');
  headline text;
begin
  if auth.uid() is null then return null; end if;
  if new.status is not distinct from old.status then return null; end if;
  if new.user_id = auth.uid() then return null; end if;

  -- These are the subject line as well as the bell headline — the same string
  -- goes to notify-email, on purpose, so the two surfaces can never say
  -- different things about one event.
  --
  -- 'said yes' was briefly rewritten to 'accepted your session time', on the
  -- reasoning that a subject line sitting among somebody's real mail should
  -- be composed rather than chatty. Reverted on the owner's call, and the
  -- call is right: PeerFlow is two people agreeing an hour with each other,
  -- and 'Sarah said yes' is what actually happened. The formal version
  -- describes a workflow. This one describes a person.
  headline := case new.status
    when 'confirmed' then who || ' said yes'
    when 'declined'  then who || ' declined that time'
    when 'cancelled' then who || ' cancelled your session'
    else null end;

  if headline is null then return null; end if;

  perform public.raise_note(
    new.user_id, 'session', headline,
    public.when_for(new.user_id, new.starts_at) ||
      case new.status
        when 'confirmed' then '. It is now on both your calendars.'
        when 'declined'  then '. Propose another time whenever you are ready.'
        else '. It has come off both calendars. Propose another time whenever '
             || 'you are ready.' end,
    'app.html');
  return null;
end $$;

drop trigger if exists session_answered_note on public.sessions;
create trigger session_answered_note
  after update on public.sessions
  for each row execute function public.note_session_answered();


-- ============================================================
-- Out of the building.
--
-- pg_net posts to the notify-email function, which decides whether to send —
-- it reads the address, honours email_notify, and claims the row so a retry
-- cannot send twice. Nothing secret travels in this request and none is
-- needed: the body is a notification id, and the function will only ever
-- email that notification's own recipient, once.
--
-- Badges are excluded. A note to yourself about a badge you have just been
-- shown on screen is not worth an email.
--
-- The whole thing is optional. Without pg_net the trigger is simply not
-- created and every notification still lands in the bell, which is why the
-- extension check is a branch rather than a hard requirement.
-- ============================================================
create or replace function public.dispatch_note_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Nothing you did to yourself gets emailed back to you. This read
  -- `new.kind = 'badge'` and nothing has ever written 'badge': notifySelf()
  -- is called once in the whole app, from app-progress.html, with
  -- 'achievement'. So the guard never fired, and the edge function does not
  -- filter by kind either — unlocking a badge would have emailed you about
  -- your own achievement, which docs/EMAIL.md says never happens. Harmless
  -- only because the email half is not switched on yet.
  --
  -- Named as a set rather than a single string so the next self-note does not
  -- have to remember this.
  if new.kind in ('achievement', 'badge') then return null; end if;
  begin
    perform net.http_post(
      url     := 'https://ooolpkdqrfhnmcmdqhau.supabase.co/functions/v1/notify-email',
      body    := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    -- Email is never allowed to fail the thing it is reporting on.
    null;
  end;
  return null;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    drop trigger if exists dispatch_note_email on public.notifications;
    create trigger dispatch_note_email
      after insert on public.notifications
      for each row execute function public.dispatch_note_email();
  else
    raise notice 'pg_net is not installed, so notifications will not be emailed. %',
                 'Run: create extension pg_net with schema extensions;';
  end if;
end $$;

-- ---------- END migration-notify.sql ----------



-- ============================================================
-- BEGIN migration-safety.sql
-- ============================================================

-- ============================================================
-- PeerFlow — report somebody, block them, and delete your account
--
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
--
-- The code of conduct has said this since the site went up:
--
--     "Every call has one-tap report and block, and you can report someone
--      whether or not you're still on the call."
--
-- None of it existed. There was no blocks table, no reports table, and no way
-- for anybody to stop anybody else from messaging them, asking to partner
-- with them, or booking time in their calendar. The only stated route out was
-- an email address in a footer.
--
-- What this adds:
--
--   blocks           who has blocked whom. Yours to read, yours to write,
--                    invisible to the person you blocked.
--   reports          what somebody said about somebody else, with the names
--                    written down at the time, so a report survives either
--                    account being deleted.
--   blocked_with()   the one question every policy below has to ask, asked in
--                    a way that does not require reading a table you are not
--                    allowed to read.
--   block_person()   block, end the partnership, and clear the calendar, in
--                    one transaction rather than three round trips that can
--                    half-fail.
--   report_person()  write a report, snapshot the names, and block by default.
--
-- and it narrows three existing policies so that a block actually stops
-- something rather than being a row nobody consults.
-- ============================================================


-- ---------- blocks ----------
-- A block is one-directional as a fact and two-directional in effect: I block
-- you, and neither of us can reach the other afterwards. Storing it as one row
-- with a direction rather than as a symmetric pair keeps "who did this" — I
-- can unblock you; you cannot unblock yourself.
create table if not exists public.blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint no_self_block check (blocker <> blocked)
);

-- The primary key already answers "who have I blocked". This answers "who has
-- blocked me", which is the direction blocked_with() below reads on every
-- profile row of every People page.
create index if not exists blocks_blocked on public.blocks (blocked);

alter table public.blocks enable row level security;

drop policy if exists "read your own blocks" on public.blocks;
drop policy if exists "block somebody"       on public.blocks;
drop policy if exists "unblock somebody"     on public.blocks;

-- Only your own rows, in the blocker direction. Being able to read rows where
-- you are the *blocked* party would turn a silent block into a notification,
-- which is the one thing a block must not be: the whole value of it to
-- somebody being harassed is that using it is not an act of confrontation.
create policy "read your own blocks"
  on public.blocks for select using (auth.uid() = blocker);
create policy "block somebody"
  on public.blocks for insert with check (auth.uid() = blocker);
create policy "unblock somebody"
  on public.blocks for delete using (auth.uid() = blocker);
-- No update policy. A block has nothing about it to change.

grant select, insert, delete on public.blocks to authenticated;


-- ---------- the question every policy has to ask ----------
-- "Is there a block, in either direction, between me and this person?"
--
-- It cannot be written as a plain subquery inside a policy, because a
-- subquery in a policy runs as the person asking and is therefore subject to
-- the blocks table's own RLS — which deliberately hides the rows where you
-- are the blocked party. A policy written that way would enforce blocks you
-- made and silently ignore blocks made against you, which is exactly backwards:
-- the person who needs the rule enforced is the one who did not write the row.
--
-- SECURITY DEFINER steps over that. It takes one argument rather than two so
-- that the only pair anybody can ask about is a pair they are already in.
create or replace function public.blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker = auth.uid() and b.blocked = p_other)
        or (b.blocker = p_other    and b.blocked = auth.uid())
  );
$$;

revoke all on function public.blocked_with(uuid) from public;
-- anon needs this as much as authenticated does, which is not obvious and was
-- found the hard way — see the profiles policy below for why. For a signed-out
-- caller auth.uid() is NULL, both halves of the OR compare against NULL, the
-- exists() finds nothing and the answer is false, so granting it away leaks
-- nothing: there is no pair for a caller with no identity to ask about.
grant execute on function public.blocked_with(uuid) to anon, authenticated, service_role;


-- ---------- blocking, as one act ----------
-- Blocking somebody you are partnered with has to end the partnership, or the
-- block does almost nothing: an accepted partner_requests row is what the
-- booking policy checks, so leaving it standing leaves them able to put time
-- in your calendar. And ending the partnership without clearing the calendar
-- leaves both of you holding sessions that can never be joined, because
-- session_for_call() refuses anybody who is no longer partnered.
--
-- All three belong in one transaction. Done from the browser as three calls,
-- the second or third can fail and leave somebody blocked but still bookable.
create or replace function public.block_person(p_other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;
  if p_other is null or p_other = me then
    raise exception 'you cannot block yourself' using errcode = 'PF011';
  end if;

  insert into public.blocks (blocker, blocked)
  values (me, p_other)
  on conflict (blocker, blocked) do nothing;

  -- 'ended' rather than deleted, which is what migration-mvp.sql chose for
  -- walking away from a partnership: the sessions the two of you sat stay
  -- attributable to a pairing that really existed.
  update public.partner_requests
     set status   = 'ended',
         ended_at = coalesce(ended_at, now()),
         ended_by = coalesce(ended_by, me)
   where status = 'accepted'
     and ((from_user = me and to_user = p_other)
       or (to_user   = me and from_user = p_other));

  -- Everything still to come comes off both calendars. Sessions already sat
  -- are left alone — they happened, and rewriting history to say they did not
  -- would take somebody's streak away for having been harassed.
  update public.sessions s
     set status       = 'cancelled',
         cancelled_at = coalesce(s.cancelled_at, now()),
         cancelled_by = coalesce(s.cancelled_by, me)
   where s.status in ('proposed', 'confirmed')
     and s.starts_at > now()
     and s.pair_id in (
       select r.id from public.partner_requests r
        where (r.from_user = me and r.to_user = p_other)
           or (r.to_user   = me and r.from_user = p_other));
end;
$$;

revoke all on function public.block_person(uuid) from public, anon;
grant execute on function public.block_person(uuid) to authenticated;


-- ---------- reports ----------
-- Reports are write-only from the app's point of view: you can read the ones
-- you wrote and nothing else, and there is no update path at all. They are
-- read in the Supabase dashboard, by hand, which is the honest shape of
-- moderation on a site this size — a queue with nobody on it would be worse
-- than an inbox somebody actually opens.
--
-- reporter and reported are `on delete set null` rather than cascade, and the
-- two name columns exist, for one reason: a report has to outlive both
-- accounts. Somebody who harasses a person and then deletes their account
-- must not be able to delete the record of it on the way out, and the person
-- reading the report a month later needs to know who it was about.
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter      uuid references auth.users(id) on delete set null,
  reported      uuid references auth.users(id) on delete set null,
  reporter_name text,
  reported_name text,
  reason        text not null
                check (reason in ('harassment','no_show','spam','safety','other')),
  detail        text check (detail is null or length(detail) <= 2000),
  -- Which session it happened on, when there was one. Nullable, because the
  -- code of conduct promises you can report somebody whether or not you are
  -- still on the call — including when there was never a call.
  session_id    uuid references public.sessions(id) on delete set null,
  created_at    timestamptz not null default now(),
  handled_at    timestamptz
);

create index if not exists reports_reported on public.reports (reported, created_at desc);
-- The queue: everything nobody has looked at yet, newest first.
create index if not exists reports_open on public.reports (created_at desc)
  where handled_at is null;

alter table public.reports enable row level security;

drop policy if exists "read reports you wrote" on public.reports;

create policy "read reports you wrote"
  on public.reports for select using (auth.uid() = reporter);
-- No insert policy on purpose. Reports are written by report_person() below,
-- which fills in the names itself — a row whose reported_name the reporter got
-- to choose would be worth nothing as a record.

grant select on public.reports to authenticated;


create or replace function public.report_person(
  p_about   uuid,
  p_reason  text,
  p_detail  text default null,
  p_session uuid default null,
  p_block   boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  rid uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;
  if p_about is null or p_about = me then
    raise exception 'you cannot report yourself' using errcode = 'PF011';
  end if;
  if not exists (select 1 from public.profiles where id = p_about) then
    raise exception 'no such person' using errcode = 'PF012';
  end if;
  if p_reason is null or p_reason not in
       ('harassment','no_show','spam','safety','other') then
    raise exception 'unknown reason' using errcode = 'PF013';
  end if;

  -- Somebody upset enough to report a person is somebody who may well press
  -- the button twice. Collapsing repeats within the hour keeps the queue
  -- readable without ever telling them their report did not count — they get
  -- the same id back and the same confirmation.
  select r.id into rid
    from public.reports r
   where r.reporter = me
     and r.reported = p_about
     and r.created_at > now() - interval '1 hour'
   order by r.created_at desc
   limit 1;

  if rid is null then
    insert into public.reports (reporter, reported, reporter_name, reported_name,
                                reason, detail, session_id)
    select me,
           p_about,
           (select p.name from public.profiles p where p.id = me),
           (select p.name from public.profiles p where p.id = p_about),
           p_reason,
           nullif(btrim(coalesce(p_detail, '')), ''),
           -- Only a session that is genuinely yours. Without this the
           -- argument is a free pointer into anybody's calendar, and a report
           -- could be filed against a booking the reporter was never part of.
           (select s.id from public.sessions s
             where s.id = p_session and s.user_id = me)
    returning id into rid;
  end if;

  -- Blocking is the default rather than a second decision, because the state
  -- somebody is in when they report a person is not the state in which to ask
  -- them a follow-up question. The dialog lets them turn it off.
  if p_block then
    perform public.block_person(p_about);
  end if;

  return rid;
end;
$$;

revoke all on function public.report_person(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.report_person(uuid, text, text, uuid, boolean) to authenticated;


-- ============================================================
-- Making the block bite
-- ============================================================
-- Three policies decided who could reach whom, and none of them knew blocks
-- existed. Each gets the same clause added and nothing else changed.

-- ---------- profiles ----------
-- Blocked in either direction and the profile is simply not there. The person
-- disappears from People, and app-person.html falls into the "we couldn't find
-- that person" state it already had for a deleted account — which is the right
-- amount of information for both sides: the blocker sees them gone, and the
-- blocked party sees something indistinguishable from an account that closed.
--
-- This was first written as a CASE, on the reasoning that Postgres does not
-- promise to evaluate the arms of an AND or OR in written order and a
-- signed-out reader must never reach a function anon cannot execute. The CASE
-- was correct about evaluation and beside the point about permissions:
-- dev/sql-tests.sh had a signed-out read fail with "permission denied for
-- function blocked_with" while sitting on the `auth.uid() is null then true`
-- arm. EXECUTE is checked when the expression is prepared, not when an arm is
-- taken, so no amount of ordering saves a policy from a missing grant — which
-- is why blocked_with is granted to anon above, and why the test that caught
-- this is worth more than the comment that was wrong.
--
-- With the grant in place the plain expression is right and needs no guard: a
-- signed-out caller has no identity, so blocked_with returns false for every
-- row and the policy reads exactly as `true` used to.
drop policy if exists "profiles are viewable" on public.profiles;
create policy "profiles are viewable"
  on public.profiles for select using (
    id = auth.uid() or not public.blocked_with(id)
  );

-- ---------- partner requests ----------
-- Asking somebody to be your partner is the loudest thing one account can do
-- to another, so it is the first thing a block has to stop.
drop policy if exists "send requests as yourself" on public.partner_requests;
create policy "send requests as yourself"
  on public.partner_requests for insert
  with check (auth.uid() = from_user and not public.blocked_with(to_user));

-- The update policy matters as much as the insert one. `unique (from_user,
-- to_user)` means a second request between the same two people is an UPDATE
-- of the row that is already there, not an INSERT — so a policy that guarded
-- only inserts would let a blocked account revive a dead request by setting
-- its status back to 'pending'.
drop policy if exists "answer or mark seen" on public.partner_requests;
create policy "answer or mark seen"
  on public.partner_requests for update
  using (
    (auth.uid() = from_user or auth.uid() = to_user)
    and not public.blocked_with(
      case when auth.uid() = from_user then to_user else from_user end)
  );

-- ---------- messages ----------
drop policy if exists "message people you know" on public.messages;
create policy "message people you know"
  on public.messages for insert with check (
    auth.uid() = from_user
    and not public.blocked_with(messages.to_user)
    and exists (
      select 1 from public.partner_requests r
      where (r.from_user = auth.uid() and r.to_user   = messages.to_user)
         or (r.to_user   = auth.uid() and r.from_user = messages.to_user)
    )
  );
-- Messages already sent stay readable by both sides. Blocking stops what
-- happens next; it is not a right to edit somebody else's inbox, and a thread
-- that emptied itself would destroy the evidence for the report that usually
-- accompanies it.


-- ============================================================
-- Deleting your account
-- ============================================================
-- Settings used to say: email hello@peerflow.dev and your account is removed.
-- That is a promise made by a person who might be asleep, and it is not what
-- privacy.html now says — it says there is a button, it happens immediately,
-- and nobody has to approve it. This is that button.
--
-- Everything hangs off auth.users with `on delete cascade`, so deleting the
-- one row takes the profile, the sessions, the messages, the notifications,
-- the achievements, the partner requests and the blocks with it. The work
-- below is entirely about the rows that are NOT yours and would otherwise be
-- left holding a reference to somebody who no longer exists.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  mine text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  select coalesce(nullif(btrim(name), ''), 'Your partner')
    into mine from public.profiles where id = me;

  -- 1. Tell them, while there is still a row saying you were partners.
  --    After the cascade there is nothing left to work out who to tell, and
  --    somebody whose partner silently evaporates learns about it by turning
  --    up to a call that will not open.
  insert into public.notifications (user_id, kind, title, body, href)
  select case when r.from_user = me then r.to_user else r.from_user end,
         'partner',
         mine || ' closed their account',
         'Any sessions the two of you had booked have been called off. '
           || 'You can ask somebody else on Everyone.',
         'app-people.html'
    from public.partner_requests r
   where r.status = 'accepted'
     and (r.from_user = me or r.to_user = me);

  -- 2. Take the future off their calendar. Their row survives the cascade —
  --    it belongs to them — and would otherwise sit there as a confirmed
  --    session that can never be joined, because session_for_call() refuses
  --    anybody who is no longer partnered.
  --
  --    The two rows of one booking are matched on any of the three things
  --    they share. pair_id is the modern answer and the only one that is
  --    always right, but rows written before migration-room-per-session.sql
  --    have none, so room_name and room_url are checked too. A NULL on either
  --    side compares as NULL and simply does not match, which is the wanted
  --    behaviour: no match is better than a wrong one.
  update public.sessions o
     set status       = 'cancelled',
         cancelled_at = coalesce(o.cancelled_at, now())
    from public.sessions m
   where m.user_id = me
     and o.user_id <> me
     and o.status in ('proposed', 'confirmed')
     and o.starts_at > now()
     and o.starts_at = m.starts_at
     and (o.pair_id = m.pair_id
       or o.room_name = m.room_name
       or o.room_url  = m.room_url);

  -- 3. Take your name off the rows that outlive you. privacy.html promises
  --    exactly this: a former partner keeps the times the two of you booked,
  --    with your name off them. Deleting their rows outright would rewrite
  --    their own history and take their streak with it; leaving the name on
  --    would mean deleting your account did not delete your name.
  update public.sessions o
     set partner_name = null
    from public.sessions m
   where m.user_id = me
     and o.user_id <> me
     and o.starts_at = m.starts_at
     and (o.pair_id = m.pair_id
       or o.room_name = m.room_name
       or o.room_url  = m.room_url);

  -- 4. Reports need no work and that is the point. reporter and reported are
  --    `on delete set null` and the names were written down at report time,
  --    so harassing somebody and then closing the account does not delete the
  --    record of it. This comment exists so nobody later "tidies up" those
  --    columns into a cascade.

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- The function runs as its owner, which is whoever pasted this into the SQL
-- editor — the `postgres` role — and `postgres` can normally delete from
-- auth.users. Normally. If delete_own_account() ever fails with "permission
-- denied for table users", this is the missing grant, and it has to be run by
-- something that owns the auth schema. Wrapped so that a database where it is
-- neither needed nor permitted still loads this file.
do $$
begin
  execute 'grant delete on table auth.users to postgres';
exception when others then
  raise notice 'delete_own_account: could not grant delete on auth.users (%). '
               'Harmless unless deleting an account fails with a permission '
               'error, in which case this grant is what is missing.', sqlerrm;
end $$;


-- ============================================================
-- Taking it back, and adding to it
-- ============================================================
-- The reporting flow asks for one press: pick a reason and the report is
-- filed and the person is blocked, with no form in between. That is the right
-- shape — somebody reaching for this button has just been made uncomfortable,
-- and that is not the moment to ask them four questions — but it is only safe
-- if the press is reversible. These two functions are what make it so.

-- Undo. Deletes a report you have just made and, by default, unblocks them
-- with it.
--
-- Three conditions, and each one is doing work. `reporter = me` because this
-- is your report and nobody else's to withdraw. `handled_at is null` because
-- once somebody has read and acted on it, it is a record of a decision rather
-- than a draft. And the fifteen minutes because this is an undo button, not a
-- way to un-say something a week later — a report that could be withdrawn
-- indefinitely could be withdrawn under pressure.
--
-- What it deliberately does NOT restore is the partnership and the sessions
-- block_person() called off. Sessions do not record the status they had
-- before, so 'confirmed' and 'proposed' cannot be told apart afterwards, and
-- guessing would put a session somebody never agreed to back on their
-- calendar. The UI says this in as many words rather than implying a clean
-- reversal.
create or replace function public.withdraw_report(
  p_id      uuid,
  p_unblock boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  who uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  delete from public.reports
   where id = p_id
     and reporter = me
     and handled_at is null
     and created_at > now() - interval '15 minutes'
  returning reported into who;

  -- No row means the id was wrong, the report was somebody else's, it has
  -- been read already, or the window has closed. All four are "there is
  -- nothing to undo", which is a false rather than an error: the caller is a
  -- button that should say so quietly.
  if who is null then
    return false;
  end if;

  if p_unblock then
    delete from public.blocks where blocker = me and blocked = who;
  end if;

  return true;
end;
$$;

revoke all on function public.withdraw_report(uuid, boolean) from public, anon;
grant execute on function public.withdraw_report(uuid, boolean) to authenticated;


-- The other half of one-press reporting: the sentence you did not stop to
-- write. A day rather than fifteen minutes, because adding what happened is
-- not undoing anything and somebody may well come back to it once they have
-- stopped shaking. Still only your own report, and still not one that has
-- already been read — an account of an incident that can be rewritten after
-- somebody has acted on it is not a record.
create or replace function public.amend_report(
  p_id     uuid,
  p_detail text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  update public.reports
     set detail = nullif(btrim(coalesce(p_detail, '')), '')
   where id = p_id
     and reporter = me
     and handled_at is null
     and created_at > now() - interval '24 hours';

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.amend_report(uuid, text) from public, anon;
grant execute on function public.amend_report(uuid, text) to authenticated;


-- ---------- who is on the other side of this call ----------
-- call.html knows the partner's name and not their id: session_for_call()
-- returns `partner` as text, because until now nothing on that page needed
-- to address them as an account. Reporting does.
--
-- This is a separate lookup rather than a new column on session_for_call()
-- deliberately. That function is the gate every call goes through and its
-- shape is baked into the call-token edge function; widening it would mean a
-- migration and a redeployment to add a field that one button needs.
--
-- It answers only for a session that is yours, so it cannot be used to walk
-- the calendar looking up who sat with whom. NULL for anything else, which
-- the caller reads as "no report button".
create or replace function public.partner_for_session(p_session uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me    uuid := auth.uid();
  mine  public.sessions%rowtype;
  other uuid;
begin
  if me is null or p_session is null then
    return null;
  end if;

  select * into mine
    from public.sessions
   where id = p_session and user_id = me;
  if not found then
    return null;
  end if;

  -- The same three-way match the rest of this file uses to pair up the two
  -- rows of one booking: pair_id is the modern answer and the only one that
  -- is always right, room_name and room_url cover rows written before it
  -- existed, and a NULL on either side compares as NULL and simply fails to
  -- match — which is wanted, since no answer beats a wrong one here.
  select o.user_id into other
    from public.sessions o
   where o.user_id <> me
     and o.starts_at = mine.starts_at
     and (o.pair_id   = mine.pair_id
       or o.room_name = mine.room_name
       or o.room_url  = mine.room_url)
   limit 1;

  return other;
end;
$$;

revoke all on function public.partner_for_session(uuid) from public, anon;
grant execute on function public.partner_for_session(uuid) to authenticated;

-- ---------- END migration-safety.sql ----------


-- ============================================================
-- BEGIN migration-attendance.sql
-- ============================================================

-- ============================================================
-- PeerFlow — who turned up, and what that is worth
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql and migrate-2026-08.sql — it replaces functions that
-- migration-reliability.sql, migration-video.sql, migration-safety.sql and
-- migration-no-double-booking.sql created, so it has to come after all of
-- them. Safe to run more than once. Nothing here drops a column or deletes a
-- row.
--
-- WHY
-- The product promise is "find a study partner who actually shows up", and
-- until now PeerFlow could not tell you whether anybody did. The pieces were
-- all here — LiveKit writes sessions.attended, reliability_of() reads it —
-- but three things were missing and each one is the reason the next did not
-- work.
--
--   1. There was no outcome. A session's fate was spread across four columns
--      (status, attended, cancelled_by, cancelled_at) and re-derived, subtly
--      differently, in reliability_of(), in finished() in db.js, and in the
--      per-partner session count on the partner page. Three readings of the
--      same rows is three answers.
--
--   2. Nothing ever decided the commonest failure. LiveKit only sends
--      room_finished when a room existed, and a room only exists once
--      somebody joins — so the session where one person ghosts and the other
--      gives up and closes the tab produced no event at all, and attended
--      stayed null forever. The one case the whole feature is about was the
--      one case nothing observed.
--
--   3. The browser could write it. The "answer a proposal" policy in
--      schema.sql allows an UPDATE on your own session row, and `attended` is
--      a column on that row. Anybody who could open a console could mark
--      themselves present at every session they had ever booked.
--
-- So: one settled outcome per participant per session, decided by the
-- database from what the room observed, and unwritable from a browser.
--
-- WHAT IT ADDS
--   sessions.attendance          one of five outcomes, or null for "not yet"
--   sessions.attendance_source   how it was decided, so a claim is checkable
--   sessions.settled_at          when it was decided
--   sessions.partner_ok          the post-session check-in answer
--   sessions.continue_pref       carry on together, or find somebody else
--   settle_pair() / settle_due() the thing that decides, and the two ways in
--   session_checkin()            the check-in, and the rules that stop it
--                                being a way to slander somebody
--   end_partnership()            walking away without it being a report
--   reliability_of()             rewritten to read the outcome
--   partnering_restricted_until() the cooldown after three no-shows
--   sessions_truth_guard         the trigger that makes all of it mean
--                                something
--   send_due_reminders()         24 hours, 1 hour, 10 minutes
--
-- WHAT IT DOES NOT DO
-- It does not punish anybody for one missed session, it does not touch the
-- account of somebody who has missed several, and it never invents a verdict
-- out of silence. Where PeerFlow did not see what happened, it says nothing —
-- which is the same rule the rest of this schema already follows.
-- ============================================================


-- ============================================================
-- 1. The policy, in one place
--
-- Every number the feature turns on is a function rather than a literal
-- sitting in six queries. They are immutable and Postgres inlines them, so
-- this costs nothing at run time and means that changing the cancellation
-- line from six hours to four is one edit rather than a search.
--
-- assets/reliability.js carries the same set for the browser, and
-- dev/reliability-tests.js checks the two agree.
-- ============================================================

-- Cancel with at least this much notice and it is an early cancellation,
-- which costs nothing. Inside it, it is a late one. Six hours rather than
-- twelve because the thing being asked of somebody is "tell us as soon as you
-- know", and a line drawn at half a day makes an evening session
-- uncancellable from the moment you wake up.
create or replace function public.pf_cancel_notice_hours() returns int
  language sql immutable parallel safe as $$ select 6 $$;

-- How long after the start somebody can still be arriving. Two jobs: nobody
-- is called absent before it has passed, and a join after it is late rather
-- than on time.
create or replace function public.pf_grace_minutes() returns int
  language sql immutable parallel safe as $$ select 10 $$;

-- How many recent outcomes the score is made of. Long enough to be a record,
-- short enough that a bad fortnight in March is not still being served to
-- strangers in September.
create or replace function public.pf_window() returns int
  language sql immutable parallel safe as $$ select 20 $$;

-- Below this many graded sessions there is no percentage, only "New partner".
-- Three is the smallest number that is a pattern rather than an anecdote.
create or replace function public.pf_min_graded() returns int
  language sql immutable parallel safe as $$ select 3 $$;

-- The rolling window for the cooldown, how many no-shows fill it, and how
-- long it lasts.
create or replace function public.pf_noshow_days() returns int
  language sql immutable parallel safe as $$ select 30 $$;
create or replace function public.pf_noshow_limit() returns int
  language sql immutable parallel safe as $$ select 3 $$;
create or replace function public.pf_cooldown_days() returns int
  language sql immutable parallel safe as $$ select 7 $$;


-- ============================================================
-- 2. The outcome
--
-- Five values, on the row that is already one participant's half of one
-- meeting. There is no new table because there is nothing a new table would
-- hold that this row does not already: it has the person, the session, the
-- scheduled start, the join and leave the room reported, and when the
-- cancellation came in.
--
--   attended         they were in the room
--   cancelled_early  they called it off with at least six hours' notice
--   cancelled_late   they called it off inside six hours
--   no_show          the room was open, they were not in it, and they had
--                    not said anything
--   excused          nothing was asked of them: the other person called it
--                    off first, or the partnership ended before the day came
--
-- Null means undecided, and stays null rather than defaulting to anything.
-- A great many rows will sit at null for ever — every session from before
-- PeerFlow owned the call, and every session where nothing was watching —
-- and that is the correct answer for them.
-- ============================================================

alter table public.sessions add column if not exists attendance        text;
alter table public.sessions add column if not exists attendance_source text;
alter table public.sessions add column if not exists settled_at        timestamptz;

-- The post-session check-in. partner_ok is what this person said about the
-- OTHER one, which is why it is deliberately not the same column as their own
-- attendance: one is evidence, the other is a verdict, and the rules below
-- decide when the first is allowed to become the second.
alter table public.sessions add column if not exists partner_ok    boolean;
alter table public.sessions add column if not exists checked_in_at timestamptz;
alter table public.sessions add column if not exists continue_pref text;

-- One "your partner is waiting" per person per session, ever. Stamped when
-- the note goes out, which is also what stops it going out twice.
alter table public.sessions add column if not exists waiting_note_at timestamptz;

-- Which reminders have gone: 0 none, 1 the day before, 2 the hour before,
-- 3 the ten-minute one. A single monotonic number rather than three
-- timestamps because the only question ever asked of it is "how far have we
-- got", and because a session booked for this evening should get the ten
-- minute reminder and not also the two it has already missed.
alter table public.sessions add column if not exists reminded_stage smallint not null default 0;

alter table public.sessions drop constraint if exists sessions_attendance_check;
alter table public.sessions
  add constraint sessions_attendance_check
  check (attendance is null or attendance in
         ('attended', 'cancelled_early', 'cancelled_late', 'no_show', 'excused'));

-- Where the verdict came from, so that "they did not turn up" can always be
-- traced back to something. livekit is the room itself; partner is the other
-- person's check-in, which is only ever believed under the conditions in
-- session_checkin(); system is a cancellation or a partnership ending, where
-- there was nothing to observe because nothing was supposed to happen.
alter table public.sessions drop constraint if exists sessions_attendance_source_check;
alter table public.sessions
  add constraint sessions_attendance_source_check
  check (attendance_source is null or attendance_source in ('livekit', 'partner', 'system'));

alter table public.sessions drop constraint if exists sessions_continue_pref_check;
alter table public.sessions
  add constraint sessions_continue_pref_check
  check (continue_pref is null or continue_pref in ('continue', 'stop'));

-- reliability_of() reads one person's graded outcomes newest first, and the
-- cooldown reads their no-shows inside thirty days. Both are this index.
create index if not exists sessions_user_outcome
  on public.sessions (user_id, starts_at desc) where attendance is not null;

-- The settler's own question: what is over and still undecided.
create index if not exists sessions_unsettled
  on public.sessions (starts_at) where settled_at is null;

-- The reminder sweep's question, which is the mirror image: what is coming
-- and has not been mentioned yet.
create index if not exists sessions_reminders
  on public.sessions (starts_at) where reminded_stage < 3;


-- ============================================================
-- 3. Early or late
--
-- One function so that the six-hour line is drawn in exactly one place. A
-- cancellation with no timestamp on it is treated as early: those are rows
-- from before migration-mvp.sql added cancelled_at, and the direction to be
-- wrong in, when the evidence is missing, is the generous one.
-- ============================================================
create or replace function public.pf_cancel_kind(
  p_starts    timestamptz,
  p_cancelled timestamptz
) returns text
language sql immutable parallel safe
as $$
  select case
    when p_cancelled is null then 'cancelled_early'
    when p_starts - p_cancelled >= (public.pf_cancel_notice_hours() || ' hours')::interval
      then 'cancelled_early'
    else 'cancelled_late'
  end;
$$;


-- ============================================================
-- 4. Deciding a session
--
-- settle_pair() takes the two rows of one meeting — they share starts_at and
-- room_url, which is how every other function in this schema finds them — and
-- gives each person an outcome, or leaves them alone.
--
-- The rules, in the order they are asked:
--
--   cancelled by this person   early or late, by the six-hour line
--   cancelled by the other     excused. Somebody who was stood down is not
--                              somebody who did not turn up, and this is the
--                              rule that stops one flaky partner dragging
--                              down everybody they ever booked with
--   the room saw them          attended
--   the room said they were
--     absent                   no_show
--   the room saw the OTHER
--     one and not this one     no_show. This is the case nothing used to
--                              catch: LiveKit sends room_finished, close_room
--                              fills the false, but only when a room existed
--                              at all
--   nothing saw anything       nothing. Not "absent" — undecided. A session
--                              where neither of them joined is also what a
--                              site with the webhook misconfigured looks
--                              like, and there is no way to tell those apart
--                              from in here. Marking both people absent on
--                              that evidence would put a no-show on every
--                              session PeerFlow has ever hosted the first
--                              time somebody forgot to deploy a function
--
-- Confirmed sessions are only decided once their booked hour is over.
-- Somebody who joins twenty minutes in is late, not absent, and the ten
-- minute grace is what separates those two — it is not a deadline to be
-- graded at.
--
-- Cancellations are decided the moment they happen, because there is nothing
-- further to wait for.
-- ============================================================
create or replace function public.settle_pair(
  p_starts_at timestamptz,
  p_room      text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  observed boolean;
  r        record;
  n        integer := 0;
  seen_n   int;
  stood_up boolean;
begin
  if p_starts_at is null or p_room is null then return 0; end if;

  -- Did anything at all watch this meeting? One join, or one verdict already
  -- written by close_room, is enough to know the room was real and reporting.
  select exists (
    select 1 from public.sessions o
     where o.starts_at = p_starts_at
       and o.room_url  = p_room
       and (o.joined_at is not null or o.attended is not null)
  ) into observed;

  -- Both rows are settled before anybody is told anything, because the
  -- sentence one of them gets — "your partner did not make it, and nothing on
  -- your record changes" — is only true once the other row has been decided.
  -- Written as two passes for that reason and no other.
  with target as (
    select s.id,
           case
             when s.status = 'cancelled' and s.cancelled_by is not distinct from s.user_id
               then public.pf_cancel_kind(s.starts_at, s.cancelled_at)
             when s.status = 'cancelled'          then 'excused'
             when s.attended is true              then 'attended'
             when s.joined_at is not null         then 'attended'
             when s.attended is false             then 'no_show'
             when s.status = 'no_show'            then 'no_show'
             when observed                        then 'no_show'
             else null
           end as verdict
      from public.sessions s
     where s.starts_at = p_starts_at
       and s.room_url  = p_room
       and s.settled_at is null
       and s.status in ('confirmed', 'completed', 'cancelled', 'no_show')
       -- A cancellation is final at once; everything else waits for the hour
       -- it was booked for to be over. Postgres does not promise to evaluate
       -- AND left to right, so the status test that makes the interval
       -- arithmetic safe to reach is written as the branch it is.
       and case when s.status = 'cancelled' then true
                else s.starts_at + (s.duration_min || ' minutes')::interval <= now()
           end
  )
  update public.sessions s
     set attendance        = t.verdict,
         attendance_source = case when t.verdict in ('cancelled_early','cancelled_late','excused')
                                  then 'system' else 'livekit' end,
         settled_at        = now()
    from target t
   -- No verdict is a perfectly good answer, and settling it would freeze it:
   -- the webhook can still arrive, and a row that said "decided: nothing"
   -- would never be looked at again.
   where s.id = t.id and t.verdict is not null;

  get diagnostics n = row_count;
  if n = 0 then return 0; end if;

  -- Somebody did not turn up, and two people need to hear about it.
  --
  -- The escalation is deliberately gentle and deliberately explicit. A first
  -- miss is a sentence about what it means, not a warning; the second says
  -- plainly what the third will do; the third says what has happened and when
  -- it lifts. Nothing here closes an account or takes anything away from
  -- anybody, and it is all wrapped so that a database without
  -- migration-notify.sql settles attendance silently rather than failing.
  begin
    select exists (
      select 1 from public.sessions o
       where o.starts_at = p_starts_at and o.room_url = p_room
         and o.attendance = 'attended'
    ) into stood_up;

    for r in
      select s.user_id, s.partner_name, s.starts_at, s.attendance
        from public.sessions s
       where s.starts_at = p_starts_at
         and s.room_url  = p_room
         and s.settled_at is not null
         and s.attendance in ('attended', 'no_show')
    loop
      if r.attendance = 'no_show' then
        select count(*) into seen_n
          from public.sessions o
         where o.user_id = r.user_id
           and o.attendance = 'no_show'
           and o.starts_at >= now() - (public.pf_noshow_days() || ' days')::interval;

        perform public.raise_note(
          r.user_id, 'attendance',
          'You missed ' || public.when_for(r.user_id, r.starts_at),
          case
            when seen_n < 2 then
              'Sessions you miss without cancelling count against how reliable you look to ' ||
              'partners. Cancelling ahead of time does not — if you know you cannot make one, ' ||
              'say so and it costs you nothing.'
            when seen_n = 2 then
              'That is two missed sessions in the last month. A third pauses new partner ' ||
              'requests for a week. Cancelling ahead of time never counts.'
            else
              'That is ' || seen_n || ' missed sessions in the last month, so finding new ' ||
              'partners is paused for ' || public.pf_cooldown_days() ||
              ' days. Your partners, sessions and messages are all unaffected.'
          end,
          'app.html');

      -- And the person who was left sitting there — but only if somebody
      -- really was left sitting there. A session both of them missed stands
      -- nobody up, and telling each of them their partner did not make it
      -- would be two accusations and no acknowledgement.
      elsif stood_up and exists (
        select 1 from public.sessions o
         where o.starts_at = p_starts_at and o.room_url = p_room
           and o.user_id <> r.user_id and o.attendance = 'no_show'
      ) then
        perform public.raise_note(
          r.user_id, 'attendance',
          coalesce(nullif(r.partner_name, ''), 'Your partner') || ' did not make it',
          'Nothing on your record changes — you were there. Propose another time, or find ' ||
          'somebody else whenever you want to.',
          'app.html');
      end if;
    end loop;
  exception when others then
    null;
  end;

  return n;
end $$;

-- Nobody calls this directly. It is reached through settle_due() below, which
-- checks the caller is in the session, or from close_room() and the sweep,
-- which have no caller at all.
revoke all on function public.settle_pair(timestamptz, text) from public, anon, authenticated;


-- ------------------------------------------------------------
-- The two ways in.
--
-- There is no scheduler behind a static site — the same problem
-- migration-standing.sql solved by materialising occurrences on page load —
-- so the primary path is that opening PeerFlow settles your own finished
-- sessions. That has exactly the right incentive shape: the person who most
-- wants a no-show written down is the person who sat waiting for it, and they
-- are the one who opens the app.
--
-- settle_due_all() is the same work with no caller, for the pg_cron branch at
-- the bottom of this file where the extension is available.
-- ------------------------------------------------------------
create or replace function public.settle_due(p_limit int default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r  record;
  n  integer := 0;
begin
  if me is null then return 0; end if;

  for r in
    select distinct s.starts_at, s.room_url
      from public.sessions s
     where s.user_id = me
       and s.settled_at is null
       and s.room_url is not null
       and s.status in ('confirmed', 'completed', 'cancelled', 'no_show')
       -- Far enough back to catch somebody returning after a fortnight away,
       -- not so far that a dormant account settles two years of history on
       -- one page load.
       and s.starts_at > now() - interval '60 days'
       and case when s.status = 'cancelled' then true
                else s.starts_at + (s.duration_min || ' minutes')::interval <= now()
           end
     order by s.starts_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 100))
  loop
    n := n + public.settle_pair(r.starts_at, r.room_url);
  end loop;

  return n;
end $$;

revoke all on function public.settle_due(int) from public, anon;
grant execute on function public.settle_due(int) to authenticated;

create or replace function public.settle_due_all(p_limit int default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct s.starts_at, s.room_url
      from public.sessions s
     where s.settled_at is null
       and s.room_url is not null
       and s.status in ('confirmed', 'completed', 'cancelled', 'no_show')
       and s.starts_at > now() - interval '60 days'
       and case when s.status = 'cancelled' then true
                else s.starts_at + (s.duration_min || ' minutes')::interval <= now()
           end
     order by s.starts_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    n := n + public.settle_pair(r.starts_at, r.room_url);
  end loop;
  return n;
end $$;

revoke all on function public.settle_due_all(int) from public, anon, authenticated;


-- ============================================================
-- 5. Backfilling what is already known
--
-- Everything above reads the new column, so without this every session
-- PeerFlow has ever held would read as unscored and the People page would go
-- blank on the day this runs.
--
-- It is the same rules as settle_pair, applied once to history, and it is as
-- careful about silence: a past session whose attendance was never observed
-- is left null rather than being called a no-show years after the fact.
-- Rows are matched one at a time rather than through settle_pair because the
-- "the room saw the other one" test needs the pair, and doing that per row in
-- one statement is a correlated subquery rather than a loop over the table.
-- ============================================================
with pairs as (
  select s.id, s.user_id, s.status, s.attended, s.joined_at, s.cancelled_by,
         s.cancelled_at, s.starts_at,
         exists (
           select 1 from public.sessions o
            where o.starts_at = s.starts_at
              and o.room_url  = s.room_url
              and (o.joined_at is not null or o.attended is not null)
         ) as observed
    from public.sessions s
   where s.settled_at is null
     and s.status in ('confirmed', 'completed', 'cancelled', 'no_show')
     and case when s.status = 'cancelled' then true
              else s.starts_at + (s.duration_min || ' minutes')::interval <= now()
         end
),
graded as (
  select id,
         case
           when status = 'cancelled' and cancelled_by is not distinct from user_id
             then public.pf_cancel_kind(starts_at, cancelled_at)
           when status = 'cancelled'  then 'excused'
           when attended is true      then 'attended'
           when joined_at is not null then 'attended'
           when attended is false     then 'no_show'
           when status = 'no_show'    then 'no_show'
           when observed              then 'no_show'
           else null
         end as verdict
    from pairs
)
update public.sessions s
   set attendance        = g.verdict,
       attendance_source = case when g.verdict in ('cancelled_early','cancelled_late','excused')
                                then 'system' else 'livekit' end,
       settled_at        = now()
  from graded g
 where s.id = g.id
   and g.verdict is not null;

-- Sessions that have already happened are not going to be reminded about,
-- and leaving them at stage 0 would have the first sweep write a "tomorrow"
-- note about last March.
update public.sessions
   set reminded_stage = 3
 where reminded_stage < 3
   and starts_at <= now();


-- ============================================================
-- 6. Cancelling, and what it costs
--
-- answer_session is the only way a session is cancelled, and it already
-- stamps who did it and when. This version writes the outcome at the same
-- moment, in the same statement, so a cancellation cannot exist for even an
-- instant without the record of what it was.
--
-- Everything else about it is unchanged from
-- migration-no-double-booking.sql, including the clash handling and the
-- rephrased exception — this is that function plus three lines, not a new
-- one.
-- ============================================================
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
           cancelled_at = case when p_status = 'cancelled' then now()      else cancelled_at end,
           -- Whoever pressed Cancel wears it, at whatever notice they gave.
           -- The other person is excused: they were told, and being told is
           -- the whole thing PeerFlow is trying to encourage.
           --
           -- Only for a session the two of them had actually agreed to. A
           -- bare column inside SET is the row's OLD value, so `status` here
           -- is what it was before this statement moved it — which is the
           -- question being asked. Calling off something nobody ever accepted
           -- is not a broken promise and must not land on anybody's record.
           attendance = case
             when p_status = 'cancelled' and status in ('confirmed', 'completed')
               then case when user_id = auth.uid()
                         then public.pf_cancel_kind(starts_at, now())
                         else 'excused' end
             else attendance end,
           attendance_source = case
             when p_status = 'cancelled' and status in ('confirmed', 'completed')
               then 'system' else attendance_source end,
           settled_at = case
             when p_status = 'cancelled' and status in ('confirmed', 'completed')
               then now() else settled_at end
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


-- ============================================================
-- 7. The room, reporting back
--
-- record_presence is unchanged in what it writes about the person joining.
-- What it gains is the other half of the moment: if you are in the room and
-- your partner is not, they are told, once.
--
-- One notification per person per session, ever, enforced by the timestamp
-- rather than by whoever is calling — LiveKit redelivers on any non-2xx and
-- a reconnection is another participant_joined, so "send it once" has to be a
-- property of the row.
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
  w record;
  me_name text;
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

  -- Only on the way in. A participant_left is not a reason to tell anybody
  -- somebody is waiting for them.
  if p_left is not null then return n; end if;

  select coalesce(nullif(p.name, ''), 'Your partner') into me_name
    from public.profiles p where p.id = p_user;

  begin
    -- The stamp and the read are one statement, which is what makes "once,
    -- ever" true rather than nearly true: LiveKit redelivers on any non-2xx
    -- and a reconnection is another participant_joined, so two of these can
    -- be in flight at the same instant. The UPDATE takes the row lock, and
    -- only the call that actually moved waiting_note_at from null gets a row
    -- back to notify from.
    for w in
      with told as (
        update public.sessions o
           set waiting_note_at = now()
         where o.room_name = p_room
           and o.user_id  <> p_user
           and o.joined_at is null
           and o.waiting_note_at is null
           and o.status in ('confirmed', 'completed')
           -- Not about a session that finished hours ago, if somebody wanders
           -- back into a room that is still technically open.
           and o.starts_at + (o.duration_min || ' minutes')::interval > now()
        returning o.id, o.user_id
      )
      select id, user_id from told
    loop
      perform public.raise_note(
        w.user_id, 'session',
        coalesce(me_name, 'Your partner') || ' is waiting for you',
        coalesce(me_name, 'Your partner') || ' has joined your PeerFlow session and is in the ' ||
        'room now. If you cannot make it, cancelling takes one press and costs you nothing.',
        'call.html?s=' || w.id::text);
    end loop;
  exception when others then
    -- A site without migration-notify.sql still records attendance. It just
    -- cannot tell anybody about it.
    null;
  end;

  return n;
end $$;

revoke all on function public.record_presence(text, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;


-- ------------------------------------------------------------
-- The room closing. Same two jobs as before — write the absent verdict, and
-- move a finished booking to 'completed' once its own clock says it is over —
-- and then hand the pair to settle_pair so the outcome is written in the same
-- breath as the evidence for it.
-- ------------------------------------------------------------
create or replace function public.close_room(p_room text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  r record;
begin
  if p_room is null then
    return 0;
  end if;

  update public.sessions
     set attended = false
   where room_name = p_room
     and attended is null
     and status in ('confirmed', 'completed');
  get diagnostics n = row_count;

  -- LiveKit ends a room the moment the last person leaves it, which is not
  -- the same thing as the session ending. Somebody steps out to find a
  -- charger, a connection drops, one of you joins early and leaves again
  -- before the other arrives: the room finishes, and this used to move the
  -- booking to 'completed' three minutes into a fifty-minute session. The
  -- booking is finished when its own clock says so.
  update public.sessions
     set status = 'completed'
   where room_name = p_room
     and status = 'confirmed'
     and starts_at + (duration_min || ' minutes')::interval <= now()
     and exists (
       select 1 from public.sessions a
        where a.room_name = p_room and a.attended is true
     );

  for r in
    select distinct starts_at, room_url from public.sessions
     where room_name = p_room and room_url is not null
  loop
    perform public.settle_pair(r.starts_at, r.room_url);
  end loop;

  return n;
end $$;

revoke all on function public.close_room(text) from public, anon, authenticated;


-- ============================================================
-- 8. The check-in
--
-- Two questions after a session, both optional, neither of them a review:
-- did they turn up, and do you want to carry on. It exists because the room
-- cannot see everything and because a partnership that is not working should
-- be easy to leave.
--
-- The interesting part is what an answer is allowed to do, because "my
-- partner says you did not turn up" is the one input in this whole feature
-- that somebody could lie into.
--
--   "yes, they were here"  fills an outcome only where there is none. It can
--                          never overwrite anything, and it can only ever be
--                          generous, so there is nothing to gain by lying.
--
--   "no, they were not"    only lands if the accuser was demonstrably in the
--                          room themselves and the accused demonstrably was
--                          not. You cannot report an empty room you never
--                          entered, and you cannot contradict a join the
--                          server watched happen.
--
-- Where the conditions are not met the answer is still recorded on the
-- caller's own row — it is worth knowing about — but it settles nothing. That
-- is not a fudge: on a site where the webhook is not deployed there is no
-- objective attendance at all, and inventing one out of accusations is
-- exactly the system the brief for this feature said not to build.
-- ============================================================
create or replace function public.session_checkin(
  p_session  uuid,
  p_showed   boolean default null,
  p_continue text    default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  mine     public.sessions%rowtype;
  theirs   public.sessions%rowtype;
  outcome  text := 'noted';
  -- FOUND is whatever the last statement set it to, and there are updates
  -- between finding the partner's row and needing to know whether there was
  -- one. Held in a variable of its own so the answer cannot be overwritten by
  -- something unrelated three lines later.
  paired   boolean := false;
  fresh    boolean;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;
  if p_continue is not null and p_continue not in ('continue', 'stop') then
    raise exception 'bad answer' using errcode = 'PF013';
  end if;

  select * into mine from public.sessions where id = p_session and user_id = me;
  if not found then
    raise exception 'no such session for this user' using errcode = 'PF012';
  end if;
  if mine.starts_at + (mine.duration_min || ' minutes')::interval > now() then
    raise exception 'that session is not over yet' using errcode = 'PF014';
  end if;

  -- Whatever the room knows, it knows before an opinion is taken.
  perform public.settle_pair(mine.starts_at, mine.room_url);
  select * into mine from public.sessions where id = p_session;

  update public.sessions
     set partner_ok    = coalesce(p_showed, partner_ok),
         continue_pref = coalesce(nullif(p_continue, ''), continue_pref),
         checked_in_at = now()
   where id = p_session;

  select * into theirs from public.sessions
   where starts_at = mine.starts_at and room_url = mine.room_url and user_id <> me
   limit 1;
  paired := found;

  if paired and p_showed is not null then
    if p_showed and theirs.attendance is null then
      update public.sessions
         set attendance = 'attended', attendance_source = 'partner', settled_at = now()
       where id = theirs.id;
      outcome := 'confirmed';
    elsif not p_showed
      and theirs.attendance is null
      and theirs.joined_at is null
      and theirs.attended is distinct from true
      -- The condition that makes this safe: you were in the room.
      and mine.joined_at is not null
    then
      update public.sessions
         set attendance = 'no_show', attendance_source = 'partner', settled_at = now()
       where id = theirs.id;
      outcome := 'recorded';
    elsif not p_showed then
      -- Either the room got there first and already agrees — in which case
      -- saying "we could not verify that" about a verdict PeerFlow itself
      -- reached would be nonsense — or there genuinely is nothing to go on
      -- and the answer is kept without being acted on.
      outcome := case when theirs.attendance = 'no_show' then 'recorded'
                      else 'unverified' end;
    end if;
  end if;

  if p_continue = 'stop' and mine.pair_id is not null then
    perform public.end_partnership(mine.pair_id);
    return 'ended';
  end if;

  -- Both of you said yes. Nothing is booked on anybody's behalf — a standing
  -- weekly slot still takes one person suggesting and the other agreeing,
  -- which is migration-standing.sql's rule and a good one — but this is the
  -- moment to say so, to both of you, once.
  if p_continue = 'continue' and paired and theirs.continue_pref = 'continue' then
    select (r.standing_anchor is null) into fresh
      from public.partner_requests r where r.id = mine.pair_id;
    if coalesce(fresh, false) then
      begin
        perform public.raise_note(
          mine.user_id, 'partnership',
          'You and ' || coalesce(nullif(mine.partner_name, ''), 'your partner') ||
            ' both want to keep going',
          'Set a weekly slot and the next four weeks go on both calendars, so neither of ' ||
          'you has to ask again.', 'app.html');
        perform public.raise_note(
          theirs.user_id, 'partnership',
          'You and ' || coalesce(nullif(theirs.partner_name, ''), 'your partner') ||
            ' both want to keep going',
          'Set a weekly slot and the next four weeks go on both calendars, so neither of ' ||
          'you has to ask again.', 'app.html');
      exception when others then
        null;
      end;
    end if;
    return 'continuing';
  end if;

  return outcome;
end $$;

revoke all on function public.session_checkin(uuid, boolean, text) from public, anon;
grant execute on function public.session_checkin(uuid, boolean, text) to authenticated;


-- ------------------------------------------------------------
-- The other half of a session you own.
--
-- The dashboard has to be able to say "your partner did not make it", and it
-- cannot work that out from your own row: "read own sessions" limits SELECT
-- to your half, correctly, because a calendar is private. Inferring it from
-- the shape of your own record is guesswork, and guesswork about whether
-- somebody stood you up is exactly the wrong thing to be approximate about.
--
-- session_partner_state() already exists for this — migration-mvp.sql — but
-- it answers about one session at a time, and the dashboard needs to ask
-- about a handful at once. Same principle, batched, and narrower: three facts
-- about the partner's copy of a session the caller demonstrably owns a copy
-- of. Not their goal, not their name, not their other bookings.
-- ------------------------------------------------------------
create or replace function public.partner_outcomes(p_sessions uuid[])
returns table (session_id uuid, attendance text, joined boolean, checked_in boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.id,
         o.attendance,
         (o.joined_at is not null),
         (o.checked_in_at is not null)
    from public.sessions m
    join public.sessions o
      on  o.starts_at = m.starts_at
      and o.room_url  = m.room_url
      and o.user_id  <> m.user_id
   where m.id = any(p_sessions)
     -- The whole authorisation, in one clause: you are asking about your own
     -- bookings or you are getting nothing.
     and m.user_id = auth.uid();
$$;

revoke all on function public.partner_outcomes(uuid[]) from public, anon;
grant execute on function public.partner_outcomes(uuid[]) to authenticated;


-- ============================================================
-- 9. Walking away
--
-- block_person() already ends a partnership, and it is the wrong tool for
-- this: it files somebody under "people I had to block", hides both profiles
-- from each other for ever, and is meant for somebody who did something. A
-- pairing that simply is not working is not that, and if the only exit is the
-- block button then either people use it wrongly or they ghost — which is the
-- thing this whole feature exists to reduce.
--
-- So: the same three steps block_person takes, without the block and without
-- the accusation. Future sessions come off both calendars as 'excused',
-- because neither of you failed to attend something that was called off.
-- ============================================================
create or replace function public.end_partnership(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me    uuid := auth.uid();
  r     public.partner_requests%rowtype;
  other uuid;
  who   text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  select * into r from public.partner_requests
   where id = p_request and me in (from_user, to_user);
  if not found then
    raise exception 'no such partnership for this user' using errcode = 'PF012';
  end if;

  other := case when r.from_user = me then r.to_user else r.from_user end;

  update public.partner_requests
     set status          = 'ended',
         ended_at        = coalesce(ended_at, now()),
         ended_by        = coalesce(ended_by, me),
         -- The standing slot goes with the partnership it belonged to,
         -- otherwise materialise_standing keeps booking for a pair that no
         -- longer exists.
         standing_anchor = null,
         standing_by     = null,
         standing_set_at = null,
         standing_ok_at  = null
   where id = p_request
     and status = 'accepted';

  update public.sessions s
     set status            = 'cancelled',
         cancelled_at      = coalesce(s.cancelled_at, now()),
         cancelled_by      = coalesce(s.cancelled_by, me),
         attendance        = 'excused',
         attendance_source = 'system',
         settled_at        = now()
   where s.pair_id = p_request
     and s.status in ('proposed', 'confirmed')
     and s.starts_at > now();

  begin
    select coalesce(nullif(p.name, ''), 'Your partner') into who
      from public.profiles p where p.id = me;
    perform public.raise_note(
      other, 'partnership',
      coalesce(who, 'Your partner') || ' is looking for a different study partner',
      'Nothing on your record changes and nothing was reported. Anything the two of you had ' ||
      'booked has come off both calendars. There are other people on your path.',
      'app-people.html');
  exception when others then
    null;
  end;
end $$;

revoke all on function public.end_partnership(uuid) from public, anon;
grant execute on function public.end_partnership(uuid) to authenticated;


-- ------------------------------------------------------------
-- Blocking, which already ends a partnership and calls off everything still
-- to come, needs one line adding for the same reason: it cancels those
-- sessions with cancelled_by set to the person doing the blocking, and by the
-- rules above that would read as "they called it off at short notice" and cost
-- them reliability. Being harassed is not a late cancellation.
--
-- Both rows are excused. Not just the blocker's: somebody who has just been
-- blocked has done something, and whatever it was, it was not failing to
-- attend a session that no longer exists. Reports are how conduct is handled
-- here, and they are a separate thing on purpose.
--
-- Otherwise identical to migration-safety.sql's version.
-- ------------------------------------------------------------
create or replace function public.block_person(p_other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;
  if p_other is null or p_other = me then
    raise exception 'you cannot block yourself' using errcode = 'PF011';
  end if;

  insert into public.blocks (blocker, blocked)
  values (me, p_other)
  on conflict (blocker, blocked) do nothing;

  update public.partner_requests
     set status   = 'ended',
         ended_at = coalesce(ended_at, now()),
         ended_by = coalesce(ended_by, me)
   where status = 'accepted'
     and ((from_user = me and to_user = p_other)
       or (to_user   = me and from_user = p_other));

  -- Everything still to come comes off both calendars. Sessions already sat
  -- are left alone — they happened, and rewriting history to say they did not
  -- would take somebody's streak away for having been harassed.
  update public.sessions s
     set status            = 'cancelled',
         cancelled_at      = coalesce(s.cancelled_at, now()),
         cancelled_by      = coalesce(s.cancelled_by, me),
         attendance        = 'excused',
         attendance_source = 'system',
         settled_at        = now()
   where s.status in ('proposed', 'confirmed')
     and s.starts_at > now()
     and s.pair_id in (
       select r.id from public.partner_requests r
        where (r.from_user = me and r.to_user = p_other)
           or (r.to_user   = me and r.from_user = p_other));
end;
$$;

revoke all on function public.block_person(uuid) from public, anon;
grant execute on function public.block_person(uuid) to authenticated;


-- ============================================================
-- 10. Making it mean something
--
-- Everything above is decoration unless the browser cannot simply write the
-- answer it wants. It could: schema.sql's "answer a proposal" policy allows
-- an UPDATE on your own session row, and attended, joined_at and now
-- attendance are all columns on that row.
--
-- The policy is right and stays as it is — it is what lets answer_session and
-- friends do their work, and it is the rule those functions would need if
-- they ever ran as the caller. What is wrong is that the trust-bearing
-- columns were inside it.
--
-- current_user is the discriminator, and it is the right one rather than a
-- convenient one. PostgREST runs a browser's request as the `authenticated`
-- role; a security definer function owned by the schema owner runs as that
-- owner whatever role called it. So the test is exactly "is this the browser
-- speaking for itself, or one of the functions above" — which is the actual
-- question — and it cannot be spoofed from a request, because the role is set
-- by the connection pooler from a verified JWT and not by anything in the
-- body.
--
-- On INSERT the columns are quietly emptied rather than refused. Nothing in
-- the app ever sends them, so anything that does is either an old client or
-- somebody trying it on, and losing a booking over it would be the wrong
-- trade in the first case.
-- ============================================================
-- SECURITY INVOKER, and that is the entire mechanism rather than an omission.
-- A definer trigger runs as its owner whoever called it, so current_user
-- inside one is always the owner and the test below would pass for everybody
-- — including the browser it exists to stop. An invoker trigger runs as
-- whatever role is executing the statement: `authenticated` when PostgREST is
-- forwarding somebody's request, and the schema owner when one of the definer
-- functions above is doing the writing. Which is the question.
--
-- It needs no privileges of its own. It reads NEW and OLD and either raises
-- or does not.
create or replace function public.sessions_truth_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.attended          := null;
    new.joined_at         := null;
    new.left_at           := null;
    new.attendance        := null;
    new.attendance_source := null;
    new.settled_at        := null;
    new.partner_ok        := null;
    new.checked_in_at     := null;
    new.reminded_stage    := 0;
    new.waiting_note_at   := null;
    return new;
  end if;

  if new.attended          is distinct from old.attended
  or new.joined_at         is distinct from old.joined_at
  or new.left_at           is distinct from old.left_at
  or new.attendance        is distinct from old.attendance
  or new.attendance_source is distinct from old.attendance_source
  or new.settled_at        is distinct from old.settled_at
  or new.partner_ok        is distinct from old.partner_ok
  or new.reminded_stage    is distinct from old.reminded_stage
  -- status is on the list for the same reason: 'completed' is what the
  -- session count and the streak read, and it moves through answer_session
  -- and close_room, never from a page.
  or new.status            is distinct from old.status then
    raise exception 'attendance is recorded by the session, not by the browser'
      using errcode = 'PF020';
  end if;

  return new;
end $$;

drop trigger if exists sessions_truth_guard on public.sessions;
create trigger sessions_truth_guard
  before insert or update on public.sessions
  for each row execute function public.sessions_truth_guard();


-- ============================================================
-- 11. The score
--
-- Rewritten to read the settled outcome rather than re-deriving one, which
-- is the whole point of there being a settled outcome. The return type gains
-- columns, so the old function is dropped rather than replaced — create or
-- replace cannot change a signature, and PostgREST hands back JSON so extra
-- fields are additive for every caller.
--
-- THE FORMULA
--
--   attended        1.0, or 0.8 if they came in more than ten minutes late
--   cancelled_late  0.4
--   no_show         0.0
--   cancelled_early not counted
--   excused         not counted
--   undecided       not counted
--
-- Cancelling early is excluded rather than scored, because it is the
-- behaviour PeerFlow is trying to produce and a system that shaves a point
-- off it is arguing with itself. The obvious hole in that — cancel
-- everything early, keep a perfect score — is closed by the floor rather
-- than by a penalty: an early cancellation is not a graded session, so
-- somebody who only ever cancels never reaches three graded sessions and
-- never gets a percentage at all. They stay "New partner" for ever, which is
-- exactly what PeerFlow knows about them. The counts come back alongside so
-- a profile can say how many they have called off as well.
--
-- The average is weighted twice over. Recency: the newest counts fully and
-- each older one 0.9 as much, over the last twenty, so somebody can climb out
-- of a bad month. And a prior of two invisible sessions at 85%, which is what
-- stops one late cancellation reading as 40% and stops three tidy sessions
-- reading as a flat 100%. Nobody is ever shown as perfect, because nobody is,
-- and a number that saturates tells you nothing about the person above it.
--
-- Below three graded sessions the percentage is null and the app says "New
-- partner". Not "0%", not "no data" — a new person is not an unreliable one,
-- and the commonest way to make a reliability score cruel is to let it read
-- as an accusation of somebody who has not had a chance yet.
-- ============================================================
drop function if exists public.reliability_of(uuid[]);

create or replace function public.reliability_of(p_users uuid[])
returns table (
  uid        uuid,
  pct        int,
  counted    int,
  attended_n int,
  noshow_n   int,
  early_n    int,
  late_n     int,
  expected_n int,
  first_at   timestamptz
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
      case s.attendance
        when 'attended' then
          case when s.joined_at is not null
                and s.joined_at > s.starts_at + (public.pf_grace_minutes() || ' minutes')::interval
               then 0.8 else 1.0 end
        when 'cancelled_late' then 0.4
        when 'no_show'        then 0.0
        else null
      end as g
    from public.sessions s
    where s.user_id = any(p_users)
      and s.attendance is not null
  ),
  windowed as (
    select u, g, row_number() over (partition by u order by starts_at desc) as rn
      from graded
     where g is not null
  ),
  agg as (
    select u,
           sum(power(0.9::numeric, (rn - 1)::numeric) * g) as num,
           sum(power(0.9::numeric, (rn - 1)::numeric))     as den,
           count(*)                                        as n
      from windowed
     where rn <= public.pf_window()
     group by u
  ),
  totals as (
    select s.user_id as u,
           count(*) filter (where s.attendance = 'attended')        as att,
           count(*) filter (where s.attendance = 'no_show')         as ns,
           count(*) filter (where s.attendance = 'cancelled_early') as early,
           count(*) filter (where s.attendance = 'cancelled_late')  as late,
           min(s.starts_at) filter (where s.attendance = 'attended') as first_seen
      from public.sessions s
     where s.user_id = any(p_users)
       and s.attendance is not null
     group by s.user_id
  )
  select
    w.w as uid,
    case when coalesce(a.n, 0) >= public.pf_min_graded()
         then round(100 * ((coalesce(a.num, 0) + 2 * 0.85) / (coalesce(a.den, 0) + 2)))::int
         else null end as pct,
    coalesce(a.n, 0)::int     as counted,
    coalesce(t.att, 0)::int   as attended_n,
    coalesce(t.ns, 0)::int    as noshow_n,
    coalesce(t.early, 0)::int as early_n,
    coalesce(t.late, 0)::int  as late_n,
    -- What was actually asked of them: everything except the ones they called
    -- off in good time and the ones that were called off on them. This is the
    -- denominator in "23 of 24 sessions attended".
    (coalesce(t.att, 0) + coalesce(t.ns, 0) + coalesce(t.late, 0))::int as expected_n,
    t.first_seen as first_at
  from unnest(p_users) as w(w)
  left join agg    a on a.u = w.w
  left join totals t on t.u = w.w;
$$;

-- Aggregates only, and only for signed-in people. This is the whole reason
-- the function exists: it answers "do they turn up" without ever handing back
-- a session row, so somebody's reputation is public and their diary is not.
revoke all on function public.reliability_of(uuid[]) from public, anon;
grant execute on function public.reliability_of(uuid[]) to authenticated;


-- ============================================================
-- 12. Three misses in a month
--
-- A pause on starting new partnerships, and nothing else. Not a ban, not a
-- suspension, not a loss of anything already there: existing partners,
-- sessions, chat, history and the account itself all carry on working
-- exactly as they did. The reasoning is that somebody with three no-shows in
-- a month is, at that moment, a bad thing to introduce a fourth person to —
-- and that this is a statement about a month rather than about a person, so
-- it has to expire on its own.
--
-- Seven days from the last miss. Attending in the meantime does not shorten
-- it, because there is nothing to attend that is not already booked, and the
-- one thing that does shorten it is time.
-- ============================================================
create or replace function public.partnering_restricted_until(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when count(*) >= public.pf_noshow_limit()
     and max(s.starts_at) + (public.pf_cooldown_days() || ' days')::interval > now()
    then max(s.starts_at) + (public.pf_cooldown_days() || ' days')::interval
    else null
  end
  from public.sessions s
 where s.user_id = p_user
   and s.attendance = 'no_show'
   and s.starts_at >= now() - (public.pf_noshow_days() || ' days')::interval;
$$;

-- anon as well as authenticated, for the same reason blocked_with is: a
-- policy that calls a function the current role cannot execute fails with
-- "permission denied for function" rather than falling through to false.
revoke all on function public.partnering_restricted_until(uuid) from public;
grant execute on function public.partnering_restricted_until(uuid)
  to anon, authenticated, service_role;

-- What the page shows, for the caller and nobody else. Deliberately not
-- readable about other people: a cooldown is a private matter between
-- PeerFlow and the person in it, and the partners they already have see the
-- reliability score like everybody else.
create or replace function public.partnering_status()
returns table (no_shows int, restricted_until timestamptz, window_days int, allowed int)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.sessions s
      where s.user_id = auth.uid()
        and s.attendance = 'no_show'
        and s.starts_at >= now() - (public.pf_noshow_days() || ' days')::interval),
    public.partnering_restricted_until(auth.uid()),
    public.pf_noshow_days(),
    public.pf_noshow_limit()
  where auth.uid() is not null;
$$;

revoke all on function public.partnering_status() from public, anon;
grant execute on function public.partnering_status() to authenticated;

-- The enforcement, in the only place that cannot be walked around. This is
-- migration-safety.sql's policy with one clause added — the block check has
-- to stay, so it is restated here rather than a second policy being layered
-- on, because two permissive INSERT policies would OR together and the
-- narrower one would never bite.
drop policy if exists "send requests as yourself" on public.partner_requests;
create policy "send requests as yourself"
  on public.partner_requests for insert
  with check (
    auth.uid() = from_user
    and not public.blocked_with(to_user)
    and public.partnering_restricted_until(auth.uid()) is null
  );


-- ============================================================
-- 13. Reminders
--
-- Three, at a day, an hour and ten minutes, and the last one is the one that
-- matters: by then the only useful thing to say is that a specific person is
-- about to be sitting in a room waiting.
--
-- Where they come from is the awkward part and worth being plain about.
-- PeerFlow is a static site and there is no scheduler in the free tier, so
-- the sweep runs from two places: pg_cron if the project has it, and
-- otherwise whoever opens the app. The page-load path settles for both people
-- in a session rather than only the caller, which is what makes it useful at
-- all — your partner opening PeerFlow at lunchtime is what sends you the
-- reminder for this evening.
--
-- That is honest rather than ideal, and the difference is documented in
-- docs/EMAIL.md and in the deployment notes rather than hidden. With pg_cron
-- installed it is exact; without it, reminders are best-effort and the ten
-- minute one may not fire if neither of you opens the site.
-- ============================================================
create or replace function public.remind_rows(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r    record;
  want smallint;
  n    integer := 0;
begin
  for r in
    select s.id, s.user_id, s.partner_name, s.starts_at, s.duration_min,
           s.topic, s.reminded_stage
      from public.sessions s
     where s.id = any(p_ids)
       and s.status = 'confirmed'
       and s.starts_at > now()
       and s.reminded_stage < 3
  loop
    want := case
      when r.starts_at - now() <= interval '10 minutes' then 3
      when r.starts_at - now() <= interval '1 hour'     then 2
      when r.starts_at - now() <= interval '24 hours'   then 1
      else 0 end;

    -- Only the one that is due now. A session booked for this evening should
    -- get the ten minute reminder when it is due and never the two it slept
    -- through, which is why the stage jumps rather than stepping.
    continue when want <= r.reminded_stage;

    update public.sessions set reminded_stage = want where id = r.id;
    n := n + 1;

    begin
      perform public.raise_note(
        r.user_id, 'reminder',
        case want
          when 3 then coalesce(nullif(r.partner_name, ''), 'Your partner') ||
                        ' is expecting you in 10 minutes'
          when 2 then 'In an hour: your session with ' ||
                        coalesce(nullif(r.partner_name, ''), 'your partner')
          else        'Tomorrow: your session with ' ||
                        coalesce(nullif(r.partner_name, ''), 'your partner')
        end,
        case want
          when 3 then 'Your room is open. If you cannot make it, cancel now — it takes one ' ||
                      'press and it is far better than not arriving.'
          when 2 then public.when_for(r.user_id, r.starts_at) ||
                      coalesce(' · ' || nullif(r.topic, ''), '') ||
                      '. Your room opens fifteen minutes before you start.'
          else        public.when_for(r.user_id, r.starts_at) ||
                      coalesce(' · ' || nullif(r.topic, ''), '') || ' · ' ||
                      r.duration_min || ' minutes. Cancelling ahead of time costs you nothing.'
        end,
        case when want = 3 then 'call.html?s=' || r.id::text else 'app.html' end);
    exception when others then
      null;
    end;
  end loop;

  return n;
end $$;

revoke all on function public.remind_rows(uuid[]) from public, anon, authenticated;

-- The caller's own sessions, and their partner's copies of those same
-- sessions. Reaching the partner's row is the point: it is what turns "you
-- opened the app" into "your partner got their reminder".
create or replace function public.send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  if auth.uid() is null then return 0; end if;

  select array_agg(o.id) into ids
    from public.sessions o
   where o.status = 'confirmed'
     and o.starts_at > now()
     and o.starts_at < now() + interval '25 hours'
     and o.reminded_stage < 3
     and exists (
       select 1 from public.sessions m
        where m.user_id = auth.uid()
          and m.starts_at = o.starts_at
          and m.room_url  = o.room_url
     );

  if ids is null then return 0; end if;
  return public.remind_rows(ids);
end $$;

revoke all on function public.send_due_reminders() from public, anon;
grant execute on function public.send_due_reminders() to authenticated;

create or replace function public.send_due_reminders_all(p_limit int default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(id) into ids from (
    select o.id from public.sessions o
     where o.status = 'confirmed'
       and o.starts_at > now()
       and o.starts_at < now() + interval '25 hours'
       and o.reminded_stage < 3
     order by o.starts_at
     limit greatest(1, least(coalesce(p_limit, 500), 2000))
  ) q;
  if ids is null then return 0; end if;
  return public.remind_rows(ids);
end $$;

revoke all on function public.send_due_reminders_all(int) from public, anon, authenticated;


-- ============================================================
-- 14. The tick
--
-- One function so pg_cron has one thing to call, and so the two halves can
-- never be scheduled out of step with each other.
-- ============================================================
create or replace function public.attendance_tick()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.settle_due_all(200) + public.send_due_reminders_all(500);
$$;

revoke all on function public.attendance_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'peerflow-attendance') then
      perform cron.unschedule('peerflow-attendance');
    end if;
    perform cron.schedule('peerflow-attendance', '*/5 * * * *',
                          'select public.attendance_tick();');
    raise notice 'peerflow-attendance scheduled every five minutes.';
  else
    raise notice 'pg_cron is not installed, so attendance is settled and reminders are sent %',
                 'when somebody opens the app. For exact reminders run: ' ||
                 'create extension pg_cron; and re-run this file.';
  end if;
end $$;

-- ============================================================
-- Done. Nothing above drops a column or deletes a row.
-- ============================================================

-- ---------- END migration-attendance.sql ----------


-- ============================================================
-- BEGIN migration-reschedule.sql
-- ============================================================

-- ============================================================
-- PeerFlow — moving a session instead of losing it
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migrate-2026-08.sql and migration-notify.sql.
-- Safe to run more than once.
--
-- WHY
--
-- A confirmed session had exactly one way out of it: Cancel. So "I can't make
-- Thursday" and "I don't want to study with you" ended at the same button,
-- and the difference between them — which is the whole difference between a
-- partnership that survives a clash and one that quietly stops — was left for
-- the two people to sort out in chat, or not at all.
--
-- The app has had a control labelled Reschedule for a while. It opened an
-- empty booking form. Nothing connected the old session to the new one, so
-- the honest description of it was "cancel, then remember to book something".
-- What follows is the missing primitive.
--
-- WHAT A RESCHEDULE HAS TO BE
--
-- A session is two rows sharing (starts_at, room_url), one per person. Moving
-- it means calling off both copies of the old one AND offering both copies of
-- a new one, and the only acceptable outcomes are all of that or none of it.
-- Half of it is the state this whole feature exists to prevent: one person
-- holding a cancelled evening and the other holding a booking, or two live
-- sessions where there should be one.
--
-- A browser cannot do that. It is four writes across two rooms, RLS lets it
-- see only its own half of each, and any of the four can fail on its own. So
-- it is one SECURITY DEFINER function, and one transaction: every raise below
-- rolls back the cancel as well, which is why the checks come first and the
-- writes come last.
--
-- WHAT IT IS NOT
--
-- It is not a booking. Nothing here confirms anything. The new time goes in
-- as 'proposed', exactly as the ordinary booking form's does, and the partner
-- accepts it exactly as they accept any other — the two-sided rule is the
-- product and this does not get an exemption from it. What the partner is
-- spared is having to notice that something was cancelled and work out for
-- themselves that they were supposed to suggest something else.
--
-- RELIABILITY IS DELIBERATELY UNTOUCHED
--
-- No new outcome, no new grading, nothing added to settle_pair(). The rules
-- already in migration-attendance.sql are the right ones for this:
--
--   moving it with six hours' notice or more settles as 'cancelled_early',
--   which assets/reliability.js does not count at all. It is already free.
--
--   moving it inside six hours settles as 'cancelled_late'. That is the same
--   as cancelling late, and it should be: your partner has lost the evening
--   either way, and a 'rescheduled' outcome that scored better would be a
--   way of buying back the cost of short notice by attaching a new time to
--   it. The app says the six-hour line out loud on the button instead.
--
--   the other person is 'excused' either way, as they already were.
--
-- So this migration adds no column to do with attendance and changes no
-- function that decides one.
-- ============================================================


-- ---------- where it came from ----------
-- Nullable, additive, and read by nothing that already exists.
--
-- The alternative was to put the old time only in the notification body, and
-- that is not enough: the notification is read once and the proposal sits on
-- the dashboard for days. A person looking at "Saturday 3pm, waiting on you"
-- needs to know it is the Thursday they had already agreed to, or they answer
-- it as though it were an extra session.
alter table public.sessions
  add column if not exists rescheduled_from timestamptz;


-- ============================================================
-- Two notifications for one action
--
-- The triggers in migration-notify.sql are right about everything they
-- currently see. A reschedule is the first thing that makes them wrong, and
-- not because either of them misfires: they both fire, correctly, and the
-- pair of notes is the problem.
--
--   note_session_answered sees the old session go to 'cancelled' and says
--   "Amir cancelled your session. It has come off both calendars."
--
--   note_session_proposed sees the new rows inserted and says "Amir proposed
--   a session time."
--
-- Both true, both arriving together, and the first one is alarming and
-- obsolete by the time it is read. Worse, each is emailed.
--
-- So the function below sets a transaction-local flag and both triggers stand
-- down while it is set, leaving reschedule_session to raise the single note
-- that describes what actually happened. current_setting(..., true) returns
-- NULL rather than raising when the setting has never been set, which is
-- every other transaction in the system.
-- ============================================================
create or replace function public.pf_rescheduling() returns boolean
language sql stable parallel safe
set search_path = public
as $$
  select coalesce(current_setting('pf.rescheduling', true), '') = '1'
$$;


create or replace function public.note_session_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A reschedule raises its own, naming both times.
  if public.pf_rescheduling() then return null; end if;

  if new.status = 'proposed'
     and new.proposed_by is not null
     and new.user_id <> new.proposed_by then
    perform public.raise_note(
      new.user_id, 'session',
      coalesce(nullif(new.partner_name, ''), 'Your partner') || ' proposed a session time',
      public.when_for(new.user_id, new.starts_at) ||
        coalesce(' · ' || nullif(new.topic, ''), '') ||
        '. Nothing is booked until you accept.',
      'app.html');
  end if;
  return null;
end $$;


create or replace function public.note_session_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce(nullif(new.partner_name, ''), 'Your partner');
  headline text;
begin
  -- Same reason as above: the cancellation half of a reschedule is not news
  -- on its own, and "Amir cancelled your session" is actively wrong about
  -- what has just happened.
  if public.pf_rescheduling() then return null; end if;

  if auth.uid() is null then return null; end if;
  if new.status is not distinct from old.status then return null; end if;
  if new.user_id = auth.uid() then return null; end if;

  headline := case new.status
    when 'confirmed' then who || ' said yes'
    when 'declined'  then who || ' declined that time'
    when 'cancelled' then who || ' cancelled your session'
    else null end;

  if headline is null then return null; end if;

  perform public.raise_note(
    new.user_id, 'session', headline,
    public.when_for(new.user_id, new.starts_at) ||
      case new.status
        when 'confirmed' then '. It is now on both your calendars.'
        when 'declined'  then '. Propose another time whenever you are ready.'
        else '. It has come off both calendars. Propose another time whenever '
             || 'you are ready.' end,
    'app.html');
  return null;
end $$;

-- Re-pointed at the replaced functions. `create or replace` keeps the same
-- OID so the existing triggers already run the new bodies; these are here so
-- a database that somehow lost them gets them back, and so the file reads as
-- the whole story rather than half of it.
drop trigger if exists session_proposed_note on public.sessions;
create trigger session_proposed_note
  after insert on public.sessions
  for each row execute function public.note_session_proposed();

drop trigger if exists session_answered_note on public.sessions;
create trigger session_answered_note
  after update on public.sessions
  for each row execute function public.note_session_answered();


-- ============================================================
-- The primitive
--
-- Everything it refuses, and why it refuses it there rather than in the page:
--
--   not signed in            PF020. The page cannot be trusted to know.
--   not your session         PF021. Owning one of the two rows is what makes
--                            you allowed to move it. Same test answer_session
--                            makes, for the same reason.
--   not confirmed            PF022. A proposal nobody has answered is moved by
--                            declining it and offering another, which the app
--                            already does and which needs no atomicity — there
--                            is no agreement to protect. A cancelled or
--                            declined session has nothing to move. A finished
--                            one is history.
--   already started          PF023. Past the start there is no session left to
--                            move, only a question about who turned up, and
--                            settle_pair is about to answer it. Rescheduling
--                            out from under that would be racing it.
--   new time in the past     PF024.
--   new time is the old time PF025. Not an error worth a stack trace, but a
--                            no-op that cancels a real booking and offers it
--                            straight back is not a no-op at all.
--   either of you is busy    PF001, the same code and the same sentence the
--                            exclusion constraint produces, because it is the
--                            same rule reached earlier. Checked for BOTH
--                            people, which is the thing the browser cannot do
--                            — RLS hides your partner's calendar from it.
--
-- The conflict check runs before the cancel. It would be correct either way,
-- since a raise rolls the whole transaction back, but doing it first means
-- the common failure never touches the row at all.
-- ============================================================
create or replace function public.reschedule_session(
  p_starts_at     timestamptz,
  p_room          text,
  p_new_starts_at timestamptz,
  p_new_duration  int  default null,
  p_note          text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  mine     public.sessions%rowtype;
  theirs   public.sessions%rowtype;
  new_room text;
  new_id   uuid := gen_random_uuid();
  mins     int;
  clash    public.sessions%rowtype;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF020';
  end if;

  select * into mine from public.sessions
   where starts_at = p_starts_at and room_url = p_room and user_id = me;
  if not found then
    raise exception 'no such session for this user' using errcode = 'PF021';
  end if;

  if mine.status <> 'confirmed' then
    raise exception 'only an agreed session can be moved' using errcode = 'PF022';
  end if;
  -- settled_at is set the moment a cancellation is graded and when the room
  -- reports back, so a row carrying one has already been written into
  -- somebody's record and is not a booking any more.
  if mine.settled_at is not null then
    raise exception 'that session has already been settled' using errcode = 'PF022';
  end if;
  if mine.starts_at <= now() then
    raise exception 'that session has already started' using errcode = 'PF023';
  end if;

  if p_new_starts_at is null or p_new_starts_at <= now() then
    raise exception 'the new time is in the past' using errcode = 'PF024';
  end if;

  mins := greatest(coalesce(p_new_duration, mine.duration_min, 50), 1);

  if p_new_starts_at = mine.starts_at and mins = mine.duration_min then
    raise exception 'that is the time it is already at' using errcode = 'PF025';
  end if;

  -- The other half of the booking. A session always has one; a database that
  -- has lost it is one this should not be inventing a partner for, so the
  -- move goes ahead for the row that does exist and nobody is notified.
  select * into theirs from public.sessions
   where starts_at = mine.starts_at and room_url = mine.room_url and user_id <> me
   limit 1;

  -- Busy at the new time — either of you, and the old session itself does not
  -- count, since it is about to stop existing. Same rule as the exclusion
  -- constraint, asked early and of both calendars.
  select s.* into clash from public.sessions s
   where s.user_id in (me, theirs.user_id)
     and s.status in ('confirmed', 'completed')
     and not (s.starts_at = mine.starts_at and s.room_url = mine.room_url)
     and public.session_span(s.starts_at, s.duration_min)
      && public.session_span(p_new_starts_at, mins)
   limit 1;
  if found then
    raise exception 'That time is no longer free — one of you has since agreed to something else then.'
      using errcode = 'PF001';
  end if;

  -- From here on it is writes, and the flag keeps the two note triggers quiet
  -- so the single note at the bottom is the only thing either of you is told.
  -- Transaction-local: it goes when this returns, whichever way it returns.
  perform set_config('pf.rescheduling', '1', true);

  -- Off both calendars, graded exactly as any other cancellation by the same
  -- caller would be. pf_cancel_kind decides early or late off the notice
  -- given; the other person is excused. Nothing about that is special-cased
  -- here, on purpose: this is a cancellation, and it is the one the person
  -- doing it is responsible for.
  update public.sessions
     set status            = 'cancelled',
         cancelled_by      = me,
         cancelled_at      = now(),
         attendance        = case when user_id = me
                                  then public.pf_cancel_kind(starts_at, now())
                                  else 'excused' end,
         attendance_source = 'system',
         settled_at        = now()
   where starts_at = mine.starts_at and room_url = mine.room_url;

  -- And on as an offer. A room of its own, like every other booking since
  -- migration-video.sql: the old room belonged to the old hour and reusing it
  -- would hand out a key to a session that no longer exists.
  new_room := 'pf:' || new_id::text;

  insert into public.sessions
    (user_id, partner_name, topic, starts_at, duration_min, room_url, room_name,
     pair_id, goal, status, proposed_by, note, rescheduled_from)
  values
    (me, mine.partner_name, mine.topic, p_new_starts_at, mins, new_room,
     'pf-' || new_id::text, mine.pair_id, mine.goal, 'proposed', me,
     coalesce(nullif(p_note, ''), mine.note), mine.starts_at);

  if theirs.user_id is not null then
    insert into public.sessions
      (user_id, partner_name, topic, starts_at, duration_min, room_url, room_name,
       pair_id, goal, status, proposed_by, note, rescheduled_from)
    values
      (theirs.user_id, theirs.partner_name, mine.topic, p_new_starts_at, mins, new_room,
       'pf-' || new_id::text, mine.pair_id, mine.goal, 'proposed', me,
       coalesce(nullif(p_note, ''), mine.note), mine.starts_at);

    -- One notification, naming both times, in their clock. This is the whole
    -- reason the triggers were stood down: what has happened is not a
    -- cancellation and not a fresh proposal, and saying either of those
    -- separately would describe a different event from the one that occurred.
    perform public.raise_note(
      theirs.user_id, 'session',
      coalesce(nullif(theirs.partner_name, ''), 'Your partner') || ' moved your session',
      'Was ' || public.when_for(theirs.user_id, mine.starts_at) ||
        ', now ' || public.when_for(theirs.user_id, p_new_starts_at) ||
        '. Nothing is booked until you accept the new time.',
      'app.html');
  end if;

  return new_room;
end $$;

revoke all on function public.reschedule_session(timestamptz, text, timestamptz, int, text)
  from public, anon;
grant execute on function public.reschedule_session(timestamptz, text, timestamptz, int, text)
  to authenticated;

-- ---------- END migration-reschedule.sql ----------


-- ============================================================
-- BEGIN migration-dormancy.sql
-- ============================================================

-- ============================================================
-- PeerFlow — a partnership that has gone quiet
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migrate-2026-08.sql, migration-notify.sql and
-- migration-reschedule.sql. Safe to run more than once.
--
-- WHY
--
-- Two people match, they meet, it goes well — and then neither of them books
-- the next one. Nobody decided anything. There was no falling out and no
-- no-show. The session that would have been the third one simply never got
-- proposed, and a month later both of them assume the other lost interest.
--
-- The dashboard has been saying something about this for a while: once the
-- gap reaches a week the band reads "It's been nine days since you studied
-- with Amir" and offers to book. That is the right sentence in the wrong
-- place, because it is only ever read by somebody who has opened PeerFlow —
-- which is exactly the person who has not gone quiet. The half of the pair
-- that needs reaching is the half that is not looking.
--
-- HOW THIS REACHES SOMEBODY WHO IS NOT HERE
--
-- There is no scheduler behind a static site, and this file does not add one.
-- It copies what settle_due() and send_due_reminders() already do: a
-- SECURITY DEFINER function that the app calls on every load, which does work
-- on rows belonging to the OTHER person as well as the caller. Your partner
-- opening PeerFlow at lunchtime is what reminds you about this evening; your
-- partner opening PeerFlow at all is now what asks you whether the two of you
-- want to carry on.
--
-- And as with those two, there is a _all variant with no caller for the
-- pg_cron branch, so a project that has cron does not depend on anybody
-- opening anything.
--
-- WHO IS TOLD
--
-- Only the other person. The caller is looking at a dashboard that already
-- says it, in a band with the button on it, so a notification would be
-- telling somebody something they are currently reading. That halves the
-- volume of this feature and points the remaining half at the person it is
-- actually for.
--
-- WHEN
--
--   dormant          fourteen days with nothing. Two missed weeks against a
--                    default goal of two sessions a week, where one missed
--                    week is a holiday. It is also where the app's own
--                    language changes: sinceWords() starts saying "two weeks"
--                    at fourteen days, and the band's existing seven-day line
--                    is left exactly as it was — this is a second, quieter
--                    state above it rather than a replacement.
--
--   cooldown         twenty-one days between one nudge and the next for the
--                    same partnership. Longer than the threshold on purpose:
--                    a pair who stay dormant cannot be nudged twice inside
--                    three weeks, however many times either of them opens the
--                    app.
--
-- WHAT DISQUALIFIES A PARTNERSHIP
--
--   not accepted     end_partnership() and block_person() both set the row to
--                    'ended', so this one test excludes a partnership that was
--                    walked away from AND one that was blocked. Nothing extra
--                    is needed for either, and nothing here can nudge somebody
--                    about a person who blocked them.
--
--   never got going  no session that actually happened. A pair who accepted
--                    and never met are not dormant, they are new, and the
--                    dashboard already has a band for exactly that. Nudging
--                    them here would be two features talking over each other.
--
--   too new          the partnership itself is younger than the threshold.
--
--   something ahead  anything proposed or confirmed in the future. A standing
--                    slot materialises four weeks out, so a pair with a live
--                    slot can never qualify — which is correct, they have not
--                    gone quiet.
--
--   recent activity  a session that happened, or any session row created, in
--                    the last fourteen days. Created, not just held: somebody
--                    proposing a time that was then declined is a partnership
--                    still talking to itself, and it resets the clock.
-- ============================================================


-- ---------- the one new column ----------
-- When this partnership's dormancy was last raised with anybody, or waved off
-- by one of them. One column, one row per partnership, and it means the same
-- thing whichever of them wrote it: leave this pair alone until the cooldown
-- has passed.
--
-- Deliberately not two columns. "Amir said not now" and "Amir was told" want
-- the same thing to happen next — silence for three weeks — and a schema that
-- tells them apart would only be earning the right to nudge the other person
-- after one of them has already said no.
alter table public.partner_requests
  add column if not exists dormant_nudged_at timestamptz;


-- ---------- the policy, as functions rather than numbers ----------
-- Same shape as pf_cancel_notice_hours() and pf_grace_minutes(): the number
-- lives in one place, the app can read it, and nothing has to agree with a
-- literal typed into three files.
create or replace function public.pf_dormant_days() returns int
  language sql immutable parallel safe as $$ select 14 $$;

create or replace function public.pf_dormant_cooldown_days() returns int
  language sql immutable parallel safe as $$ select 21 $$;


-- ============================================================
-- Which partnerships have gone quiet.
--
-- Split out from the function that acts on them so that both the per-caller
-- and the cron variant ask exactly the same question, and so the SQL tests can
-- ask it without anything being written.
--
-- STABLE and SECURITY DEFINER: it reads sessions belonging to both people, and
-- "read own sessions" would otherwise hide half the evidence — a pair whose
-- only upcoming booking sits on the partner's row would look dormant to
-- everybody except the partner.
-- ============================================================
create or replace function public.dormant_partnerships()
returns table (
  request_id uuid,
  from_user  uuid,
  to_user    uuid,
  last_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.from_user, r.to_user, act.last_at
    from public.partner_requests r
    -- Everything this pair has ever had on a calendar, in one pass: when they
    -- last actually sat one, when a row was last written at all, and whether
    -- anything is still ahead of them.
    cross join lateral (
      select max(s.starts_at) filter (
               where s.attendance = 'attended' or s.status = 'completed'
                  or (s.status = 'confirmed'
                      and s.starts_at + make_interval(mins => s.duration_min) <= now())
             ) as last_at,
             max(s.created_at) as wrote_at,
             bool_or(s.status in ('proposed', 'confirmed') and s.starts_at > now()) as ahead
        from public.sessions s
       where s.pair_id = r.id
    ) act
   where r.status = 'accepted'
     -- A pair who accepted last week and have not met are new, not dormant.
     and r.created_at <= now() - make_interval(days => public.pf_dormant_days())
     -- Never got going. The dashboard's first-session band owns this case.
     and act.last_at is not null
     -- Something is already on the calendar, so nothing has gone quiet.
     and not coalesce(act.ahead, false)
     -- Quiet for long enough, by both measures: nothing sat, and nothing even
     -- offered.
     and act.last_at  <= now() - make_interval(days => public.pf_dormant_days())
     and coalesce(act.wrote_at, act.last_at)
                      <= now() - make_interval(days => public.pf_dormant_days())
     -- Not already raised with one of them inside the cooldown.
     and (r.dormant_nudged_at is null
          or r.dormant_nudged_at <= now()
             - make_interval(days => public.pf_dormant_cooldown_days()));
$$;

-- Revoked from everybody, authenticated included, and deliberately so.
--
-- This function answers "which partnerships have gone quiet" for the whole
-- platform, not for the caller: request id, both user ids, and when that pair
-- last studied. It was granted to authenticated on the reasoning that the app
-- needed to reach it and the SQL tests wanted to ask it without writing
-- anything. Both were wrong. nudge_dormant() is SECURITY DEFINER, so it
-- executes as the owner and can call this whatever the caller holds, and the
-- tests connect as the owner too — neither ever needed the grant.
--
-- What the grant did buy was a way for any signed-in account to select
-- straight from it over PostgREST and read back the partnership graph: who is
-- partnered with whom, and how long each pair has been idle, for every user
-- on the platform. Nothing in the product shows that, and nothing should.
revoke all on function public.dormant_partnerships() from public, anon, authenticated;


-- ============================================================
-- Raising it with one of them.
--
-- Shared by both entry points below. p_only is the person NOT to tell — the
-- caller, who is reading a dashboard that says the same thing — or NULL from
-- cron, where there is nobody at the keyboard and both of them are equally
-- absent.
--
-- The stamp is written before the note and conditionally, so two tabs opening
-- at the same instant cannot both get past it. FOUND after that UPDATE is the
-- whole of the idempotency: whoever wins writes the row, the loser finds
-- nothing to update and sends nothing.
-- ============================================================
create or replace function public.raise_dormant(p_request uuid, p_skip uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.partner_requests%rowtype;
  n     integer := 0;
  who   record;
begin
  update public.partner_requests
     set dormant_nudged_at = now()
   where id = p_request
     and status = 'accepted'
     and (dormant_nudged_at is null
          or dormant_nudged_at <= now()
             - make_interval(days => public.pf_dormant_cooldown_days()))
  returning * into r;
  if not found then return 0; end if;

  for who in
    select u.id as target,
           case when u.id = r.from_user then r.to_user else r.from_user end as other
      from (select r.from_user as id union all select r.to_user) u
     where p_skip is null or u.id <> p_skip
  loop
    begin
      perform public.raise_note(
        who.target, 'dormant',
        'You and ' ||
          coalesce(nullif((select name from public.profiles where id = who.other), ''),
                   'your partner') ||
          ' haven''t studied together recently',
        'Plan your next session — pick an hour and send it over. Nothing is booked ' ||
        'until they accept.',
        'app.html?plan=' || who.other::text);
      n := n + 1;
    exception when others then
      -- A notification that fails is never allowed to be the reason the
      -- stamp is rolled back; the alternative is a pair being asked again on
      -- the very next page load.
      null;
    end;
  end loop;

  return n;
end $$;

revoke all on function public.raise_dormant(uuid, uuid) from public, anon, authenticated;


-- ============================================================
-- The two ways in.
--
-- Same shape as settle_due / settle_due_all and send_due_reminders /
-- send_due_reminders_all: one for the browser, scoped to partnerships the
-- caller is actually in, and one with no caller for cron.
-- ============================================================
create or replace function public.nudge_dormant()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r  record;
  n  integer := 0;
begin
  if me is null then return 0; end if;
  for r in
    select * from public.dormant_partnerships() d
     where me in (d.from_user, d.to_user)
  loop
    -- The caller is skipped. They are looking at the band.
    n := n + public.raise_dormant(r.request_id, me);
  end loop;
  return n;
end $$;

revoke all on function public.nudge_dormant() from public, anon;
grant execute on function public.nudge_dormant() to authenticated;


create or replace function public.nudge_dormant_all(p_limit int default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.dormant_partnerships()
     order by last_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    -- Nobody at a keyboard, so both of them are told.
    n := n + public.raise_dormant(r.request_id, null);
  end loop;
  return n;
end $$;

revoke all on function public.nudge_dormant_all(int) from public, anon, authenticated;


-- ============================================================
-- Not now.
--
-- The band carries a way out of it, and it has to mean something more durable
-- than hiding a card until the next reload. Stamping the same column is the
-- whole of it: the pair goes quiet for a cooldown, for both of them, which is
-- the honest reading of one of the two saying they would rather not right now.
-- ============================================================
create or replace function public.snooze_dormant(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF030';
  end if;
  update public.partner_requests
     set dormant_nudged_at = now()
   where id = p_request
     and status = 'accepted'
     and me in (from_user, to_user);
  if not found then
    raise exception 'no such partnership for this user' using errcode = 'PF031';
  end if;
end $$;

revoke all on function public.snooze_dormant(uuid) from public, anon;
grant execute on function public.snooze_dormant(uuid) to authenticated;


-- ============================================================
-- The cron branch, if this project has pg_cron.
--
-- attendance_tick() already exists and is already scheduled where cron is
-- installed. Adding the dormancy sweep to it rather than scheduling a second
-- job keeps the two halves from drifting out of step, which is the reason
-- that function was written as one call in the first place.
--
-- Redefined rather than replaced in spirit: everything it did, it still does.
-- ============================================================
create or replace function public.attendance_tick()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.settle_due_all(200)
       + public.send_due_reminders_all(500)
       + public.nudge_dormant_all(200);
$$;

revoke all on function public.attendance_tick() from public, anon, authenticated;

-- ---------- END migration-dormancy.sql ----------
