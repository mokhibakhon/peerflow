-- ============================================================
-- PeerFlow — publish the count, not the people
--
-- HOW TO RUN IT
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run twice. Run it after migration-forgery.sql and
-- migration-actor-rules.sql; it does not depend on them, but that is the
-- order they were written in and the order the README describes.
--
-- WHAT THIS IS
--
-- The profiles read policy was `id = auth.uid() or not blocked_with(id)`, and
-- the comment above it was honest about what that means: a signed-out caller
-- has no identity, blocked_with returns false for every row, and the whole
-- expression reads exactly as `true` used to. So anybody with the publishable
-- key — which ships in assets/supabase-config.js, in a public repository, and
-- is designed to be public — could read every profile on the platform.
--
-- Not through the app: app-people.html bounces a signed-out visitor to login,
-- and that is correct behaviour. But authgate.js is a courtesy that runs in
-- the browser after the page has loaded, and nobody reading your users would
-- load the page. They would ask PostgREST directly. What came back was name,
-- topic, level, timezone and availability — and name plus timezone plus a
-- weekly availability grid is "when is this person alone at their computer",
-- published to anyone who asks, about people the code of conduct describes as
-- needing to feel safe meeting strangers one-to-one on camera.
--
-- WHY IT WAS NOT A ONE-LINE FIX
--
-- The landing page depends on it. home.js calls pf.trackCounts(), which did
-- `from('profiles').select('track_id')` anonymously on every page load and
-- tallied the result in the browser to fill the "3 waiting" / "be the first"
-- labels on the eight path cards. Requiring a session would have turned every
-- one of those to "be the first" — silently, on the page whose entire job is
-- convincing somebody to sign up.
--
-- The landing page never needed the rows. It needed eight numbers. So the
-- numbers get their own function and the rows get a policy: publish the
-- aggregate, not the records.
-- ============================================================


-- ---------- the eight numbers, and nothing else ----------
-- SECURITY DEFINER so it can count rows the caller may no longer read, STABLE
-- so it can be planned as a read, and returning only a track id and a total —
-- there is no argument, no filter and no way to ask it about a person.
--
-- `track_id is not null` is the same rule the browser used and the same rule
-- learnerStats and fetchPeers use for "finished signing up", so the numbers on
-- the landing page do not move when this ships. That was the point.
create or replace function public.track_counts()
returns table (track_id text, learners bigint)
language sql
security definer
stable
set search_path = public
as $$
  select p.track_id, count(*)
    from public.profiles p
   where p.track_id is not null
   group by p.track_id
$$;

revoke all on function public.track_counts() from public;
grant execute on function public.track_counts() to anon, authenticated;


-- ---------- and the rows need somebody to be asking ----------
-- The block rule is unchanged and still does the work it did; what is added
-- in front of it is the requirement that there be a caller at all.
--
-- The table grant is deliberately left alone. Revoking select from anon would
-- be a second belt on the same trousers, and it changes the failure from an
-- empty list into a permission error on a path — profile upsert during
-- sign-up — where the session may not have settled yet. The policy is the
-- mechanism this schema uses everywhere else, and zero rows is the security
-- property that matters.
drop policy if exists "profiles are viewable" on public.profiles;
create policy "profiles are viewable"
  on public.profiles for select using (
    auth.uid() is not null
    and (id = auth.uid() or not public.blocked_with(id))
  );
