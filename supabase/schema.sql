-- ============================================================
-- PeerFlow database schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- ============================================================

-- ---------- tracks ----------
-- The paths people can pick from at signup.
create table if not exists public.tracks (
  id     text primary key,
  name   text not null,
  career text not null,
  sort   int  not null default 0
);

-- ---------- profiles (one per auth user) ----------
-- Set at signup; editable later from the Profile page.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '',
  track_id     text references public.tracks(id),
  topic        text,
  level        text check (level in ('new','tutorials','builder','jobprep')),
  goal         text check (goal in ('job','studies','switch')),
  timezone     text,
  availability jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- Adds newer columns when profiles already exists from an earlier run
-- (create table if not exists would skip them).
alter table public.profiles add column if not exists topic text;
-- Name was one free-text field. Split so we can greet someone by first name
-- without guessing where their name ends; `name` stays as the joined
-- display value so older rows and every read path keep working.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;

-- ---------- waitlist (home-page email captures) ----------
-- Anyone can leave their email + what they want to learn. Insert-only:
-- there is no read policy, so the list is private to the project owner.
create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  interest   text,
  created_at timestamptz not null default now()
);

-- ---------- matches (created by hand for now) ----------
-- When you pair two people, insert one row per person: each row holds the
-- OTHER person's details, and both rows share the same room_url. Users can
-- read only their own row; you insert rows from the Supabase dashboard.
create table if not exists public.matches (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  partner_name  text not null,
  partner_topic text,
  partner_times text,
  room_url      text,
  created_at    timestamptz not null default now()
);

-- ---------- partner requests ----------
-- One person asks another to be their learning partner. The recipient accepts
-- or declines. Both sides also track whether they've seen the latest state,
-- which is what drives the unread count on the bell.
create table if not exists public.partner_requests (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users(id) on delete cascade,
  to_user      uuid not null references auth.users(id) on delete cascade,
  message      text,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  to_seen_at   timestamptz,   -- recipient has seen the request
  from_seen_at timestamptz,   -- sender has seen the answer
  created_at   timestamptz not null default now(),
  constraint no_self_request check (from_user <> to_user),
  unique (from_user, to_user)
);
create index if not exists partner_requests_to   on public.partner_requests (to_user, status);
create index if not exists partner_requests_from on public.partner_requests (from_user, status);

-- Only the recipient may change the status. The sender can still update the
-- row (to mark the answer as seen), so enforce the rule here rather than in RLS.
create or replace function public.guard_partner_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() = old.from_user and auth.uid() <> old.to_user
     and new.status is distinct from old.status then
    raise exception 'only the recipient can answer a partner request';
  end if;
  return new;
end;
$$;

drop trigger if exists partner_request_guard on public.partner_requests;
create trigger partner_request_guard
  before update on public.partner_requests
  for each row execute function public.guard_partner_request();

-- ---------- drop the legacy group-session tables ----------
-- Earlier versions of PeerFlow had a group "sessions" table (host_id, capacity,
-- kind) plus session_members. The one-to-one model replaces it with a per-person
-- sessions table keyed by user_id. Only drop when the old shape is present, so
-- re-running this file never destroys real scheduled sessions.
do $$
begin
  if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'sessions')
     and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'sessions' and column_name = 'user_id')
  then
    drop table if exists public.session_members cascade;
    drop table if exists public.sessions cascade;
  end if;
end $$;

-- ---------- sessions (scheduled meetings, created by hand for now) ----------
-- One row per person per meeting: when two partners agree a time, insert a row
-- for each of them with the same starts_at and room_url. Each person can only
-- read their own rows.
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  partner_name text,
  topic        text,
  starts_at    timestamptz not null,
  duration_min int not null default 50,
  room_url     text,
  created_at   timestamptz not null default now()
);
create index if not exists sessions_user_starts on public.sessions (user_id, starts_at);

-- ---------- auto-create a profile on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row level security ----------
alter table public.tracks   enable row level security;
alter table public.profiles enable row level security;
alter table public.waitlist enable row level security;
alter table public.matches  enable row level security;
alter table public.sessions enable row level security;
alter table public.partner_requests enable row level security;

drop policy if exists "tracks are public"          on public.tracks;
drop policy if exists "profiles are viewable"       on public.profiles;
drop policy if exists "insert own profile"          on public.profiles;
drop policy if exists "update own profile"          on public.profiles;
drop policy if exists "anyone can join the waitlist" on public.waitlist;
drop policy if exists "read own match"              on public.matches;
drop policy if exists "read own sessions"           on public.sessions;
drop policy if exists "book with your partner"      on public.sessions;
drop policy if exists "cancel a session"            on public.sessions;
drop policy if exists "read own requests"           on public.partner_requests;
drop policy if exists "send requests as yourself"   on public.partner_requests;
drop policy if exists "answer or mark seen"         on public.partner_requests;

create policy "tracks are public"
  on public.tracks for select using (true);

create policy "profiles are viewable"
  on public.profiles for select using (true);
create policy "insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Insert-only: no select policy means the list stays private to the owner.
create policy "anyone can join the waitlist"
  on public.waitlist for insert with check (true);

-- Users can read only their own match row (you insert rows as the owner).
create policy "read own match"
  on public.matches for select using (auth.uid() = user_id);

-- Same for sessions: you only ever see your own scheduled meetings.
create policy "read own sessions"
  on public.sessions for select using (auth.uid() = user_id);

-- Booking writes one row for each person, so you may insert a row for
-- yourself or for someone you have an accepted partner request with.
create policy "book with your partner"
  on public.sessions for insert with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.partner_requests r
      where r.status = 'accepted'
        and ((r.from_user = auth.uid() and r.to_user = sessions.user_id)
          or (r.to_user   = auth.uid() and r.from_user = sessions.user_id))
    )
  );

-- Cancelling removes both rows, so the same rule applies.
create policy "cancel a session"
  on public.sessions for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.partner_requests r
      where r.status = 'accepted'
        and ((r.from_user = auth.uid() and r.to_user = sessions.user_id)
          or (r.to_user   = auth.uid() and r.from_user = sessions.user_id))
    )
  );

-- Partner requests: visible to the two people involved, and only they can act.
create policy "read own requests"
  on public.partner_requests for select
  using (auth.uid() = from_user or auth.uid() = to_user);
create policy "send requests as yourself"
  on public.partner_requests for insert
  with check (auth.uid() = from_user);
-- Either side may update (recipient answers, sender marks the answer seen);
-- the guard trigger stops the sender from answering on their own behalf.
create policy "answer or mark seen"
  on public.partner_requests for update
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ---------- seed: the paths ----------
insert into public.tracks (id, name, career, sort) values
  ('frontend',      'Frontend Development',   'Frontend / web developer',      1),
  ('backend',       'Backend Development',    'Backend / software engineer',   2),
  ('cybersecurity', 'Cybersecurity',          'Security analyst / pentester',  3),
  ('data',          'Data & Analytics',       'Data analyst',                  4),
  ('mobile',        'Mobile Development',     'Mobile developer',              5),
  ('devops',        'DevOps & Cloud',         'DevOps / cloud engineer',       6),
  ('aiml',          'AI & Machine Learning',  'ML / AI engineer',              7),
  ('design',        'UX/UI Design',           'Product / UX designer',         8)
on conflict (id) do update set name = excluded.name, career = excluded.career, sort = excluded.sort;
