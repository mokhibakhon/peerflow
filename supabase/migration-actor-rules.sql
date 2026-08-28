-- ============================================================
-- PeerFlow — who is allowed to move a session, and to where
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run twice. Run migration-forgery.sql first if you have not.
--
-- Until this is run the holes below are open. Nothing in CI applies it.
--
-- WHAT THIS IS
--
-- sessions_truth_guard already stops a browser writing attendance or status
-- directly, and it is a good guard: SECURITY INVOKER on purpose, so it can
-- tell a page from a definer function, with tests for the obvious attacks.
--
-- It has one structural blind spot, and it is not a flaw in the guard. The
-- definer RPCs run as the owner, so the guard waves them through by design —
-- which means every rule about WHO may do WHAT has to live inside each RPC.
-- answer_session had almost none. It checked that the caller owned a row of
-- the session and nothing else, so:
--
--   * the person who proposed a time could accept it themselves, and the
--     other person would find it on their calendar as agreed
--   * any participant could pass 'completed', which is what the session count
--     and the streak read
--   * any participant could pass 'no_show', which reliability_of reads as a
--     zero — landing on the other person's record
--
-- The app has only ever sent three of the five: assets/db.js calls this with
-- 'confirmed', 'declined' and 'cancelled' and nothing else. 'completed' is
-- set by close_room when the booking's own clock says it is over, and
-- 'no_show' by the attendance sweep. Neither was ever a thing a page needed
-- to say, so removing them from the allow-list costs the product nothing and
-- closes two forgeries outright.
--
-- What remains is the actor rule, which needs proposed_by — already on the
-- table, already written by assets/db.js on every proposal.
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
  mine public.sessions%rowtype;
begin
  -- 'completed' and 'no_show' are gone from here on purpose. They are the
  -- database's own conclusions about what happened, not answers a person
  -- gives, and a page has never sent either.
  if p_status not in ('confirmed', 'declined', 'cancelled') then
    raise exception 'a page may only accept, decline or cancel'
      using errcode = 'PF041';
  end if;

  -- Owning a row of this session is still the price of entry, and it is still
  -- the only thing that distinguishes "not yours" from "does not exist" — the
  -- two answer the same way so this cannot be used to ask whether a given
  -- time is somebody's booking.
  select * into mine from public.sessions
   where user_id = auth.uid() and starts_at = p_starts_at and room_url = p_room;

  if not found then
    raise exception 'no such session for this user';
  end if;

  if p_status in ('confirmed', 'declined') then
    -- Answering is something you do to an open question. A session already
    -- agreed, already declined or already called off is not one.
    if mine.status <> 'proposed' then
      raise exception 'that session is not waiting on an answer'
        using errcode = 'PF042';
    end if;
    -- And the answer is the other person's to give. `is not distinct from`
    -- rather than `=` so a null proposed_by does not quietly evaluate to
    -- null and let the branch through: rows from before that column existed
    -- have no proposer recorded, and they all default to 'confirmed', so they
    -- cannot reach this line anyway.
    if mine.proposed_by is not distinct from auth.uid() then
      raise exception 'only the other person can answer a proposal'
        using errcode = 'PF041';
    end if;
  else
    -- Cancelling is either party's, which is the difference between it and
    -- declining — but only for something still live. Cancelling an already
    -- cancelled session would re-run the attendance arithmetic below on a
    -- record that has already been settled.
    if mine.status not in ('proposed', 'confirmed') then
      raise exception 'that session cannot be cancelled'
        using errcode = 'PF042';
    end if;
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
-- Deleting a booking is for the ones that never became one
--
-- drop_session removes both rows outright, and its own comment in
-- assets/db.js says what it is for: "withdrawing a proposal nobody has
-- answered yet — nothing was agreed, so there is nothing to report — and for
-- clearing a decline or a cancellation you have read."
--
-- It never enforced that. Any participant could delete any session of theirs,
-- including a completed one, taking the attendance record with it — which is
-- the evidence reliability_of is computed from. Somebody with a bad week
-- could tidy it away.
--
-- The rule is the one the comment already describes.
-- ============================================================
create or replace function public.drop_session(
  p_starts_at timestamptz,
  p_room      text
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

  -- Checked across both rows rather than the caller's own: a session the two
  -- of you agreed to is agreed for both of you, and it is cancelled, not
  -- deleted. Cancelling keeps the row and records who called it off, which is
  -- the entire point of there being a record.
  if exists (
    select 1 from public.sessions
    where starts_at = p_starts_at and room_url = p_room
      and status in ('confirmed', 'completed')
  ) then
    raise exception 'a session you both agreed to is cancelled, not deleted'
      using errcode = 'PF042';
  end if;

  delete from public.sessions
   where starts_at = p_starts_at and room_url = p_room;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.drop_session(timestamptz, text) from public, anon;
grant execute on function public.drop_session(timestamptz, text) to authenticated;


-- ============================================================
-- finish_session is dead, and was still granted
--
-- Nothing in the app calls it — the only mention of the name in assets/ is a
-- comment. It sets attended and completed_at directly from whatever the
-- caller passes, as a definer function, which is the exact shape the
-- attendance guard exists to prevent; it predates that guard and was simply
-- never withdrawn.
--
-- Revoked rather than dropped. A drop would fail loudly if some caller
-- nobody remembers still exists, and a revoke fails just as loudly at the
-- same moment while leaving the body there to read.
-- ============================================================
revoke all on function public.finish_session(timestamptz, text, boolean) from public, anon, authenticated;
