/* Attendance on screen: the check-in, the missed-session band, the cancel
 * notice, and the pause after three misses.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/attendance-tests.js 9000 /tmp/shots
 *
 * dev/reliability-tests.js has the arithmetic and dev/sql-tests.sh has the
 * rules; this is only the part that cannot be checked without drawing it.
 * That distinction earned itself twice while this was being written, and both
 * bugs read perfectly well in the source:
 *
 *   * the check-in row printed "Amir was there" from s.attendance — which is
 *     the CALLER's outcome, not their partner's — so a session where you
 *     turned up and they did not said the opposite of the band directly above
 *     it. Nothing about the markup was wrong. The wrong row was being read.
 *
 *   * lastWithEach() counted only 'confirmed' past sessions, and close_room
 *     moves a session that went well to 'completed'. So the better the video
 *     side worked, the more certain the dashboard was that you had never
 *     studied with this person, and two partners who met weekly for a month
 *     were told "You haven't studied with Amir yet".
 *
 * Both are asserted below, by what the page says rather than by which
 * elements exist.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || 9000;
const OUT  = process.argv[3] || require('os').tmpdir() + '/peerflow-shots';
require('fs').mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (n, c, x) => {
  if (c) { console.log('  \x1b[32mPASS\x1b[0m ' + n); return; }
  fails++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x ? '\n        ' + x : ''));
};

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* One finished session with Amir, three hours ago, which the room saw you at.
 * `extra` is spliced in so each case can say what happened to the OTHER
 * person without rebuilding the row. */
const sessionDial = (extra) => `
  var s = new Date(); s.setHours(s.getHours() - 3);
  window.__sessions = [{id:'c1',partnerName:'Amir Karimov',topic:'Cybersecurity',
    startsAt:s,durationMin:50,roomUrl:'pf:c1',pairId:'r1',status:'completed',
    proposedBy:'them',mine:false,cancelledByMe:false,goal:null,goalDone:null,
    attended:true,joinedAt:s,attendance:'attended',attendanceSource:'livekit',
    settledAt:s,partnerOk:null,checkedInAt:null,continuePref:null,
    completedAt:s,cancelledAt:null}];
  ${extra || ''}
`;

async function page(b, url, dial, width){
  const p = await b.newPage({ viewport: { width: width || 1280, height: 1100 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  if (dial) await p.addInitScript(dial);
  await p.goto('http://127.0.0.1:' + PORT + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}

const bandOf = p => p.evaluate(() => ({
  tone: document.querySelector('#now').getAttribute('data-tone'),
  kicker: document.querySelector('#now-k').innerText.trim(),
  head: document.querySelector('#now-h').innerText.trim(),
  sub: document.querySelector('#now-s').innerText.trim(),
  acts: Array.from(document.querySelectorAll('#now-a a,#now-a button')).map(x => x.innerText.trim())
}));

const rowOf = p => p.evaluate(() => {
  const row = document.querySelector('#ci-list .cirow');
  if (!row) return null;
  return {
    title: row.querySelector('.ci-t').innerText.trim(),
    ask: row.querySelector('.what span:not(.ci-t)').innerText.trim(),
    buttons: Array.from(row.querySelectorAll('button')).map(x => x.innerText.trim()),
    groups: row.querySelectorAll('.ci-q').length,
    headShown: !document.querySelector('#ci-h').hidden
  };
});

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });

  console.log('\n==> the check-in asks only what it does not already know');
  {
    const p = await page(b, '/app.html', sessionDial());
    const r = await rowOf(p);
    ok('the row is there after a finished session', !!r && r.headShown);
    ok('  and asks about the partner by first name',
       r && /Did Amir show up\?/.test(r.ask), r && r.ask);
    ok('  with both questions offered', r && r.buttons.length === 4, JSON.stringify(r && r.buttons));
    ok('  as two groups, not one menu of four', r && r.groups === 2, String(r && r.groups));
    await p.locator('#sess-card').screenshot({ path: OUT + '/checkin-asking.png' });
    await p.close();
  }
  {
    /* The room already watched the partner arrive, so the question is settled
       and putting it to a person would be asking them to do the server's job. */
    const p = await page(b, '/app.html', sessionDial(
      `window.__partnerOut = {c1:{attendance:'attended',joined:true,checkedIn:false}};`));
    const r = await rowOf(p);
    ok('when the room saw them, it states it instead of asking',
       r && /Amir was there\./.test(r.ask), r && r.ask);
    ok('  and drops Yes/No, keeping only the question worth asking',
       r && r.buttons.length === 2 && r.buttons.join() === 'Study again,Find someone else',
       JSON.stringify(r && r.buttons));
    await p.close();
  }
  {
    /* The bug this file exists for. s.attendance is the CALLER's outcome; the
       question is about the other person, and reading the wrong row printed
       "Amir was there" under a band saying he had not been. */
    const p = await page(b, '/app.html', sessionDial(
      `window.__partnerOut = {c1:{attendance:'no_show',joined:false,checkedIn:false}};`));
    const r = await rowOf(p);
    ok('when the partner missed it, the row says so — it does not read your own row',
       r && /Amir didn’t make it/.test(r.ask), r && r.ask);
    ok('  and is explicit that it costs the person reading it nothing',
       r && /Nothing on your record changes/.test(r.ask), r && r.ask);
    await p.close();
  }

  console.log('\n==> the band when somebody was left sitting there');
  {
    const p = await page(b, '/app.html', sessionDial(
      `window.__partnerOut = {c1:{attendance:'no_show',joined:false,checkedIn:false}};`));
    const band = await bandOf(p);
    ok('the band names it', /Amir didn’t make it\./.test(band.head), band.head);
    /* Neither green nor amber. Green is what every other quiet state wears and
       would read as the page being pleased; amber is taken, exclusively, by
       "somebody is waiting on you". */
    ok('  in a tone that is neither celebratory nor an alarm',
       band.tone === 'quiet', band.tone);
    ok('  and offers exactly reschedule, message, rematch',
       band.acts.join(' | ') === 'Reschedule | Message Amir | Find another partner',
       JSON.stringify(band.acts));
    ok('  saying plainly that the reliable one is unaffected',
       /Nothing about it counts against you/.test(band.sub), band.sub);
    await p.locator('#now').screenshot({ path: OUT + '/band-stood-up.png' });
    await p.close();
  }
  {
    /* Mid-session, past the grace, you are in and they are not. Nothing is
       decided yet and the wording must not pretend otherwise. */
    const p = await page(b, '/app.html', `
      var s = new Date(); s.setMinutes(s.getMinutes() - 20);
      window.__sessions = [{id:'c3',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:s,durationMin:50,roomUrl:'pf:c3',pairId:'r1',status:'confirmed',
        proposedBy:'them',mine:false,cancelledByMe:false,goal:null,goalDone:null,
        attended:true,joinedAt:s,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,completedAt:null,cancelledAt:null}];
    `);
    const band = await bandOf(p);
    ok('twenty minutes in and alone, the band says so',
       /hasn’t arrived/.test(band.head), band.head);
    ok('  without calling it a no-show, because they can still walk in',
       !/no.show|didn’t make it|missed/i.test(band.head + band.sub), band.sub);
    ok('  and the way back into the room is the first thing offered',
       band.acts[0] === 'Back to the room', JSON.stringify(band.acts));
    await p.close();
  }

  console.log('\n==> a finished session counts as having met');
  {
    /* lastWithEach() counted only 'confirmed' past rows, and close_room moves
       a session that went well to 'completed' — so the band told partners who
       met every week that they had never studied together. */
    const p = await page(b, '/app.html', sessionDial());
    const band = await bandOf(p);
    ok('a completed session is not "you haven’t studied with Amir yet"',
       !/haven’t studied|first session/i.test(band.head), band.head);
    await p.close();
  }
  {
    /* And the other half: with no history the first session is named in full,
       at a short length, because a partnership that never has a first session
       is the commonest way this product fails. */
    const p = await page(b, '/app.html', 'window.__empty = true;');
    const band = await bandOf(p);
    ok('with no history it names the first session', /Your first session with Amir/.test(band.head), band.head);
    ok('  giving a day, a time and a length rather than pointing at a form',
       /·/.test(band.sub) && /minute first session/.test(band.sub), band.sub);
    ok('  and it is the short one, which is easier to say yes to',
       /25-minute/.test(band.sub), band.sub);
    ok('  with a button that proposes it rather than opening an empty form',
       band.acts[0] === 'Propose this time', JSON.stringify(band.acts));
    await p.locator('#now').screenshot({ path: OUT + '/band-first-session.png' });
    await p.close();
  }

  console.log('\n==> cancelling says what it costs before you press it');
  for (const [name, hours, want] of [['well ahead', 30, /costs you nothing/],
                                     ['inside six hours', 3, /late cancellation/]]) {
    const p = await page(b, '/app.html', `
      var s = new Date(); s.setHours(s.getHours() + ${hours});
      window.__sessions = [{id:'x1',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:s,durationMin:50,roomUrl:'pf:x1',pairId:'r1',status:'confirmed',
        proposedBy:'them',mine:false,cancelledByMe:false,goal:null,goalDone:null,
        attended:null,joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,completedAt:null,cancelledAt:null},
        {id:'x2',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:new Date(s.getTime()+86400000*3),durationMin:50,roomUrl:'pf:x2',pairId:'r1',
        status:'confirmed',proposedBy:'them',mine:false,cancelledByMe:false,goal:null,
        goalDone:null,attended:null,joinedAt:null,attendance:null,attendanceSource:null,
        settledAt:null,partnerOk:null,checkedInAt:null,continuePref:null,
        completedAt:null,cancelledAt:null}];
    `);
    /* Two sessions so the booked list is drawn — one is the band's alone. */
    await p.click('#upcoming [data-cancel-booked]');
    await p.waitForTimeout(150);
    const note = await p.evaluate(() => {
      const n = document.querySelector('#upcoming .slot-err');
      return n && !n.hidden ? { text: n.innerText.trim(), cls: n.className } : null;
    });
    ok('arming Cancel ' + name + ' explains the consequence', !!note, 'no note shown');
    ok('  and it is the right one', note && want.test(note.text), note && note.text);
    /* The commonest of these says cancelling costs nothing, and in red that
       would be actively misleading. */
    ok('  styled as a statement, not an error', note && /note/.test(note.cls), note && note.cls);
    await p.close();
  }

  console.log('\n==> the pause after three missed sessions');
  {
    const p = await page(b, '/app-people.html', `
      window.__standingStatus = {noShows:3,
        restrictedUntil:new Date(Date.now()+5*86400000), windowDays:30, allowed:3};
    `);
    const r = await p.evaluate(() => {
      const n = document.querySelector('#coolnote');
      const asks = Array.from(document.querySelectorAll('[data-ask]'));
      return {
        shown: n && !n.hidden,
        text: n ? n.innerText.replace(/\s+/g, ' ').trim() : '',
        asks: asks.length,
        allDisabled: asks.length > 0 && asks.every(b => b.disabled)
      };
    });
    ok('the notice is shown', r.shown);
    /* The one thing it has to get right. Somebody reading "paused" about a
       study site assumes they have lost their partner and their history. */
    ok('  and says what is NOT affected',
       /partners.*sessions.*messages.*history/i.test(r.text) &&
       /carry on/i.test(r.text), r.text);
    ok('  and that cancelling ahead of time never counted',
       /Cancelling ahead of time has never counted/.test(r.text), r.text);
    ok('  while Send request is taken out of service rather than left to fail',
       r.allDisabled, r.asks + ' buttons, all disabled: ' + r.allDisabled);
    await p.locator('#coolnote').screenshot({ path: OUT + '/cooldown.png' });
    await p.close();
  }
  {
    const p = await page(b, '/app-people.html', '');
    const r = await p.evaluate(() => ({
      shown: !document.querySelector('#coolnote').hidden,
      anyDisabled: Array.from(document.querySelectorAll('[data-ask]')).some(b => b.disabled)
    }));
    ok('with nothing missed there is no notice and nothing is disabled',
       !r.shown && !r.anyDisabled);
    await p.close();
  }

  console.log('\n==> somebody new is described, not left blank');
  {
    const p = await page(b, '/app-people.html', `window.__rel = {
      m1:{pct:96,counted:20,attended:18,noShows:1,early:2,late:0,expected:19}};`);
    const r = await p.evaluate(() => ({
      chips: Array.from(document.querySelectorAll('.relchip')).map(x => x.innerText.trim()),
      heroFacts: Array.from(document.querySelectorAll('.tp-fact')).map(x =>
        x.innerText.replace(/\s+/g, ' ').trim())
    }));
    /* A directory where some rows carry a green percentage and others carry
       nothing makes the blank ones read as the worse option — which is where
       every new member starts. */
    ok('an unscored person reads "New partner" rather than an empty column',
       r.chips.some(c => /New partner/.test(c)), JSON.stringify(r.chips));
    ok('  and the top pick states its record on the card',
       r.heroFacts.some(f => /96%/.test(f)), JSON.stringify(r.heroFacts));
    await p.close();
  }
  {
    const p = await page(b, '/app-people.html', 'window.__rel = {};');
    const r = await p.evaluate(() => Array.from(document.querySelectorAll('.tp-fact'))
      .map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    ok('an unscored top pick says so instead of dropping the fact',
       r.some(f => /New partner/.test(f)), JSON.stringify(r));
    await p.close();
  }

  console.log('\n==> a claim PeerFlow cannot check is kept, and says so');
  {
    /* Not a failure and not an error: it is PeerFlow declining to take
       somebody's word about somebody else when it has nothing to check it
       against. Reporting it as either would be wrong, and reloading silently
       would let somebody believe they had put a no-show on a record. */
    const p = await page(b, '/app.html',
      sessionDial(`window.__checkinOut = 'unverified';`));
    await p.click('#ci-list [data-ci-showed="0"]');
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const row = document.querySelector('#ci-list .cirow');
      const err = row && row.querySelector('.slot-err');
      return {
        stillThere: !!row,
        text: err && !err.hidden ? err.innerText.trim() : null,
        cls: err ? err.className : '',
        goStillLive: Array.from(row.querySelectorAll('[data-ci-go]')).every(b => !b.disabled)
      };
    });
    ok('the row stays rather than reloading as though it had landed', r.stillThere);
    ok('  and explains that nothing was put on anybody’s record',
       r.text && /has not been put on their record/.test(r.text), r.text);
    ok('  reading as a note rather than an error', /note/.test(r.cls), r.cls);
    ok('  with the other question still answerable', r.goStillLive);
    await p.close();
  }

  console.log('\n==> ending a partnership asks twice');
  {
    const p = await page(b, '/app.html', sessionDial());
    await p.click('#ci-list [data-ci-go="stop"]');
    await p.waitForTimeout(200);
    const armed = await p.evaluate(() => {
      const btn = document.querySelector('#ci-list [data-ci-go="stop"]');
      const err = document.querySelector('#ci-list .slot-err');
      return { label: btn.innerText.trim(), danger: btn.classList.contains('danger'),
               warn: err && !err.hidden ? err.innerText.trim() : null };
    });
    ok('the first press arms rather than acting', /Sure\?/.test(armed.label), armed.label);
    ok('  and says what it will do', armed.warn && /ends the partnership/.test(armed.warn), armed.warn);
    /* A bad match is not misconduct, and the copy has to say so or people use
       the block button instead — or just stop replying, which is the ghosting
       this whole feature exists to reduce. */
    ok('  making clear it is not a report',
       armed.warn && /not a report/.test(armed.warn), armed.warn);
    await p.close();
  }

  console.log('\n==> mobile');
  {
    const p = await page(b, '/app.html', sessionDial(), 390);
    const r = await p.evaluate(() => {
      const row = document.querySelector('#ci-list .cirow');
      const stop = row.querySelector('[data-ci-go="stop"]');
      const cont = row.querySelector('[data-ci-go="continue"]');
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        stopY: Math.round(stop.getBoundingClientRect().y),
        contY: Math.round(cont.getBoundingClientRect().y),
        inCard: !!stop.closest('#sess-card')
      };
    });
    ok('the check-in row does not push the page sideways', !r.overflow);
    /* Ordered last on a narrow screen, where it would otherwise land under
       the thumb next to the button people actually mean to press. */
    ok('  and the one that ends a partnership sits below the one that keeps it',
       r.stopY > r.contY, r.contY + ' vs ' + r.stopY);
    ok('  still inside the sessions card, not loose on the page', r.inCard);
    await p.locator('#sess-card').screenshot({ path: OUT + '/checkin-mobile.png' });
    await p.close();
  }

  console.log('\n==> a database without the migration degrades quietly');
  {
    const p = await page(b, '/app.html',
      sessionDial('window.__attendanceMissing = true;'));
    const r = await p.evaluate(() => ({
      band: document.querySelector('#now-h').innerText.trim(),
      row: !!document.querySelector('#ci-list .cirow'),
      ask: (document.querySelector('#ci-list .cirow .what span:not(.ci-t)') || {}).innerText
    }));
    /* The check-in still asks — it is answerable from either side and the
       question is not migration-dependent — but nothing claims to know an
       outcome it cannot have been told. */
    ok('the page still draws', !!r.band);
    ok('  and asks rather than asserting an outcome it cannot have',
       r.row && /Did Amir show up\?/.test(r.ask || ''), String(r.ask));
    await p.close();
  }

  await b.close();
  console.log('\n===================================================');
  console.log(fails ? ('failed ' + fails) : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
