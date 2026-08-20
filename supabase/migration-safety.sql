-- ============================================================
-- PeerFlow — report somebody, block them, and delete your account
--
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
--
-- The code of conduct has said this since the site went up:
--
--     "Every call has one-tap report and block, and you can report someone
--      whether or not you're still on the call."
--
-- None of it existed. There was no blocks table, no reports table, and no way
-- for anybody to stop anybody else from messaging them, asking to partner
-- with them, or booking time in their calendar. The only stated route out was
-- an email address in a footer.
--
-- What this adds:
--
--   blocks           who has blocked whom. Yours to read, yours to write,
--                    invisible to the person you blocked.
--   reports          what somebody said about somebody else, with the names
--                    written down at the time, so a report survives either
--                    account being deleted.
--   blocked_with()   the one question every policy below has to ask, asked in
--                    a way that does not require reading a table you are not
--                    allowed to read.
--   block_person()   block, end the partnership, and clear the calendar, in
--                    one transaction rather than three round trips that can
--                    half-fail.
--   report_person()  write a report, snapshot the names, and block by default.
--
-- and it narrows three existing policies so that a block actually stops
-- something rather than being a row nobody consults.
-- ============================================================


-- ---------- blocks ----------
-- A block is one-directional as a fact and two-directional in effect: I block
-- you, and neither of us can reach the other afterwards. Storing it as one row
-- with a direction rather than as a symmetric pair keeps "who did this" — I
-- can unblock you; you cannot unblock yourself.
create table if not exists public.blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint no_self_block check (blocker <> blocked)
);

-- The primary key already answers "who have I blocked". This answers "who has
-- blocked me", which is the direction blocked_with() below reads on every
-- profile row of every People page.
create index if not exists blocks_blocked on public.blocks (blocked);

alter table public.blocks enable row level security;

drop policy if exists "read your own blocks" on public.blocks;
drop policy if exists "block somebody"       on public.blocks;
drop policy if exists "unblock somebody"     on public.blocks;

-- Only your own rows, in the blocker direction. Being able to read rows where
-- you are the *blocked* party would turn a silent block into a notification,
-- which is the one thing a block must not be: the whole value of it to
-- somebody being harassed is that using it is not an act of confrontation.
create policy "read your own blocks"
  on public.blocks for select using (auth.uid() = blocker);
create policy "block somebody"
  on public.blocks for insert with check (auth.uid() = blocker);
create policy "unblock somebody"
  on public.blocks for delete using (auth.uid() = blocker);
-- No update policy. A block has nothing about it to change.

grant select, insert, delete on public.blocks to authenticated;


-- ---------- the question every policy has to ask ----------
-- "Is there a block, in either direction, between me and this person?"
--
-- It cannot be written as a plain subquery inside a policy, because a
-- subquery in a policy runs as the person asking and is therefore subject to
-- the blocks table's own RLS — which deliberately hides the rows where you
-- are the blocked party. A policy written that way would enforce blocks you
-- made and silently ignore blocks made against you, which is exactly backwards:
-- the person who needs the rule enforced is the one who did not write the row.
--
-- SECURITY DEFINER steps over that. It takes one argument rather than two so
-- that the only pair anybody can ask about is a pair they are already in.
create or replace function public.blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker = auth.uid() and b.blocked = p_other)
        or (b.blocker = p_other    and b.blocked = auth.uid())
  );
$$;

revoke all on function public.blocked_with(uuid) from public;
-- anon needs this as much as authenticated does, which is not obvious and was
-- found the hard way — see the profiles policy below for why. For a signed-out
-- caller auth.uid() is NULL, both halves of the OR compare against NULL, the
-- exists() finds nothing and the answer is false, so granting it away leaks
-- nothing: there is no pair for a caller with no identity to ask about.
grant execute on function public.blocked_with(uuid) to anon, authenticated, service_role;


-- ---------- blocking, as one act ----------
-- Blocking somebody you are partnered with has to end the partnership, or the
-- block does almost nothing: an accepted partner_requests row is what the
-- booking policy checks, so leaving it standing leaves them able to put time
-- in your calendar. And ending the partnership without clearing the calendar
-- leaves both of you holding sessions that can never be joined, because
-- session_for_call() refuses anybody who is no longer partnered.
--
-- All three belong in one transaction. Done from the browser as three calls,
-- the second or third can fail and leave somebody blocked but still bookable.
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

  -- 'ended' rather than deleted, which is what migration-mvp.sql chose for
  -- walking away from a partnership: the sessions the two of you sat stay
  -- attributable to a pairing that really existed.
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
     set status       = 'cancelled',
         cancelled_at = coalesce(s.cancelled_at, now()),
         cancelled_by = coalesce(s.cancelled_by, me)
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


-- ---------- reports ----------
-- Reports are write-only from the app's point of view: you can read the ones
-- you wrote and nothing else, and there is no update path at all. They are
-- read in the Supabase dashboard, by hand, which is the honest shape of
-- moderation on a site this size — a queue with nobody on it would be worse
-- than an inbox somebody actually opens.
--
-- reporter and reported are `on delete set null` rather than cascade, and the
-- two name columns exist, for one reason: a report has to outlive both
-- accounts. Somebody who harasses a person and then deletes their account
-- must not be able to delete the record of it on the way out, and the person
-- reading the report a month later needs to know who it was about.
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter      uuid references auth.users(id) on delete set null,
  reported      uuid references auth.users(id) on delete set null,
  reporter_name text,
  reported_name text,
  reason        text not null
                check (reason in ('harassment','no_show','spam','safety','other')),
  detail        text check (detail is null or length(detail) <= 2000),
  -- Which session it happened on, when there was one. Nullable, because the
  -- code of conduct promises you can report somebody whether or not you are
  -- still on the call — including when there was never a call.
  session_id    uuid references public.sessions(id) on delete set null,
  created_at    timestamptz not null default now(),
  handled_at    timestamptz
);

create index if not exists reports_reported on public.reports (reported, created_at desc);
-- The queue: everything nobody has looked at yet, newest first.
create index if not exists reports_open on public.reports (created_at desc)
  where handled_at is null;

alter table public.reports enable row level security;

drop policy if exists "read reports you wrote" on public.reports;

create policy "read reports you wrote"
  on public.reports for select using (auth.uid() = reporter);
-- No insert policy on purpose. Reports are written by report_person() below,
-- which fills in the names itself — a row whose reported_name the reporter got
-- to choose would be worth nothing as a record.

grant select on public.reports to authenticated;


create or replace function public.report_person(
  p_about   uuid,
  p_reason  text,
  p_detail  text default null,
  p_session uuid default null,
  p_block   boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  rid uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;
  if p_about is null or p_about = me then
    raise exception 'you cannot report yourself' using errcode = 'PF011';
  end if;
  if not exists (select 1 from public.profiles where id = p_about) then
    raise exception 'no such person' using errcode = 'PF012';
  end if;
  if p_reason is null or p_reason not in
       ('harassment','no_show','spam','safety','other') then
    raise exception 'unknown reason' using errcode = 'PF013';
  end if;

  -- Somebody upset enough to report a person is somebody who may well press
  -- the button twice. Collapsing repeats within the hour keeps the queue
  -- readable without ever telling them their report did not count — they get
  -- the same id back and the same confirmation.
  select r.id into rid
    from public.reports r
   where r.reporter = me
     and r.reported = p_about
     and r.created_at > now() - interval '1 hour'
   order by r.created_at desc
   limit 1;

  if rid is null then
    insert into public.reports (reporter, reported, reporter_name, reported_name,
                                reason, detail, session_id)
    select me,
           p_about,
           (select p.name from public.profiles p where p.id = me),
           (select p.name from public.profiles p where p.id = p_about),
           p_reason,
           nullif(btrim(coalesce(p_detail, '')), ''),
           -- Only a session that is genuinely yours. Without this the
           -- argument is a free pointer into anybody's calendar, and a report
           -- could be filed against a booking the reporter was never part of.
           (select s.id from public.sessions s
             where s.id = p_session and s.user_id = me)
    returning id into rid;
  end if;

  -- Blocking is the default rather than a second decision, because the state
  -- somebody is in when they report a person is not the state in which to ask
  -- them a follow-up question. The dialog lets them turn it off.
  if p_block then
    perform public.block_person(p_about);
  end if;

  return rid;
end;
$$;

revoke all on function public.report_person(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.report_person(uuid, text, text, uuid, boolean) to authenticated;


-- ============================================================
-- Making the block bite
-- ============================================================
-- Three policies decided who could reach whom, and none of them knew blocks
-- existed. Each gets the same clause added and nothing else changed.

-- ---------- profiles ----------
-- Blocked in either direction and the profile is simply not there. The person
-- disappears from People, and app-person.html falls into the "we couldn't find
-- that person" state it already had for a deleted account — which is the right
-- amount of information for both sides: the blocker sees them gone, and the
-- blocked party sees something indistinguishable from an account that closed.
--
-- This was first written as a CASE, on the reasoning that Postgres does not
-- promise to evaluate the arms of an AND or OR in written order and a
-- signed-out reader must never reach a function anon cannot execute. The CASE
-- was correct about evaluation and beside the point about permissions:
-- dev/sql-tests.sh had a signed-out read fail with "permission denied for
-- function blocked_with" while sitting on the `auth.uid() is null then true`
-- arm. EXECUTE is checked when the expression is prepared, not when an arm is
-- taken, so no amount of ordering saves a policy from a missing grant — which
-- is why blocked_with is granted to anon above, and why the test that caught
-- this is worth more than the comment that was wrong.
--
-- With the grant in place the plain expression is right and needs no guard: a
-- signed-out caller has no identity, so blocked_with returns false for every
-- row and the policy reads exactly as `true` used to.
drop policy if exists "profiles are viewable" on public.profiles;
create policy "profiles are viewable"
  on public.profiles for select using (
    id = auth.uid() or not public.blocked_with(id)
  );

-- ---------- partner requests ----------
-- Asking somebody to be your partner is the loudest thing one account can do
-- to another, so it is the first thing a block has to stop.
drop policy if exists "send requests as yourself" on public.partner_requests;
create policy "send requests as yourself"
  on public.partner_requests for insert
  with check (auth.uid() = from_user and not public.blocked_with(to_user));

-- The update policy matters as much as the insert one. `unique (from_user,
-- to_user)` means a second request between the same two people is an UPDATE
-- of the row that is already there, not an INSERT — so a policy that guarded
-- only inserts would let a blocked account revive a dead request by setting
-- its status back to 'pending'.
drop policy if exists "answer or mark seen" on public.partner_requests;
create policy "answer or mark seen"
  on public.partner_requests for update
  using (
    (auth.uid() = from_user or auth.uid() = to_user)
    and not public.blocked_with(
      case when auth.uid() = from_user then to_user else from_user end)
  );

-- ---------- messages ----------
drop policy if exists "message people you know" on public.messages;
create policy "message people you know"
  on public.messages for insert with check (
    auth.uid() = from_user
    and not public.blocked_with(messages.to_user)
    and exists (
      select 1 from public.partner_requests r
      where (r.from_user = auth.uid() and r.to_user   = messages.to_user)
         or (r.to_user   = auth.uid() and r.from_user = messages.to_user)
    )
  );
-- Messages already sent stay readable by both sides. Blocking stops what
-- happens next; it is not a right to edit somebody else's inbox, and a thread
-- that emptied itself would destroy the evidence for the report that usually
-- accompanies it.
