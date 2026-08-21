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

## Already set this up?

Two things changed after the first version, and both need a step from you:

* **Re-run `supabase/migration-notify.sql`.** Two of the four headlines were
  reworded — "Sarah proposed a session time" and "Sarah declined that time".
  Everything in there is `create or replace`, so re-running is safe and
  changes nothing else.
* **Re-deploy the function.** `supabase functions deploy notify-email
  --no-verify-jwt`. The template is new: a proper branded layout instead of a
  bare `<div>`.

Nothing else moves. The Resend key, the domain and the pg_net trigger are all
unchanged.

## Setting it up

### 1. Run the migration

Supabase → **SQL Editor** → paste the whole of `supabase/migration-notify.sql`
→ **Run**. Additive and safe to run more than once.

At this point the bell works for every session event. Email does not yet.

This was not true when it was written, and it is worth saying why. The rows
landed in `public.notifications` correctly — but nothing read that table.
`assets/notify.js` built the panel entirely from `myRequests()` and
`fetchSessions()`, so the bell you saw working after step 1 was an older,
derived one that had worked all along, and every row these triggers wrote was
invisible. The panel reads the table now, in its **Recent** half.

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

Every message also carries a `List-Unsubscribe` header, so Gmail and Apple Mail
show their own Unsubscribe control next to the sender and it lands on Settings.
Deliberately *without* `List-Unsubscribe-Post: One-Click`: that header promises
a POST endpoint that unsubscribes with no further interaction, and
`app-settings.html` is a static page that would accept the POST and do nothing.
Claiming a control that does not work is worse than not claiming it.

Badges never send email — a note to yourself about something you have just been
shown on screen is not worth one. The guard for that checked `kind = 'badge'`
and the only thing that writes a self-note writes `'achievement'`, so it never
fired; it takes both now.

## What the email looks like

`dev/email-preview.js` renders it without sending one:

    node dev/email-preview.js        # writes dev/email-preview.html — open it

It lifts the template straight out of `supabase/functions/notify-email/index.ts`
rather than keeping a copy, and renders all four notifications the triggers
actually raise, HTML and plain text side by side. Open it before changing any
wording; the frame has to hold a long topic line and a bare headline without
either looking wrong.

The layout is nested tables rather than divs, because Outlook on Windows
renders through Word and has no flexbox. Colours are stated on every element,
because Gmail and Outlook dark mode invert what they are not told. There is a
hidden preheader line at the top of the body, which is what Gmail shows next
to the subject in the inbox list — without one it shows whatever text comes
first, which would be the logo's alt text.

### The logo

`assets/email-logo.png` — the dark-band lockup, 630×630/3 px, served from
`https://peerflow.dev/assets/email-logo.png` and displayed at 158×42.

It has to be a hosted PNG. Inline SVG is stripped by Gmail and Outlook, and
base64 `data:` URIs are stripped by Gmail, so a file on the site is the only
thing that arrives. It sits on a green band whose colour is set with both
`bgcolor` and CSS, so a client that blocks images still shows a branded header
with the word PeerFlow in it via the alt text.

Rebuild it after a logo change with the script in the commit that added it —
Chromium screenshotting the same SVG the site uses, at 3× so it stays sharp on
a phone.

### The logo *beside the sender*, in the inbox list

This is a different thing, and it is not free. The round avatar Gmail shows
next to a sender's name comes from **BIMI**, and Gmail will only display one
when all of the following are true:

1. SPF and DKIM pass and are aligned — Resend's domain verification does this,
   so this part is already done.
2. **DMARC is at `p=quarantine` or `p=reject`**, not `p=none`. A DNS TXT record
   at `_dmarc.peerflow.dev`. Free, and worth doing on its own merits: it stops
   anyone spoofing the domain and it helps deliverability.
3. A square logo in **SVG Tiny Portable/Secure** — a restricted SVG profile,
   not any SVG — hosted over HTTPS, named in a TXT record at
   `default._bimi.peerflow.dev`. Free.
4. A **Verified Mark Certificate** from DigiCert or Entrust, named in the same
   record. This is the wall: a VMC requires a *registered trademark* for the
   PeerFlow name and costs roughly $1,000–1,500 a year. Apple Mail wants one
   too.

So: steps 1–3 are worth doing whenever, and step 4 is not worth doing at this
stage. Without the VMC most clients simply show the default coloured initial,
which is what happens today.

One free approximation, Gmail only: Gmail shows the Google profile photo of a
sender that has a Google account on that address. If `hello@peerflow.dev` is
ever set up as a Google Workspace user, setting its profile picture gets the
logo in front of Gmail recipients without any of the above. It is not
guaranteed and it does nothing for other clients, but it costs nothing beyond
the mailbox.

## What this does not do yet

**No reminder before a session.** "Your session with Asalxon starts in an hour"
would be the obvious next one, and it needs a scheduler — `pg_cron`, or a
Supabase scheduled function — because nothing writes a row at that moment for a
trigger to hang off.

**No digest, and no batching.** Four things happening in a minute send four
emails. With sessions happening twice a week that is not yet a problem.
