-- ============================================================
-- PeerFlow — the profiles policy stops asking the same question 2000 times
--
-- Run this once in the Supabase SQL editor, after migration-safety.sql and
-- migration-profiles-private.sql. Safe to run more than once.
--
-- WHY
--
-- Every read of public.profiles goes through this policy:
--
--   using (auth.uid() is not null
--          and (id = auth.uid() or not public.blocked_with(id)))
--
-- blocked_with() takes the row's id, so it is called once per row the scan
-- touches. It is SECURITY DEFINER, which means the planner cannot inline it:
-- each call is a real function invocation running its own exists() against
-- public.blocks. The People directory reads sixty profiles and the count on
-- Today reads the lot.
--
-- This was measured rather than assumed, against a PostgreSQL 16 loaded with
-- the real files and two thousand profiles, with track_functions=all:
--
--   select count(*) from public.profiles   ->  blocked_with() called 1999 times
--
-- One call per row, every row, every read. The schema already suspected it —
-- the comment above the blocks_blocked index says blocked_with reads "on every
-- profile row of every People page" — this is that sentence with a number
-- against it.
--
-- WHAT THIS DOES
--
-- Asks the same question once. blocked_ids() returns the set of accounts you
-- are in a block with, either direction, gathered in one query. The policy
-- then tests membership of that set, which Postgres evaluates as a single
-- subplan and hashes, instead of calling a function per row.
--
-- Same measurement after:
--
--   select count(*) from public.profiles   ->  blocked_with()  0 calls
--                                              blocked_ids()   1 call
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not inline the subquery into the policy, which is the obvious move
-- and is a security bug. The blocks table's own SELECT policy is
--
--   using (auth.uid() = blocker)
--
-- so a caller can see only the blocks they themselves made. Half of what
-- blocked_with asks — "has this person blocked ME" — is invisible to the
-- caller by design. A subquery written directly into the profiles policy runs
-- as the caller, would find nothing for that half, and everyone who had
-- blocked you would become visible again. The SECURITY DEFINER boundary is
-- load-bearing, so blocked_ids() keeps it; only the number of times it is
-- crossed changes.
--
-- It does not touch blocked_with(). Three other policies still call it — the
-- partner_requests insert and update, and the messages insert — and each of
-- those checks one named row rather than scanning, so per-row cost is one
-- call and there is nothing to fix.
--
-- It does not rewrite auth.uid() as (select auth.uid()) anywhere, which is the
-- standard advice for Supabase policies and, measured here, buys nothing.
-- auth.uid() is a plain `language sql stable` function, so the planner inlines
-- it to current_setting(...) and it never appears as a function call at all —
-- 0 invocations before and after, in the same run that showed blocked_with at
-- 1999. The advice is aimed at the case where inlining does not happen. That
-- is not this schema, and a sweeping rewrite of 197 call sites in security
-- policies to buy nothing measurable is not a trade worth making.
--
-- NOTHING HERE DROPS A COLUMN OR DELETES A ROW.
-- ============================================================


-- ------------------------------------------------------------
-- The set, gathered once
--
-- SECURITY DEFINER for the reason set out at length above: the caller cannot
-- see the blocks made against them, and this has to.
--
-- STABLE, so Postgres may evaluate it once per statement rather than once per
-- reference. blocker and blocked are both NOT NULL in public.blocks, which is
-- what makes the `not in` in the policy safe — a NULL in that set would make
-- the whole test NULL and hide every row.
-- ------------------------------------------------------------
create or replace function public.blocked_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when b.blocker = auth.uid() then b.blocked else b.blocker end
    from public.blocks b
   where b.blocker = auth.uid() or b.blocked = auth.uid()
$$;

revoke all on function public.blocked_ids() from public;
-- anon gets this for the same reason it gets blocked_with: for a signed-out
-- caller auth.uid() is NULL, both halves of the where compare against NULL,
-- the set comes back empty, and there is nothing to leak. Refusing execute
-- would instead make the policy error for anon rather than simply find
-- nothing.
grant execute on function public.blocked_ids() to anon, authenticated, service_role;


-- ------------------------------------------------------------
-- The policy, saying the same thing once
--
-- The shape is deliberately unchanged: still "you may always see yourself,
-- and you may see anybody you are not in a block with", still refusing
-- everything to a caller with no session. `id not in (select ...)` is the
-- same predicate as `not blocked_with(id)` over a set that cannot contain
-- NULL.
-- ------------------------------------------------------------
drop policy if exists "profiles are viewable" on public.profiles;
create policy "profiles are viewable"
  on public.profiles for select using (
    auth.uid() is not null
    and (id = auth.uid() or id not in (select public.blocked_ids()))
  );


-- ============================================================
-- Done. To confirm it took, with two accounts where one has blocked the
-- other, each of these should answer the way the comment says:
--
--   -- as the blocker, the blocked account is gone
--   select count(*) from public.profiles where id = '<blocked account>';   -- 0
--   -- and as the blocked account, so is the blocker
--   select count(*) from public.profiles where id = '<blocker account>';   -- 0
--   -- you can still see yourself, and anybody unrelated
--   select count(*) from public.profiles where id = auth.uid();            -- 1
-- ============================================================
