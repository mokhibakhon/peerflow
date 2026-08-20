#!/usr/bin/env bash
#
# The SQL, tested against a real PostgreSQL 16 rather than reasoned about.
#
#     dev/sql-tests.sh
#
# It builds a throwaway cluster in a temp directory, stands up just enough of
# Supabase for the real files to run (an auth schema, an auth.uid() reading the
# same JWT claim PostgREST sets), loads schema.sql + migration-mvp.sql +
# migrate-2026-08.sql + migration-no-double-booking.sql in that order, and then
# asserts. Nothing here touches the real database and nothing persists.
#
# Two things this is deliberately careful about, both of which have burned
# somebody before:
#
#   * `SET LOCAL` outside a transaction is a silent no-op, so an RLS test can
#     pass vacuously as superuser with auth.uid() sitting at NULL. Every case
#     that depends on identity runs inside BEGIN/ROLLBACK and asserts
#     auth.uid() is not null before it asserts anything else. Test 0 exists
#     only to prove that check can fail.
#
#   * A test that asserts an error is worthless if the error is the wrong one.
#     Each expected failure checks the SQLSTATE, not just that something threw.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PF_PGPORT:-5599}"
WORK="$(mktemp -d)"
OWNER="$(id -un)"
PASS=0
FAIL=0

cleanup() {
  if [ -n "${STARTED:-}" ]; then
    su_pg "pg_ctl -D $WORK/pgdata -m immediate stop" >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# initdb and postgres refuse to run as root, so when this is running as root
# (which it is in the container) everything goes through the postgres account.
su_pg() {
  if [ "$OWNER" = "root" ]; then
    su postgres -c "/usr/lib/postgresql/16/bin/$1"
  else
    "/usr/lib/postgresql/16/bin/$1"
  fi
}

echo "==> building a throwaway PostgreSQL 16 in $WORK"
mkdir -p "$WORK/pgdata"
[ "$OWNER" = "root" ] && chown -R postgres:postgres "$WORK" && chmod 755 "$WORK"
su_pg "initdb -D $WORK/pgdata -U postgres --auth=trust" >/dev/null 2>&1 || {
  echo "initdb failed"; exit 1; }
su_pg "pg_ctl -D $WORK/pgdata -o '-p $PORT -k /tmp' -l $WORK/pgdata/log start" >/dev/null 2>&1
STARTED=1
sleep 2

PSQL="psql -h /tmp -p $PORT -U postgres -d pf -v ON_ERROR_STOP=1 -q"
psql -h /tmp -p "$PORT" -U postgres -q -c "create database pf;" >/dev/null 2>&1 || {
  echo "could not create database — is something else on port $PORT?"; exit 1; }

# ---------- the Supabase-shaped bits the real files expect to exist ----------
$PSQL <<'SQL' >/dev/null 2>&1
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
-- The real auth.uid() reads the JWT PostgREST puts on the connection. Same
-- claim name, so the policies behave exactly as they do in production.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  -- The role the edge functions arrive as. It bypasses RLS in production, so
  -- nothing here tests through it; it exists because the real SQL grants to it
  -- by name, and a GRANT to a role that does not exist is a hard error that
  -- stops the whole file loading.
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
SQL

# migrate-2026-08.sql is the paste the user actually runs, and it now ends
# with migration-no-double-booking.sql concatenated onto it, so loading it is
# the real path rather than an approximation of one.
FILES="supabase/schema.sql supabase/migration-mvp.sql supabase/migrate-2026-08.sql"

# A test that has never been seen to fail is not evidence of anything, so the
# suite can be run against the schema as it was before the fix:
#
#     PF_WITHOUT_FIX=1 dev/sql-tests.sh
#
# Everything that names the new rule should go red and everything else should
# stay green. If a case goes red in both, it is not testing what its name
# claims. The cut is made at the section marker rather than by leaving a file
# out, because the fix now lives inside the combined paste.
if [ -n "${PF_WITHOUT_FIX:-}" ]; then
  echo "==> PF_WITHOUT_FIX: cutting migrate-2026-08.sql off before the fix"
  sed '/^-- BEGIN migration-no-double-booking.sql$/,$d' \
    "$ROOT/supabase/migrate-2026-08.sql" > "$WORK/migrate-trimmed.sql"
  # A cut that silently matched nothing would quietly load the fix anyway and
  # make the whole comparison a lie, so check the marker was really there.
  if ! grep -q "BEGIN migration-no-double-booking" "$ROOT/supabase/migrate-2026-08.sql"; then
    echo "expected the section marker in migrate-2026-08.sql and did not find it"; exit 1
  fi
  cp "$WORK/migrate-trimmed.sql" "$WORK/m.sql"
  FILES="supabase/schema.sql supabase/migration-mvp.sql $WORK/m.sql"
fi

echo "==> loading the real SQL"
for f in $FILES; do
  # PF_WITHOUT_FIX puts an absolute path in the list; everything else is
  # relative to the repo root.
  case "$f" in /*) f_path="$f" ;; *) f_path="$ROOT/$f" ;; esac
  out="$($PSQL -f "$f_path" 2>&1 | grep -E "^psql.*ERROR" )"
  if [ -n "$out" ]; then echo "FAILED loading $f:"; echo "$out"; exit 1; fi
  echo "    $f"
done

$PSQL -c "grant select, insert, update, delete on all tables in schema public to authenticated;" >/dev/null 2>&1
# Supabase gives anon table grants too, and one case below depends on a
# signed-out read reaching the policy rather than stopping at a missing GRANT.
# Without this the "signed-out reads still work" case fails for a reason that
# does not exist in production, which is worse than not testing it.
$PSQL -c "grant select on all tables in schema public to anon;" >/dev/null 2>&1

# Two people who are partners, which is what the insert policy wants to see.
A=11111111-1111-1111-1111-111111111111
B=22222222-2222-2222-2222-222222222222
$PSQL >/dev/null 2>&1 <<SQL
insert into auth.users (id, email) values ('$A','a@example.com'), ('$B','b@example.com');
insert into public.partner_requests (from_user, to_user, status) values ('$A','$B','accepted');
SQL

# ---------- the harness ----------
# Each case is a chunk of SQL run inside a transaction that is always rolled
# back, so cases cannot leak into each other. `expect` is either "ok" or a
# SQLSTATE the statement must raise.
check() {
  local name="$1" expect="$2" sql="$3"
  local out rc
  out="$(psql -h /tmp -p "$PORT" -U postgres -d pf -v ON_ERROR_STOP=1 -q 2>&1 <<SQL
begin;
$sql
rollback;
SQL
)"
  rc=$?
  if [ "$expect" = "ok" ]; then
    if [ $rc -eq 0 ]; then
      PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$name"
    else
      FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n        expected success, got:\n%s\n' "$name" "$(echo "$out" | sed 's/^/        /')"
    fi
  else
    if echo "$out" | grep -q "SQLSTATE_$expect\|$expect"; then
      PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$name"
    else
      FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n        expected SQLSTATE %s, got:\n%s\n' "$name" "$expect" "$(echo "$out" | sed 's/^/        /')"
    fi
  fi
}

# Turns any error into a line naming its SQLSTATE, so `check` can match on the
# code rather than on message text that is meant to be rewritten freely.
wrap() {
  cat <<SQL
do \$\$
begin
$1
exception when others then
  raise notice 'SQLSTATE_%', sqlstate;
  raise exception 'SQLSTATE_%', sqlstate using errcode = sqlstate;
end \$\$;
SQL
}

# Asserts identity is really set. Every identity-dependent case starts with it.
AS_A="set local role authenticated; set local request.jwt.claim.sub = '$A';
      do \$\$ begin if auth.uid() is null then
        raise exception 'auth.uid() is NULL — the test would have passed vacuously'; end if; end \$\$;"

echo
echo "==> the guard against vacuous RLS passes"
check "auth.uid() is actually set inside a transaction" ok "$AS_A"
check "auth.uid() is NULL without the claim, and that is detected" "P0001" "$(wrap "
  if auth.uid() is null then raise exception 'auth.uid() is NULL'; end if;")"

echo
echo "==> the constraint itself"
check "a second confirmed session overlapping the first is refused" "PF001" "$(wrap "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:20+00',50,'pf:two','confirmed');")"

check "the exact same minute under a different room is refused (sessions_one_per_slot misses this)" "PF001" "$(wrap "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:two','confirmed');")"

check "back-to-back sessions that only touch are allowed" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:50+00',50,'pf:two','confirmed');"

check "two different people at the same time are allowed" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed'),
           ('$B','2026-09-01 15:00+00',50,'pf:one','confirmed');"

check "a cancelled session does not block the slot" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','cancelled');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:two','confirmed');"

echo
echo "==> proposals are offers, not commitments"
check "two overlapping proposals may both stand" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','proposed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed');"

check "a proposal landing on an agreed session is refused" "PF001" "$(wrap "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed');")"

echo
echo "==> the guard sees what the browser cannot"
# This is the case clashIn could never cover: A books B, and B is the one who
# is busy. RLS hides B's rows from A entirely, so only a SECURITY DEFINER
# check can catch it.
check "booking a partner who is already busy is refused" "PF001" "$(wrap "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$B','2026-09-01 15:00+00',50,'pf:other','confirmed');
  set local role authenticated;
  set local request.jwt.claim.sub = '$A';
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed'),
           ('$B','2026-09-01 15:10+00',50,'pf:two','proposed');")"

echo
echo "==> accepting the second of two competing offers"
check "answer_session refuses a yes that would double-book" "PF001" "$(wrap "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed'),
           ('$B','2026-09-01 15:00+00',50,'pf:one','confirmed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed'),
           ('$B','2026-09-01 15:10+00',50,'pf:two','proposed');
  set local role authenticated;
  set local request.jwt.claim.sub = '$A';
  perform public.answer_session('2026-09-01 15:10+00'::timestamptz,'pf:two','confirmed');")"

check "answer_session still accepts a free slot" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed'),
           ('$B','2026-09-01 15:10+00',50,'pf:two','proposed');
  $AS_A
  select public.answer_session('2026-09-01 15:10+00'::timestamptz,'pf:two','confirmed');
  -- Back to superuser to count. While the authenticated role is still on, the
  -- SELECT policy limits this to A's own row, so asserting on it there would
  -- read 1 and look like a bug in answer_session — which is exactly what the
  -- whole two-rows-one-session problem looks like from the browser.
  reset role;
  do \$\$ begin
    if (select count(*) from public.sessions where room_url='pf:two' and status='confirmed') <> 2
      then raise exception 'both rows should have moved'; end if;
  end \$\$;"

# The proposal has to exist before the clashing session does. Once something
# is agreed at that hour the trigger refuses the proposal outright, so the
# only way to hold a proposal that overlaps an agreed session is to have made
# it first — which is exactly how it happens in life.
check "declining a proposal that has since been overtaken is never blocked" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:10+00',50,'pf:two','proposed'),
           ('$B','2026-09-01 15:10+00',50,'pf:two','proposed');
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A','2026-09-01 15:00+00',50,'pf:one','confirmed'),
           ('$B','2026-09-01 15:00+00',50,'pf:one','confirmed');
  $AS_A
  select public.answer_session('2026-09-01 15:10+00'::timestamptz,'pf:two','declined');"

echo
echo "==> the standing slot no longer books over things"
# The regression this is really guarding: `on conflict do nothing` skips only
# the conflicting row, so without the pre-check one of these weeks would have
# written a session for B and nothing for A.
check "a week where one of you is busy is skipped whole, not half" ok "
  update public.partner_requests
     set standing_anchor = date_trunc('hour', now()) + interval '2 days',
         standing_minutes = 50, standing_by = '$A', standing_ok_at = now()
   where from_user='$A';
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    select '$A', standing_anchor, 50, 'pf:clash', 'confirmed'
      from public.partner_requests where from_user='$A';
  $AS_A
  select public.materialise_standing(id, 4) from public.partner_requests where from_user='$A';
  reset role;
  do \$\$
  declare a_rows int; b_rows int;
  begin
    select count(*) into a_rows from public.sessions
      where user_id='$A' and room_url like 'https://meet.jit.si/PeerFlow-%';
    select count(*) into b_rows from public.sessions
      where user_id='$B' and room_url like 'https://meet.jit.si/PeerFlow-%';
    if a_rows <> b_rows then
      raise exception 'half a booking: A has % rows, B has %', a_rows, b_rows;
    end if;
  end \$\$;"

echo
echo "==> the standing slot books a room you can actually join"
# Standing occurrences used to share one room_url for the whole partnership,
# derived from the partner request id. session_for_call only derives a missing
# room_name when at most two rows share the url — a room belongs to one
# booking — so from the very first four-week fill onwards nothing could be
# derived, room_name stayed null, and Join answered 'no-room' for every
# occurrence. These four assert the shape that fixes it.
STANDING="
  update public.partner_requests
     set standing_anchor = date_trunc('hour', now()) + interval '2 days',
         standing_minutes = 50, standing_by = '$A', standing_ok_at = now()
   where from_user='$A';
  $AS_A
  select public.materialise_standing(id, 4) from public.partner_requests where from_user='$A';
  reset role;"

check "every occurrence gets a room of its own" ok "$STANDING
  do \$\$ declare bad int; begin
    select count(*) into bad from (
      select room_url from public.sessions group by room_url having count(*) > 2) x;
    if bad > 0 then raise exception '% room url(s) shared by more than one booking', bad; end if;
  end \$\$;"

check "every occurrence gets a room name, so Join does not say no-room" ok "$STANDING
  do \$\$ declare bad int; begin
    select count(*) into bad from public.sessions where room_name is null;
    if bad > 0 then raise exception '% standing row(s) have no room_name', bad; end if;
  end \$\$;"

check "every occurrence records which partnership it belongs to" ok "$STANDING
  do \$\$ declare bad int; begin
    select count(*) into bad from public.sessions where pair_id is null;
    if bad > 0 then raise exception '% standing row(s) have no pair_id', bad; end if;
  end \$\$;"

check "no booking is written with a jitsi address" ok "$STANDING
  do \$\$ declare bad int; begin
    select count(*) into bad from public.sessions where room_url like '%jit.si%';
    if bad > 0 then raise exception '% row(s) still carry a jitsi url', bad; end if;
  end \$\$;"

# Calling it twice must not book the same weeks again. This is the case that
# breaks if the room scheme changes without the lookup changing with it: the
# old code found an existing week by its partnership-wide url, and a
# per-occurrence url cannot be recomputed, so the match is by pair_id now.
check "a second call books nothing, having recognised the weeks already there" ok "$STANDING
  $AS_A
  do \$\$ declare again int; begin
    select public.materialise_standing(id, 4) into again
      from public.partner_requests where from_user='$A';
    if again <> 0 then raise exception 'booked % more occurrence(s) on the second call', again; end if;
  end \$\$;"


# ============================================================
# migration-safety.sql — blocking, and reports
# ============================================================
# A block is only worth anything if it is enforced by the database. Every
# case below runs as a real role with a real auth.uid(), because the whole
# mechanism is RLS policies plus one SECURITY DEFINER function, and neither
# of those does anything at all as superuser.

AS_B="set local role authenticated; set local request.jwt.claim.sub = '$B';
      do \$\$ begin if auth.uid() is null then
        raise exception 'auth.uid() is NULL — the test would have passed vacuously'; end if; end \$\$;"

# Names, so the report snapshot has something to snapshot.
$PSQL >/dev/null 2>&1 <<SQL
update public.profiles set name = 'Ada A' where id = '$A';
update public.profiles set name = 'Bo B'  where id = '$B';
SQL

echo
echo "==> a block hides both people from each other"
check "before any block, A can see B's profile" ok "
  $AS_A
  do \$\$ begin
    if not exists (select 1 from public.profiles where id='$B') then
      raise exception 'B was invisible before anybody blocked anybody'; end if;
  end \$\$;"

check "after A blocks B, B's profile is gone from A's view" ok "
  $AS_A
  select public.block_person('$B');
  do \$\$ begin
    if exists (select 1 from public.profiles where id='$B') then
      raise exception 'blocked profile still visible to the blocker'; end if;
  end \$\$;"

# The direction that a naive policy gets wrong. B never wrote a row and
# cannot read one, so a policy using a plain subquery against blocks would
# see nothing and let B carry on as though nothing had happened.
check "and A's profile is gone from B's view, who never wrote the row" ok "
  $AS_A
  select public.block_person('$B');
  reset role;
  $AS_B
  do \$\$ begin
    if exists (select 1 from public.profiles where id='$A') then
      raise exception 'the blocked party can still see the blocker'; end if;
  end \$\$;"

check "your own profile is never hidden from you" ok "
  $AS_A
  select public.block_person('$B');
  do \$\$ begin
    if not exists (select 1 from public.profiles where id='$A') then
      raise exception 'A cannot see A'; end if;
  end \$\$;"

# This is the case that found the real rule. The policy was first written as
# a CASE whose first arm was `auth.uid() is null then true`, on the theory
# that ordering would keep a signed-out reader away from a function anon
# cannot execute. It did not: this failed with "permission denied for function
# blocked_with" while sitting on that arm, because EXECUTE is checked when the
# expression is prepared rather than when an arm is taken. The fix was the
# grant, not the ordering. Take the grant back out of migration-safety.sql and
# this is the case that goes red.
check "signed-out reads of profiles still work" ok "
  set local role anon;
  do \$\$ declare n int; begin
    select count(*) into n from public.profiles;
    if n < 2 then raise exception 'anon saw % profiles', n; end if;
  end \$\$;"

check "the blocked party cannot read the row that names them" ok "
  $AS_A
  select public.block_person('$B');
  reset role;
  $AS_B
  do \$\$ begin
    if exists (select 1 from public.blocks where blocked='$B') then
      raise exception 'a block is visible to the person it was made against'; end if;
  end \$\$;"

echo
echo "==> a block ends what was already agreed"
check "blocking ends the partnership" ok "
  $AS_A
  select public.block_person('$B');
  do \$\$ begin
    if exists (select 1 from public.partner_requests
                where status='accepted' and from_user='$A' and to_user='$B') then
      raise exception 'still partners after a block'; end if;
  end \$\$;"

check "a future session with them is called off" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, pair_id)
    select '$A', now() + interval '2 days', 50, 'pf:soon', 'confirmed', id
      from public.partner_requests where from_user='$A';
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, pair_id)
    select '$B', now() + interval '2 days', 50, 'pf:soon', 'confirmed', id
      from public.partner_requests where from_user='$A';
  $AS_A
  select public.block_person('$B');
  reset role;
  do \$\$ declare n int; begin
    select count(*) into n from public.sessions
      where room_url='pf:soon' and status <> 'cancelled';
    if n > 0 then raise exception '% future row(s) survived the block', n; end if;
  end \$\$;"

# Deleting the past would take somebody's streak away for having been
# harassed, which is the wrong direction of consequence.
check "a session already sat is left alone" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, pair_id)
    select '$A', now() - interval '2 days', 50, 'pf:past', 'confirmed', id
      from public.partner_requests where from_user='$A';
  $AS_A
  select public.block_person('$B');
  reset role;
  do \$\$ begin
    if not exists (select 1 from public.sessions
                    where room_url='pf:past' and status='confirmed') then
      raise exception 'a session that already happened was cancelled'; end if;
  end \$\$;"

echo
echo "==> a block stops what comes next"
check "the blocked party cannot send a message" "42501" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  perform public.block_person('$B');
  reset role;
  set local role authenticated; set local request.jwt.claim.sub = '$B';
  insert into public.messages (from_user, to_user, body) values ('$B','$A','hello');")"

check "a message between two people who have not blocked each other still sends" ok "
  $AS_B
  insert into public.messages (from_user, to_user, body) values ('$B','$A','hello');"

# unique (from_user, to_user) means a repeat request is an UPDATE, so a policy
# that guarded only INSERT would let a blocked account revive a dead row.
check "the blocked party cannot revive the request by updating it" "42501" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  perform public.block_person('$B');
  reset role;
  set local role authenticated; set local request.jwt.claim.sub = '$B';
  update public.partner_requests set status='pending' where to_user='$B';
  if not found then raise exception 'no row was updated' using errcode='42501'; end if;")"

check "you cannot block yourself" "PF011" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  perform public.block_person('$A');")"

check "block_person refuses a caller with no identity" "PF010" "$(wrap "
  set local role authenticated;
  perform public.block_person('$B');")"

echo
echo "==> reports"
check "a report cannot be inserted directly, only through the function" "42501" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  insert into public.reports (reporter, reported, reason)
    values ('$A','$B','harassment');")"

check "report_person writes both names down at the time" ok "
  $AS_A
  select public.report_person('$B','harassment','they would not stop', null, false);
  reset role;
  do \$\$ declare r record; begin
    select * into r from public.reports where reported='$B';
    if r.reporter_name <> 'Ada A' or r.reported_name <> 'Bo B' then
      raise exception 'names not snapshotted: % / %', r.reporter_name, r.reported_name; end if;
    if r.detail <> 'they would not stop' then raise exception 'detail lost'; end if;
  end \$\$;"

check "reporting blocks by default" ok "
  $AS_A
  select public.report_person('$B','harassment');
  do \$\$ begin
    if not exists (select 1 from public.blocks where blocker='$A' and blocked='$B') then
      raise exception 'report did not block'; end if;
  end \$\$;"

check "and does not block when told not to" ok "
  $AS_A
  select public.report_person('$B','no_show', null, null, false);
  do \$\$ begin
    if exists (select 1 from public.blocks where blocker='$A' and blocked='$B') then
      raise exception 'report blocked despite p_block false'; end if;
  end \$\$;"

check "pressing report twice within the hour writes one row" ok "
  $AS_A
  do \$\$ declare a uuid; b uuid; n int; begin
    a := public.report_person('$B','harassment', null, null, false);
    b := public.report_person('$B','harassment', null, null, false);
    if a <> b then raise exception 'two ids: % and %', a, b; end if;
    select count(*) into n from public.reports where reporter='$A' and reported='$B';
    if n <> 1 then raise exception '% rows in the queue', n; end if;
  end \$\$;"

check "an unknown reason is refused" "PF013" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  perform public.report_person('$B','because');")"

check "you cannot report yourself" "PF011" "$(wrap "
  set local role authenticated; set local request.jwt.claim.sub = '$A';
  perform public.report_person('$A','harassment');")"

# The session argument is a free pointer otherwise: a report could be filed
# against a booking the reporter was never part of.
check "a session that is not yours is not attached to the report" ok "
  insert into public.sessions (id, user_id, starts_at, duration_min, room_url, status)
    values ('33333333-3333-3333-3333-333333333333','$B', now() + interval '3 days',
            50,'pf:theirs','confirmed');
  $AS_A
  select public.report_person('$B','harassment', null,
                              '33333333-3333-3333-3333-333333333333', false);
  reset role;
  do \$\$ begin
    if (select session_id from public.reports where reported='$B') is not null then
      raise exception 'a report was attached to somebody else''s session'; end if;
  end \$\$;"

check "you can read the reports you wrote and nobody else's" ok "
  $AS_A
  select public.report_person('$B','spam', null, null, false);
  reset role;
  $AS_B
  do \$\$ declare n int; begin
    select count(*) into n from public.reports;
    if n <> 0 then raise exception 'the reported party can read % report(s)', n; end if;
  end \$\$;"

echo
echo "==================================================="
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
