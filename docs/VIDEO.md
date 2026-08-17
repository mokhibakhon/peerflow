# The call

PeerFlow used to hand you a link to a public Jitsi address and open it in
another tab. Anybody holding the URL could walk in, and PeerFlow saw nothing
at all — not who joined, not when, not for how long. That is why reliability
has never shown a number, and why the session count on the dashboard is
really a count of bookings whose time has passed.

The room is ours now. It runs on LiveKit, nobody gets in without a signed
token, and the only thing that mints one is an edge function that asks the
database whether the person in front of it is allowed in.

**None of it works until you do the six things below.** Until then the app
still behaves: pressing Join says *"Calls are not set up on this site yet"*
rather than failing strangely.

---

## What talks to what

```
    browser                    Supabase                     LiveKit
 ───────────                ────────────                  ──────────

 call.html ──── which session? ────► call-token
                                        │
                                        │ session_for_call()   ← the five checks
                                        │ (runs as YOU, not as
                                        │  a service key)
                                        ▼
                                     a signed token ─────────► join the room
                                                                    │
 sessions.attended  ◄──── record_presence() ◄── livekit-webhook ◄────┘
 sessions.joined_at                              (verifies LiveKit's
 sessions.left_at                                 signature first)
```

Two things are worth noticing:

* **The browser never says which room it wants.** It sends a session id; the
  room name comes out of the booking. There is nothing to guess and nothing
  to type your way into.
* **`call-token` never holds the service role key.** It forwards your own
  JWT to Postgres, so `auth.uid()` is you and normal RLS applies. Only the
  webhook holds the service role, because it writes on behalf of two people
  neither of whom is making the request.

---

## 1. Run the migration

In the Supabase SQL editor, run `supabase/migration-video.sql`.

It is additive and safe to run twice. It adds `sessions.room_name` and
`sessions.left_at`, backfills a room name for every existing per-booking
session, and creates three functions: `session_for_call`, `record_presence`
and `close_room`.

Bookings from the very old days — when one room was shared by every session
with the same partner — are deliberately left without a room name. Those say
*"this one was booked before PeerFlow had its own room"* rather than dropping
several different sessions into one place.

## 2. Get LiveKit keys

Make a project at [LiveKit Cloud](https://cloud.livekit.io) (the free tier is
enough for testing and for a first cohort — check the current limits, they
move). You need three values from it:

| Value | Looks like |
|---|---|
| API key | `APIxxxxxxxxxxxx` |
| API secret | a long random string |
| Server URL | `wss://your-project.livekit.cloud` |

Self-hosting LiveKit works exactly the same way — only the URL changes.

## 3. Give them to Supabase

```sh
supabase secrets set \
  LIVEKIT_API_KEY=APIxxxxxxxxxxxx \
  LIVEKIT_API_SECRET=your-secret \
  LIVEKIT_URL=wss://your-project.livekit.cloud
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
already there — Supabase injects those into every function.

## 4. Deploy the two functions

```sh
supabase functions deploy call-token
supabase functions deploy livekit-webhook --no-verify-jwt
```

**The `--no-verify-jwt` matters.** LiveKit has no Supabase session and cannot
get one, so if Supabase checks for a JWT the webhook is rejected before our
code can look at it — and attendance silently never gets written, which is
the one failure here that looks like nothing is wrong. The function
authenticates itself instead: it verifies LiveKit's own signature over the
exact request body before believing a single field.

## 5. Point LiveKit at the webhook

In the LiveKit project settings, add a webhook pointing at:

```
https://<your-project-ref>.supabase.co/functions/v1/livekit-webhook
```

Three events are used. `participant_joined` and `participant_left` fill
`attended`, `joined_at` and `left_at`; `room_finished` closes the room, which
is when a row still holding no attendance becomes a recorded no-show —
observed, not asked.

## 6. Check it

Book a session with a second account, wait until fifteen minutes before the
start, and press Join from Today. You should get the lobby, see yourself,
and land in the room.

Then look at the row:

```sql
select user_id, attended, joined_at, left_at, status
  from public.sessions
 where room_name = 'pf-…';
```

If `attended` is still null after a call, the webhook is not arriving —
check step 4 and step 5 in that order.

---

## When somebody cannot get in

Every refusal is a word from `session_for_call()`, and `call.js` turns it
into a sentence. If you are debugging, these are the words:

| Reason | Means |
|---|---|
| `too-early` | more than fifteen minutes before the start |
| `too-late` | more than twenty minutes after the end |
| `proposed` | nobody has accepted the time yet |
| `cancelled` / `declined` | the session was called off |
| `not-partners` | the partnership ended, so the sessions closed with it |
| `no-room` | booked before this migration, no room name |
| `unknown` | not your session, or not a session (the same answer on purpose) |
| `not-configured` | the keys in step 3 are missing |
| `not-deployed` | step 4 has not been done |

The window is fifteen minutes before the start until twenty minutes after the
end. The twenty minutes exist so a call that started late is not cut off
mid-sentence — not so a session can be planned around them.

---

## What this does not do yet

**The streak still counts bookings, not attendance.** `finished()` in
`assets/db.js` counts a session if it was confirmed and its time has passed.
Now that `attended` is real, that rule could tighten — but it would make some
people's streaks fall, so it is a decision rather than a clean-up and it has
not been made.

**There is no waiting room and no moderation.** Two people who agreed to meet
are the only two people who can be in the room, so there is nobody to admit
and nobody to remove. If group sessions ever happen, that changes.

**Nothing is recorded.** No LiveKit recording is configured, and the token
grants no `roomRecord` permission.
