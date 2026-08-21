/* Whether somebody turns up, and what that is worth.
 *
 * This file is deliberately pure, for the same reason assets/phases.js is: no
 * DOM, no database, no clock of its own. Every answer is a function of the
 * arguments, so the whole thing can be walked exhaustively in Node without a
 * browser. The test for it is dev/reliability-tests.js.
 *
 * WHY IT EXISTS AT ALL, GIVEN THE SCORE IS COMPUTED IN SQL
 *
 * reliability_of() in supabase/migration-attendance.sql is the authority, and
 * it has to be: a score computed in a browser is a score anybody can edit, and
 * the rows it is made of are not readable about other people anyway. Nothing
 * here is ever used to decide somebody's number.
 *
 * What the browser genuinely needs is the rest of it:
 *
 *   * the words in front of the number, which are a product decision and not
 *     a database one;
 *   * whether pressing Cancel right now is an early cancellation or a late
 *     one, so the button can say so BEFORE it is pressed rather than the
 *     consequence arriving afterwards — which is the single most useful thing
 *     this whole feature does for somebody who cannot make a session;
 *   * what a finished session's outcome is going to settle as, so the
 *     dashboard can tell "we have not decided yet" from "nobody turned up";
 *   * a readable copy of the formula, in one place, that somebody changing
 *     the policy can read without knowing plpgsql.
 *
 * So the rule is: the numbers and the thresholds are stated once, here and in
 * the migration, and dev/reliability-tests.js and dev/sql-tests.sh assert the
 * same fixtures against both. If the two ever disagree, one of those two
 * suites goes red, which is the only way a duplicated constant is ever safe.
 */
(function(root){

  /* ---------- the policy ----------
     Every number the feature turns on. Mirrors the pf_* functions in
     supabase/migration-attendance.sql one for one, deliberately with the same
     values in the same order, so the two files can be read side by side. */
  var POLICY = {
    /* Cancel with at least this much notice and it costs nothing. */
    cancelNoticeHours: 6,
    /* How long after the start somebody can still be arriving — and, once
       they have, the line between on time and late. */
    graceMinutes: 10,
    /* How many recent outcomes the score is made of. */
    window: 20,
    /* Below this many graded sessions there is no percentage, only the
       words "New partner". */
    minGraded: 3,
    /* Each older session counts this much of the one after it. */
    decay: 0.9,
    /* Two invisible sessions at 85%, which is what stops one bad week
       reading as 40% and stops three tidy sessions reading as 100%. */
    priorWeight: 2,
    priorScore: 0.85,
    /* Three misses inside thirty days pauses new partner requests for a
       week. Nothing else. */
    noShowDays: 30,
    noShowLimit: 3,
    cooldownDays: 7
  };

  var HOUR = 3600000, MINUTE = 60000, DAY = 86400000;

  /* ---------- the five outcomes ----------

     attended         they were in the room
     cancelled_early  called off with at least six hours' notice
     cancelled_late   called off inside six hours
     no_show          the room was open, they were not in it, and they had
                      said nothing
     excused          nothing was asked of them — the other person called it
                      off first, or the partnership ended before the day came

     null is not a sixth outcome. It means undecided, and a great many
     sessions stay there for ever: everything from before PeerFlow owned the
     call, and everything nothing was watching. */
  var OUTCOMES = ['attended', 'cancelled_early', 'cancelled_late', 'no_show', 'excused'];

  function ms(v){
    if (v === null || v === undefined || v === '') return null;
    var t = (v instanceof Date) ? v.getTime() : new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  /* Early or late, drawn in exactly one place.

     A cancellation with no timestamp is treated as early. Those are rows from
     before migration-mvp.sql added cancelled_at, and when the evidence is
     missing the direction to be wrong in is the generous one. */
  function cancelKind(startsAt, cancelledAt){
    var s = ms(startsAt), c = ms(cancelledAt);
    if (s === null || c === null) return 'cancelled_early';
    return (s - c >= POLICY.cancelNoticeHours * HOUR) ? 'cancelled_early' : 'cancelled_late';
  }

  /* How much notice is left before a cancellation stops being free, in whole
     hours. Negative once the line has been crossed. This is what lets the
     Cancel button say what it is about to do. */
  function noticeLeftMs(startsAt, now){
    var s = ms(startsAt);
    if (s === null) return 0;
    return (s - POLICY.cancelNoticeHours * HOUR) - (now === undefined ? Date.now() : now);
  }

  /* What a session will settle as, given what is known about it right now.

     This is settle_pair() in supabase/migration-attendance.sql, in the same
     order and with the same answers, over one participant's row. It is not
     what writes anybody's record — the database does that, and the browser
     could not be trusted with it — but the dashboard has to know what it is
     looking at, and re-deriving it inline on a page is how three pages came
     to disagree about the same rows in the first place.

     `row` is a session as assets/db.js hands it over:
       { status, attended, joinedAt, cancelledByMe, cancelledAt,
         startsAt, durationMin, attendance }
     `partnerJoined` says whether the OTHER person was seen in the room, which
     is the only way to tell "nobody came" from "nothing was watching". */
  function outcomeOf(row, now, partnerJoined){
    if (!row) return null;
    /* Already decided by the database. Its answer always wins — this
       function is a prediction, and a prediction of something that has
       already happened is just a worse copy of it. */
    if (row.attendance && OUTCOMES.indexOf(row.attendance) >= 0) return row.attendance;

    var status = row.status || 'confirmed';
    if (status === 'cancelled') {
      /* Whoever pressed Cancel wears it. The other person is excused: they
         were told, and being told is the whole point. */
      return row.cancelledByMe ? cancelKind(row.startsAt, row.cancelledAt) : 'excused';
    }
    if (status !== 'confirmed' && status !== 'completed' && status !== 'no_show') return null;

    var s = ms(row.startsAt);
    if (s === null) return null;
    /* Not until the hour it was booked for is over. Somebody who joins
       twenty minutes in is late, not absent, and the ten-minute grace is what
       separates those two rather than a deadline to be graded at. */
    if (s + (row.durationMin || 50) * MINUTE > (now === undefined ? Date.now() : now)) return null;

    if (row.attended === true || ms(row.joinedAt) !== null) return 'attended';
    if (row.attended === false) return 'no_show';
    if (status === 'no_show') return 'no_show';
    /* Something was watching and it saw the other one. So this is an absence
       rather than a silence. */
    if (partnerJoined) return 'no_show';
    /* And here nothing was watching at all — which is also exactly what a
       site with the webhook misconfigured looks like. No verdict. */
    return null;
  }

  /* ---------- the formula ----------

       attended        1.0, or 0.8 if they came in more than ten minutes late
       cancelled_late  0.4
       no_show         0.0
       cancelled_early not counted
       excused         not counted

     Cancelling early is excluded rather than scored, because it is the
     behaviour PeerFlow is trying to produce and a system that shaves a point
     off it is arguing with itself. The obvious hole — cancel everything
     early, keep a perfect record — is closed by the floor rather than by a
     penalty: an early cancellation is not a graded session, so somebody who
     only ever cancels never reaches three and never gets a percentage at all.
     They read as "New partner" for ever, which is precisely what PeerFlow
     knows about them. */
  function grade(outcome, startsAt, joinedAt){
    if (outcome === 'attended') {
      var s = ms(startsAt), j = ms(joinedAt);
      if (s !== null && j !== null && j > s + POLICY.graceMinutes * MINUTE) return 0.8;
      return 1.0;
    }
    if (outcome === 'cancelled_late') return 0.4;
    if (outcome === 'no_show') return 0.0;
    return null;
  }

  /* The score, from rows that already carry their settled outcome.

     Weighted twice over. Recency: the newest counts fully and each older one
     0.9 as much, over the last twenty, so a bad month in March is not still
     being served to strangers in September. And the prior, which is what
     stops the first late cancellation of somebody's life reading as 40%.

     Returns pct null below the floor. Not 0, and not "no data": a new person
     is not an unreliable one, and letting the number read as an accusation of
     somebody who has not had a chance yet is the commonest way to make a
     reliability score cruel. */
  function score(rows){
    var graded = [];
    (rows || []).forEach(function(r){
      var g = grade(r.attendance, r.startsAt, r.joinedAt);
      if (g === null) return;
      graded.push({ at: ms(r.startsAt) || 0, g: g });
    });
    graded.sort(function(a, b){ return b.at - a.at; });
    graded = graded.slice(0, POLICY.window);

    var num = 0, den = 0;
    graded.forEach(function(x, i){
      var w = Math.pow(POLICY.decay, i);
      num += w * x.g;
      den += w;
    });

    var counted = graded.length;
    if (counted < POLICY.minGraded) return { pct: null, counted: counted };
    var pct = Math.round(100 * ((num + POLICY.priorWeight * POLICY.priorScore) /
                                (den + POLICY.priorWeight)));
    return { pct: pct, counted: counted };
  }

  /* Counting the outcomes for the line under the number. expected is what was
     actually asked of somebody: everything except the ones they called off in
     good time and the ones that were called off on them. It is the
     denominator in "23 of 24 sessions attended". */
  function tally(rows){
    var t = { attended: 0, noShows: 0, early: 0, late: 0, excused: 0, expected: 0 };
    (rows || []).forEach(function(r){
      if (r.attendance === 'attended')             t.attended++;
      else if (r.attendance === 'no_show')         t.noShows++;
      else if (r.attendance === 'cancelled_early') t.early++;
      else if (r.attendance === 'cancelled_late')  t.late++;
      else if (r.attendance === 'excused')         t.excused++;
    });
    t.expected = t.attended + t.noShows + t.late;
    return t;
  }

  /* ---------- the words ----------

     A bare percentage invites arithmetic nobody wants to do — "is 82 good?" —
     so the label answers it and the number backs the label up.

     "New partner" is the important one. Somebody with nothing behind them is
     not unreliable and must never read as though they are; a person choosing
     between two names should see "new" and decide what they think of that,
     rather than seeing a low score they will read as a warning. */
  function label(pct, counted){
    if (pct === null || pct === undefined) {
      return (counted === undefined || counted < POLICY.minGraded) ? 'New partner' : '';
    }
    if (pct >= 95) return 'Always turns up';
    if (pct >= 90) return 'Very reliable';
    if (pct >= 80) return 'Reliable';
    if (pct >= 65) return 'Usually turns up';
    return 'Often misses';
  }

  /* The compact form for a directory row: "96% reliable · 18 sessions" or
     "New partner". Built here rather than on three pages, because it was on
     three pages and they had drifted. */
  function chip(rel){
    if (!rel) return '';
    var counted = rel.counted || 0;
    if (rel.pct === null || rel.pct === undefined) return 'New partner';
    var done = rel.attended || 0;
    return rel.pct + '% reliable' +
           (done ? ' · ' + done + (done === 1 ? ' session' : ' sessions') : '');
  }

  /* The checkable claim under the label. Never "100% reliable" on its own:
     the counts are what make a score evidence rather than a badge. */
  function summary(rel){
    if (!rel) return '';
    var out = [];
    var expected = rel.expected;
    if (expected === undefined || expected === null) {
      expected = (rel.attended || 0) + (rel.noShows || 0) + (rel.late || 0);
    }
    if (expected) {
      out.push((rel.attended || 0) + ' of ' + expected +
               (expected === 1 ? ' session attended' : ' sessions attended'));
    }
    /* Worth saying, and worth saying separately: somebody who calls sessions
       off in good time is not unreliable, but a partner deciding whether to
       book with them should still know how often it happens. */
    if (rel.early) out.push(rel.early + ' cancelled ahead of time');
    return out.join(' · ');
  }

  /* ---------- three misses in a month ----------

     A pause on starting new partnerships, and nothing else. Not a ban and not
     a suspension: existing partners, sessions, chat, history and the account
     all carry on exactly as before. Seven days from the last miss, and the
     one thing that shortens it is time.

     Mirrors partnering_restricted_until(). The database is what enforces it —
     the RLS policy on partner_requests — and this is so the page can say why
     rather than showing somebody a button that fails. */
  function noShowStanding(noShowStarts, now){
    var t = (now === undefined ? Date.now() : now);
    var cutoff = t - POLICY.noShowDays * DAY;
    var recent = (noShowStarts || []).map(ms).filter(function(x){
      return x !== null && x >= cutoff;
    }).sort(function(a, b){ return a - b; });

    var out = { count: recent.length, restrictedUntil: null };
    if (recent.length < POLICY.noShowLimit) return out;
    var until = recent[recent.length - 1] + POLICY.cooldownDays * DAY;
    if (until > t) out.restrictedUntil = new Date(until);
    return out;
  }

  root.pfReliability = {
    POLICY: POLICY,
    OUTCOMES: OUTCOMES,
    cancelKind: cancelKind,
    noticeLeftMs: noticeLeftMs,
    outcomeOf: outcomeOf,
    grade: grade,
    score: score,
    tally: tally,
    label: label,
    chip: chip,
    summary: summary,
    noShowStanding: noShowStanding
  };

  /* Node loads this file too, so dev/reliability-tests.js exercises the real
     thing rather than a copy of it that drifts out of step. The browser gets
     window.pfReliability either way. */
  if (typeof module !== 'undefined' && module.exports) module.exports = root.pfReliability;
})(typeof window !== 'undefined' ? window : globalThis);
