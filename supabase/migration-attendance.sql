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
