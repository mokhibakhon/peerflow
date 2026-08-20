/* Answering a proposal, and what the page says afterwards.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/answer-tests.js 9000
 *
 * Four buttons end a proposal: accept, decline, suggest another time, and drop
 * — which is one button doing two jobs, cancelling a proposal of your own and
 * dismissing a decline they gave you. The first three are also on the band at
 * the top of the dashboard, as relays: those buttons find the real button in
 * #prop-list and click it. That half was never broken. What was broken is
 * everything after the answer lands.
 *
 * The band is computed once, on load. Accepting reloads, so it was right.
 * Declining called loadProposals(), which redraws one list and nothing else —
 * so the band went on saying "Needs your answer" over buttons relaying into a
 * row that no longer existed, and pressing them hit `if (!target) return` and
 * did nothing at all, silently. Declining from the band is the ordinary way to
 * decline, it being the first thing on the page, so that was most decline
 * journeys rather than an edge case.
 *
 * These checks only mean anything because dev/db-stub.js now records answers
 * in sessionStorage: a fixture that forgets the answer across the reload
 * cannot see the half of the journey that was wrong. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

/* One proposal from them, nothing else. The state account B is in when a
   partner has just suggested a time.
 *
 * The time is computed HERE and injected as a fixed string, not computed in
 * the page. addInitScript re-runs on every navigation, so `Date.now()` inside
 * it would give the reloaded page a proposal a few seconds later than the one
 * that was answered — a different session as far as anything keying on the
 * start time is concerned, which is most things. That cost a wrong FAIL that
 * looked exactly like the bug under test still being present. */
const AT = new Date(Date.now() + 3 * 86400000).toISOString();
const DIALS = `window.__sessions = [{
  id:'p1', partnerName:'Amir Karimov', topic:'Cybersecurity',
  startsAt:new Date(${JSON.stringify(AT)}), durationMin:50,
  roomUrl:'pf:demo2', status:'proposed', proposedBy:'them', note:null,
  mine:false, cancelledByMe:false, confirmedAt:null, goal:null, goalDone:null,
  attended:null, completedAt:null, cancelledAt:null
}];`;

const ACCEPT  = '[data-relay="#prop-list [data-accept]"]';
const DECLINE = '[data-relay="#prop-list [data-no]"]';
const SWAP    = '[data-relay="#prop-list [data-swap]"]';

async function open(b, dials){
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  await p.addInitScript(dials || DIALS);
  await p.goto('http://127.0.0.1:' + PORT + '/app.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  return p;
}
const read = p => p.evaluate(() => ({
  kicker: document.getElementById('now-k').innerText.trim(),
  head:   document.getElementById('now-h').innerText.trim(),
  buttons: [...document.querySelectorAll('#now-a button, #now-a a')].map(x => x.innerText.trim()),
  deadRelays: [...document.querySelectorAll('#now-a [data-relay]')]
                .filter(x => !document.querySelector(x.getAttribute('data-relay')))
                .map(x => x.innerText.trim())
}));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n==> declining from the band');
  let p = await open(b);
  const before = await read(p);
  ok('the band starts by asking: "' + before.head + '"', /proposed/i.test(before.head));
  await p.click(DECLINE); await p.waitForTimeout(200);   /* arms */
  await p.click(DECLINE);                                /* fires */
  await p.waitForTimeout(1600);
  const after = await read(p);
  console.log('    band now: ' + after.kicker + ' / ' + after.head);
  ok('the band no longer says a proposal is waiting', !/proposed/i.test(after.head), after.head);
  ok('and it offers no button that leads nowhere',
     after.deadRelays.length === 0, 'dead: ' + after.deadRelays.join(', '));
  await p.close();

  console.log('\n==> accepting from the band');
  p = await open(b);
  await p.click(ACCEPT);
  await p.waitForTimeout(1600);
  const acc = await read(p);
  console.log('    band now: ' + acc.kicker + ' / ' + acc.head);
  ok('the band switches to the booked session', /next session|room is open/i.test(acc.kicker), acc.kicker);
  ok('and it offers no button that leads nowhere',
     acc.deadRelays.length === 0, 'dead: ' + acc.deadRelays.join(', '));
  await p.close();

  console.log('\n==> suggesting another time from the band');
  /* The one answer that must NOT reload: it has just pre-filled the booking
     form with their day and hour, and a reload would lose it. */
  p = await open(b);
  await p.click(SWAP);
  await p.waitForTimeout(1200);
  const sw = await read(p);
  const formOpen = await p.evaluate(() => !document.getElementById('book-card').hidden);
  console.log('    band now: ' + sw.kicker + ' / ' + sw.head);
  ok('the booking form is open, so nothing reloaded', formOpen);
  ok('the band stops claiming there is something to answer',
     !/proposed/i.test(sw.head) && !/needs your answer/i.test(sw.kicker), sw.kicker + ' / ' + sw.head);
  ok('and it offers no button that leads nowhere',
     sw.deadRelays.length === 0, 'dead: ' + sw.deadRelays.join(', '));
  await p.close();

  /* The fourth button on these rows, and the one missed the first time this
     was fixed. data-drop does two jobs — cancelling a proposal of your own,
     and dismissing a decline they gave you — and both end the proposal, so
     both change what the band should say. Neither is reachable from the band
     itself, so there are no dead buttons to give it away: the band simply goes
     on describing something that is no longer there. */
  const MINE = `window.__sessions=[{id:'m1',partnerName:'Amir Karimov',topic:'Cybersecurity',
    startsAt:new Date(${JSON.stringify(AT)}),durationMin:50,roomUrl:'pf:mine',status:'proposed',
    proposedBy:'me',note:null,mine:true,cancelledByMe:false,confirmedAt:null,goal:null,
    goalDone:null,attended:null,completedAt:null,cancelledAt:null}];`;
  const TURNED = `window.__sessions=[{id:'d1',partnerName:'Amir Karimov',topic:'Cybersecurity',
    startsAt:new Date(${JSON.stringify(AT)}),durationMin:50,roomUrl:'pf:turned',status:'declined',
    proposedBy:'me',note:null,mine:true,cancelledByMe:false,confirmedAt:null,goal:null,
    goalDone:null,attended:null,completedAt:null,cancelledAt:null}];`;

  for (const [name, dials, says] of [
        ['cancelling a proposal of your own', MINE,   /you asked/i],
        ['dismissing a decline they gave you', TURNED, /can.t make that time/i]]) {
    console.log('\n==> ' + name);
    p = await open(b, dials);
    const was = await read(p);
    ok('the band describes it first: "' + was.head + '"', says.test(was.head), was.head);
    /* Cancelling your own arms first; dismissing a decline goes straight
       through, so the button is gone after one click. */
    await p.click('#prop-list [data-drop]');
    await p.waitForTimeout(300);
    if (await p.$('#prop-list [data-drop]')) await p.click('#prop-list [data-drop]');
    await p.waitForTimeout(1600);
    const now = await read(p);
    console.log('    band now: ' + now.kicker + ' / ' + now.head);
    ok('the row is gone', (await p.$$('#prop-list .prop')).length === 0);
    ok('and the band stops describing it', !says.test(now.head), now.head);
    await p.close();
  }

  await b.close();
  console.log(fails ? '\nfailed ' + fails : '\nall checks pass');
  process.exit(fails ? 1 : 0);
})();
