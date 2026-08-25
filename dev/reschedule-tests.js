/* Moving a session, on screen.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/reschedule-tests.js 9000
 *
 * dev/sql-tests.sh has the primitive — what reschedule_session() refuses, and
 * the thing that matters most about it, which is that every refusal leaves the
 * original booking exactly as it was. This file is the half that cannot be
 * checked without drawing it.
 *
 * The bug this feature exists to fix does not look like a bug in the source.
 * A confirmed session had one way out of it, Cancel, so "I can't make
 * Thursday" and "I don't want to study with you" ended at the same button.
 * Nothing was broken. There was simply no third thing to press.
 *
 * So the checks here are mostly about what is offered and in what order, and
 * then about the one state that must never appear: a page where the old
 * session and a new one are both live, or where a refused move has quietly
 * taken the booking with it anyway.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;

let fails = 0;
const ok = (n, c, x) => {
  if (c) { console.log('  \x1b[32mPASS\x1b[0m ' + n); return; }
  fails++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x ? '\n        ' + x : ''));
};

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function page(b, url, dial, width){
  const p = await b.newPage({ viewport: { width: width || 1280, height: 1100 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  if (dial) await p.addInitScript(dial);
  await p.goto('http://127.0.0.1:' + PORT + (url || '/app.html'), { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  return p;
}

const calls = (p) => p.evaluate(() => {
  try { return JSON.parse(sessionStorage.getItem('__calls') || '[]'); }
  catch (e) { return []; }
});
const formOpen = (p) => p.evaluate(() => {
  const c = document.getElementById('book-card');
  return !!c && !c.hidden;
});
const sentence = (p) => p.evaluate(() =>
  (document.getElementById('bk-sent').innerText || '').replace(/\s+/g, ' ').trim());
/* The booked row's own buttons, in the order somebody's eye meets them. */
const rowActs = (p) => p.$$eval('#upcoming .slot button',
  e => e.map(x => x.textContent.trim()));
/* When the booked hour on the row itself. innerText goes empty on a collapsed
   card, and the card IS collapsed in the state most of these run in. */
const rowWhen = (p) => p.$$eval('#upcoming .slot .when',
  e => e.map(x => x.textContent.trim()));

/* Start a move the way a person does.
 *
 * syncSessCard hides the sessions card while it holds a single booking and
 * nothing else, on the reasoning that the band above is already saying it — so
 * in the commonest state of all, the row's own Reschedule is real, correct and
 * not on screen. The band's copy is what gets pressed, and it relays into the
 * row's button so there is one implementation of what Reschedule means.
 *
 * Driving the hidden control directly would test a path nobody can take. */
const startMove = (p) => p.evaluate(() => {
  const band = [...document.querySelectorAll('#now-a [data-relay]')]
    .filter(x => /reschedule/i.test(x.textContent))[0];
  if (band) { band.click(); return 'band'; }
  const row = document.querySelector('#upcoming [data-reschedule]');
  if (row) { row.click(); return 'row'; }
  return 'none';
});

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });

  console.log('\n==> a booked session can be moved');
  {
    const p = await page(b);
    const acts = await rowActs(p);
    ok('the row offers both, and Reschedule first: ' + JSON.stringify(acts),
       acts[0] === 'Reschedule' && acts.indexOf('Cancel') > 0);

    const band = await p.$$eval('#now-a button, #now-a a', e => e.map(x => x.textContent.trim()));
    ok('so does the band, in the same order: ' + JSON.stringify(band),
       band.indexOf('Reschedule') > 0 &&
       band.indexOf('Reschedule') < band.indexOf('Cancel this one'));
    await p.close();
  }

  console.log('\n==> and is not offered where it could not work');
  {
    /* The migration test. rescheduled_from has a rung of its own in
       fetchSessions, so a database without migration-reschedule.sql sends the
       column back as undefined — and reschedule_session() is missing there
       too. A button that could only ever apologise is not drawn. */
    const p = await page(b, '/app.html', 'window.__rescheduleMissing = true;');
    const acts = await rowActs(p);
    ok('without the migration there is no Reschedule: ' + JSON.stringify(acts),
       acts.indexOf('Reschedule') < 0);
    ok('  but Cancel still works, so the page is not otherwise damaged',
       acts.indexOf('Cancel') >= 0);
    const band = await p.$$eval('#now-a button, #now-a a', e => e.map(x => x.textContent.trim()));
    ok('  and the band does not offer it either: ' + JSON.stringify(band),
       band.indexOf('Reschedule') < 0);
    await p.close();
  }

  console.log('\n==> pressing it opens the form on the same session');
  {
    const p = await page(b);
    await startMove(p);
    await p.waitForTimeout(500);

    ok('the booking form is open', await formOpen(p));
    ok('it says what it is doing now: "' +
       (await p.innerText('#book-card .ch .grow')).replace(/\s+/g, ' ').trim() + '"',
       /pick another time/i.test(await p.innerText('#book-card .ch .grow')));
    ok('the button means the new thing: "' + (await p.innerText('#bk-save')) + '"',
       /propose the new time/i.test(await p.innerText('#bk-save')));

    const st = await sentence(p);
    ok('the same partner is already in it: "' + st + '"', /Amir/.test(st));
    ok('and the length carries over rather than resetting: "' + st + '"', /50 minutes/.test(st));

    const was = await p.innerText('#bk-was');
    ok('and it names the session it took: "' + was.trim() + '"',
       /instead of/i.test(was) && /Amir/.test(was));

    const hint = await p.innerText('#bk-hint');
    ok('the hard half is said out loud: "' + hint + '"',
       /old time comes off/i.test(hint) && /accepts/i.test(hint));

    /* Nothing has been sent yet. Opening a form is not doing anything. */
    ok('nothing has been moved by opening it',
       !(await calls(p)).some(c => c === 'reschedule'));
    await p.close();
  }

  console.log('\n==> proposing the new time replaces the old one');
  {
    const p = await page(b);
    const was = (await rowWhen(p))[0];
    await startMove(p);
    await p.waitForTimeout(400);
    await p.click('#bk-save');
    await p.waitForTimeout(1200);

    const c = await calls(p);
    ok('it went through the reschedule primitive, once: ' +
       JSON.stringify(c.filter(x => x === 'reschedule')),
       c.filter(x => x === 'reschedule').length === 1);
    /* The thing that must never happen: a cancel and a propose as two
       separate calls, which is the non-atomic version this replaces. */
    ok('and not as a cancel plus a booking',
       !c.some(x => x === 'cancelBooked') && !c.some(x => x === 'propose'));

    const upcoming = await rowWhen(p);
    ok('the old booking is off the calendar (was ' + was + '): ' + JSON.stringify(upcoming),
       upcoming.indexOf(was) < 0);

    /* The fixture already carries a proposal of Amir's that has nothing to do
       with this, so the question is not how many proposals there are — it is
       how many of them are this move. */
    const props = await p.$$eval('#prop-list .prop', e => e.map(x => x.innerText.replace(/\s+/g, ' ')));
    const moved = props.filter(t => /moved from/i.test(t));
    ok('exactly one moved time is waiting: ' + moved.length, moved.length === 1);
    ok('  it is waiting on the partner, not booked: "' + (moved[0] || '') + '"',
       /waiting on/i.test(moved[0] || ''));
    ok('  and it names the hour it came from: "' + (moved[0] || '') + '"',
       /* Case-insensitive: .prop-m is text-transform:uppercase, so innerText
          hands back the rendered capitals rather than the written ones. */
       new RegExp('moved from ' + was.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
         .test(moved[0] || ''));
    await p.close();
  }

  console.log('\n==> the calendar agrees with the sessions card');
  {
    /* The grid is drawn from its own filtered copy of the sessions, so it is
       a second place the same booking is described and a second place it can
       be described wrongly. After a move it must show the new hour and not
       the old one — a calendar still holding a cancelled session is the
       divergence this whole feature is supposed to make impossible. */
    const p = await page(b);
    const before = await p.$$eval('#cal-grid .cal-ev', e => e.length);
    await startMove(p);
    await p.waitForTimeout(400);
    await p.click('#bk-save');
    await p.waitForTimeout(1400);

    const blocks = await p.$$eval('#cal-grid .cal-ev',
      e => e.map(x => x.className + '|' + x.innerText.replace(/\s+/g, ' ')));
    ok('the calendar still holds the same number of things (' + before + '): ' + blocks.length,
       blocks.length === before);
    ok('and the moved one is drawn as waiting, not as booked: ' + JSON.stringify(blocks),
       blocks.some(t => /waiting/i.test(t)));
    ok('with nothing left showing as a live booking at the old hour',
       !blocks.some(t => /booked/.test(t.split('|')[0]) && /11:00/.test(t)));
    await p.close();
  }

  console.log('\n==> a refused move leaves the booking alone');
  {
    const p = await page(b, '/app.html',
      "window.__rescheduleFail = 'That time is no longer free — one of you has since agreed to something else then.';");
    const was = (await rowWhen(p))[0];
    await startMove(p);
    await p.waitForTimeout(400);
    await p.click('#bk-save');
    await p.waitForTimeout(800);

    const note = await p.innerText('#bk-note');
    ok('it says what the database said: "' + note.trim() + '"', /no longer free/i.test(note));
    ok('the form stays open so another time can be picked', await formOpen(p));
    ok('the button is usable again: "' + (await p.innerText('#bk-save')) + '"',
       await p.evaluate(() => !document.getElementById('bk-save').disabled));

    const upcoming = await rowWhen(p);
    ok('the original booking is exactly where it was: ' + JSON.stringify(upcoming),
       upcoming.indexOf(was) >= 0);
    ok('and nothing new was created',
       (await p.$$('#prop-list .prop[data-moved]')).length === 0);
    await p.close();
  }

  console.log('\n==> a time in the past never reaches the database');
  {
    const p = await page(b);
    await startMove(p);
    await p.waitForTimeout(400);
    /* Yesterday, forced past the menus the way a stale tab would. */
    await p.evaluate(() => {
      const d = new Date(Date.now() - 86400000);
      window.__forced = d.toISOString();
    });
    await p.evaluate(() => {
      /* The form's own state, reached the way the date box reaches it. */
      const any = new Date(Date.now() - 86400000);
      const iso = any.getFullYear() + '-' +
        String(any.getMonth() + 1).padStart(2, '0') + '-' +
        String(any.getDate()).padStart(2, '0');
      const trig = document.querySelector('#bk-sent .pick[data-k="day"] .trig');
      trig.click();
      const box = document.getElementById('bk-any');
      if (box) { box.min = ''; box.value = iso; }
      document.querySelector('#bk-sent [data-any]').click();
    });
    await p.waitForTimeout(300);
    await p.click('#bk-save');
    await p.waitForTimeout(600);
    const note = await p.innerText('#bk-note');
    ok('the page refuses it before the round trip: "' + note.trim() + '"', /past/i.test(note));
    ok('and no call was made', !(await calls(p)).some(x => x === 'reschedule'));
    await p.close();
  }

  console.log('\n==> pressing Propose twice moves it once');
  {
    const p = await page(b);
    await startMove(p);
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      const btn = document.getElementById('bk-save');
      btn.click(); btn.click();
    });
    await p.waitForTimeout(1200);
    const c = await calls(p);
    ok('one call, not two: ' + JSON.stringify(c.filter(x => x === 'reschedule')),
       c.filter(x => x === 'reschedule').length === 1);
    const moved = await p.$$eval('#prop-list .prop',
      e => e.filter(x => /moved from/i.test(x.innerText)).length);
    ok('and one moved proposal, not two: ' + moved, moved === 1);
    await p.close();
  }

  console.log('\n==> backing out of a move does not leave it armed');
  {
    /* The form is shared with ordinary booking, so a move abandoned halfway
       must not still be attached to the next thing proposed — that would
       cancel a booking nobody asked it to. */
    const p = await page(b);
    await startMove(p);
    await p.waitForTimeout(300);
    await p.click('#bk-close');
    await p.waitForTimeout(200);
    ok('the form closes', (await formOpen(p)) === false);

    await p.click('#cal-new');
    await p.waitForTimeout(300);
    ok('and reopens as an ordinary proposal: "' + (await p.innerText('#bk-save')) + '"',
       /propose this time/i.test(await p.innerText('#bk-save')));
    const head = (await p.innerText('#book-card .ch .grow')).replace(/\s+/g, ' ').trim();
    ok('  with its own heading back: "' + head + '"', /propose a time/i.test(head));
    ok('  and no session named under it', await p.evaluate(() =>
       document.getElementById('bk-was').hidden === true));

    await p.click('#bk-save');
    await p.waitForTimeout(900);
    const c = await calls(p);
    ok('and it books rather than moving: ' + JSON.stringify(c.filter(x => /propose|reschedule/.test(x))),
       c.some(x => x === 'propose') && !c.some(x => x === 'reschedule'));
    await p.close();
  }

  console.log('\n==> the partner hears that it moved, not that it was cancelled');
  {
    /* What the person on the other end sees. Their copy of the moved session
       is a proposal waiting on them, and the bell is where they meet it. */
    const soon = `
      var was = new Date(); was.setDate(was.getDate() + 1); was.setHours(19,0,0,0);
      var now2 = new Date(); now2.setDate(now2.getDate() + 3); now2.setHours(19,0,0,0);
      window.__sessions = [{id:'mv9',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:now2,durationMin:50,roomUrl:'pf:mv9',pairId:'r1',status:'proposed',
        proposedBy:'them',mine:false,cancelledByMe:false,goal:null,goalDone:null,
        attended:null,joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:was,
        completedAt:null,cancelledAt:null}];
    `;
    const p = await page(b, '/app.html', soon);
    await p.click('#pf-bell');
    await p.waitForTimeout(400);
    const row = await p.$eval('#pf-list .bell-item', e => e.innerText.replace(/\s+/g, ' '));
    ok('the bell says it was moved: "' + row + '"', /moved your session to/i.test(row));
    ok('  and what it was moved from: "' + row + '"', /was /i.test(row));
    ok('  and never that it was cancelled: "' + row + '"', !/cancelled/i.test(row));
    await p.close();
  }

  console.log('\n==> a session that has started is not offered a move');
  {
    const dial = `
      var s = new Date(); s.setMinutes(s.getMinutes() - 10);
      window.__sessions = [{id:'live1',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:s,durationMin:50,roomUrl:'pf:live1',pairId:'r1',status:'confirmed',
        proposedBy:'them',mine:false,cancelledByMe:false,goal:null,goalDone:null,
        attended:null,joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null,
        completedAt:null,cancelledAt:null}];
    `;
    const p = await page(b, '/app.html', dial);
    const acts = await rowActs(p);
    ok('an hour already under way offers no Reschedule: ' + JSON.stringify(acts),
       acts.indexOf('Reschedule') < 0);
    await p.close();
  }

  console.log('\n==> reliability is untouched by any of this');
  {
    /* The words on the Cancel button are the visible edge of the grading
       policy, and this change deliberately did not move them: an early move
       and an early cancellation cost the same nothing, a late one costs the
       same as a late cancellation. If this ever fails, the policy has been
       changed by accident. */
    const p = await page(b);
    await p.evaluate(() => document.querySelector('#upcoming [data-cancel-booked]').click());
    await p.waitForTimeout(300);
    const note = await p.$eval('#upcoming .slot .slot-err', e => e.textContent);
    ok('the cancellation notice still says what it always said: "' + note.trim() + '"',
       /costs you nothing|late cancellation/i.test(note));
    await p.close();
  }

  console.log('\n==> on a phone');
  {
    const p = await page(b, '/app.html', null, 390);
    const acts = await rowActs(p);
    ok('both controls survive the narrow row: ' + JSON.stringify(acts),
       acts.indexOf('Reschedule') >= 0 && acts.indexOf('Cancel') >= 0);
    await startMove(p);
    await p.waitForTimeout(600);
    ok('the form opens', await formOpen(p));
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('nothing pushes the page sideways (' + over + 'px)', over <= 1);
    const w = await p.evaluate(() =>
      Math.round(document.getElementById('book-card').getBoundingClientRect().width));
    ok('the card fits (' + w + 'px of 390)', w <= 390);
    await p.close();
  }

  console.log('\n==> on a desktop');
  {
    const p = await page(b, '/app.html', null, 1440);
    await startMove(p);
    await p.waitForTimeout(900);
    const seen = await p.evaluate(() => {
      const r = document.getElementById('book-card').getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    ok('the form is on screen after the press', seen);
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('and the page does not scroll sideways (' + over + 'px)', over <= 1);
    await p.close();
  }

  await b.close();
  console.log('\n===================================================');
  console.log(fails ? '\x1b[31m' + fails + ' failed\x1b[0m' : '\x1b[32mall checks pass\x1b[0m');
  process.exit(fails ? 1 : 0);
})();
