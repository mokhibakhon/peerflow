# Email

Until this, nothing left the building. Every notification was a row rendered by
the bell, so you found out your partner had proposed Tuesday the next time you
happened to open PeerFlow. For something that happens twice a week, that is not
a notification.

And underneath that, a worse one: **session events raised no notification at
all.** `notify_partner()` had been in the database since the MVP migration —
written, locked to real partnerships, granted — and was called from nowhere.
Proposing, accepting, declining and cancelling were all silent, bell included.

Both are fixed, in that order, because the second made the first invisible.

---

## What happens now

```
somebody proposes / accepts / declines / cancels
                │
                ▼
   trigger on public.sessions          ← in the database, so no page can
     note_session_proposed()             forget, and exactly one of the
     note_session_answered()             booking's two rows is the news
                │
                ▼
   row in public.notifications  ────────────────► the bell, immediately
                │
                ▼  (only if pg_net is installed)
   trigger dispatch_note_email()
                │  POST { id }
                ▼
   notify-email edge function
     claims the row (emailed_at)  ← so a retry or replay cannot send twice
     honours profiles.email_notify
     reads the address with the service role
                │
                ▼
             Resend
```

Two things worth knowing:

* **The whole email half is optional.** Without `pg_net`, the trigger is never
  created and every notification still lands in the bell. The migration says so
  in a `raise notice` rather than failing.
* **The request carries no secret and needs none.** The body is a notification
  id, and the function will only ever email that notification's own recipient,
  at the address on their account, once. A forged call can at most ask for an
  email that has already been sent, and claiming the row makes that a no-op.

Times are written in the reader's own clock, from `profiles.timezone` — telling
somebody in Tashkent that their partner proposed 14:00 UTC is telling them
nothing.

---

## Setting it up

### 1. Run the migration

Supabase → **SQL Editor** → paste the whole of `supabase/migration-notify.sql`
→ **Run**. Additive and safe to run more than once.

At this point the bell works for every session event. Email does not yet.

### 2. Turn on pg_net

```sql
create extension if not exists pg_net with schema extensions;
```

Then **re-run `migration-notify.sql`** — the email trigger is only created when
the extension is present, so it needs one more pass to pick it up.

### 3. Make a Resend account

[resend.com](https://resend.com). Add `peerflow.dev` as a domain and add the DNS
records it gives you. **Do this first** — verification waits on DNS, which can
take a while, and nothing else here does.

Then create an API key.

### 4. Give it to Supabase

```sh
supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  PF_MAIL_FROM='PeerFlow <hello@peerflow.dev>' \
  PF_SITE_URL=https://peerflow.dev
```

`PF_MAIL_FROM` has to be on the domain you verified. The other two have
sensible defaults but are worth setting explicitly.

### 5. Deploy

```sh
supabase functions deploy notify-email --no-verify-jwt
```

**`--no-verify-jwt` matters.** The caller is a Postgres trigger, which has no
Supabase session and cannot get one. The function is safe without it for the
reason above.

### 6. Check it

Propose a time from one account. The other should get the bell immediately and
an email shortly after. If the bell rings and no email arrives:

```sql
select title, created_at, emailed_at from public.notifications
 order by created_at desc limit 5;
```

* `emailed_at` **null** → the dispatch trigger never fired. `pg_net` is not
  installed, or step 2's re-run was missed.
* `emailed_at` **set** → the function ran. Check its logs in the Supabase
  dashboard; Resend's own dashboard shows anything it refused.

---

## Turning it off

Settings → **Email**. One button. The bell keeps working either way.

Badges never send email — a note to yourself about something you have just been
shown on screen is not worth one.

## What this does not do yet

**No reminder before a session.** "Your session with Asalxon starts in an hour"
would be the obvious next one, and it needs a scheduler — `pg_cron`, or a
Supabase scheduled function — because nothing writes a row at that moment for a
trigger to hang off.

**No digest, and no batching.** Four things happening in a minute send four
emails. With sessions happening twice a week that is not yet a problem.
