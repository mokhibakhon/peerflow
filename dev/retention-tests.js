/* The two places a partnership goes quiet, asserted rather than hoped for.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/retention-tests.js 9000
 *
 * Both of them are the same shape of bug and neither shows in the markup:
 * somebody presses a button, the database is updated correctly, and the page
 * comes back looking exactly as it did. Every check here is therefore about
 * what is on screen AFTER the press, not about whether the call was made.
 *
 *   ACCEPT → FIRST SESSION. Saying yes wrote a row and reloaded the
 *   directory. The person who asked was told nothing that survived the tab
 *   being closed, and the person who accepted was handed back a page of
 *   strangers. Now the accept notifies, and both ends carry a link that opens
 *   the booking form with the other person already in it.
 *
 *   COMPLETED → NEXT. "Study again" recorded a preference and waited for the
 *   partner to record the same one. If they had not — which is the ordinary
 *   case, since somebody has to answer first — the press went nowhere. Now it
 *   ends in a proposal, and the two-sided rule is untouched: it proposes, the
 *   partner still accepts.
 *
 * The edge cases are the point of the file. A second press, a second visit to
 * the same emailed link, a partnership that has since ended, and an hour that
 * is already booked all have to end somewhere sensible and none of them may
 * produce a second session.
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

/* A session three hours ago that the room watched you attend, so the check-in
 * is due on it. `extra` is spliced in after, so each case can change what is
 * around it without rebuilding the row. */
const finished = (extra) => `
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
  await p.waitForTimeout(700);
  return p;
}

/* Which db.js functions the page called, in order. The stub records them, and
 * it is the only way to assert "exactly once" about a button that can be
 * pressed twice before the first answer lands. */
const calls = (p) => p.evaluate(() => {
  try { return JSON.parse(sessionStorage.getItem('__calls') || '[]'); }
  catch (e) { return []; }
});

/* The booking form is the deliverable of nearly every case here: it either
 * opened with the right person and a sensible hour in it, or it did not. */
const formOpen = (p) => p.evaluate(() => {
  const c = document.getElementById('book-card');
  return !!c && !c.hidden;
});
const sentence = (p) => p.evaluate(() =>
  (document.getElementById('bk-sent').innerText || '').replace(/\s+/g, ' ').trim());

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });

  /* ============================================================
     ACCEPT → FIRST SESSION
     ============================================================ */

  console.log('\n==> accepting a request ends somewhere');
  {
    const dial = `
      window.__incoming = [{id:'q1',from_user:'m2',to_user:'u1',status:'pending',
        message:'want to pair on TryHackMe?',created_at:new Date().toISOString(),
        other:{id:'m2',name:'Dilnoza Rahimova',track_id:'cybersecurity',
               topic:'Pentesting',level:'tutorials',timezone:'Asia/Tashkent',
               availability:['thu-evening']}}];
    `;
    const p = await page(b, '/app-people.html', dial);
    /* A marker that a reload would wipe. The old handler reloaded, which is
       the behaviour being replaced, and "did it reload" is otherwise
       invisible after the fact. */
    await p.evaluate(() => { window.__stillHere = true; });

    ok('the request is in the inbox', (await p.$$('#inbox-list .inreq')).length === 1);

    await p.click('#inbox-list [data-answer="accepted"]');
    await p.waitForTimeout(500);

    ok('the answer reached the database',
       (await calls(p)).some(c => c === 'respond:q1:accepted'));
    ok('the page did not reload out from under the answer',
       await p.evaluate(() => window.__stillHere === true));

    const acts = await p.innerText('#inbox-list .inreq-acts');
    ok('the row now offers the first session: "' + acts.trim() + '"',
       /plan your first session/i.test(acts));

    const href = await p.getAttribute('#inbox-list .inreq-acts a', 'href');
    ok('and it points at the booking form with them in it: ' + href,
       href === 'app.html?plan=m2');

    const msg = await p.innerText('#inbox-list .inreq-msg');
    ok('it says what has actually happened: "' + msg.trim() + '"',
       /partners/i.test(msg) && /proposes a time/i.test(msg));

    const chip = await p.innerText('#people [data-id="m2"] .pstate');
    ok('their row in the directory agrees: "' + chip.trim() + '"', /partners/i.test(chip));

    const head = await p.innerText('#inbox-t');
    ok('the heading stops saying something is waiting: "' + head + '"',
       !/waiting on you/i.test(head));

    /* Declining is the other half of the same handler and must not have
       gained a call to action. */
    const p2 = await page(b, '/app-people.html', dial);
    await p2.click('#inbox-list [data-answer="declined"]');
    await p2.waitForTimeout(500);
    const dacts = await p2.innerText('#inbox-list .inreq-acts');
    ok('declining says so and offers nothing: "' + dacts.trim() + '"',
       /declined/i.test(dacts) && !/plan/i.test(dacts));
    ok('and no booking link is drawn on a decline',
       (await p2.$$('#inbox-list .inreq-acts a')).length === 0);
    await p2.close();
    await p.close();
  }

  console.log('\n==> the bell carries the same next step');
  {
    /* Nothing booked with them yet: the accepted request is the moment to
       plan the first session, and the bell is where the person who asked
       finds out. */
    const p = await page(b, '/app.html', 'window.__empty = true;');
    await p.click('#pf-bell');
    await p.waitForTimeout(400);
    const go = await p.$eval('#pf-list .bell-item a.btn', a => a.getAttribute('href') + ' | ' + a.textContent);
    ok('with nothing booked it offers the first session: ' + go,
       go.indexOf('app.html?plan=u2') === 0 && /plan your first session/i.test(go));
    await p.close();

    /* Something already arranged with them: telling somebody to plan their
       first session is telling them to do a thing they have done. */
    const p2 = await page(b, '/app.html');
    await p2.click('#pf-bell');
    await p2.waitForTimeout(400);
    /* The row about the accepted request specifically. The panel also holds
       whatever needs answering, which has a button of its own. */
    const go2 = await p2.evaluate(() => {
      const row = [...document.querySelectorAll('#pf-list .bell-item')]
        .filter(x => /accepted your request/i.test(x.innerText))[0];
      const a = row && row.querySelector('a.btn');
      return a ? a.getAttribute('href') + ' | ' + a.textContent : 'no row';
    });
    ok('with a session on the table it goes back to the partner page: ' + go2,
       go2.indexOf('app-sessions.html') === 0);
    await p2.close();
  }

  console.log('\n==> the accepted-request note is not said twice');
  {
    const dial = `
      window.__empty = true;
      window.__notes = [{id:'n9',kind:'partner',title:'Amir Karimov said yes',
        body:'You are partners now.',href:'app.html?plan=u2',readAt:null,
        createdAt:new Date().toISOString()}];
    `;
    const p = await page(b, '/app.html', dial);
    await p.click('#pf-bell');
    await p.waitForTimeout(400);
    const said = await p.$$eval('#pf-list .bell-item', e => e.map(x => x.innerText.replace(/\s+/g, ' ')));
    const yes = said.filter(t => /Amir Karimov/.test(t) && /(said yes|accepted your request)/i.test(t));
    ok('one row about it, not two: ' + JSON.stringify(yes), yes.length === 1);
    await p.close();
  }

  console.log('\n==> app.html?plan= opens the form on that person');
  {
    const p = await page(b, '/app.html?plan=u2', 'window.__empty = true;');
    ok('the booking form is open', await formOpen(p));
    const st = await sentence(p);
    ok('and the sentence is about them: "' + st + '"', /Amir/.test(st));
    ok('a first session opens at 25 minutes: "' + st + '"', /25 minutes/.test(st));
    await p.close();
  }

  console.log('\n==> and does not open a second one on top of the first');
  {
    /* The same link, followed again a week later, with a time now waiting on
       an answer. The band says what is in flight; the form stays shut. */
    const p = await page(b, '/app.html?plan=u2');
    ok('the form stays closed when something is already on the table',
       (await formOpen(p)) === false);
    await p.close();
  }

  console.log('\n==> the band names a partner you have never met');
  {
    /* One partnership with a month of history, one brand new. This used to
       need EVERY partnership to be new before it would say anything about a
       first session, so the person you had never spoken to was described as
       "book your next session". */
    const dial = `
      window.__manyPartners = 2;
      var d = new Date(); d.setDate(d.getDate() - 9); d.setHours(19,0,0,0);
      window.__sessions = [{id:'h1',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:d,durationMin:50,roomUrl:'pf:h1',pairId:'r1',status:'completed',
        proposedBy:'me',mine:true,cancelledByMe:false,goal:null,goalDone:null,
        attended:true,joinedAt:d,attendance:'attended',attendanceSource:'livekit',
        settledAt:d,partnerOk:null,checkedInAt:d,continuePref:null,
        completedAt:d,cancelledAt:null}];
    `;
    const p = await page(b, '/app.html', dial);
    const h = await p.innerText('#now-h');
    const k = await p.innerText('#now-k');
    ok('the band is about the first session: ' + k + ' / ' + h,
       /first session/i.test(k) && /first session with/i.test(h));
    ok('and it names the one with no history: ' + h, /Asalxon/.test(h));
    const pick = await p.getAttribute('#now-a a.btn', 'data-pick');
    ok('the button points the form at that same person (data-pick=' + pick + ')', pick === '1');
    await p.close();
  }

  /* ============================================================
     COMPLETED → NEXT SESSION
     ============================================================ */

  console.log('\n==> "study again" ends in a proposal');
  {
    const p = await page(b, '/app.html', finished());
    ok('the check-in is asked', (await p.$$('#ci-list .cirow')).length === 1);

    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(600);

    const c = await calls(p);
    ok('the answer is recorded once: ' + JSON.stringify(c.filter(x => /^checkin:/.test(x))),
       c.filter(x => /^checkin:/.test(x)).length === 1);
    ok('and it is recorded as continuing', c.some(x => x === 'checkin:c1:-:continue'));

    ok('the booking form is open', await formOpen(p));
    const st = await sentence(p);
    ok('the same partner is already in it: "' + st + '"', /Amir/.test(st));

    const h = await p.innerText('#now-h');
    ok('the band asks the next question: "' + h + '"', /Another one with Amir/.test(h));

    const row = await p.innerText('#ci-list .cirow');
    ok('the row says the answer was kept: "' + row.replace(/\s+/g, ' ').trim() + '"',
       /like to carry on/i.test(row) && /pick a time/i.test(row));
    ok('and stops offering buttons nothing can now answer',
       (await p.$$('#ci-list .cirow button')).length === 0);

    /* Nothing was booked. The two-sided rule is the thing this feature was
       most likely to break: a proposal is sent by pressing Propose, not by
       answering a check-in. */
    ok('nothing was proposed by the check-in itself',
       !(await calls(p)).some(x => x === 'propose'));
    await p.close();
  }

  console.log('\n==> the suggested time is real');
  {
    /* Two shared hours on a day two days out, and the first of them already
       booked. The suggestion has to step over it — an hour you are looking at
       on your own calendar is not an hour to offer somebody. */
    const dial = finished(`
      var wd = (new Date().getDay() + 2) % 7;
      window.__sharedBy = {}; window.__sharedBy[wd] = [19, 20];
      var d = new Date(); d.setHours(19,0,0,0); d.setDate(d.getDate() + 2);
      window.__sessions = window.__sessions.concat([{id:'b1',
        partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:d,durationMin:50,
        roomUrl:'pf:b1',pairId:'rX',status:'confirmed',proposedBy:'me',mine:true,
        cancelledByMe:false,goal:null,goalDone:null,attended:null,joinedAt:null,
        attendance:null,attendanceSource:null,settledAt:null,partnerOk:null,
        checkedInAt:null,continuePref:null,completedAt:null,cancelledAt:null}]);
    `);
    const p = await page(b, '/app.html', dial);
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(600);

    const st = await sentence(p);
    /* Asked of the browser rather than written out, so the check does not
       depend on the container's locale. */
    const taken = await p.evaluate(() => {
      const d = new Date(); d.setHours(19, 0, 0, 0);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    });
    const free = await p.evaluate(() => {
      const d = new Date(); d.setHours(20, 0, 0, 0);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    });
    ok('it skips the hour already booked (' + taken + ') and offers ' + free + ': "' + st + '"',
       st.indexOf(free) >= 0 && st.indexOf(taken) < 0);

    const at = await p.evaluate(() => {
      const el = document.getElementById('now-s');
      return el ? el.innerText : '';
    });
    ok('and the band says the same hour: "' + at + '"', at.indexOf(free) >= 0);
    await p.close();
  }

  console.log('\n==> pressing it twice does not book twice');
  {
    const p = await page(b, '/app.html', finished());
    /* Both presses go in without waiting, which is what a double click is. */
    await p.evaluate(() => {
      const btn = document.querySelector('#ci-list [data-ci-go="continue"]');
      btn.click(); btn.click();
    });
    await p.waitForTimeout(700);
    const c = await calls(p);
    ok('one check-in, not two: ' + JSON.stringify(c.filter(x => /^checkin:/.test(x))),
       c.filter(x => /^checkin:/.test(x)).length === 1);
    ok('and no session was created', !c.some(x => x === 'propose'));
    const disabled = await p.$$eval('#ci-list .cirow button', e => e.every(x => x.disabled));
    ok('the row cannot be answered again', disabled);
    await p.close();
  }

  console.log('\n==> already something on the table with them');
  {
    /* The default fixture has a proposal from Amir three days out. Answering
       "study again" about a session with the same partnership must not open a
       second proposal on top of it. */
    const dial = `
      var s = new Date(); s.setHours(s.getHours() - 3);
      var later = new Date(); later.setDate(later.getDate() + 3); later.setHours(19,0,0,0);
      window.__sessions = [
        {id:'c1',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:s,
         durationMin:50,roomUrl:'pf:c1',pairId:'r1',status:'completed',proposedBy:'them',
         mine:false,cancelledByMe:false,goal:null,goalDone:null,attended:true,joinedAt:s,
         attendance:'attended',attendanceSource:'livekit',settledAt:s,partnerOk:null,
         checkedInAt:null,continuePref:null,completedAt:s,cancelledAt:null},
        {id:'c2',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:later,
         durationMin:50,roomUrl:'pf:c2',pairId:'r1',status:'proposed',proposedBy:'me',
         mine:true,cancelledByMe:false,goal:null,goalDone:null,attended:null,joinedAt:null,
         attendance:null,attendanceSource:null,settledAt:null,partnerOk:null,
         checkedInAt:null,continuePref:null,completedAt:null,cancelledAt:null}];
    `;
    const p = await page(b, '/app.html', dial);
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(600);

    ok('the answer is still recorded',
       (await calls(p)).some(x => /^checkin:c1:.*:continue$/.test(x)));
    ok('the form is not opened on top of it', (await formOpen(p)) === false);
    const row = await p.innerText('#ci-list .cirow');
    ok('and the row says why: "' + row.replace(/\s+/g, ' ').trim().slice(-70) + '"',
       /already asked/i.test(row) && /Amir/.test(row));
    await p.close();
  }

  console.log('\n==> the partnership has ended');
  {
    const p = await page(b, '/app.html', finished('window.__noPartner = true;'));
    ok('the check-in is still asked about the session that happened',
       (await p.$$('#ci-list .cirow')).length === 1);
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(600);
    ok('the answer is still recorded',
       (await calls(p)).some(x => /^checkin:c1:.*:continue$/.test(x)));
    ok('no form is opened to a partner who is gone', (await formOpen(p)) === false);
    const row = await p.innerText('#ci-list .cirow');
    ok('and it says so plainly: "' + row.replace(/\s+/g, ' ').trim().slice(-80) + '"',
       /not partners/i.test(row));
    await p.close();
  }

  console.log('\n==> a standing slot is the suggestion');
  {
    /* The two of them already agreed an hour a week. That is the most
       reasonable next time there is, and the form should open on it rather
       than on whichever shared hour comes first. materialiseStanding has
       booked the next occurrence, so the suggestion is the week after. */
    const p = await page(b, '/app.html',
      finished('window.__standing = {minutes:50, agreed:true, mine:true};'));
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(600);
    const st = await sentence(p);
    const want = await p.evaluate(() => {
      const d = new Date(); d.setHours(19, 0, 0, 0);
      const k = (4 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + k);
      return d.toLocaleDateString(undefined, { weekday: 'long' }) + '|' +
             d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    });
    const [day, hour] = want.split('|');
    ok('it opens on the standing day and hour (' + day + ' ' + hour + '): "' + st + '"',
       st.indexOf(day) >= 0 && st.indexOf(hour) >= 0);
    ok('at the length the two of them agreed: "' + st + '"', /50 minutes/.test(st));
    await p.close();
  }

  console.log('\n==> the check-in still ends a partnership when asked to');
  {
    /* The other button on the same row. Nothing about it changed and nothing
       about it may change: it is the one irreversible thing there. */
    const p = await page(b, '/app.html', finished());
    await p.click('#ci-list [data-ci-go="stop"]');
    await p.waitForTimeout(300);
    const armed = await p.innerText('#ci-list [data-ci-go="stop"]');
    ok('it still asks twice: "' + armed + '"', /sure/i.test(armed));
    await p.click('#ci-list [data-ci-go="stop"]');
    await p.waitForTimeout(500);
    ok('and then goes through as before',
       (await calls(p)).some(x => /^checkin:c1:.*:stop$/.test(x)));
    await p.close();
  }

  console.log('\n==> on a phone');
  {
    const p = await page(b, '/app.html', finished(), 390);
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(700);
    ok('the form still opens', await formOpen(p));
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('nothing pushes the page sideways (' + over + 'px)', over <= 1);
    const wide = await p.evaluate(() => {
      const el = document.getElementById('book-card');
      return Math.round(el.getBoundingClientRect().width);
    });
    ok('the booking card fits the screen (' + wide + 'px of 390)', wide <= 390);
    const btn = await p.evaluate(() => {
      const r = document.getElementById('bk-save').getBoundingClientRect();
      return Math.round(r.height);
    });
    /* The shared control height, not a number invented here — what is being
       checked is that the phone layout has not shrunk it. */
    ok('and Propose is still a real target (' + btn + 'px tall)', btn >= 36);
    await p.close();
  }

  console.log('\n==> on a desktop the form lands where it was asked for');
  {
    const p = await page(b, '/app.html', finished(), 1440);
    await p.click('#ci-list [data-ci-go="continue"]');
    await p.waitForTimeout(900);
    const seen = await p.evaluate(() => {
      const r = document.getElementById('book-card').getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    ok('the booking card is on screen after the press', seen);
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
