-- ============================================================
-- PeerFlow database schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- ============================================================

-- ---------- tracks ----------
create table if not exists public.tracks (
  id     text primary key,
  name   text not null,
  career text not null,
  sort   int  not null default 0
);

-- ---------- profiles (one per auth user) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '',
  track_id     text references public.tracks(id),
  level        text check (level in ('new','tutorials','builder','jobprep')),
  goal         text check (goal in ('job','studies','switch')),
  timezone     text,
  availability jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- sessions ----------
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  track_id     text references public.tracks(id),      -- null = all tracks
  kind         text not null default 'silent' check (kind in ('silent','collaborative')),
  starts_at    timestamptz not null,
  duration_min int  not null default 110,
  capacity     int  not null default 8,
  meet_url     text not null default 'https://meet.google.com/new',
  host_id      uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- ---------- session membership ----------
create table if not exists public.session_members (
  session_id uuid references public.sessions(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  goal_text  text not null default '',
  goal_done  boolean,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

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
alter table public.tracks          enable row level security;
alter table public.profiles        enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_members enable row level security;

drop policy if exists "tracks are public"            on public.tracks;
drop policy if exists "profiles are viewable"        on public.profiles;
drop policy if exists "insert own profile"           on public.profiles;
drop policy if exists "update own profile"           on public.profiles;
drop policy if exists "sessions are viewable"        on public.sessions;
drop policy if exists "authed users create sessions" on public.sessions;
drop policy if exists "host updates own session"     on public.sessions;
drop policy if exists "members are viewable"         on public.session_members;
drop policy if exists "join sessions as yourself"    on public.session_members;
drop policy if exists "update own membership"        on public.session_members;
drop policy if exists "leave sessions"               on public.session_members;

create policy "tracks are public"
  on public.tracks for select using (true);

create policy "profiles are viewable"
  on public.profiles for select using (true);
create policy "insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "sessions are viewable"
  on public.sessions for select using (true);
create policy "authed users create sessions"
  on public.sessions for insert with check (auth.uid() = host_id);
create policy "host updates own session"
  on public.sessions for update using (auth.uid() = host_id);

create policy "members are viewable"
  on public.session_members for select using (true);
create policy "join sessions as yourself"
  on public.session_members for insert with check (auth.uid() = user_id);
create policy "update own membership"
  on public.session_members for update using (auth.uid() = user_id);
create policy "leave sessions"
  on public.session_members for delete using (auth.uid() = user_id);

-- ---------- seed: the 8 tracks ----------
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

-- ---------- seed: a first week of sessions ----------
-- Creates sessions for tonight and the next 6 evenings so the board is
-- never empty. Re-running only adds sessions if none exist in the future.
do $$
declare
  d int;
  base timestamptz;
begin
  if not exists (select 1 from public.sessions where starts_at > now()) then
    for d in 0..6 loop
      base := date_trunc('day', now()) + (d || ' days')::interval;
      insert into public.sessions (title, track_id, kind, starts_at, duration_min, capacity) values
        ('Silent co-work · focus room',            null,            'silent',        base + interval '18 hours', 110, 8),
        ('CTF night — web challenges',             'cybersecurity', 'collaborative', base + interval '19 hours',  90, 6),
        ('Pair programming — React components',    'frontend',      'collaborative', base + interval '20 hours',  90, 4),
        ('SQL practice — window functions',        'data',          'collaborative', base + interval '21 hours',  90, 6),
        ('Late silent co-work · night owls',       null,            'silent',        base + interval '22 hours', 110, 8);
    end loop;
  end if;
end $$;
