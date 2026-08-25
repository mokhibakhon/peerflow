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
-- then migration-mvp.sql, then migrate-2026-08.sql. All three, and nothing
-- else: every migration written so far is folded into the third.
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
