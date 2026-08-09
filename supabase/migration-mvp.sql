-- ============================================================
-- PeerFlow — MVP migration (attendance, notifications, progress)
--
-- Run this AFTER supabase/schema.sql. Paste into Supabase → SQL Editor → Run.
-- Safe to run more than once.
--
-- This file is additive. It does not drop or rewrite anything created by
-- schema.sql: existing profiles, partner requests and sessions survive, and
-- answer_session / drop_session keep the behaviour they already had.
--
-- What it adds
--   1. 'ended' partner requests, so a partnership can be archived without
--      destroying the history of sessions the two people did together.
--   2. Per-person attendance on sessions: who confirmed, who turned up, what
--      each of them meant to get done.
--   3. Session goals, completion and no-show.
--   4. In-app notifications.
--   5. Unlocked achievements.
--   6. A current stage on the learning path.
-- ============================================================


-- ============================================================
-- 1. Partnerships: archive rather than delete
-- ============================================================
-- A partnership is still an accepted row in partner_requests — that is what
-- acceptedPartners() reads, and rewriting it into a separate table would break
-- every existing pairing. Ending one moves it to 'ended' instead of deleting
-- it, so the sessions the two of them sat stay attributable and the pair can
-- be shown in history.

alter table public.partner_requests drop constraint if exists partner_requests_status_check;
alter table public.partner_requests
  add constraint partner_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'ended'));

alter table public.partner_requests add column if not exists ended_at timestamptz;
alter table public.partner_requests add column if not exists ended_by uuid
  references auth.users(id) on delete set null;

-- The guard trigger lets only the recipient change status. Ending is different:
-- either side may walk away from a partnership they are both in. Replace the
-- trigger body so 'ended' is allowed from either direction, while accepting and
-- declining stay the recipient's alone.
create or replace function public.guard_partner_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
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
-- 2 + 3. Sessions: attendance, goals, completion
-- ============================================================
-- sessions already holds one row per person per meeting, which is exactly the
-- shape per-participant state wants: each person's row carries their own
-- confirmation, their own goal and whether they turned up.

alter table public.sessions add column if not exists confirmed_at timestamptz;
alter table public.sessions add column if not exists goal         text;
alter table public.sessions add column if not exists goal_done    boolean;
alter table public.sessions add column if not exists attended     boolean;
alter table public.sessions add column if not exists completed_at timestamptz;
-- When a cancellation happened, so early and late cancellations can be told
-- apart without a second status value.
alter table public.sessions add column if not exists cancelled_at timestamptz;

-- 'completed' and 'no_show' join the existing four.
alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions
  add constraint sessions_status_check
  check (status in ('proposed', 'confirmed', 'declined', 'cancelled',
                    'completed', 'no_show'));

create index if not exists sessions_user_confirmed on public.sessions (user_id, confirmed_at);


-- ---------- answering keeps working, and learns two more answers ----------
-- Same contract as before: check the caller owns a copy, then move both rows.
-- 'completed' and 'no_show' are added to the allowed list, and a cancellation
-- now stamps cancelled_at so reliability can tell early from late.
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

  update public.sessions
     set status       = p_status,
         cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
         cancelled_at = case when p_status = 'cancelled' then now()      else cancelled_at end
   where starts_at = p_starts_at and room_url = p_room;
  get diagnostics n = row_count;
  return n;
end $$;


-- ---------- per-person state: only ever the caller's own row ----------
-- Confirming attendance, setting a goal and checking out are each about one
-- person. answer_session deliberately moves both rows; these deliberately move
-- one, so a partner can never confirm on your behalf.

create or replace function public.confirm_attendance(
  p_starts_at timestamptz,
  p_room      text,
  p_goal      text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.sessions
     set confirmed_at = now(),
         goal         = coalesce(nullif(p_goal, ''), goal)
   where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no such session for this user';
  end if;
  return n;
end $$;

create or replace function public.set_session_goal(
  p_starts_at timestamptz,
  p_room      text,
  p_goal      text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.sessions
     set goal = nullif(p_goal, '')
   where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no such session for this user';
  end if;
  return n;
end $$;

-- Checking out of a session. Marks the caller present and, because a session
-- somebody attended did happen, moves the shared status to 'completed'. The
-- partner's `attended` stays null until they check out themselves — that is
-- what makes a no-show visible rather than assumed.
create or replace function public.finish_session(
  p_starts_at  timestamptz,
  p_room       text,
  p_goal_done  boolean default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not exists (
    select 1 from public.sessions
    where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room
  ) then
    raise exception 'no such session for this user';
  end if;

  update public.sessions
     set attended     = true,
         goal_done    = coalesce(p_goal_done, goal_done),
         completed_at = now()
   where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room;

  update public.sessions
     set status = 'completed'
   where starts_at = p_starts_at and room_url = p_room
     and status in ('confirmed', 'proposed');
  get diagnostics n = row_count;
  -- Rows moved to 'completed'. Zero is a normal answer, not a failure: the
  -- second person to check out finds the session already completed.
  return n;
end $$;

-- ---------- reading the other half of a session ----------
-- "read own sessions" limits SELECT to your own row, which is right: nobody
-- should be able to read the sessions of people they have nothing to do with.
-- But an attendance panel has to say whether the OTHER person has confirmed,
-- and that lives on their row.
--
-- This returns exactly three facts about the partner's copy of one meeting the
-- caller already owns a copy of — confirmed, attended, and whether they have
-- set a goal. Not the goal text, not their name, not anything else on the row.
create or replace function public.session_partner_state(
  p_starts_at timestamptz,
  p_room      text
) returns table (confirmed boolean, attended boolean, has_goal boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sessions
    where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room
  ) then
    raise exception 'no such session for this user';
  end if;

  return query
    select (s.confirmed_at is not null),
           coalesce(s.attended, false),
           (s.goal is not null and s.goal <> '')
      from public.sessions s
     where s.starts_at = p_starts_at
       and s.room_url  = p_room
       and s.user_id  <> auth.uid()
     limit 1;
end $$;

revoke all on function public.session_partner_state(timestamptz, text) from public, anon;
grant execute on function public.session_partner_state(timestamptz, text) to authenticated;

revoke all on function public.confirm_attendance(timestamptz, text, text) from public, anon;
revoke all on function public.set_session_goal(timestamptz, text, text)   from public, anon;
revoke all on function public.finish_session(timestamptz, text, boolean)  from public, anon;
grant execute on function public.confirm_attendance(timestamptz, text, text) to authenticated;
grant execute on function public.set_session_goal(timestamptz, text, text)   to authenticated;
grant execute on function public.finish_session(timestamptz, text, boolean)  to authenticated;


-- ============================================================
-- 4. Notifications
-- ============================================================
-- Read and dismissed by their owner. Nobody may insert a row into somebody
-- else's list directly — that would let any account push arbitrary text at any
-- other account. Writing to a partner goes through notify_partner() below,
-- which will only write to someone the caller is actually partnered with.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "read own notifications"    on public.notifications;
drop policy if exists "insert own notifications"  on public.notifications;
drop policy if exists "update own notifications"  on public.notifications;
drop policy if exists "delete own notifications"  on public.notifications;

create policy "read own notifications"
  on public.notifications for select using (auth.uid() = user_id);
-- Only for yourself. Partner-facing notifications go through the function.
create policy "insert own notifications"
  on public.notifications for insert with check (auth.uid() = user_id);
create policy "update own notifications"
  on public.notifications for update using (auth.uid() = user_id);
create policy "delete own notifications"
  on public.notifications for delete using (auth.uid() = user_id);

create or replace function public.notify_partner(
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
  -- Only someone you are actually partnered with, and never yourself.
  if p_to = auth.uid() then
    raise exception 'cannot notify yourself';
  end if;
  if not exists (
    select 1 from public.partner_requests r
    where r.status = 'accepted'
      and ((r.from_user = auth.uid() and r.to_user = p_to)
        or (r.to_user   = auth.uid() and r.from_user = p_to))
  ) then
    raise exception 'not partnered with that user';
  end if;

  insert into public.notifications (user_id, kind, title, body, href)
  values (p_to, p_kind, left(p_title, 200), left(p_body, 500), left(p_href, 200))
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.notify_partner(uuid, text, text, text, text) from public, anon;
grant execute on function public.notify_partner(uuid, text, text, text, text) to authenticated;

-- A partner REQUEST is the one notification that has to reach someone you are
-- not yet partnered with. Narrower function: it will only write a row when a
-- pending request from the caller to that person genuinely exists.
create or replace function public.notify_request(
  p_to    uuid,
  p_title text,
  p_body  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_to = auth.uid() then
    raise exception 'cannot notify yourself';
  end if;
  if not exists (
    select 1 from public.partner_requests r
    where ((r.from_user = auth.uid() and r.to_user = p_to)
        or (r.to_user   = auth.uid() and r.from_user = p_to))
  ) then
    raise exception 'no request between these users';
  end if;

  insert into public.notifications (user_id, kind, title, body, href)
  values (p_to, 'partner_request', left(p_title, 200), left(p_body, 500), 'app-people.html')
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.notify_request(uuid, text, text) from public, anon;
grant execute on function public.notify_request(uuid, text, text) to authenticated;


-- ============================================================
-- 5. Achievements
-- ============================================================
-- The rules are evaluated in the browser from real session rows (assets/
-- badges.js). This table only records that an achievement has been seen to
-- unlock, so "unlocked" can be announced once instead of every page load.

create table if not exists public.achievements (
  user_id     uuid not null references auth.users(id) on delete cascade,
  code        text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);
create index if not exists achievements_user on public.achievements (user_id, unlocked_at desc);

alter table public.achievements enable row level security;

drop policy if exists "read own achievements"   on public.achievements;
drop policy if exists "insert own achievements" on public.achievements;

create policy "read own achievements"
  on public.achievements for select using (auth.uid() = user_id);
create policy "insert own achievements"
  on public.achievements for insert with check (auth.uid() = user_id);


-- ============================================================
-- 6. Learning-path stage and session preference
-- ============================================================
-- The twelve-week ordering per path already lives in assets/plans.js. All the
-- database needs is which week the learner is on, so Progress can show what is
-- done, current and next without a course-content table.

alter table public.profiles add column if not exists stage_index  int not null default 0;
alter table public.profiles add column if not exists pref_minutes int not null default 50;

-- ============================================================
-- Done. Nothing above drops user data.
-- ============================================================
