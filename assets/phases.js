/* The shape of a session: focus, break, focus.
 *
 * This file is deliberately pure. No DOM, no LiveKit, no clock of its own —
 * every answer is a function of the arguments it is given, so it can be run
 * over every minute of every session length in Node without a browser. The
 * test for it is dev/phases-tests.js.
 *
 * WHY THERE IS NO SYNCHRONISATION HERE
 *
 * A timer in a two-person call has to agree on both screens or it is worse
 * than useless, and the usual way to do that is to have one side own the
 * state and broadcast it — which needs a host, a message channel, and an
 * answer for what happens when somebody reconnects mid-break.
 *
 * None of that is necessary. call-token already hands both browsers the same
 * starts_at and ends_at, read from the booking in the same query that
 * authorised the join. So the phase is a function of the wall clock and two
 * fixed timestamps, and both sides compute it independently and cannot
 * disagree, because neither of them is deciding anything. Somebody who joins
 * twenty minutes late sees the correct phase with the correct time left,
 * immediately, without asking anyone.
 *
 * The cost of that is real and worth stating: nothing here can be paused or
 * skipped, because there is nowhere to put the fact that it was. If that is
 * wanted later it needs shared state, and the LiveKit data channel is already
 * granted (canPublishData) for it — but it should be a deliberate step up in
 * machinery, not something this file grows into quietly.
 */
(function(root){

  /* session_for_call closes the room twenty minutes after the booking ends,
     so that a call which started late is not cut off mid-sentence. That means
     ends_at is NOT the end of the session — it is the end of the grace. A
     schedule built from (ends_at - starts_at) would run a fifty-minute
     booking as seventy and put a break where the session had already
     finished. */
  /* Twenty is not a number this file gets to choose. It is the same twenty as
     the "interval '20 minutes'" that session_for_call() adds to closes in
     supabase/migrate-2026-08.sql, and unlike every other policy number in the
     product it has no pf_* function to read it from — so the two copies are
     held together by this comment and nothing else. Change one and change the
     other, or a fifty-minute booking starts running as seventy again. */
  var GRACE_MIN = 20;

  function bookedMinutes(startsAt, endsAt){
    var a = new Date(startsAt).getTime(), b = new Date(endsAt).getTime();
    if (!isFinite(a) || !isFinite(b)) return 0;
    return Math.max(0, Math.round((b - a) / 60000) - GRACE_MIN);
  }

  var FOCUS = 25;   /* one pomodoro */
  var BREAK = 5;
  /* Below this, a session is one sitting. Twenty-five and thirty minute
     bookings are already a single pomodoro; breaking them up would interrupt
     more than it would rest. */
  var SHORTEST_SPLIT = 30;
  /* A trailing block shorter than this is not worth being its own phase —
     five minutes of "focus" after a break is a countdown, not a session. */
  var STUB = 10;

  /* The blocks a booking of this length is made of, in order.

     The three lengths the app actually offers fall out as:
       25 -> 25
       50 -> 25 | 5 | 20
       80 -> 25 | 5 | 25 | 5 | 20
     which is why the durations were worth keeping as they are. Anything else
     degrades sensibly rather than being rejected. */
  function schedule(totalMin){
    var total = Math.max(0, Math.round(totalMin || 0));
    if (!total) return [];
    if (total <= SHORTEST_SPLIT) return [{ kind:'focus', min: total }];

    var out = [], left = total;
    while (left > SHORTEST_SPLIT) {
      out.push({ kind:'focus', min: FOCUS });
      out.push({ kind:'break', min: BREAK });
      left -= (FOCUS + BREAK);
    }
    out.push({ kind:'focus', min: left });

    /* Fold a runt final block back into the one before it, taking the break
       with it, rather than ending on something too short to use. An
       eighty-five minute booking should finish with one longer sitting, not
       with a five minute sprint. */
    var last = out[out.length - 1];
    if (out.length >= 3 && last.min < STUB) {
      var brk = out[out.length - 2];
      out.splice(out.length - 2, 2);
      out[out.length - 1].min += brk.min + last.min;
    }
    return out;
  }

  /* Where the session is at a given instant.

     Returns the same shape whatever the answer, so callers never have to
     check which fields exist:

       state    'before' | 'running' | 'after'
       kind     'focus' | 'break'  (null unless running)
       index    which block, 0-based, and count of them
       endsAt   when this block ends, ms  (or when the session starts/ended)
       leftMs   how long is left of it

     `now` is passed in rather than read, so a test can walk a whole session
     minute by minute and so the two browsers are demonstrably running the
     same function over the same numbers. */
  function at(now, startsAt, totalMin){
    var start = new Date(startsAt).getTime();
    var blocks = schedule(totalMin);
    var total = 0;
    for (var i = 0; i < blocks.length; i++) total += blocks[i].min;
    var end = start + total * 60000;

    if (!blocks.length || !isFinite(start)) {
      return { state:'after', kind:null, index:-1, count:0, endsAt:start, leftMs:0, blocks:blocks };
    }
    if (now < start) {
      return { state:'before', kind:null, index:-1, count:blocks.length,
               endsAt:start, leftMs:start - now, blocks:blocks };
    }
    if (now >= end) {
      return { state:'after', kind:null, index:blocks.length, count:blocks.length,
               endsAt:end, leftMs:0, blocks:blocks };
    }

    var edge = start;
    for (var j = 0; j < blocks.length; j++) {
      var stop = edge + blocks[j].min * 60000;
      if (now < stop) {
        return { state:'running', kind:blocks[j].kind, index:j, count:blocks.length,
                 endsAt:stop, leftMs:stop - now, blocks:blocks };
      }
      edge = stop;
    }
    /* Unreachable: now < end was checked above, so some block contains it. */
    return { state:'after', kind:null, index:blocks.length, count:blocks.length,
             endsAt:end, leftMs:0, blocks:blocks };
  }

  /* How many focus blocks there are, and which one this is — for "focus 2 of
     3", which is the only numbering worth showing. Breaks are not counted:
     nobody thinks of themselves as being on break three. */
  function focusNumber(blocks, index){
    var n = 0, of = 0, mine = 0;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].kind !== 'focus') continue;
      of++;
      if (i === index) mine = of;
    }
    n = mine;
    return { n: n, of: of };
  }

  root.pfPhases = { schedule: schedule, at: at, bookedMinutes: bookedMinutes,
                    focusNumber: focusNumber, GRACE_MIN: GRACE_MIN };

  /* Node loads this file too, so dev/phases-tests.js exercises the real thing
     rather than a copy of it that drifts out of step. The browser gets
     window.pfPhases either way. */
  if (typeof module !== 'undefined' && module.exports) module.exports = root.pfPhases;
})(typeof window !== 'undefined' ? window : globalThis);
