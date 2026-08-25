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
-- one, silently. Nothing warns you and nothing fails.
--
-- To set a database up, see SETUP_GUIDE.md. The short version is schema.sql,
-- then migration-mvp.sql, then migrate-2026-08.sql, then the migrations
-- written after it that are not folded in yet: migration-reschedule.sql and
-- migration-dormancy.sql.
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
