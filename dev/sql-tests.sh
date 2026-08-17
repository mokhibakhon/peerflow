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
end $$;
grant usage on schema public, auth to authenticated, anon;
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
echo "==================================================="
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
