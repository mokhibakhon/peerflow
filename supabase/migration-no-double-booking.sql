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
