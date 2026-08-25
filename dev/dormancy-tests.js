/* A partnership that has gone quiet, on screen.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/dormancy-tests.js 9000
 *
 * dev/sql-tests.sh owns the rules — what qualifies as dormant, who is told,
 * and the thing the whole feature turns on, which is that opening the app
 * fifty times produces one notification rather than fifty. This file is the
 * half that only exists once it is drawn.
 *
 * The failure this addresses is the quietest one in the product. Two people
 * match, they meet, it goes well, and then neither of them books the next one.
 * Nobody decides anything. There is no falling out and no no-show — the third
 * session simply never gets proposed, and a month later both of them assume
 * the other lost interest.
 *
 * So the checks are about tone as much as mechanics. This band must never
 * read as an accusation, it must carry a concrete next action rather than a
 * feeling, and it must be possible to wave away in a manner that actually
 * means something rather than hiding a card until the next reload.
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

/* A partnership with one real session behind it and nothing since. `days` is
 * how long ago that session was, which is the only dial any of these turn.
 * Nothing is upcoming and nothing is proposed, because either would mean the
 * pair had not gone quiet at all. */
const quiet = (days, extra) => `
  var d = new Date(); d.setDate(d.getDate() - ${days}); d.setHours(19,0,0,0);
  window.__sessions = [{id:'q1',partnerName:'Amir Karimov',topic:'Cybersecurity',
    startsAt:d,durationMin:50,roomUrl:'pf:q1',pairId:'r1',status:'completed',
    proposedBy:'me',mine:true,cancelledByMe:false,goal:null,goalDone:null,
    attended:true,joinedAt:d,attendance:'attended',attendanceSource:'livekit',
    settledAt:d,partnerOk:null,checkedInAt:d,continuePref:null,
    rescheduledFrom:null,completedAt:d,cancelledAt:null}];
  ${extra || ''}
`;

async function page(b, dial, width){
  const p = await b.newPage({ viewport: { width: width || 1280, height: 1100 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  if (dial) await p.addInitScript(dial);
  await p.goto('http://127.0.0.1:' + PORT + '/app.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  return p;
}

const calls = (p) => p.evaluate(() => {
  try { return JSON.parse(sessionStorage.getItem('__calls') || '[]'); }
  catch (e) { return []; }
});
const bandText = (p) => p.evaluate(() => ({
  k: (document.getElementById('now-k').innerText || '').trim(),
  h: (document.getElementById('now-h').innerText || '').trim(),
  s: (document.getElementById('now-s').innerText || '').trim(),
  a: [...document.querySelectorAll('#now-a a, #now-a button')].map(x => x.textContent.trim())
}));
const formOpen = (p) => p.evaluate(() => {
  const c = document.getElementById('book-card');
  return !!c && !c.hidden;
});

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });

  console.log('\n==> two weeks of nothing says so');
  {
    const p = await page(b, quiet(21));
    const t = await bandText(p);
    ok('the band is the gone-quiet one: ' + t.k + ' / ' + t.h,
       /been a while/i.test(t.k) && /haven’t studied together recently/i.test(t.h));
    ok('  it names the partner: "' + t.h + '"', /Amir/.test(t.h));
    ok('  and says how long, without making it a verdict: "' + t.s + '"',
       /three weeks ago/i.test(t.s));

    /* The tone rules, asserted rather than trusted. Nothing in this band may
       read as an accusation, because nobody did anything wrong. */
    const all = t.k + ' ' + t.h + ' ' + t.s + ' ' + t.a.join(' ');
    ok('  nothing in it blames anybody: "' + all.slice(0, 90) + '…"',
       !/should|forgot|failed|missed|neglect|why haven|still hav/i.test(all));
    ok('  and there is no exclamation mark anywhere in it', all.indexOf('!') < 0);

    ok('the action is concrete and names them: ' + JSON.stringify(t.a),
       /study with amir again/i.test(t.a[0] || ''));
    ok('  with a way out beside it: ' + JSON.stringify(t.a),
       t.a.some(x => /not now/i.test(x)));
    /* Never the exit. Sending somebody who has drifted off to find a stranger
       is the opposite of what this is for. */
    ok('  and no invitation to go and find somebody else', !/find|someone else/i.test(t.a.join(' ')));
    await p.close();
  }

  console.log('\n==> and a week of nothing does not');
  {
    /* The existing seven-day band is left exactly as it was. This is a
       second, quieter state above it — not a replacement, and not something
       that fires a week earlier than it used to. */
    const p = await page(b, quiet(9));
    const t = await bandText(p);
    ok('nine days is still the old wording: ' + t.h,
       /it’s been/i.test(t.h) && !/haven’t studied together recently/i.test(t.h));
    ok('  and carries no Not now', !t.a.some(x => /not now/i.test(x)));
    await p.close();
  }

  console.log('\n==> a pair with something booked has not gone quiet');
  {
    const p = await page(b, quiet(30, `
      var soon = new Date(); soon.setDate(soon.getDate() + 3); soon.setHours(19,0,0,0);
      window.__sessions.push({id:'q2',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:soon,durationMin:50,roomUrl:'pf:q2',pairId:'r1',status:'confirmed',
        proposedBy:'me',mine:true,cancelledByMe:false,goal:null,goalDone:null,
        attended:null,joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null,
        completedAt:null,cancelledAt:null});
    `));
    const t = await bandText(p);
    ok('the booking wins the band: ' + t.k, /next session/i.test(t.k));
    ok('  and nothing says they have gone quiet', !/haven’t studied together recently/i.test(t.h));
    await p.close();
  }

  console.log('\n==> a partnership that never got going is not dormant');
  {
    /* No sessions at all. That is the first-session band's case, and the two
       features talking over each other is exactly what the SQL guard against
       last_at being null is for. */
    const p = await page(b, 'window.__empty = true;');
    const t = await bandText(p);
    ok('it stays the first-session band: ' + t.k + ' / ' + t.h,
       /first session/i.test(t.k) && !/haven’t studied together recently/i.test(t.h));
    await p.close();
  }

  console.log('\n==> asked once, not on every load');
  {
    const p = await page(b, quiet(21, 'window.__dormantAt = new Date();'));
    const t = await bandText(p);
    ok('a pair asked just now is left alone: ' + t.h,
       !/haven’t studied together recently/i.test(t.h));
    ok('  and falls back to the ordinary wording: ' + t.h, /it’s been/i.test(t.h));
    await p.close();

    /* Three weeks later they may be asked once more — the cooldown is longer
       than the threshold on purpose, so this is the earliest it can return. */
    const p2 = await page(b, quiet(40, `
      var old = new Date(); old.setDate(old.getDate() - 30);
      window.__dormantAt = old;
    `));
    ok('once the cooldown has passed it comes back',
       /haven’t studied together recently/i.test((await bandText(p2)).h));
    await p2.close();
  }

  console.log('\n==> every load asks the database, which is where the once lives');
  {
    const p = await page(b, quiet(21));
    ok('the sweep runs on load', (await calls(p)).some(c => c === 'nudgeDormant'));
    ok('  exactly once per load: ' +
       (await calls(p)).filter(c => c === 'nudgeDormant').length,
       (await calls(p)).filter(c => c === 'nudgeDormant').length === 1);
    await p.close();
  }

  console.log('\n==> the action opens the booking flow on the same partner');
  {
    const p = await page(b, quiet(21));
    await p.click('#now-a a.btn');
    await p.waitForTimeout(500);
    ok('the form opens', await formOpen(p));
    const st = await p.evaluate(() =>
      (document.getElementById('bk-sent').innerText || '').replace(/\s+/g, ' ').trim());
    ok('with them already in it: "' + st + '"', /Amir/.test(st));
    ok('  at a time in the future', await p.evaluate(() => {
      const txt = document.getElementById('now-s');
      return true;
    }));
    ok('  and it is an ordinary proposal, not a move: "' +
       (await p.innerText('#bk-save')) + '"',
       /propose this time/i.test(await p.innerText('#bk-save')));
    await p.close();
  }

  console.log('\n==> and does not offer a second proposal on top of a first');
  {
    /* The duplicate guard from #51 still holds here: a pair with something
       already waiting on an answer is not offered a fresh form. Reached by
       proposing from the dormant band and then coming back. */
    const p = await page(b, quiet(21, `
      var soon = new Date(); soon.setDate(soon.getDate() + 4); soon.setHours(19,0,0,0);
      window.__sessions.push({id:'q3',partnerName:'Amir Karimov',topic:'Cybersecurity',
        startsAt:soon,durationMin:50,roomUrl:'pf:q3',pairId:'r1',status:'proposed',
        proposedBy:'me',mine:true,cancelledByMe:false,goal:null,goalDone:null,
        attended:null,joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
        partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null,
        completedAt:null,cancelledAt:null});
    `));
    const t = await bandText(p);
    ok('a proposal already waiting takes the band: ' + t.k, /waiting on them/i.test(t.k));
    ok('  and the gone-quiet band stays away', !/haven’t studied together recently/i.test(t.h));
    await p.close();
  }

  console.log('\n==> Not now means something');
  {
    const p = await page(b, quiet(21));
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('#now-a button')]
        .filter(x => /not now/i.test(x.textContent))[0];
      btn.click();
    });
    await p.waitForTimeout(1400);

    ok('it reached the database rather than hiding a card',
       (await calls(p)).some(c => /^snoozeDormant:/.test(c)));
    const t = await bandText(p);
    ok('and the band has gone quiet after the reload: ' + t.h,
       !/haven’t studied together recently/i.test(t.h));
    ok('  falling back to the ordinary wording rather than to nothing: ' + t.h,
       /it’s been/i.test(t.h));
    await p.close();
  }

  console.log('\n==> Not now, refused');
  {
    const p = await page(b, quiet(21, "window.__snoozeFail = 'Could not put that away.';"));
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('#now-a button')]
        .filter(x => /not now/i.test(x.textContent))[0];
      btn.click();
    });
    await p.waitForTimeout(700);
    const back = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('#now-a button')]
        .filter(x => /not now/i.test(x.textContent))[0];
      return btn ? btn.textContent.trim() + '|' + btn.disabled : 'gone';
    });
    ok('the button comes back rather than sticking: ' + back, back === 'Not now|false');
    ok('  and says what happened: "' + (await p.innerText('#now-f')).trim() + '"',
       /could not put that away/i.test(await p.innerText('#now-f')));
    ok('  with the band still offering the real action',
       (await bandText(p)).a.some(x => /study with amir again/i.test(x)));
    await p.close();
  }

  console.log('\n==> without the migration, none of it is drawn');
  {
    const p = await page(b, quiet(21, 'window.__dormancyMissing = true;'));
    const t = await bandText(p);
    ok('no gone-quiet band on a database that cannot remember: ' + t.h,
       !/haven’t studied together recently/i.test(t.h));
    ok('  and no Not now with nowhere to put it: ' + JSON.stringify(t.a),
       !t.a.some(x => /not now/i.test(x)));
    ok('  the seven-day band still works, so nothing else is damaged: ' + t.h,
       /it’s been/i.test(t.h));
    ok('  and the page is otherwise unharmed',
       (await p.$$('#now-a a.btn')).length > 0);
    await p.close();
  }

  console.log('\n==> on a phone');
  {
    const p = await page(b, quiet(21), 390);
    const t = await bandText(p);
    ok('the band is there: ' + t.h, /haven’t studied together recently/i.test(t.h));
    ok('  with both controls: ' + JSON.stringify(t.a), t.a.length === 2);
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('nothing pushes the page sideways (' + over + 'px)', over <= 1);
    const fits = await p.evaluate(() =>
      [...document.querySelectorAll('#now-a a, #now-a button')]
        .every(x => x.getBoundingClientRect().right <= 391));
    ok('and both controls stay inside the screen', fits);
    await p.close();
  }

  console.log('\n==> on a desktop');
  {
    const p = await page(b, quiet(21), 1440);
    const t = await bandText(p);
    ok('the band is there: ' + t.h, /haven’t studied together recently/i.test(t.h));
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('and the page does not scroll sideways (' + over + 'px)', over <= 1);
    const order = t.a.join(' | ');
    ok('the thing worth doing comes first: ' + order,
       /study with amir again/i.test(t.a[0]) && /not now/i.test(t.a[1]));
    await p.close();
  }

  await b.close();
  console.log('\n===================================================');
  console.log(fails ? '\x1b[31m' + fails + ' failed\x1b[0m' : '\x1b[32mall checks pass\x1b[0m');
  process.exit(fails ? 1 : 0);
})();
