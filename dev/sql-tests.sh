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
# A third account, partnered with nobody. The attendance cases need somebody
# who is a stranger to the other two: to be asked for a partner request while
# the sender is paused, and to try reading a session that is none of theirs.
C=33333333-3333-3333-3333-333333333333
$PSQL >/dev/null 2>&1 <<SQL
insert into auth.users (id, email)
  values ('$A','a@example.com'), ('$B','b@example.com'), ('$C','c@example.com');
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

# The same thing from INSIDE a wrap block, where SET LOCAL is not available:
# it is a plain SQL statement and a wrapped case is a plpgsql body. set_config
# with is_local = true is the same setting by another name, and the surrounding
# transaction is rolled back either way.
#
# The role is set as well as the claim, and it matters as much: the guard that
# stops a browser writing its own attendance works by asking whether
# current_user is `authenticated`, so a case that only set the JWT claim would
# run as superuser and sail straight past the thing it is testing.
IN_A="perform set_config('request.jwt.claim.sub', '$A', true);
      perform set_config('role', 'authenticated', true);
      if auth.uid() is null then
        raise exception 'auth.uid() is NULL — the test would have passed vacuously'; end if;"
IN_B="perform set_config('request.jwt.claim.sub', '$B', true);
      perform set_config('role', 'authenticated', true);
      if auth.uid() is null then
        raise exception 'auth.uid() is NULL — the test would have passed vacuously'; end if;"
IN_C="perform set_config('request.jwt.claim.sub', '$C', true);
      perform set_config('role', 'authenticated', true);
      if auth.uid() is null then
        raise exception 'auth.uid() is NULL — the test would have passed vacuously'; end if;"
# Back to the owner, so the assertions afterwards can read both halves of a
# session rather than only the caller's own row.
IN_OWNER="perform set_config('role', 'none', true);"


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
echo "==> deleting your account"
# The one function here that destroys data. Everything it does beyond the
# single DELETE is about rows belonging to somebody else, so that is what
# these cases are about — what survives, not what goes.

check "your own rows go" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status)
    values ('$A', now() + interval '2 days', 50, 'pf:mine', 'confirmed');
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ declare n int; begin
    select count(*) into n from public.sessions where user_id='$A';
    if n > 0 then raise exception '% of your own session rows survived', n; end if;
    if exists (select 1 from public.profiles where id='$A') then
      raise exception 'the profile survived'; end if;
    if exists (select 1 from auth.users where id='$A') then
      raise exception 'the account survived'; end if;
  end \$\$;"

check "the partner is told, before the row saying you were partners goes" ok "
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ begin
    if not exists (select 1 from public.notifications
                    where user_id='$B' and title like '%closed their account%') then
      raise exception 'the partner was not told'; end if;
  end \$\$;"

check "their future session with you is called off" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, partner_name)
    select '$A', now() + interval '2 days', 50, 'pf:both', 'confirmed', 'Bo B'
      from public.partner_requests where from_user='$A';
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, partner_name)
    select '$B', now() + interval '2 days', 50, 'pf:both', 'confirmed', 'Ada A'
      from public.partner_requests where from_user='$A';
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ declare st text; begin
    select status into st from public.sessions where user_id='$B' and room_url='pf:both';
    if st is distinct from 'cancelled' then
      raise exception 'their row is still %', coalesce(st,'gone'); end if;
  end \$\$;"

# privacy.html promises exactly this: a former partner keeps the times the two
# of you booked, with your name off them.
check "their row keeps the booking and loses your name" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, partner_name)
    values ('$A', now() - interval '2 days', 50, 'pf:past', 'confirmed', 'Bo B'),
           ('$B', now() - interval '2 days', 50, 'pf:past', 'confirmed', 'Ada A');
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ declare r record; begin
    select * into r from public.sessions where user_id='$B' and room_url='pf:past';
    if r is null then raise exception 'their history row was deleted with your account'; end if;
    if r.partner_name is not null then
      raise exception 'your name is still on their row: %', r.partner_name; end if;
    if r.status <> 'confirmed' then
      raise exception 'a session that already happened was cancelled'; end if;
  end \$\$;"

# The reason reporter/reported are `on delete set null` and the names are
# snapshotted. Closing your account must not delete the record of what you did.
check "a report about you survives you, names and all" ok "
  $AS_B
  select public.report_person('$A','harassment','it kept happening', null, false);
  reset role;
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ declare r record; begin
    select * into r from public.reports where reported_name = 'Ada A';
    if r is null then raise exception 'the report went with the account'; end if;
    if r.reported is not null then raise exception 'reported should be null now'; end if;
    if r.detail <> 'it kept happening' then raise exception 'the detail was lost'; end if;
  end \$\$;"

check "a report you wrote survives you too" ok "
  $AS_A
  select public.report_person('$B','spam', null, null, false);
  select public.delete_own_account();
  reset role;
  do \$\$ declare n int; begin
    select count(*) into n from public.reports where reporter_name='Ada A';
    if n <> 1 then raise exception '% rows, expected the report to survive', n; end if;
  end \$\$;"

check "delete_own_account refuses a caller with no identity" "PF010" "$(wrap "
  set local role authenticated;
  perform public.delete_own_account();")"

# A session of theirs that has nothing to do with you must not be touched by
# the matching in steps 2 and 3 — the three-way OR is wide, and NULL on either
# side has to fail to match rather than match everything.
check "a stranger's session at the same moment is left alone" ok "
  insert into public.sessions (user_id, starts_at, duration_min, room_url, status, partner_name)
    values ('$A', now() + interval '2 days', 50, 'pf:mine',   'confirmed', 'Bo B'),
           ('$B', now() + interval '2 days', 50, 'pf:theirs', 'confirmed', 'Someone Else');
  $AS_A
  select public.delete_own_account();
  reset role;
  do \$\$ declare r record; begin
    select * into r from public.sessions where user_id='$B' and room_url='pf:theirs';
    if r.status <> 'confirmed' then raise exception 'an unrelated session was cancelled'; end if;
    if r.partner_name is distinct from 'Someone Else' then
      raise exception 'an unrelated partner name was wiped: %', r.partner_name; end if;
  end \$\$;"


echo
echo "==> undo, which is what makes one-press reporting safe"

check "withdrawing removes the report and unblocks them" ok "
  $AS_A
  do \$\$ declare rid uuid; gone boolean; begin
    rid := public.report_person('$B','harassment');
    if not exists (select 1 from public.blocks where blocker='$A' and blocked='$B') then
      raise exception 'the report did not block'; end if;
    gone := public.withdraw_report(rid);
    if not gone then raise exception 'withdraw_report returned false'; end if;
    if exists (select 1 from public.reports where id = rid) then
      raise exception 'the report is still there'; end if;
    if exists (select 1 from public.blocks where blocker='$A' and blocked='$B') then
      raise exception 'still blocked after an undo'; end if;
  end \$\$;"

check "withdrawing can keep the block if asked to" ok "
  $AS_A
  do \$\$ declare rid uuid; begin
    rid := public.report_person('$B','harassment');
    perform public.withdraw_report(rid, false);
    if not exists (select 1 from public.blocks where blocker='$A' and blocked='$B') then
      raise exception 'the block was removed despite p_unblock false'; end if;
  end \$\$;"

check "you cannot withdraw somebody else's report" ok "
  $AS_B
  do \$\$ declare rid uuid; begin
    rid := public.report_person('$A','harassment', null, null, false);
    perform set_config('request.jwt.claim.sub', '$A', true);
    if public.withdraw_report(rid) then
      raise exception 'A withdrew a report B wrote'; end if;
    perform set_config('request.jwt.claim.sub', '$B', true);
    if not exists (select 1 from public.reports where id = rid) then
      raise exception 'the report was deleted anyway'; end if;
  end \$\$;"

# Once somebody has read and acted on it, it is a record of a decision rather
# than a draft.
check "a report already handled cannot be withdrawn" ok "
  $AS_A
  select public.report_person('$B','harassment', null, null, false);
  reset role;
  update public.reports set handled_at = now() where reporter='$A' and reported='$B';
  $AS_A
  do \$\$ begin
    if public.withdraw_report(
         (select id from public.reports where reporter='$A' and reported='$B')) then
      raise exception 'a handled report was withdrawn'; end if;
  end \$\$;"

# The setup above only works because it steps out of the authenticated role
# first. This is that fact, asserted: a report is not something its author can
# mark as dealt with.
check "the reporter cannot mark their own report handled" ok "
  $AS_A
  select public.report_person('$B','harassment', null, null, false);
  update public.reports set handled_at = now() where reporter='$A';
  do \$\$ begin
    if (select handled_at from public.reports where reporter='$A') is not null then
      raise exception 'the reporter marked their own report handled'; end if;
  end \$\$;"

# An undo button, not a way to un-say something a week later: a report that
# could be withdrawn indefinitely could be withdrawn under pressure.
check "the window closes after fifteen minutes" ok "
  $AS_A
  select public.report_person('$B','harassment', null, null, false);
  reset role;
  update public.reports set created_at = now() - interval '16 minutes'
   where reporter='$A' and reported='$B';
  $AS_A
  do \$\$ declare rid uuid; begin
    select id into rid from public.reports where reporter='$A' and reported='$B';
    if public.withdraw_report(rid) then
      raise exception 'a report from 16 minutes ago was withdrawn'; end if;
    if not exists (select 1 from public.reports where id = rid) then
      raise exception 'it was deleted despite returning false'; end if;
  end \$\$;"

check "withdrawing something that is not there is false, not an error" ok "
  $AS_A
  do \$\$ begin
    if public.withdraw_report('00000000-0000-0000-0000-000000000000') then
      raise exception 'claimed to withdraw a report that does not exist'; end if;
  end \$\$;"

echo
echo "==> the sentence you did not stop to write"

check "amending sets the detail on your own report" ok "
  $AS_A
  do \$\$ declare rid uuid; begin
    rid := public.report_person('$B','harassment', null, null, false);
    if not public.amend_report(rid, '  they would not stop  ') then
      raise exception 'amend_report returned false'; end if;
    if (select detail from public.reports where id = rid) <> 'they would not stop' then
      raise exception 'detail not trimmed or not saved'; end if;
  end \$\$;"

check "an empty amendment clears the detail rather than storing blanks" ok "
  $AS_A
  do \$\$ declare rid uuid; begin
    rid := public.report_person('$B','harassment','first go', null, false);
    perform public.amend_report(rid, '   ');
    if (select detail from public.reports where id = rid) is not null then
      raise exception 'whitespace was stored'; end if;
  end \$\$;"

check "you cannot amend somebody else's report" ok "
  $AS_B
  do \$\$ declare rid uuid; begin
    rid := public.report_person('$A','harassment','what really happened', null, false);
    perform set_config('request.jwt.claim.sub', '$A', true);
    if public.amend_report(rid, 'no it did not') then
      raise exception 'A rewrote a report B wrote'; end if;
    perform set_config('request.jwt.claim.sub', '$B', true);
    if (select detail from public.reports where id = rid) <> 'what really happened' then
      raise exception 'the detail was changed anyway'; end if;
  end \$\$;"

check "a report already handled cannot be rewritten" ok "
  $AS_A
  select public.report_person('$B','harassment','as it happened', null, false);
  reset role;
  update public.reports set handled_at = now() where reporter='$A' and reported='$B';
  $AS_A
  do \$\$ declare rid uuid; begin
    select id into rid from public.reports where reporter='$A' and reported='$B';
    if public.amend_report(rid, 'actually never mind') then
      raise exception 'a handled report was rewritten'; end if;
    if (select detail from public.reports where id = rid) <> 'as it happened' then
      raise exception 'the detail changed anyway'; end if;
  end \$\$;"


echo
echo "==> who is on the other side of this call"

check "the counterpart row's owner is found" ok "
  insert into public.sessions (id, user_id, starts_at, duration_min, room_url, status)
    values ('44444444-4444-4444-4444-444444444444','$A', now() + interval '1 day',
            50,'pf:pair','confirmed'),
           ('55555555-5555-5555-5555-555555555555','$B', now() + interval '1 day',
            50,'pf:pair','confirmed');
  $AS_A
  do \$\$ begin
    if public.partner_for_session('44444444-4444-4444-4444-444444444444') <> '$B' then
      raise exception 'wrong partner, or none'; end if;
  end \$\$;"

# It must not be usable to walk the calendar looking up who sat with whom.
check "a session that is not yours answers nothing" ok "
  insert into public.sessions (id, user_id, starts_at, duration_min, room_url, status)
    values ('44444444-4444-4444-4444-444444444444','$A', now() + interval '1 day',
            50,'pf:pair','confirmed'),
           ('55555555-5555-5555-5555-555555555555','$B', now() + interval '1 day',
            50,'pf:pair','confirmed');
  $AS_B
  do \$\$ begin
    if public.partner_for_session('44444444-4444-4444-4444-444444444444') is not null then
      raise exception 'answered for somebody else''s session row'; end if;
  end \$\$;"

check "a session sat alone answers nothing rather than guessing" ok "
  insert into public.sessions (id, user_id, starts_at, duration_min, room_url, status)
    values ('44444444-4444-4444-4444-444444444444','$A', now() + interval '1 day',
            50,'pf:solo','confirmed');
  $AS_A
  do \$\$ begin
    if public.partner_for_session('44444444-4444-4444-4444-444444444444') is not null then
      raise exception 'invented a partner'; end if;
  end \$\$;"

# ============================================================
# Attendance: the outcome, the score, and the pause
# (supabase/migration-attendance.sql)
#
# The score is computed in two places — reliability_of() here and score() in
# assets/reliability.js — and a formula written twice is only safe if
# something notices when the two drift. So the fixtures below are built to
# match the ones marked "shared with sql-tests" in dev/reliability-tests.js
# and asserted to the same percentages. Change the policy in one file and both
# suites go red together.
# ============================================================
echo
echo "==> the outcome of a session"

# The case the whole feature exists for: one of them turns up and the other
# does not. Nothing used to decide this at all — LiveKit only sends
# room_finished once a room has existed, so a session where one person ghosts
# produced no event and attended stayed null for ever.
SETTLED="
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, joined_at, attended)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:s1','pf-s1','confirmed',
          now() - interval '3 hours', true),
         ('$B','A', now() - interval '3 hours', 50, 'pf:s1','pf-s1','confirmed', null, null);
  perform public.settle_pair((select starts_at from public.sessions where room_url='pf:s1' limit 1), 'pf:s1');"

check "the one who was in the room is marked attended" ok "$(wrap "
  $SETTLED
  if (select attendance from public.sessions where room_url='pf:s1' and user_id='$A')
     is distinct from 'attended' then raise exception 'not attended'; end if;")"

check "the one who never arrived is marked no_show" ok "$(wrap "
  $SETTLED
  if (select attendance from public.sessions where room_url='pf:s1' and user_id='$B')
     is distinct from 'no_show' then raise exception 'not a no-show'; end if;")"

check "and the verdict records that the room is where it came from" ok "$(wrap "
  $SETTLED
  if (select attendance_source from public.sessions where room_url='pf:s1' and user_id='$B')
     is distinct from 'livekit' then raise exception 'wrong source'; end if;")"

# The rule that keeps the whole thing honest, and the one most tempting to
# break. A session neither of them joined is indistinguishable, from inside
# the database, from a site whose webhook was never deployed — so it gets no
# verdict at all rather than two no-shows.
check "a session nothing observed gets no verdict, not two no-shows" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:s2','pf-s2','confirmed'),
         ('$B','A', now() - interval '3 hours', 50, 'pf:s2','pf-s2','confirmed');
  perform public.settle_pair((select starts_at from public.sessions where room_url='pf:s2' limit 1), 'pf:s2');
  if exists (select 1 from public.sessions where room_url='pf:s2' and attendance is not null)
    then raise exception 'invented a verdict out of silence'; end if;")"

check "a session still running is not decided early" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, joined_at, attended)
  values ('$A','B', now() - interval '5 minutes', 50, 'pf:s3','pf-s3','confirmed',
          now() - interval '5 minutes', true),
         ('$B','A', now() - interval '5 minutes', 50, 'pf:s3','pf-s3','confirmed', null, null);
  perform public.settle_pair((select starts_at from public.sessions where room_url='pf:s3' limit 1), 'pf:s3');
  if exists (select 1 from public.sessions where room_url='pf:s3' and attendance is not null)
    then raise exception 'graded a session that had not finished'; end if;")"

# The ten minute grace is the line between on time and late, not a deadline to
# be graded at. Somebody who walks in at minute twenty attended.
check "somebody who joined twenty minutes in attended, and is not a no-show" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, joined_at, attended)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:s4','pf-s4','confirmed',
          now() - interval '3 hours' + interval '20 minutes', true),
         ('$B','A', now() - interval '3 hours', 50, 'pf:s4','pf-s4','confirmed',
          now() - interval '3 hours', true);
  perform public.settle_pair((select starts_at from public.sessions where room_url='pf:s4' limit 1), 'pf:s4');
  if (select attendance from public.sessions where room_url='pf:s4' and user_id='$A')
     is distinct from 'attended' then raise exception 'a late arrival is not an absence'; end if;")"

echo
echo "==> cancelling, and who wears it"

CANCEL_EARLY="
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() + interval '20 hours', 50, 'pf:c1','pf-c1','confirmed'),
         ('$B','A', now() + interval '20 hours', 50, 'pf:c1','pf-c1','confirmed');
  $IN_A
  perform public.answer_session(
    (select starts_at from public.sessions where room_url='pf:c1' limit 1), 'pf:c1', 'cancelled');
  $IN_OWNER"

CANCEL_LATE="
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() + interval '2 hours', 50, 'pf:c2','pf-c2','confirmed'),
         ('$B','A', now() + interval '2 hours', 50, 'pf:c2','pf-c2','confirmed');
  $IN_A
  perform public.answer_session(
    (select starts_at from public.sessions where room_url='pf:c2' limit 1), 'pf:c2', 'cancelled');
  $IN_OWNER"

check "twenty hours' notice is an early cancellation" ok "$(wrap "
  $CANCEL_EARLY
  if (select attendance from public.sessions where room_url='pf:c1' and user_id='$A')
     is distinct from 'cancelled_early' then raise exception 'not early'; end if;")"

check "two hours' notice is a late one" ok "$(wrap "
  $CANCEL_LATE
  if (select attendance from public.sessions where room_url='pf:c2' and user_id='$A')
     is distinct from 'cancelled_late' then raise exception 'not late'; end if;")"

# The rule that stops one flaky partner dragging down everybody they booked
# with. Whoever pressed Cancel wears it; the other one is excused.
check "the person who was cancelled ON is excused, not penalised" ok "$(wrap "
  $CANCEL_LATE
  if (select attendance from public.sessions where room_url='pf:c2' and user_id='$B')
     is distinct from 'excused' then raise exception 'penalised the wrong person'; end if;")"

check "an early cancellation is not a graded session at all" ok "$(wrap "
  $CANCEL_EARLY
  if (select counted from public.reliability_of(array['$A']::uuid[])) <> 0
    then raise exception 'an early cancellation was graded'; end if;")"

# Cancelling a proposal nobody ever accepted is not a broken promise, and must
# not land on anybody's record.
check "cancelling a time nobody had agreed to lands on nobody" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, proposed_by)
  values ('$A','B', now() + interval '2 hours', 50, 'pf:c3','pf-c3','proposed','$A'),
         ('$B','A', now() + interval '2 hours', 50, 'pf:c3','pf-c3','proposed','$A');
  $IN_A
  perform public.answer_session(
    (select starts_at from public.sessions where room_url='pf:c3' limit 1), 'pf:c3', 'cancelled');
  $IN_OWNER
  if exists (select 1 from public.sessions where room_url='pf:c3' and attendance is not null)
    then raise exception 'graded an unaccepted proposal'; end if;")"

echo
echo "==> the score"

# Helper: $4 settled outcomes for person $1, one a day going back, starting
# $5 days ago (default 1).
#
# The offset is not decoration. Two batches for the same person both starting
# a day ago put two sessions on the same hour, and the exclusion constraint
# from migration-no-double-booking.sql refuses the second — correctly, since
# nobody can be in two places at once. A fixture describing an impossible
# calendar tests nothing, so each batch gets its own stretch of days.
grade_rows() {
  local from="${5:-1}"
  echo "insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
        select '$1','X', date_trunc('hour', now()) - (n || ' days')::interval, 50,
               'pf:$3'||n, 'confirmed', '$2', 'livekit', now()
          from generate_series($from, $from + $4 - 1) n;"
}

check "two sessions is not enough for a percentage" ok "$(wrap "
  $(grade_rows "$A" attended g1 2)
  if (select pct from public.reliability_of(array['$A']::uuid[])) is not null
    then raise exception 'scored somebody with two sessions'; end if;")"

# shared with dev/reliability-tests.js: "three perfect sessions is not 100%"
check "three perfect sessions scores 94, not 100" ok "$(wrap "
  $(grade_rows "$A" attended g2 3)
  if (select pct from public.reliability_of(array['$A']::uuid[])) <> 94
    then raise exception 'got %', (select pct from public.reliability_of(array['$A']::uuid[])); end if;")"

# shared with dev/reliability-tests.js: 23 attended and one no-show 12 days back
check "23 attended and one missed reads as 94" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', date_trunc('hour', now()) - (n || ' days')::interval, 50,
         'pf:g3'||n, 'confirmed',
         case when n = 12 then 'no_show' else 'attended' end, 'livekit', now()
    from generate_series(1, 24) n;
  if (select pct from public.reliability_of(array['$A']::uuid[])) <> 94
    then raise exception 'got %', (select pct from public.reliability_of(array['$A']::uuid[])); end if;")"

check "  and the window caps what is counted at twenty" ok "$(wrap "
  $(grade_rows "$A" attended g4 30)
  if (select counted from public.reliability_of(array['$A']::uuid[])) <> 20
    then raise exception 'counted %', (select counted from public.reliability_of(array['$A']::uuid[])); end if;")"

check "  while the totals underneath count everything" ok "$(wrap "
  $(grade_rows "$A" attended g5 30)
  if (select attended_n from public.reliability_of(array['$A']::uuid[])) <> 30
    then raise exception 'attended_n was wrong'; end if;")"

# shared with dev/reliability-tests.js: five sessions, all joined 25 minutes in
check "turning up late five times running is 82" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at, joined_at)
  select '$A','X', date_trunc('hour', now()) - (n || ' days')::interval, 50,
         'pf:g6'||n, 'confirmed', 'attended', 'livekit', now(),
         date_trunc('hour', now()) - (n || ' days')::interval + interval '25 minutes'
    from generate_series(1, 5) n;
  if (select pct from public.reliability_of(array['$A']::uuid[])) <> 82
    then raise exception 'got %', (select pct from public.reliability_of(array['$A']::uuid[])); end if;")"

# The obvious way to game a system that forgives early cancellations. It does
# not work, and this is why: an early cancellation is not a graded session, so
# the floor is never reached and the profile reads "New partner" for ever.
check "cancelling everything early never buys a score" ok "$(wrap "
  $(grade_rows "$A" cancelled_early g7 10)
  if (select pct from public.reliability_of(array['$A']::uuid[])) is not null
    then raise exception 'a serial canceller was given a percentage'; end if;
  if (select early_n from public.reliability_of(array['$A']::uuid[])) <> 10
    then raise exception 'the cancellations were not counted at all'; end if;")"

# 96 is what six clean sessions score on their own, so asserting it after six
# excused ones have been added is the claim: the excused ones changed nothing.
# dev/reliability-tests.js makes the same claim as a direct comparison, which
# is clearer but needs two scores at once and this has one transaction.
check "excused sessions do not move the score" ok "$(wrap "
  $(grade_rows "$A" attended g8 6)
  $(grade_rows "$A" excused g9 6 20)
  if (select pct from public.reliability_of(array['$A']::uuid[])) <> 96
    then raise exception 'got %', (select pct from public.reliability_of(array['$A']::uuid[])); end if;
  if (select counted from public.reliability_of(array['$A']::uuid[])) <> 6
    then raise exception 'excused sessions were graded'; end if;
  if (select expected_n from public.reliability_of(array['$A']::uuid[])) <> 6
    then raise exception 'excused sessions were counted as expected of them'; end if;")"

check "a no-show costs more than a late cancellation" ok "$(wrap "
  $(grade_rows "$A" attended ga 4)
  $(grade_rows "$A" cancelled_late gb 2 20)
  $(grade_rows "$B" attended gc 4)
  $(grade_rows "$B" no_show gd 2 20)
  if (select pct from public.reliability_of(array['$A']::uuid[]))
     <= (select pct from public.reliability_of(array['$B']::uuid[]))
    then raise exception 'a no-show cost no more than a late cancellation'; end if;")"

echo
echo "==> nobody may write their own attendance"

# The hole this closes: schema.sql's "answer a proposal" policy allows an
# UPDATE on your own session row, and attended is a column on that row.
check "the browser cannot mark itself present" "PF020" "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min, room_url, status)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:t1','confirmed');
  $IN_A
  update public.sessions set attended = true where room_url='pf:t1';")"

check "nor set its own outcome" "PF020" "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min, room_url, status)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:t2','confirmed');
  $IN_A
  update public.sessions set attendance = 'attended' where room_url='pf:t2';")"

check "nor move a session to completed to inflate the count" "PF020" "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min, room_url, status)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:t3','confirmed');
  $IN_A
  update public.sessions set status = 'completed' where room_url='pf:t3';")"

# Claimed on the way in rather than refused, because nothing in the app sends
# these and losing a booking over a column nobody asked for would be the wrong
# trade.
check "attendance claimed on an insert is quietly dropped" ok "$(wrap "
  $IN_A
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, status, attended, attendance)
  values ('$A','B', now() + interval '30 hours', 50, 'pf:t4','confirmed', true, 'attended');
  $IN_OWNER
  if exists (select 1 from public.sessions
              where room_url='pf:t4' and (attended is not null or attendance is not null))
    then raise exception 'the browser wrote its own attendance'; end if;")"

# And the writes the app really does make from a page must keep working.
check "the browser can still answer its own goal" ok "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, status, goal)
  values ('$A','B', now() - interval '3 hours', 50, 'pf:t5','confirmed','read a pcap');
  $AS_A
  update public.sessions set goal_done = true, completed_at = now() where room_url='pf:t5';"

echo
echo "==> the check-in, and what an accusation is allowed to do"

check "saying they showed up fills an empty verdict" ok "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, status)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50, 'pf:k1','confirmed'),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50, 'pf:k1','confirmed');
  $IN_A
  perform public.session_checkin('66666666-6666-6666-6666-666666666666', true, null);
  $IN_OWNER
  if (select attendance from public.sessions where id='77777777-7777-7777-7777-777777777777')
     is distinct from 'attended' then raise exception 'vouching did nothing'; end if;")"

# The one input in this feature somebody could lie into, and the rule that
# stops them: you cannot report an empty room you never entered.
check "accusing somebody of a no-show settles nothing if you weren't there either" ok "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, status)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50, 'pf:k2','confirmed'),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50, 'pf:k2','confirmed');
  $IN_A
  if public.session_checkin('66666666-6666-6666-6666-666666666666', false, null) <> 'unverified'
    then raise exception 'the claim was acted on'; end if;
  $IN_OWNER
  if (select attendance from public.sessions where id='77777777-7777-7777-7777-777777777777')
     is not null then raise exception 'an unverifiable accusation was written down'; end if;")"

check "  but it does when the accuser demonstrably was in the room" ok "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, joined_at, attended)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50,
          'pf:k3','pf-k3','confirmed', now() - interval '3 hours', true),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50,
          'pf:k3','pf-k3','confirmed', null, null);
  $IN_A
  perform public.session_checkin('66666666-6666-6666-6666-666666666666', false, null);
  $IN_OWNER
  if (select attendance from public.sessions where id='77777777-7777-7777-7777-777777777777')
     is distinct from 'no_show' then raise exception 'a verifiable miss was not recorded'; end if;")"

check "a check-in on somebody else's session is refused" "PF012" "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min, room_url, status)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50, 'pf:k4','confirmed');
  $IN_B
  perform public.session_checkin('66666666-6666-6666-6666-666666666666', false, null);")"

check "a check-in before the session is over is refused" "PF014" "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min, room_url, status)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() + interval '3 hours', 50, 'pf:k5','confirmed');
  $IN_A
  perform public.session_checkin('66666666-6666-6666-6666-666666666666', true, null);")"

echo
echo "==> walking away without it being a report"

END_IT="
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, pair_id, status)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50,
          'pf:e1', (select id from public.partner_requests limit 1), 'confirmed'),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50,
          'pf:e1', (select id from public.partner_requests limit 1), 'confirmed'),
         ('88888888-8888-8888-8888-888888888888','$A','B', now() + interval '3 days', 50,
          'pf:e2', (select id from public.partner_requests limit 1), 'confirmed'),
         ('99999999-9999-9999-9999-999999999999','$B','A', now() + interval '3 days', 50,
          'pf:e2', (select id from public.partner_requests limit 1), 'confirmed');
  $IN_A
  perform public.session_checkin('66666666-6666-6666-6666-666666666666', true, 'stop');
  $IN_OWNER"

check "choosing another partner ends the partnership" ok "$(wrap "
  $END_IT
  if (select status from public.partner_requests limit 1) <> 'ended'
    then raise exception 'the partnership survived'; end if;")"

check "  and takes the sessions still to come off both calendars" ok "$(wrap "
  $END_IT
  if exists (select 1 from public.sessions where room_url='pf:e2' and status <> 'cancelled')
    then raise exception 'a session outlived the partnership'; end if;")"

# A bad match is not misconduct. Neither of them failed to attend something
# that was called off.
check "  as excused, so neither of them is marked down for it" ok "$(wrap "
  $END_IT
  if exists (select 1 from public.sessions where room_url='pf:e2' and attendance <> 'excused')
    then raise exception 'ending a partnership cost somebody their record'; end if;")"

check "  and it is not a block: neither profile is hidden" ok "$(wrap "
  $END_IT
  if exists (select 1 from public.blocks) then raise exception 'ending it blocked somebody'; end if;")"

# Being harassed is not a late cancellation.
check "blocking somebody costs the blocker nothing" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, pair_id, status)
  values ('$A','B', now() + interval '2 hours', 50, 'pf:b1',
          (select id from public.partner_requests limit 1), 'confirmed'),
         ('$B','A', now() + interval '2 hours', 50, 'pf:b1',
          (select id from public.partner_requests limit 1), 'confirmed');
  $IN_A
  perform public.block_person('$B');
  $IN_OWNER
  if exists (select 1 from public.sessions where room_url='pf:b1' and attendance <> 'excused')
    then raise exception 'blocking was scored as a cancellation'; end if;")"

echo
echo "==> three misses in a month"

MISSES="
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', now() - (n || ' days')::interval, 50, 'pf:ns'||n, 'confirmed',
         'no_show', 'livekit', now() from generate_series(1, 3) n;"

check "two misses do not pause anything" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', now() - (n || ' days')::interval, 50, 'pf:nt'||n, 'confirmed',
         'no_show', 'livekit', now() from generate_series(1, 2) n;
  if public.partnering_restricted_until('$A') is not null
    then raise exception 'paused somebody after two'; end if;")"

check "three inside thirty days do" ok "$(wrap "
  $MISSES
  if public.partnering_restricted_until('$A') is null
    then raise exception 'three misses did not pause anything'; end if;")"

check "  and it runs seven days from the last of them" ok "$(wrap "
  $MISSES
  if public.partnering_restricted_until('$A')::date
     <> (now() - interval '1 day' + interval '7 days')::date
    then raise exception 'the cooldown runs from the wrong end'; end if;")"

# Rolling, so it expires on its own. That is the difference between a cooldown
# and a punishment.
check "three misses spread over more than thirty days is not a pattern" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', now() - (n || ' days')::interval, 50, 'pf:nu'||n, 'confirmed',
         'no_show', 'livekit', now() from unnest(array[2, 20, 40]) n;
  if public.partnering_restricted_until('$A') is not null
    then raise exception 'counted a miss from outside the window'; end if;")"

check "three misses that have served their week are free again" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', now() - (n || ' days')::interval, 50, 'pf:nv'||n, 'confirmed',
         'no_show', 'livekit', now() from unnest(array[20, 22, 25]) n;
  if public.partnering_restricted_until('$A') is not null
    then raise exception 'the pause never lifted'; end if;")"

# The enforcement, in the only place that cannot be walked around.
check "a paused account cannot send a new partner request" "42501" "$(wrap "
  $MISSES
  $IN_A
  insert into public.partner_requests (from_user, to_user)
  values ('$A','$C');")"

check "  and can still send one once the pause has lifted" ok "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
          room_url, status, attendance, attendance_source, settled_at)
  select '$A','X', now() - (n || ' days')::interval, 50, 'pf:nw'||n, 'confirmed',
         'no_show', 'livekit', now() from unnest(array[20, 22, 25]) n;
  $AS_A
  insert into public.partner_requests (from_user, to_user) values ('$A','$C');"

# Not a ban. The point of the pause is that it is narrow.
check "  while everything they already have keeps working" ok "
  $MISSES
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, pair_id, status, proposed_by)
  values ('$B','A', now() + interval '2 days', 50, 'pf:nx',
          (select id from public.partner_requests limit 1), 'proposed','$A');
  $AS_A
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, pair_id, status, proposed_by)
  values ('$A','B', now() + interval '2 days', 50, 'pf:nx',
          (select id from public.partner_requests limit 1), 'proposed','$A');
  select 1 from public.sessions where user_id = '$A' limit 1;"

echo
echo "==> reminders"

REMIND="
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() + interval '6 minutes', 25, 'pf:r1','pf-r1','confirmed'),
         ('$B','A', now() + interval '6 minutes', 25, 'pf:r1','pf-r1','confirmed');
  $IN_A
  perform public.send_due_reminders();
  $IN_OWNER"

check "the ten-minute reminder names the person expecting you" ok "$(wrap "
  $REMIND
  if not exists (select 1 from public.notifications
                  where user_id='$A' and title like '%expecting you in 10 minutes%')
    then raise exception 'no ten-minute reminder'; end if;")"

# The whole reason the page-load path is worth having on a site with no
# scheduler: your partner opening PeerFlow is what reminds you.
check "  and reaches the partner too, not just whoever opened the page" ok "$(wrap "
  $REMIND
  if not exists (select 1 from public.notifications
                  where user_id='$B' and title like '%expecting you in 10 minutes%')
    then raise exception 'the partner was not reminded'; end if;")"

check "  running twice does not send it twice" ok "$(wrap "
  $REMIND
  $IN_A
  perform public.send_due_reminders();
  $IN_OWNER
  if (select count(*) from public.notifications where user_id='$A' and kind='reminder') <> 1
    then raise exception 'sent a reminder twice'; end if;")"

# A session booked for this evening should get the ten-minute reminder when it
# is due, and not also the two it slept through.
check "a session booked inside the hour gets one reminder, not three" ok "$(wrap "
  $REMIND
  if (select count(*) from public.notifications where user_id='$A' and kind='reminder') <> 1
    then raise exception 'sent the reminders it had already missed'; end if;")"

check "a session a day out gets the day-before one" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() + interval '20 hours', 25, 'pf:r2','pf-r2','confirmed'),
         ('$B','A', now() + interval '20 hours', 25, 'pf:r2','pf-r2','confirmed');
  $IN_A
  perform public.send_due_reminders();
  $IN_OWNER
  if not exists (select 1 from public.notifications where user_id='$A' and title like 'Tomorrow:%')
    then raise exception 'no day-before reminder'; end if;")"

check "a session next month is not mentioned yet" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() + interval '20 days', 25, 'pf:r3','pf-r3','confirmed'),
         ('$B','A', now() + interval '20 days', 25, 'pf:r3','pf-r3','confirmed');
  $IN_A
  perform public.send_due_reminders();
  $IN_OWNER
  if exists (select 1 from public.notifications where kind='reminder')
    then raise exception 'reminded somebody three weeks early'; end if;")"

echo
echo "==> your partner is waiting"

check "joining a room tells the one who has not" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() - interval '2 minutes', 50, 'pf:w1','pf-w1','confirmed'),
         ('$B','A', now() - interval '2 minutes', 50, 'pf:w1','pf-w1','confirmed');
  perform public.record_presence('pf-w1', '$A', now(), null);
  if not exists (select 1 from public.notifications
                  where user_id='$B' and title like '%is waiting for you%')
    then raise exception 'nobody was told'; end if;")"

check "  once, however many times the webhook redelivers" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() - interval '2 minutes', 50, 'pf:w2','pf-w2','confirmed'),
         ('$B','A', now() - interval '2 minutes', 50, 'pf:w2','pf-w2','confirmed');
  perform public.record_presence('pf-w2', '$A', now(), null);
  perform public.record_presence('pf-w2', '$A', now(), null);
  perform public.record_presence('pf-w2', '$A', now(), null);
  if (select count(*) from public.notifications where user_id='$B') <> 1
    then raise exception 'spammed the partner'; end if;")"

check "  and not at all once they are both in the room" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status, joined_at, attended)
  values ('$A','B', now() - interval '2 minutes', 50, 'pf:w3','pf-w3','confirmed', now(), true),
         ('$B','A', now() - interval '2 minutes', 50, 'pf:w3','pf-w3','confirmed', now(), true);
  perform public.record_presence('pf-w3', '$A', now(), null);
  if exists (select 1 from public.notifications where user_id='$B' and title like '%waiting%')
    then raise exception 'told somebody who was already there'; end if;")"

check "leaving is not a reason to tell anybody anything" ok "$(wrap "
  insert into public.sessions (user_id, partner_name, starts_at, duration_min,
                               room_url, room_name, status)
  values ('$A','B', now() - interval '2 minutes', 50, 'pf:w4','pf-w4','confirmed'),
         ('$B','A', now() - interval '2 minutes', 50, 'pf:w4','pf-w4','confirmed');
  perform public.record_presence('pf-w4', '$A', now(), now());
  if exists (select 1 from public.notifications where user_id='$B' and title like '%waiting%')
    then raise exception 'announced somebody leaving as somebody waiting'; end if;")"

echo
echo "==> the other side of a session, and nothing else"

check "you can read your partner's outcome for a session you own" ok "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, status, attendance, settled_at)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50,
          'pf:p1','confirmed', 'attended', now()),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50,
          'pf:p1','confirmed', 'no_show', now());
  $IN_A
  if (select attendance from public.partner_outcomes(
        array['66666666-6666-6666-6666-666666666666']::uuid[])) is distinct from 'no_show'
    then raise exception 'could not read the other half'; end if;")"

# It must not be usable to walk the table looking up strangers.
check "  and nothing at all for a session that is not yours" ok "$(wrap "
  insert into public.sessions (id, user_id, partner_name, starts_at, duration_min,
                               room_url, status, attendance, settled_at)
  values ('66666666-6666-6666-6666-666666666666','$A','B', now() - interval '3 hours', 50,
          'pf:p2','confirmed', 'attended', now()),
         ('77777777-7777-7777-7777-777777777777','$B','A', now() - interval '3 hours', 50,
          'pf:p2','confirmed', 'no_show', now());
  $IN_C
  if exists (select 1 from public.partner_outcomes(
               array['66666666-6666-6666-6666-666666666666']::uuid[]))
    then raise exception 'read a stranger''s session'; end if;")"

echo
echo "==> saying yes, and the person who asked finding out"
# assets/db.js does two things when somebody accepts a request: it updates the
# row and reads back who asked, and it then calls notify_partner() to tell
# them. Neither had a test, and the second one is only legal because of the
# first — notify_partner checks the partnership, and the partnership is what
# the update has just created. Get the order wrong in the browser and the
# notification is refused every time, silently, because the call is
# deliberately swallowed on failure.

check "the recipient's answer hands back the row it changed" ok "$(wrap "
  insert into public.partner_requests (id, from_user, to_user, status)
  values ('88888888-8888-8888-8888-888888888888','$C','$A','pending');
  $IN_A
  declare who uuid;
  begin
    update public.partner_requests set status = 'accepted', to_seen_at = now()
     where id = '88888888-8888-8888-8888-888888888888'
    returning from_user into who;
    if not found then raise exception 'the update returned nothing to notify'; end if;
  end;")"

check "  and it is the person who asked" ok "$(wrap "
  insert into public.partner_requests (id, from_user, to_user, status)
  values ('88888888-8888-8888-8888-888888888888','$C','$A','pending');
  $IN_A
  declare who uuid;
  begin
    update public.partner_requests set status = 'accepted'
     where id = '88888888-8888-8888-8888-888888888888'
    returning from_user into who;
    if who is distinct from '$C'::uuid then
      raise exception 'the wrong person would have been told'; end if;
  end;")"

check "accepting, then telling them, reaches their bell" ok "$(wrap "
  insert into public.partner_requests (id, from_user, to_user, status)
  values ('88888888-8888-8888-8888-888888888888','$C','$A','pending');
  $IN_A
  update public.partner_requests set status = 'accepted'
   where id = '88888888-8888-8888-8888-888888888888';
  perform public.notify_partner('$C', 'partner', 'A said yes',
            'You are partners now.', 'app.html?plan=$A');
  $IN_OWNER
  if not exists (select 1 from public.notifications
                  where user_id = '$C' and kind = 'partner'
                    and href = 'app.html?plan=$A')
    then raise exception 'nothing landed in their notifications'; end if;")"

# The order the browser does it in is the only order that works. This is the
# case that would have caught it silently doing them the other way round.
check "  and telling them before accepting is refused" "P0001" "$(wrap "
  insert into public.partner_requests (id, from_user, to_user, status)
  values ('88888888-8888-8888-8888-888888888888','$C','$A','pending');
  $IN_A
  perform public.notify_partner('$C', 'partner', 'A said yes', null, 'app.html?plan=$A');")"

check "  and a stranger cannot be told anything" "P0001" "$(wrap "
  $IN_A
  perform public.notify_partner('$C', 'partner', 'hello', null, 'app.html');")"

check "  nor can anybody write straight into somebody else's bell" ok "$(wrap "
  $IN_A
  begin
    insert into public.notifications (user_id, kind, title)
    values ('$C', 'partner', 'straight in');
    raise exception 'the insert policy let a stranger write a notification';
  exception when insufficient_privilege then null;
  end;")"

echo
echo "==================================================="
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
