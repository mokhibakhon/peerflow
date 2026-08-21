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


-- ============================================================
-- Deleting your account
-- ============================================================
-- Settings used to say: email hello@peerflow.dev and your account is removed.
-- That is a promise made by a person who might be asleep, and it is not what
-- privacy.html now says — it says there is a button, it happens immediately,
-- and nobody has to approve it. This is that button.
--
-- Everything hangs off auth.users with `on delete cascade`, so deleting the
-- one row takes the profile, the sessions, the messages, the notifications,
-- the achievements, the partner requests and the blocks with it. The work
-- below is entirely about the rows that are NOT yours and would otherwise be
-- left holding a reference to somebody who no longer exists.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  mine text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  select coalesce(nullif(btrim(name), ''), 'Your partner')
    into mine from public.profiles where id = me;

  -- 1. Tell them, while there is still a row saying you were partners.
  --    After the cascade there is nothing left to work out who to tell, and
  --    somebody whose partner silently evaporates learns about it by turning
  --    up to a call that will not open.
  insert into public.notifications (user_id, kind, title, body, href)
  select case when r.from_user = me then r.to_user else r.from_user end,
         'partner',
         mine || ' closed their account',
         'Any sessions the two of you had booked have been called off. '
           || 'You can ask somebody else on Everyone.',
         'app-people.html'
    from public.partner_requests r
   where r.status = 'accepted'
     and (r.from_user = me or r.to_user = me);

  -- 2. Take the future off their calendar. Their row survives the cascade —
  --    it belongs to them — and would otherwise sit there as a confirmed
  --    session that can never be joined, because session_for_call() refuses
  --    anybody who is no longer partnered.
  --
  --    The two rows of one booking are matched on any of the three things
  --    they share. pair_id is the modern answer and the only one that is
  --    always right, but rows written before migration-room-per-session.sql
  --    have none, so room_name and room_url are checked too. A NULL on either
  --    side compares as NULL and simply does not match, which is the wanted
  --    behaviour: no match is better than a wrong one.
  update public.sessions o
     set status       = 'cancelled',
         cancelled_at = coalesce(o.cancelled_at, now())
    from public.sessions m
   where m.user_id = me
     and o.user_id <> me
     and o.status in ('proposed', 'confirmed')
     and o.starts_at > now()
     and o.starts_at = m.starts_at
     and (o.pair_id = m.pair_id
       or o.room_name = m.room_name
       or o.room_url  = m.room_url);

  -- 3. Take your name off the rows that outlive you. privacy.html promises
  --    exactly this: a former partner keeps the times the two of you booked,
  --    with your name off them. Deleting their rows outright would rewrite
  --    their own history and take their streak with it; leaving the name on
  --    would mean deleting your account did not delete your name.
  update public.sessions o
     set partner_name = null
    from public.sessions m
   where m.user_id = me
     and o.user_id <> me
     and o.starts_at = m.starts_at
     and (o.pair_id = m.pair_id
       or o.room_name = m.room_name
       or o.room_url  = m.room_url);

  -- 4. Reports need no work and that is the point. reporter and reported are
  --    `on delete set null` and the names were written down at report time,
  --    so harassing somebody and then closing the account does not delete the
  --    record of it. This comment exists so nobody later "tidies up" those
  --    columns into a cascade.

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- The function runs as its owner, which is whoever pasted this into the SQL
-- editor — the `postgres` role — and `postgres` can normally delete from
-- auth.users. Normally. If delete_own_account() ever fails with "permission
-- denied for table users", this is the missing grant, and it has to be run by
-- something that owns the auth schema. Wrapped so that a database where it is
-- neither needed nor permitted still loads this file.
do $$
begin
  execute 'grant delete on table auth.users to postgres';
exception when others then
  raise notice 'delete_own_account: could not grant delete on auth.users (%). '
               'Harmless unless deleting an account fails with a permission '
               'error, in which case this grant is what is missing.', sqlerrm;
end $$;


-- ============================================================
-- Taking it back, and adding to it
-- ============================================================
-- The reporting flow asks for one press: pick a reason and the report is
-- filed and the person is blocked, with no form in between. That is the right
-- shape — somebody reaching for this button has just been made uncomfortable,
-- and that is not the moment to ask them four questions — but it is only safe
-- if the press is reversible. These two functions are what make it so.

-- Undo. Deletes a report you have just made and, by default, unblocks them
-- with it.
--
-- Three conditions, and each one is doing work. `reporter = me` because this
-- is your report and nobody else's to withdraw. `handled_at is null` because
-- once somebody has read and acted on it, it is a record of a decision rather
-- than a draft. And the fifteen minutes because this is an undo button, not a
-- way to un-say something a week later — a report that could be withdrawn
-- indefinitely could be withdrawn under pressure.
--
-- What it deliberately does NOT restore is the partnership and the sessions
-- block_person() called off. Sessions do not record the status they had
-- before, so 'confirmed' and 'proposed' cannot be told apart afterwards, and
-- guessing would put a session somebody never agreed to back on their
-- calendar. The UI says this in as many words rather than implying a clean
-- reversal.
create or replace function public.withdraw_report(
  p_id      uuid,
  p_unblock boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  who uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  delete from public.reports
   where id = p_id
     and reporter = me
     and handled_at is null
     and created_at > now() - interval '15 minutes'
  returning reported into who;

  -- No row means the id was wrong, the report was somebody else's, it has
  -- been read already, or the window has closed. All four are "there is
  -- nothing to undo", which is a false rather than an error: the caller is a
  -- button that should say so quietly.
  if who is null then
    return false;
  end if;

  if p_unblock then
    delete from public.blocks where blocker = me and blocked = who;
  end if;

  return true;
end;
$$;

revoke all on function public.withdraw_report(uuid, boolean) from public, anon;
grant execute on function public.withdraw_report(uuid, boolean) to authenticated;


-- The other half of one-press reporting: the sentence you did not stop to
-- write. A day rather than fifteen minutes, because adding what happened is
-- not undoing anything and somebody may well come back to it once they have
-- stopped shaking. Still only your own report, and still not one that has
-- already been read — an account of an incident that can be rewritten after
-- somebody has acted on it is not a record.
create or replace function public.amend_report(
  p_id     uuid,
  p_detail text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF010';
  end if;

  update public.reports
     set detail = nullif(btrim(coalesce(p_detail, '')), '')
   where id = p_id
     and reporter = me
     and handled_at is null
     and created_at > now() - interval '24 hours';

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.amend_report(uuid, text) from public, anon;
grant execute on function public.amend_report(uuid, text) to authenticated;


-- ---------- who is on the other side of this call ----------
-- call.html knows the partner's name and not their id: session_for_call()
-- returns `partner` as text, because until now nothing on that page needed
-- to address them as an account. Reporting does.
--
-- This is a separate lookup rather than a new column on session_for_call()
-- deliberately. That function is the gate every call goes through and its
-- shape is baked into the call-token edge function; widening it would mean a
-- migration and a redeployment to add a field that one button needs.
--
-- It answers only for a session that is yours, so it cannot be used to walk
-- the calendar looking up who sat with whom. NULL for anything else, which
-- the caller reads as "no report button".
create or replace function public.partner_for_session(p_session uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me    uuid := auth.uid();
  mine  public.sessions%rowtype;
  other uuid;
begin
  if me is null or p_session is null then
    return null;
  end if;

  select * into mine
    from public.sessions
   where id = p_session and user_id = me;
  if not found then
    return null;
  end if;

  -- The same three-way match the rest of this file uses to pair up the two
  -- rows of one booking: pair_id is the modern answer and the only one that
  -- is always right, room_name and room_url cover rows written before it
  -- existed, and a NULL on either side compares as NULL and simply fails to
  -- match — which is wanted, since no answer beats a wrong one here.
  select o.user_id into other
    from public.sessions o
   where o.user_id <> me
     and o.starts_at = mine.starts_at
     and (o.pair_id   = mine.pair_id
       or o.room_name = mine.room_name
       or o.room_url  = mine.room_url)
   limit 1;

  return other;
end;
$$;

revoke all on function public.partner_for_session(uuid) from public, anon;
grant execute on function public.partner_for_session(uuid) to authenticated;
