-- PeerFlow — who the members are and when each was last here.
--
-- Run this in Supabase -> SQL Editor. Safe to run more than once.
-- After running it, `node dev/migration-check.js` should come back clean.
--
-- WHAT THIS IS FOR
--
-- app-metrics.html could say how many people reached each step of the funnel
-- and nothing about which people. That is the right default and it stayed the
-- default for a reason — a dashboard that ranks your members by how much they
-- use the product is a different kind of object from one that counts them.
--
-- But at this size the owner's real question is "has anyone come back", and
-- the aggregate cannot answer it. Eleven accounts and four completed profiles
-- is the same picture whether all four are active weekly or none has returned
-- since April. Those two situations need opposite work, and telling them apart
-- is the whole job right now.
--
-- WHAT IT COLLECTS: NOTHING
--
-- Every column below already exists. auth.users has recorded created_at and
-- last_sign_in_at since the project was created — Supabase writes them, this
-- file only reads them. profiles and sessions are PeerFlow's own tables. There
-- is no new column, no new write, and nothing here that was not already being
-- kept for the app to work.
--
-- That distinction is the reason this is defensible and the visits table's
-- equivalent is not. Naming a member is reading a record they made by signing
-- up. Naming a VISITOR would mean building an identifier that does not exist,
-- and supabase/migration-visits.sql explains at length why it never will.
--
-- WHAT IT DOES NOT TOUCH
--
-- The visits table. There is still nothing in it that can be joined to an
-- account, and this file does not go near it. A member's page views remain
-- unattributable, which is what privacy.html promises and what stays true.

-- ---------- the members, with when each was last seen ----------
--
-- One row per account, newest sign-in first. It is a reader for one person:
-- the same app_admins gate every other function on the metrics page uses, so
-- an ordinary member calling this by hand gets zero rows rather than an error.
-- Zero rows and not an error is deliberate and matches funnel_counts() — a
-- refusal that raises looks like a broken page, and the page has a legitimate
-- empty state to fall back to.
create or replace function public.member_activity(p_limit int default 100)
returns table (
  name          text,
  track_id      text,
  joined_at     timestamptz,
  last_seen_at  timestamptz,
  complete      boolean,
  proposed      bigint,
  booked        bigint,
  attended      bigint
)
language sql
security definer
stable
-- pg_temp last, for the same reason funnel_counts() spells out: it is searched
-- first for relations regardless, and naming it last is the documented way to
-- push it behind the real schema. Every reference below is schema-qualified.
set search_path = public, pg_temp
as $$
  select
    /* An account with no profile row still counts as a member — they got as
       far as signing up, and "who never finished" is exactly the question the
       funnel's biggest drop-off raises. So this is a LEFT join from auth.users
       and the name falls back to something readable rather than nothing. */
    coalesce(nullif(trim(p.name), ''), '(no name yet)'),
    p.track_id,
    u.created_at,
    u.last_sign_in_at,

    /* The same five fields funnel_counts() calls "finished signing up", and
       the same rule fetchPeers uses. Restated rather than shared because a
       function cannot be inlined into a select list without a round trip per
       row, and this list is short. If that rule ever changes it has to change
       in both, which is why both name the five fields explicitly instead of
       saying "complete". */
    (p.track_id is not null
       and coalesce(p.topic, '') <> ''
       and p.level is not null
       and coalesce(p.timezone, '') <> ''
       and jsonb_array_length(coalesce(p.availability, '[]'::jsonb)) > 0),

    /* Sessions are two rows, one per person, so counting this member's own
       rows counts each meeting once rather than twice. */
    (select count(*) from public.sessions s where s.user_id = u.id),
    (select count(*) from public.sessions s
      where s.user_id = u.id and s.status = 'confirmed'),
    (select count(*) from public.sessions s
      where s.user_id = u.id and s.attended is true)

    from auth.users u
    left join public.profiles p on p.id = u.id
   where exists (
     select 1 from public.app_admins a where a.user_id = auth.uid()
   )
   /* Never signed in sorts last rather than first: nulls last on a descending
      order. Somebody who has not been back is the interesting row, but not
      more interesting than somebody who was here an hour ago. */
   order by u.last_sign_in_at desc nulls last
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.member_activity(int) from public, anon;
grant execute on function public.member_activity(int) to authenticated;
