-- PeerFlow — the photo somebody signed in with, visible where they are listed.
--
-- Run this in Supabase -> SQL Editor. Safe to run more than once.
-- After running it, `node dev/migration-check.js` should come back clean.
--
-- WHY THIS IS A COLUMN AND NOT A READ
--
-- The account menu has shown a real photo since Google sign-in was added, and
-- the People list has always shown an initial. That looked like a rendering
-- bug and is not one: the menu reads user_metadata.avatar_url off YOUR OWN
-- auth session, and an ordinary member cannot read anybody else's auth record.
-- So the photo was never missing from the People page — it was never reachable
-- from there.
--
-- The only way one member sees another's photo is if it is on a row that
-- members are allowed to read, which is public.profiles. Hence a column.
--
-- WHAT IS STORED
--
-- A URL, and nothing else. No image is copied, uploaded or re-hosted; the
-- browser fetches it from Google exactly as it already does for the account
-- menu, and vercel.json's img-src already allows lh3.googleusercontent.com for
-- that reason. Somebody who signed up with an email address and a password has
-- no photo anywhere, so their column is null and every surface keeps drawing
-- the initial it draws today.
--
-- WHAT IT MEANS FOR PRIVACY
--
-- It widens what other members see about you, so privacy.html says so in the
-- same paragraph that already lists your name, path, timezone and hours. That
-- is the honest place for it: a photo is more personal than a timezone, and
-- "visible to other members" is a promise the page makes explicitly rather
-- than by implication.
--
-- It is a link to a picture the account holder chose as their public face on
-- Google, on a product whose entire premise is meeting that person on camera.
-- That is the argument for it being reasonable; it is not an argument for
-- doing it quietly.

alter table public.profiles add column if not exists avatar_url text;

-- A URL and a plausible one. Length is bounded because nothing here should
-- ever be a data: URI — that would be an image pasted into a text column that
-- every reader of the table then downloads.
alter table public.profiles drop constraint if exists profiles_avatar_is_url;
alter table public.profiles add constraint profiles_avatar_is_url
  check (avatar_url is null
         or (avatar_url ~ '^https://' and length(avatar_url) <= 512));

-- ---------- new accounts ----------
-- Same trigger, one more field. Google puts the photo in avatar_url and some
-- providers use picture, so both are tried in the order Supabase populates
-- them; an email signup has neither and gets null.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', ''),
          nullif(coalesce(new.raw_user_meta_data->>'avatar_url',
                          new.raw_user_meta_data->>'picture', ''), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- the accounts that already exist ----------
-- Everyone who signed in with Google before this file was written already has
-- a photo in their auth record and an empty column, so the trigger alone would
-- leave the feature working for nobody currently using the site.
--
-- Written as an update from auth.users rather than left to the client, because
-- the client can only ever fix the row of whoever happens to sign in next: one
-- person opening the People page would see themselves appear and everybody
-- else stay an initial, which is the shape of a bug rather than of a feature
-- arriving.
--
-- Only fills what is empty. Re-running this must not overwrite a URL that
-- syncAvatar has since refreshed.
update public.profiles p
   set avatar_url = nullif(coalesce(u.raw_user_meta_data->>'avatar_url',
                                    u.raw_user_meta_data->>'picture', ''), '')
  from auth.users u
 where u.id = p.id
   and coalesce(p.avatar_url, '') = ''
   and coalesce(u.raw_user_meta_data->>'avatar_url',
                u.raw_user_meta_data->>'picture', '') <> ''
   and coalesce(u.raw_user_meta_data->>'avatar_url',
                u.raw_user_meta_data->>'picture', '') like 'https://%';

-- ---------- keeping it current ----------
-- Google's photo URLs change when somebody changes their picture, and a stale
-- one 404s into a broken image. db.js calls this on load when the URL it holds
-- for the signed-in account differs from the one in the session.
--
-- It writes one row — the caller's own — and takes the URL as an argument
-- rather than reading auth.users, so it cannot be used to write anybody else's
-- row and cannot be asked about one either. security definer only because the
-- column has a check constraint worth enforcing centrally; the where clause is
-- what makes it safe.
create or replace function public.set_my_avatar(p_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  /* Null and empty both mean "no photo", which is a real state: somebody who
     removes their Google picture should stop showing one here. */
  if p_url is null or p_url = '' then
    update public.profiles set avatar_url = null where id = auth.uid();
    return;
  end if;
  if p_url !~ '^https://' or length(p_url) > 512 then
    return;
  end if;
  update public.profiles set avatar_url = p_url where id = auth.uid();
end;
$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
