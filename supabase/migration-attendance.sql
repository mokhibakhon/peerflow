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
