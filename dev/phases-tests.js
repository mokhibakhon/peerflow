/* assets/phases.js, tested against every minute of every session it can be
 * asked about.
 *
 *     node dev/phases-tests.js
 *
 * The file is pure by design, which means it can be checked exhaustively
 * rather than sampled: a session is at most a hundred-odd minutes and there
 * are three lengths, so walking the lot second by second is cheap and leaves
 * nothing to a well-chosen example.
 */
const P = require('../assets/phases.js');

let fails = 0;
function ok(name, cond, extra){
  if (cond) { console.log('  \x1b[32mPASS\x1b[0m ' + name); return; }
  fails++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '\n        ' + extra : ''));
}
const shape = d => P.schedule(d).map(b => b.kind[0] + b.min).join('|');
const total = d => P.schedule(d).reduce((a, b) => a + b.min, 0);

console.log('\n==> the three lengths the app offers');
ok('25 is a single sitting',        shape(25) === 'f25', shape(25));
ok('50 is 25 / break / 20',         shape(50) === 'f25|b5|f20', shape(50));
ok('80 is 25 / break / 25 / break / 20', shape(80) === 'f25|b5|f25|b5|f20', shape(80));

console.log('\n==> a schedule always adds up to the booking');
// The property that matters most: no arrangement of blocks may invent or
// lose time, or the session ends at a different moment on the two screens.
let bad = [];
for (let d = 1; d <= 240; d++) if (total(d) !== d) bad.push(d + '->' + total(d));
ok('every length from 1 to 240 sums to itself', bad.length === 0, bad.slice(0, 8).join(' '));

console.log('\n==> no phase is too short to be worth showing');
bad = [];
for (let d = 31; d <= 240; d++)
  for (const b of P.schedule(d))
    if (b.kind === 'focus' && b.min < 10) bad.push(d + ' has a ' + b.min + ' min focus block');
ok('no runt focus block survives the fold', bad.length === 0, bad.slice(0, 5).join('; '));

bad = [];
for (let d = 1; d <= 240; d++) {
  const s = P.schedule(d);
  if (s.length && s[s.length - 1].kind === 'break') bad.push(String(d));
  if (s.length && s[0].kind === 'break') bad.push(String(d));
}
ok('a session never opens or closes on a break', bad.length === 0, bad.slice(0, 8).join(' '));

console.log('\n==> the twenty-minute grace is not mistaken for session time');
// session_for_call returns ends_at = starts_at + duration + 20 minutes.
// Reading that as the end of the session is the trap this guards.
const START = Date.parse('2026-09-01T15:00:00Z');
const endsAtFor = mins => new Date(START + (mins + 20) * 60000).toISOString();
ok('a 50-minute booking reads back as 50, not 70',
   P.bookedMinutes(new Date(START).toISOString(), endsAtFor(50)) === 50,
   'got ' + P.bookedMinutes(new Date(START).toISOString(), endsAtFor(50)));
ok('a 25-minute booking reads back as 25',
   P.bookedMinutes(new Date(START).toISOString(), endsAtFor(25)) === 25);
ok('a 80-minute booking reads back as 80',
   P.bookedMinutes(new Date(START).toISOString(), endsAtFor(80)) === 80);

console.log('\n==> walking every second of every session');
// Three properties, checked continuously rather than at chosen instants:
// the phase never goes backwards, it never skips a block, and the time left
// never exceeds the block it belongs to.
for (const d of [25, 50, 80]) {
  const blocks = P.schedule(d);
  let seen = -1, jumps = [], overruns = [], gaps = [];
  for (let s = -60; s <= d * 60 + 60; s++) {
    const now = START + s * 1000;
    const r = P.at(now, new Date(START).toISOString(), d);
    if (s < 0)        { if (r.state !== 'before') gaps.push('s=' + s + ' state=' + r.state); continue; }
    if (s >= d * 60)  { if (r.state !== 'after')  gaps.push('s=' + s + ' state=' + r.state); continue; }
    if (r.state !== 'running') { gaps.push('s=' + s + ' state=' + r.state); continue; }
    if (r.index < seen) jumps.push('s=' + s + ' went ' + seen + '->' + r.index);
    if (r.index > seen + 1) jumps.push('s=' + s + ' skipped ' + seen + '->' + r.index);
    if (r.index > seen) seen = r.index;
    if (r.leftMs > blocks[r.index].min * 60000) overruns.push('s=' + s);
  }
  ok(d + ' min: before/running/after line up with the clock', gaps.length === 0, gaps.slice(0, 4).join('; '));
  ok(d + ' min: phases advance one at a time, never backwards', jumps.length === 0, jumps.slice(0, 4).join('; '));
  ok(d + ' min: time left never exceeds its own block', overruns.length === 0, overruns.slice(0, 4).join('; '));
  ok(d + ' min: every block is reached', seen === blocks.length - 1,
     'reached ' + seen + ' of ' + (blocks.length - 1));
}

console.log('\n==> the boundaries themselves');
const at = (m) => P.at(START + m * 60000, new Date(START).toISOString(), 50);
ok('one second before the start it has not begun',
   P.at(START - 1000, new Date(START).toISOString(), 50).state === 'before');
ok('at exactly the start it is focus 1',
   at(0).state === 'running' && at(0).kind === 'focus' && at(0).index === 0);
ok('at minute 24:59 it is still focus 1', at(24.98).index === 0);
ok('at exactly minute 25 it is the break', at(25).kind === 'break', at(25).kind);
ok('at exactly minute 30 it is focus 2', at(30).kind === 'focus' && at(30).index === 2);
ok('at exactly minute 50 the session is over', at(50).state === 'after');

console.log('\n==> "focus 2 of 3"');
const eighty = P.schedule(80);
ok('the first block is focus 1 of 3', JSON.stringify(P.focusNumber(eighty, 0)) === '{"n":1,"of":3}');
ok('the last block is focus 3 of 3',  JSON.stringify(P.focusNumber(eighty, 4)) === '{"n":3,"of":3}');
ok('a 25-minute session is focus 1 of 1',
   JSON.stringify(P.focusNumber(P.schedule(25), 0)) === '{"n":1,"of":1}');

console.log('\n==> nonsense in, nothing out');
ok('a zero-length booking has no blocks', P.schedule(0).length === 0);
ok('a negative booking has no blocks', P.schedule(-30).length === 0);
ok('an unparseable start is not "running"',
   P.at(Date.now(), 'not a date', 50).state === 'after');
ok('bookedMinutes survives rubbish', P.bookedMinutes('x', 'y') === 0);

console.log('\n===================================================');
console.log(fails ? ('failed ' + fails) : 'all checks pass');
process.exit(fails ? 1 : 0);
