-- ============================================================
-- PeerFlow database schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- ============================================================

-- ---------- tracks ----------
-- We're starting with cybersecurity. Add more rows here as fields go live.
create table if not exists public.tracks (
  id     text primary key,
  name   text not null,
  career text not null,
  sort   int  not null default 0
);

-- ---------- profiles (one per auth user) ----------
-- track_id and availability are set at signup; level and goal are filled in
-- later from the app's optional "improve my match" prompt.
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

drop policy if exists "tracks are public"          on public.tracks;
drop policy if exists "profiles are viewable"       on public.profiles;
drop policy if exists "insert own profile"          on public.profiles;
drop policy if exists "update own profile"          on public.profiles;
drop policy if exists "anyone can join the waitlist" on public.waitlist;
drop policy if exists "read own match"              on public.matches;

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

-- ---------- seed: the live track ----------
insert into public.tracks (id, name, career, sort) values
  ('cybersecurity', 'Cybersecurity', 'Security analyst / pentester', 1)
on conflict (id) do update set name = excluded.name, career = excluded.career, sort = excluded.sort;
