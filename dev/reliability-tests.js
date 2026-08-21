/* assets/reliability.js — the outcome rules, the score, and the cooldown.
 *
 *     node dev/reliability-tests.js
 *
 * The file is pure by design, so this is arithmetic rather than a browser:
 * no server, no Playwright, no fixtures on disk. Everything is built from a
 * fixed `NOW` so that a run at 23:59 gives the same answers as a run at noon —
 * the first version of this used Date.now() and had a case that failed once a
 * day, near midnight, when a "3 days ago" session crossed a boundary.
 *
 * SEVERAL OF THESE ASSERT THE SAME NUMBERS AS dev/sql-tests.sh
 *
 * The score is computed twice in this codebase: reliability_of() in
 * supabase/migration-attendance.sql, which is the authority, and score() here,
 * which is the readable copy the pages reason with. A duplicated formula is
 * only ever safe if something notices when the two drift, so the fixtures
 * marked "shared with sql-tests" below are built identically over there and
 * asserted to the same percentage. Change the policy and both suites go red
 * together, which is the point.
 */
const R = require('../assets/reliability.js');

let fails = 0;
function ok(name, cond, extra){
  if (cond) { console.log('  \x1b[32mPASS\x1b[0m ' + name); return; }
  fails++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '\n        ' + extra : ''));
}

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
/* A Wednesday, on the hour, well away from any boundary. */
const NOW = Date.parse('2026-08-19T12:00:00Z');

/* A settled row, `d` days ago. The shape assets/db.js hands pages. */
function row(attendance, d, extra){
  const startsAt = new Date(NOW - d * DAY);
  return Object.assign({ attendance, startsAt, durationMin: 50, joinedAt: null,
                         status: 'completed' }, extra || {});
}
function many(attendance, n, from){
  const out = [];
  for (let i = 0; i < n; i++) out.push(row(attendance, (from || 1) + i));
  return out;
}


console.log('\n==> the policy is the one the migration states');
/* Not a tautology: these are the numbers written into
   supabase/migration-attendance.sql as pf_cancel_notice_hours() and friends,
   and this is the line that fails when somebody changes one of them in only
   one of the two files. */
ok('cancellation notice is 6 hours',      R.POLICY.cancelNoticeHours === 6);
ok('the grace period is 10 minutes',      R.POLICY.graceMinutes === 10);
ok('the window is the last 20',           R.POLICY.window === 20);
ok('a score needs 3 graded sessions',     R.POLICY.minGraded === 3);
ok('3 no-shows in 30 days, 7 day pause',
   R.POLICY.noShowLimit === 3 && R.POLICY.noShowDays === 30 && R.POLICY.cooldownDays === 7);


console.log('\n==> early or late, on the six-hour line');
const at8 = new Date('2026-08-20T20:00:00Z');
const before = h => new Date(at8.getTime() - h * HOUR);
ok('a day ahead is early',            R.cancelKind(at8, before(24)) === 'cancelled_early');
ok('exactly six hours ahead is early', R.cancelKind(at8, before(6)) === 'cancelled_early');
ok('five hours fifty-nine is late',
   R.cancelKind(at8, new Date(at8.getTime() - 6 * HOUR + MIN)) === 'cancelled_late');
ok('ten minutes ahead is late',       R.cancelKind(at8, before(1 / 6)) === 'cancelled_late');
ok('after it has started is late',    R.cancelKind(at8, new Date(at8.getTime() + MIN)) === 'cancelled_late');
/* Rows from before migration-mvp.sql added cancelled_at. Missing evidence is
   not evidence of the worse thing. */
ok('a cancellation with no timestamp is treated as early',
   R.cancelKind(at8, null) === 'cancelled_early');

ok('notice left is positive while cancelling is still free',
   R.noticeLeftMs(new Date(NOW + 8 * HOUR), NOW) > 0);
ok('and negative once the line has gone',
   R.noticeLeftMs(new Date(NOW + 4 * HOUR), NOW) < 0);


console.log('\n==> what a session settles as');
const past = new Date(NOW - 3 * HOUR), future = new Date(NOW + 3 * HOUR);
const base = { startsAt: past, durationMin: 50, status: 'confirmed',
               attended: null, joinedAt: null, cancelledAt: null, cancelledByMe: false };
const O = (o, partnerJoined) => R.outcomeOf(Object.assign({}, base, o), NOW, partnerJoined);

ok('the room saw them: attended',            O({ attended: true }) === 'attended');
ok('a join timestamp alone is enough',       O({ joinedAt: past }) === 'attended');
ok('the room said absent: no_show',          O({ attended: false }) === 'no_show');
ok('the room saw the other one and not this one: no_show',
   O({}, true) === 'no_show');
/* The case the whole feature turns on, and the one it is most important not
   to get wrong in the other direction. */
ok('nothing watched at all: no verdict, not an accusation',
   O({}, false) === null);
ok('still running: no verdict yet',
   R.outcomeOf(Object.assign({}, base, { startsAt: future }), NOW, false) === null);
ok('a session that finished one minute ago is decidable',
   R.outcomeOf(Object.assign({}, base,
     { startsAt: new Date(NOW - 51 * MIN), attended: false }), NOW, false) === 'no_show');
ok('an unanswered proposal is never graded',
   O({ status: 'proposed', attended: false }) === null);
ok('a declined time is never graded',
   O({ status: 'declined' }) === null);

console.log('\n==> and a cancellation lands on whoever did it');
ok('I cancelled a day ahead: early',
   O({ status: 'cancelled', cancelledByMe: true,
       startsAt: new Date(NOW + DAY), cancelledAt: new Date(NOW) }) === 'cancelled_early');
ok('I cancelled two hours ahead: late',
   O({ status: 'cancelled', cancelledByMe: true,
       startsAt: new Date(NOW + 2 * HOUR), cancelledAt: new Date(NOW) }) === 'cancelled_late');
/* The rule that stops one flaky partner dragging down everybody they booked
   with, stated as its own case because it is the one people get wrong. */
ok('THEY cancelled: I am excused, whatever the notice',
   O({ status: 'cancelled', cancelledByMe: false,
       startsAt: new Date(NOW + MIN), cancelledAt: new Date(NOW) }) === 'excused');
ok('a verdict the database has already settled always wins',
   O({ attendance: 'excused', attended: true }) === 'excused');


console.log('\n==> the grades');
ok('attended on time is full credit',  R.grade('attended', past, past) === 1);
ok('attended with no join time recorded is still full credit',
   R.grade('attended', past, null) === 1);
ok('attended nine minutes late is still on time',
   R.grade('attended', new Date(NOW), new Date(NOW + 9 * MIN)) === 1);
ok('attended eleven minutes late is 0.8',
   R.grade('attended', new Date(NOW), new Date(NOW + 11 * MIN)) === 0.8);
ok('a late cancellation is 0.4',       R.grade('cancelled_late') === 0.4);
ok('a no-show is nothing',             R.grade('no_show') === 0);
ok('an early cancellation is not graded at all', R.grade('cancelled_early') === null);
ok('an excused session is not graded at all',    R.grade('excused') === null);
ok('an undecided session is not graded at all',  R.grade(null) === null);


console.log('\n==> a brand-new user is never given a percentage');
ok('nothing at all: no score',   R.score([]).pct === null);
ok('one session: no score',      R.score(many('attended', 1)).pct === null);
ok('two sessions: no score',     R.score(many('attended', 2)).pct === null);
ok('  and the label says so rather than showing a number',
   R.label(R.score(many('attended', 2)).pct, 2) === 'New partner');
/* shared with sql-tests: "three perfect sessions is not 100%" */
const three = R.score(many('attended', 3));
ok('three sessions: a score appears',  three.pct === 94, 'got ' + three.pct);
ok('  and it is not 100%, because nobody is',  three.pct < 100);

console.log('\n==> and cancelling early can never buy one');
/* The obvious way to game a system that excuses early cancellations is to
   cancel everything early. It does not work, and this is why: an early
   cancellation is not a graded session, so the floor is never reached. */
const ducker = R.score(many('cancelled_early', 10));
ok('ten early cancellations and nothing else: still no score',
   ducker.pct === null && ducker.counted === 0);
ok('  and the profile reads "New partner", not "100% reliable"',
   R.label(ducker.pct, ducker.counted) === 'New partner');
ok('  while the record still says how many were called off',
   R.tally(many('cancelled_early', 10)).early === 10);


console.log('\n==> a mixed history');
/* shared with sql-tests: 23 attended and one no-show twelve days back. */
const mixed = many('attended', 24).map((r, i) =>
  i === 11 ? row('no_show', 12) : r);
const mx = R.score(mixed);
ok('23 attended and 1 missed reads as 94%', mx.pct === 94, 'got ' + mx.pct);
ok('  counted is capped at the window, not the history', mx.counted === 20);
const mt = R.tally(mixed);
ok('  the counts underneath are 23 and 1',
   mt.attended === 23 && mt.noShows === 1, JSON.stringify(mt));
ok('  and the summary is checkable rather than a badge',
   R.summary({ attended: 23, noShows: 1, late: 0, early: 0, expected: 24 }) ===
   '23 of 24 sessions attended');
ok('  early cancellations get their own clause',
   R.summary({ attended: 9, noShows: 1, late: 0, early: 3, expected: 10 }) ===
   '9 of 10 sessions attended · 3 cancelled ahead of time');

/* shared with sql-tests: five sessions, every one of them joined late. */
const late5 = many('attended', 5).map(r => Object.assign(r,
  { joinedAt: new Date(r.startsAt.getTime() + 25 * MIN) }));
ok('turning up late five times running is 82%', R.score(late5).pct === 82,
   'got ' + R.score(late5).pct);

console.log('\n==> nobody is punished for what the other person did');
/* The same person, the same twelve weeks, twice over: once where they
   attended everything, and once where a flaky partner called half of it off
   at ten minutes' notice. The score must not move. */
const clean  = many('attended', 6);
const dumped = many('attended', 6).concat(many('excused', 6, 10));
ok('six excused sessions change nothing',
   R.score(clean).pct === R.score(dumped).pct,
   R.score(clean).pct + ' vs ' + R.score(dumped).pct);
ok('  and they are not counted as sessions they attended',
   R.tally(dumped).attended === 6);
ok('  nor as sessions that were expected of them',
   R.tally(dumped).expected === 6);

console.log('\n==> the same person, cancelling late themselves, does move');
const sloppy = many('attended', 4).concat(many('cancelled_late', 2, 6));
ok('two late cancellations cost real points',
   R.score(sloppy).pct < R.score(many('attended', 6)).pct,
   R.score(sloppy).pct + ' vs ' + R.score(many('attended', 6)).pct);
ok('  but not as much as two no-shows would',
   R.score(sloppy).pct >
   R.score(many('attended', 4).concat(many('no_show', 2, 6))).pct);


console.log('\n==> old mistakes stop following people around');
/* The window and the decay together. Twenty clean sessions after a bad
   month should read very differently from the bad month itself, or the
   score is a life sentence and there is no reason for anybody to come back. */
const recovered = many('attended', 20).concat(many('no_show', 3, 30));
const stillBad  = many('no_show', 3);
ok('three no-shows a month ago, then twenty clean: back in the nineties',
   R.score(recovered).pct >= 90, 'got ' + R.score(recovered).pct);
ok('  whereas three no-shows and nothing since reads as "Often misses"',
   R.label(R.score(stillBad).pct) === 'Often misses', 'got ' + R.score(stillBad).pct);
/* And not as zero. Three misses is three misses, not a claim that this person
   has never turned up for anything in their life — the prior is what keeps
   the number honest about how little it is standing on. */
ok('  but not as 0%, because three sessions is not a life',
   R.score(stillBad).pct > 25 && R.score(stillBad).pct < 50,
   'got ' + R.score(stillBad).pct);
/* The window is a hard edge on purpose: past twenty, a session is gone
   whatever it was. */
const buried = many('attended', 20).concat(many('no_show', 5, 40));
ok('anything past the twentieth is outside the window entirely',
   R.score(buried).pct === R.score(many('attended', 20)).pct,
   R.score(buried).pct + ' vs ' + R.score(many('attended', 20)).pct);
ok('  and the newest session weighs most',
   R.score([row('no_show', 1)].concat(many('attended', 5, 2))).pct <
   R.score(many('attended', 5, 2).concat([row('no_show', 40)])).pct);


console.log('\n==> the words in front of the number');
ok('96 is "Always turns up"',      R.label(96) === 'Always turns up');
ok('92 is "Very reliable"',        R.label(92) === 'Very reliable');
ok('84 is "Reliable"',             R.label(84) === 'Reliable');
ok('70 is "Usually turns up"',     R.label(70) === 'Usually turns up');
ok('40 is "Often misses"',         R.label(40) === 'Often misses');
ok('no score and no history is "New partner"', R.label(null, 0) === 'New partner');
ok('no score with two behind them is still "New partner"', R.label(null, 2) === 'New partner');

console.log('\n==> the chip a directory row shows');
ok('a scored partner leads with the percentage',
   R.chip({ pct: 96, counted: 20, attended: 18 }) === '96% reliable · 18 sessions');
ok('one session is not "1 sessions"',
   R.chip({ pct: 94, counted: 3, attended: 1 }) === '94% reliable · 1 session');
ok('a new partner says so instead of showing a dash',
   R.chip({ pct: null, counted: 1, attended: 1 }) === 'New partner');
ok('and nothing at all renders nothing', R.chip(null) === '');


console.log('\n==> three misses in thirty days');
const missAt = d => new Date(NOW - d * DAY);
ok('one miss is not a pattern',
   R.noShowStanding([missAt(2)], NOW).restrictedUntil === null);
ok('two misses is still not',
   R.noShowStanding([missAt(2), missAt(9)], NOW).restrictedUntil === null);
const three3 = R.noShowStanding([missAt(2), missAt(9), missAt(20)], NOW);
ok('three inside the window pauses new partners', three3.restrictedUntil !== null);
ok('  counted correctly', three3.count === 3);
ok('  and it runs seven days from the LAST of them, not the first',
   three3.restrictedUntil.getTime() === missAt(2).getTime() + 7 * DAY,
   String(three3.restrictedUntil));
/* Rolling, so it expires on its own — which is the difference between a
   cooldown and a punishment. */
ok('three misses spread over more than thirty days is not a pattern',
   R.noShowStanding([missAt(2), missAt(20), missAt(40)], NOW).restrictedUntil === null);
ok('  and the count only sees the window',
   R.noShowStanding([missAt(2), missAt(20), missAt(40)], NOW).count === 2);
ok('three misses that have already served their week are free again',
   R.noShowStanding([missAt(20), missAt(22), missAt(25)], NOW).restrictedUntil === null);
ok('  the eighth day is clear',
   R.noShowStanding([missAt(8), missAt(9), missAt(10)], NOW).restrictedUntil === null);
ok('  the sixth day is not',
   R.noShowStanding([missAt(6), missAt(9), missAt(10)], NOW).restrictedUntil !== null);
ok('nothing missed, nothing to serve',
   R.noShowStanding([], NOW).count === 0 &&
   R.noShowStanding(null, NOW).restrictedUntil === null);


console.log('\n==> nonsense in, nothing out');
ok('an unparseable date does not throw', R.cancelKind('x', 'y') === 'cancelled_early');
ok('a null row has no outcome',          R.outcomeOf(null, NOW, false) === null);
ok('a row with no start has no outcome', R.outcomeOf({ status:'confirmed' }, NOW, false) === null);
ok('scoring nothing is not an error',    R.score(null).pct === null);
ok('tallying nothing is all zeroes',     R.tally(null).attended === 0);
ok('an unknown outcome is not graded',   R.grade('sort of') === null);
ok('summarising nothing renders nothing', R.summary(null) === '');

console.log('\n===================================================');
console.log(fails ? ('failed ' + fails) : 'all checks pass');
process.exit(fails ? 1 : 0);
