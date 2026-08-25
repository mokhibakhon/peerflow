-- ============================================================
-- SUPERSEDED — do not run this file.
--
-- Every statement below is already inside supabase/migrate-2026-08.sql, which
-- is the file that gets pasted into the SQL editor. This copy is kept because
-- it is the readable account of one change, and README.md links to it by name
-- to explain what that change was. It is documentation now, not a migration.
--
-- Running it is not a no-op and will not raise an error. These are
-- "create or replace" definitions, so the last paste wins: re-running an old
-- file replaces the current definition of whatever it defines with the older
-- one, silently. Nothing warns you and nothing fails.
--
-- To set a database up, see SETUP_GUIDE.md. The short version is schema.sql,
-- then migration-mvp.sql, then migrate-2026-08.sql. All three, and nothing
-- else: every migration written so far is folded into the third.
-- ============================================================

-- ============================================================
-- PeerFlow — a partnership that has gone quiet
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- migration-mvp.sql, migrate-2026-08.sql, migration-notify.sql and
-- migration-reschedule.sql. Safe to run more than once.
--
-- WHY
--
-- Two people match, they meet, it goes well — and then neither of them books
-- the next one. Nobody decided anything. There was no falling out and no
-- no-show. The session that would have been the third one simply never got
-- proposed, and a month later both of them assume the other lost interest.
--
-- The dashboard has been saying something about this for a while: once the
-- gap reaches a week the band reads "It's been nine days since you studied
-- with Amir" and offers to book. That is the right sentence in the wrong
-- place, because it is only ever read by somebody who has opened PeerFlow —
-- which is exactly the person who has not gone quiet. The half of the pair
-- that needs reaching is the half that is not looking.
--
-- HOW THIS REACHES SOMEBODY WHO IS NOT HERE
--
-- There is no scheduler behind a static site, and this file does not add one.
-- It copies what settle_due() and send_due_reminders() already do: a
-- SECURITY DEFINER function that the app calls on every load, which does work
-- on rows belonging to the OTHER person as well as the caller. Your partner
-- opening PeerFlow at lunchtime is what reminds you about this evening; your
-- partner opening PeerFlow at all is now what asks you whether the two of you
-- want to carry on.
--
-- And as with those two, there is a _all variant with no caller for the
-- pg_cron branch, so a project that has cron does not depend on anybody
-- opening anything.
--
-- WHO IS TOLD
--
-- Only the other person. The caller is looking at a dashboard that already
-- says it, in a band with the button on it, so a notification would be
-- telling somebody something they are currently reading. That halves the
-- volume of this feature and points the remaining half at the person it is
-- actually for.
--
-- WHEN
--
--   dormant          fourteen days with nothing. Two missed weeks against a
--                    default goal of two sessions a week, where one missed
--                    week is a holiday. It is also where the app's own
--                    language changes: sinceWords() starts saying "two weeks"
--                    at fourteen days, and the band's existing seven-day line
--                    is left exactly as it was — this is a second, quieter
--                    state above it rather than a replacement.
--
--   cooldown         twenty-one days between one nudge and the next for the
--                    same partnership. Longer than the threshold on purpose:
--                    a pair who stay dormant cannot be nudged twice inside
--                    three weeks, however many times either of them opens the
--                    app.
--
-- WHAT DISQUALIFIES A PARTNERSHIP
--
--   not accepted     end_partnership() and block_person() both set the row to
--                    'ended', so this one test excludes a partnership that was
--                    walked away from AND one that was blocked. Nothing extra
--                    is needed for either, and nothing here can nudge somebody
--                    about a person who blocked them.
--
--   never got going  no session that actually happened. A pair who accepted
--                    and never met are not dormant, they are new, and the
--                    dashboard already has a band for exactly that. Nudging
--                    them here would be two features talking over each other.
--
--   too new          the partnership itself is younger than the threshold.
--
--   something ahead  anything proposed or confirmed in the future. A standing
--                    slot materialises four weeks out, so a pair with a live
--                    slot can never qualify — which is correct, they have not
--                    gone quiet.
--
--   recent activity  a session that happened, or any session row created, in
--                    the last fourteen days. Created, not just held: somebody
--                    proposing a time that was then declined is a partnership
--                    still talking to itself, and it resets the clock.
-- ============================================================


-- ---------- the one new column ----------
-- When this partnership's dormancy was last raised with anybody, or waved off
-- by one of them. One column, one row per partnership, and it means the same
-- thing whichever of them wrote it: leave this pair alone until the cooldown
-- has passed.
--
-- Deliberately not two columns. "Amir said not now" and "Amir was told" want
-- the same thing to happen next — silence for three weeks — and a schema that
-- tells them apart would only be earning the right to nudge the other person
-- after one of them has already said no.
alter table public.partner_requests
  add column if not exists dormant_nudged_at timestamptz;


-- ---------- the policy, as functions rather than numbers ----------
-- Same shape as pf_cancel_notice_hours() and pf_grace_minutes(): the number
-- lives in one place, the app can read it, and nothing has to agree with a
-- literal typed into three files.
create or replace function public.pf_dormant_days() returns int
  language sql immutable parallel safe as $$ select 14 $$;

create or replace function public.pf_dormant_cooldown_days() returns int
  language sql immutable parallel safe as $$ select 21 $$;


-- ============================================================
-- Which partnerships have gone quiet.
--
-- Split out from the function that acts on them so that both the per-caller
-- and the cron variant ask exactly the same question, and so the SQL tests can
-- ask it without anything being written.
--
-- STABLE and SECURITY DEFINER: it reads sessions belonging to both people, and
-- "read own sessions" would otherwise hide half the evidence — a pair whose
-- only upcoming booking sits on the partner's row would look dormant to
-- everybody except the partner.
-- ============================================================
create or replace function public.dormant_partnerships()
returns table (
  request_id uuid,
  from_user  uuid,
  to_user    uuid,
  last_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.from_user, r.to_user, act.last_at
    from public.partner_requests r
    -- Everything this pair has ever had on a calendar, in one pass: when they
    -- last actually sat one, when a row was last written at all, and whether
    -- anything is still ahead of them.
    cross join lateral (
      select max(s.starts_at) filter (
               where s.attendance = 'attended' or s.status = 'completed'
                  or (s.status = 'confirmed'
                      and s.starts_at + make_interval(mins => s.duration_min) <= now())
             ) as last_at,
             max(s.created_at) as wrote_at,
             bool_or(s.status in ('proposed', 'confirmed') and s.starts_at > now()) as ahead
        from public.sessions s
       where s.pair_id = r.id
    ) act
   where r.status = 'accepted'
     -- A pair who accepted last week and have not met are new, not dormant.
     and r.created_at <= now() - make_interval(days => public.pf_dormant_days())
     -- Never got going. The dashboard's first-session band owns this case.
     and act.last_at is not null
     -- Something is already on the calendar, so nothing has gone quiet.
     and not coalesce(act.ahead, false)
     -- Quiet for long enough, by both measures: nothing sat, and nothing even
     -- offered.
     and act.last_at  <= now() - make_interval(days => public.pf_dormant_days())
     and coalesce(act.wrote_at, act.last_at)
                      <= now() - make_interval(days => public.pf_dormant_days())
     -- Not already raised with one of them inside the cooldown.
     and (r.dormant_nudged_at is null
          or r.dormant_nudged_at <= now()
             - make_interval(days => public.pf_dormant_cooldown_days()));
$$;

revoke all on function public.dormant_partnerships() from public, anon;
grant execute on function public.dormant_partnerships() to authenticated;


-- ============================================================
-- Raising it with one of them.
--
-- Shared by both entry points below. p_only is the person NOT to tell — the
-- caller, who is reading a dashboard that says the same thing — or NULL from
-- cron, where there is nobody at the keyboard and both of them are equally
-- absent.
--
-- The stamp is written before the note and conditionally, so two tabs opening
-- at the same instant cannot both get past it. FOUND after that UPDATE is the
-- whole of the idempotency: whoever wins writes the row, the loser finds
-- nothing to update and sends nothing.
-- ============================================================
create or replace function public.raise_dormant(p_request uuid, p_skip uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.partner_requests%rowtype;
  n     integer := 0;
  who   record;
begin
  update public.partner_requests
     set dormant_nudged_at = now()
   where id = p_request
     and status = 'accepted'
     and (dormant_nudged_at is null
          or dormant_nudged_at <= now()
             - make_interval(days => public.pf_dormant_cooldown_days()))
  returning * into r;
  if not found then return 0; end if;

  for who in
    select u.id as target,
           case when u.id = r.from_user then r.to_user else r.from_user end as other
      from (select r.from_user as id union all select r.to_user) u
     where p_skip is null or u.id <> p_skip
  loop
    begin
      perform public.raise_note(
        who.target, 'dormant',
        'You and ' ||
          coalesce(nullif((select name from public.profiles where id = who.other), ''),
                   'your partner') ||
          ' haven''t studied together recently',
        'Plan your next session — pick an hour and send it over. Nothing is booked ' ||
        'until they accept.',
        'app.html?plan=' || who.other::text);
      n := n + 1;
    exception when others then
      -- A notification that fails is never allowed to be the reason the
      -- stamp is rolled back; the alternative is a pair being asked again on
      -- the very next page load.
      null;
    end;
  end loop;

  return n;
end $$;

revoke all on function public.raise_dormant(uuid, uuid) from public, anon, authenticated;


-- ============================================================
-- The two ways in.
--
-- Same shape as settle_due / settle_due_all and send_due_reminders /
-- send_due_reminders_all: one for the browser, scoped to partnerships the
-- caller is actually in, and one with no caller for cron.
-- ============================================================
create or replace function public.nudge_dormant()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r  record;
  n  integer := 0;
begin
  if me is null then return 0; end if;
  for r in
    select * from public.dormant_partnerships() d
     where me in (d.from_user, d.to_user)
  loop
    -- The caller is skipped. They are looking at the band.
    n := n + public.raise_dormant(r.request_id, me);
  end loop;
  return n;
end $$;

revoke all on function public.nudge_dormant() from public, anon;
grant execute on function public.nudge_dormant() to authenticated;


create or replace function public.nudge_dormant_all(p_limit int default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.dormant_partnerships()
     order by last_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    -- Nobody at a keyboard, so both of them are told.
    n := n + public.raise_dormant(r.request_id, null);
  end loop;
  return n;
end $$;

revoke all on function public.nudge_dormant_all(int) from public, anon, authenticated;


-- ============================================================
-- Not now.
--
-- The band carries a way out of it, and it has to mean something more durable
-- than hiding a card until the next reload. Stamping the same column is the
-- whole of it: the pair goes quiet for a cooldown, for both of them, which is
-- the honest reading of one of the two saying they would rather not right now.
-- ============================================================
create or replace function public.snooze_dormant(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'PF030';
  end if;
  update public.partner_requests
     set dormant_nudged_at = now()
   where id = p_request
     and status = 'accepted'
     and me in (from_user, to_user);
  if not found then
    raise exception 'no such partnership for this user' using errcode = 'PF031';
  end if;
end $$;

revoke all on function public.snooze_dormant(uuid) from public, anon;
grant execute on function public.snooze_dormant(uuid) to authenticated;


-- ============================================================
-- The cron branch, if this project has pg_cron.
--
-- attendance_tick() already exists and is already scheduled where cron is
-- installed. Adding the dormancy sweep to it rather than scheduling a second
-- job keeps the two halves from drifting out of step, which is the reason
-- that function was written as one call in the first place.
--
-- Redefined rather than replaced in spirit: everything it did, it still does.
-- ============================================================
create or replace function public.attendance_tick()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.settle_due_all(200)
       + public.send_due_reminders_all(500)
       + public.nudge_dormant_all(200);
$$;

revoke all on function public.attendance_tick() from public, anon, authenticated;
