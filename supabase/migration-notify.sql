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
