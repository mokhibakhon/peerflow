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
