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
-- PeerFlow — direct messages
--
-- Run this once in the Supabase SQL editor, after schema.sql.
-- Additive only. Without it the Chat page says messaging is not switched on
-- and every other page carries on exactly as before.
--
-- WHO MAY MESSAGE WHOM
-- Anyone you already have a partner request with, in any state: you asked
-- them, or they asked you. That is the consent gate the product already has,
-- so this adds no new one — and it means a stranger cannot arrive in your
-- inbox uninvited, which on a site full of students matters more than the
-- convenience of open DMs. Widening it later is one line in one policy.
-- ============================================================

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  -- Set on the recipient's side only, by mark_thread_read below.
  read_at    timestamptz,
  constraint no_self_message check (from_user <> to_user),
  constraint body_not_empty  check (length(btrim(body)) > 0),
  constraint body_length     check (length(body) <= 2000)
);

-- Reading a thread is "everything between these two, oldest first", and the
-- unread badge is "anything to me that is unread". One index each.
create index if not exists messages_thread on public.messages (from_user, to_user, created_at);
create index if not exists messages_inbox  on public.messages (to_user, read_at);

alter table public.messages enable row level security;

drop policy if exists "read your own messages"    on public.messages;
drop policy if exists "message people you know"   on public.messages;

create policy "read your own messages"
  on public.messages for select
  using (auth.uid() in (from_user, to_user));

-- Send as yourself, and only to somebody one of you has already approached.
create policy "message people you know"
  on public.messages for insert with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.partner_requests r
      where (r.from_user = auth.uid() and r.to_user   = messages.to_user)
         or (r.to_user   = auth.uid() and r.from_user = messages.to_user)
    )
  );

-- No UPDATE or DELETE policy on purpose. Marking a thread read is the only
-- change anybody needs to make to a message that already exists, and it goes
-- through the function below — an UPDATE policy wide enough to set read_at
-- would also be wide enough to rewrite what somebody said.

create or replace function public.mark_thread_read(p_other uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.messages
     set read_at = now()
   where to_user = auth.uid()
     and from_user = p_other
     and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;
