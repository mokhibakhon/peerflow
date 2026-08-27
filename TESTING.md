# Testing PeerFlow with two accounts

Two people, **Mokhibakhon** and **Munisa**. Work top to bottom — later sections
assume the earlier ones passed.

Anything that fails: open DevTools (F12) → Console. Every database error is
logged there in full, and the page only ever shows a plain sentence. Send me
the console line, not the sentence — the sentence is deliberately vague.

---

## 0. Before you start

- [ ] **Bring the database up to date.** Open
      https://raw.githubusercontent.com/mokhibakhon/peerflow/main/supabase/migrate-2026-08.sql
      → select all → copy → Supabase → SQL Editor → paste → Run. It should say
      *"Success. No rows returned"*. Safe to run twice: every statement in it is
      guarded, so if you have already run some of these separately this changes
      nothing that is already correct.

      This line used to point at `schema.sql` and tell you to check the paste
      contained `answer_session`. That was right when it was written and has
      been wrong for a year: `schema.sql` is the beginning, and the goal, the
      plan, attendance, reschedule, dormancy, notifications and the move off
      Jitsi all landed as separate migrations afterwards. Running it alone
      leaves every one of those out, and each fails quietly rather than loudly —
      which is exactly the kind of thing this script is supposed to catch.
- [ ] **Two separate browser profiles.** One normal window, one incognito — or
      two different browsers. **Not two tabs.** Supabase keeps the session in
      localStorage, which tabs share, so two tabs are one account wearing two
      hats. This is very likely what made both accounts say "You proposed".
- [ ] **Clear old test rows.** Supabase → Table Editor → `sessions` → delete
      every row. Earlier testing ran against the half-broken version, so
      anything still in there is in a state the app can't produce any more.
- [ ] Decide which window is which and keep it that way. Below,
      **M** = Mokhibakhon, **N** = Munisa.

---

## 1. Signing in

- [ ] **M:** log in. Lands on Sessions, name in the top-right chip.
- [ ] **N:** log in, other window. Chip shows *Munisa*, not *Mokhibakhon*.
      If it shows the wrong name, you're in one session — go back to step 0.
- [ ] **M:** wrong password on purpose → red banner *"Uh-oh! Your email or
      password is incorrect."*, both boxes cleared.
- [ ] **M:** a made-up address with any password → **the same banner**. It must
      not hint that the address is unknown.
- [ ] **M:** Forgot password → Send reset link → email arrives → link opens the
      new-password page → set one → lands signed in.
- [ ] Click the same reset link a second time → *"That link has expired."*
- [ ] Log out. **One click.** If it takes two, tell me.

## 2. Profile

- [ ] **Both:** Profile → first and last name save and come back after refresh.
- [ ] **Both:** set a topic. Use **the same topic on both accounts** — the
      People page ranking and the shared-window chips need it.
- [ ] **Both:** set free times. Give them **at least two windows in common**
      (e.g. both tick Tue evening and Thu evening), or nothing later works.
- [ ] Tick **I'm free any time** → whole grid fills, chip turns green, the line
      below reads *"Free any time…"*.
- [ ] Untick one cell → the chip releases on its own.
- [ ] Save, refresh → the grid comes back as you left it.

## 3. People

- [ ] **M:** People. Munisa appears. If you set the same topic, she's the top
      card with **Same topic** among the facts.
- [ ] The card's facts are true — check the timezone and stage against her
      profile.
- [ ] The table under it lines up, and the **Schedules** column reads
      *"N times you're both free"*, matching the windows you actually share.
- [ ] Send request → box opens → type a note → Send → row becomes **Asked**.
- [ ] **N:** bell shows **1**, panel says *Mokhibakhon wants to learn with you*
      with your note.
- [ ] **N:** Accept. **M:** refresh → row reads **Partners**.

## 4. Proposing a time — the important part

Check **both windows** after every step. Half of these bugs only show on the
side that didn't click.

- [ ] **M:** Sessions. The **Propose a time** card reads as a sentence:
      *"Meet Munisa on Tuesday, 4 Aug at 5:00 PM for 50 minutes."*
- [ ] Under it: *"You're both free in the evening that day."*
- [ ] Press the day. Menu lists **only** the days you both ticked, with the
      date on the right — not `tue-evening`, not a blank list.
- [ ] Press the time. Top group is the band you share; **Any other time**
      below it is dimmed. Pick a dimmed one → the line turns amber and names
      Munisa. Put it back.
- [ ] **M:** set a time, add a note, **Propose this time**.
      → *"Sent — waiting on Munisa."*
      → a card: *"You proposed …"* with **Waiting on Munisa** and **Cancel**.
- [ ] **M:** the **Booked** heading is still absent. **A proposal is not a
      booking.**
- [ ] **N:** refresh → bell shows **1** → panel: *Mokhibakhon proposed …* with
      the note → **Answer it** goes to **Sessions** (not Partner) and the card
      is right there with Accept / Decline / Suggest another time.
- [ ] **N:** dashboard headline reads *"Mokhibakhon proposed a time."*

### 4a. Accept

- [ ] **N:** Accept → lands on Sessions showing *"Next session in N days"*.
- [ ] **M: refresh** → **also** shows the booked session, not a pending
      proposal. *(This is the one that was broken.)*
- [ ] Both: it's under **Booked** in the Sessions card.
- [ ] Both: no Join button yet — it says the room opens 15 minutes before.
- [ ] Opening `call.html?s=<the session id>` early says *"the room opens
      fifteen minutes before you start"* and tells you how long to wait.
- [ ] **N:** bell count drops.

### 4b. Cancel

- [ ] **M:** propose again. **M:** Cancel → button turns red and asks
      *"Sure? Cancel it"*. Click somewhere else on the card → it backs out.
- [ ] **M:** Cancel → confirm → card disappears.
- [ ] **N: refresh** → gone from her side too, nothing left over.
      *(This is the one you found.)*

### 4c. Decline

- [ ] **M:** propose. **N:** Decline → asks *"Sure? Turn it down"* → confirm.
- [ ] **N:** the card disappears — she already knows.
- [ ] **M: refresh** → amber card *"Munisa can't do …"* with **Propose another
      time** and **Dismiss**. Bell shows it. Headline: *"Munisa can't make
      that time."*
- [ ] **M:** Dismiss → gone. **N: refresh** → gone there too.

### 4d. Suggest another time

- [ ] **M:** propose. **N:** Suggest another time.
      → her form fills with M's date, time and length
      → note reads *"Their time is off the table…"*
- [ ] **N:** move it to a different day, send.
- [ ] **M: refresh** → sees both: the decline **and** Munisa's new proposal.
- [ ] **M:** Accept → booked on both sides.

### 4e. Edge cases (M's form)

- [ ] **Any other day…** at the foot of the day menu: pick a date, **Use this
      day** → the sentence moves to it and the line turns amber.
- [ ] That date field will not offer a day before today.
- [ ] Pick today, then an hour that has already gone → **Propose this time**
      → *"That's in the past — pick a future time."*
- [ ] A time in no shared window → amber warning naming Munisa, but
      **Propose still works**. It's a note, not a block.
- [ ] **Two partners:** the sentence starts *"Meet <name>"* as a menu. With
      only one partner it's plain text, not a menu with one row in it.
- [ ] Switch partner → the day and time jump to a window *that* partner
      shares.

## 5. The call

This is the section that was missing, and it is the one worth doing first if
you only do one. Everything above it can pass on a site where nobody can
actually meet — the steps in section 4 check that Join is correctly *absent*
until fifteen minutes before, and then stop. Video needs a LiveKit project and
two deployed functions (**[docs/VIDEO.md](docs/VIDEO.md)**), none of which this
repository can do for you and none of which anything else here would notice
were missing.

- [ ] **The tell.** If Join says *"Calls are not set up on this site yet"*,
      stop — LiveKit is not configured, and the rest of this section cannot
      pass. Nothing is broken in the code; steps 2 to 5 of `docs/VIDEO.md`
      have not been done.
- [ ] Book a session for **fifteen minutes from now** (section 4a), so you are
      not waiting on the clock.
- [ ] **M:** Join from Today → the lobby, with your own camera in the preview.
      The preview is mirrored, on purpose.
- [ ] Mic and Camera toggles both read *on*. Turn the camera off → the preview
      goes to *Camera off*, not to a frozen frame or a black rectangle.
- [ ] Camera and Microphone pickers list your real devices.
- [ ] **M:** Join the call → the room. Your partner's tile says
      *Waiting for Munisa…*, yours sits in the corner.
- [ ] **N:** Join from the other window → **each of you sees the other**. This
      is the whole product; if it fails, nothing above it matters.
- [ ] The bar carries Mic, Camera, Share and Sound. Share your screen → the
      other window shows it and the tile switches to fitting the whole screen
      rather than filling the tile.
- [ ] Report is there. The code of conduct promises report and block *"whether
      or not you're still on the call"*, so it has to be reachable from inside
      one.
- [ ] **Both:** Leave.
- [ ] Attendance was recorded — this is the webhook, and it fails silently:

      ```sql
      select user_id, attended, joined_at, left_at, status
        from public.sessions
       where room_name is not null
       order by starts_at desc limit 4;
      ```

      `attended` still null after a call you both joined means LiveKit's
      webhook is not arriving. `docs/VIDEO.md` steps 4 and 5, in that order.
      Everything on screen will have looked perfect.

## 6. Email

The bell is **not** evidence. `supabase/migration-notify.sql` says it outright
— *"In-app works with no email set up at all"* — so a working bell tells you
nothing about whether anybody who is not currently looking at the app ever
hears from it. That is the whole point of email here: the partner who proposed
a time is not sitting in the tab waiting.

- [ ] **M:** propose a time to N (section 4).
- [ ] **N:** the bell rings **immediately**. That much works with no email set
      up at all, so do not stop here.
- [ ] **N:** an email arrives shortly after, to the address on the account.
- [ ] If the bell rang and no email came, this says which half is missing:

      ```sql
      select title, created_at, emailed_at from public.notifications
       order by created_at desc limit 5;
      ```

      `emailed_at` **null** → the dispatch trigger never fired: `pg_net` is not
      installed, or step 2 of `docs/EMAIL.md` was missed. `emailed_at`
      **set** → the function ran and something downstream refused it; the
      function's logs are in the Supabase dashboard and Resend's dashboard
      shows what it rejected.

## 7. Things that should NOT happen

- [ ] No **Start the call** button on the Partner page at any point.
- [ ] The Partner page has **no** booking form — only who your partner is, and
      a link across to Sessions.
- [ ] Signed out, the landing page shows **no** account letter top-right.
- [ ] With nothing proposed and nothing booked, the whole **Sessions** card is
      gone — not an empty card with a heading on it.
- [ ] A proposal never appears under **Booked**.
- [ ] **People page:** *Asked*, *Partners*, *Declined*, *Waiting on you* and
      *Send request* are all the same size and weight in the table.

## 8. Speed

- [ ] Hard-refresh Sessions (Ctrl/Cmd+Shift+R). Text should appear almost at
      once, then the cards fill in. If text itself is slow, tell me.
- [ ] DevTools → Network → reload → count requests to `/auth/v1/user`.
      Should be **none**. That was the slow bit.

---

## When something fails

Say which step, which account, and paste the **console** line. "Step 4a, Munisa
accepted, M still shows the proposal after refresh" is enough to find it.
