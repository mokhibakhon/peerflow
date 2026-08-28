-- ============================================================
-- PeerFlow — two forgeries and a room that could not be joined
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run twice: both statements are `create or replace`.
--
-- Until this is run, both problems below are live. Nothing in CI applies
-- these files; merging this changes nothing on its own.
--
-- WHAT IS IN IT
--
--   1. A partner request can no longer be rewritten while it is answered.
--   2. A repaired old booking returns the room it just repaired, rather
--      than the null it read a moment earlier.
--
-- The second is a plain bug and has no business sharing a migration with a
-- security fix. It is here because it is one word, because nobody should
-- have to run two migrations in one sitting, and because a booking that
-- cannot be joined is the same kind of silent failure as the first.
-- ============================================================


-- ============================================================
-- 1. Who a partner request is between is decided when it is sent
--
-- guard_partner_request has always stopped the sender answering their own
-- request. It never stopped anybody changing WHO the request was from.
--
-- The update policy passes as long as the caller is still on one side of the
-- row, and the recipient always is. So the recipient could accept a request
-- and, in the same statement, replace from_user with any account they liked —
-- ending up partnered with somebody who never asked, and never consented.
-- Partnership is what unlocks seeing another person's availability and
-- booking time in it, so this is not a cosmetic forgery.
--
-- The fix is the smallest thing that closes it: the two participant columns
-- are immutable after insert, checked before any of the status rules run.
-- Nothing legitimate ever moves them — assets/db.js only ever updates
-- to_seen_at and from_seen_at on this table — so there is no case to carve
-- out, including for the definer functions, and carving one out is how this
-- kind of hole reopens.
--
-- id goes with them: sessions.pair_id references this row's id, so an id that
-- can move is a session that can be re-pointed at a partnership it was never
-- part of.
--
-- created_at deliberately does NOT. It was in the first version of this,
-- added on the reasoning that it cost nothing — and it cost sixteen tests.
-- The dormancy rules are all about how long a partnership has been quiet, so
-- every fixture that exercises them backdates created_at to make a
-- partnership old. Freezing it broke all of them, and it was never the
-- forgery: nobody gains anything by ageing their own partnership. A guard
-- that blocks real work to prevent an attack nobody would mount is a guard
-- that gets removed in a hurry by somebody who has not read this far.
-- ============================================================
create or replace function public.guard_partner_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Before anything else, and with no exception for anybody: a request is
  -- between the two people it was sent between.
  if new.from_user is distinct from old.from_user
  or new.to_user   is distinct from old.to_user
  or new.id        is distinct from old.id then
    raise exception 'a partner request cannot change who it is between'
      using errcode = 'PF040';
  end if;

  -- Either side may end an accepted partnership.
  if new.status = 'ended' and old.status = 'accepted'
     and auth.uid() in (old.from_user, old.to_user) then
    return new;
  end if;

  -- Everything else keeps the original rule: the sender cannot answer their
  -- own request.
  if auth.uid() = old.from_user and auth.uid() <> old.to_user
     and new.status is distinct from old.status then
    raise exception 'only the recipient can answer a partner request';
  end if;
  return new;
end;
$$;

drop trigger if exists partner_request_guard on public.partner_requests;
create trigger partner_request_guard
  before update on public.partner_requests
  for each row execute function public.guard_partner_request();


-- ============================================================
-- 2. The repaired room is the one you get back
--
-- session_for_call reads the session row into `s`, then repairs a missing
-- room_name into the local `room_id` and writes it back to the table. The
-- successful return then handed back s.room_name — the value read BEFORE the
-- repair, which is still null.
--
-- So the repair worked, the table was correct afterwards, and the person
-- pressing Join was told there was no room. They would get in on a second
-- attempt, which is exactly the shape of bug nobody reports and everybody
-- works around.
--
-- Reproduced by starting from room_name IS NULL with a recoverable room_url;
-- dev/sql-tests.sh has that case now.
--
-- Re-declared in full because a Postgres function cannot be patched, only
-- replaced. Everything below is the current definition with one identifier
-- changed on the return.
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

  return query select true, 'ok', room_id, me,
                      coalesce(nullif(my_name, ''), 'A partner'),
                      s.partner_name, s.topic, s.goal,
                      s.starts_at, closes;
end $$;

