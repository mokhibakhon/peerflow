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
