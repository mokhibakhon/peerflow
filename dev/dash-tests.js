/* The dashboard, asserted rather than admired.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/dash-tests.js 9000
 *
 * Every check here is a claim app.html makes that reads fine in the DOM
 * whether or not it is true: how many cards the rail has, whether a card
 * hides when all of its blocks do, whether the same booking is still printed
 * three times, whether every card title on the page really is one size.
 *
 * The last one is the reason this file exists. Two bugs during this work were
 * both "the right markup in the wrong box" — a class collision that gave an
 * 8px bar the green band's 26px padding, and a `.pair span` selector that
 * outranked `.av` and knocked a letter out of its circle. Neither showed in
 * the markup, and neither would have been caught by asserting on text. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

async function open(b, dials){
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  p.on('console', m => { if (m.type()==='error' && !/net::ERR_/.test(m.text())) { fails++; console.log('  console error: ' + m.text().slice(0,140)); } });
  if (dials) await p.addInitScript(dials);
  await p.goto('http://127.0.0.1:' + PORT + '/app.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n==> the page names itself');
  let p = await open(b);
  const h1 = await p.$$eval('h1', e => e.map(x => x.innerText.trim()));
  ok('exactly one <h1>, and it is the page: ' + JSON.stringify(h1), h1.length === 1 && h1[0] === 'Today');
  ok('the date is filled in: "' + (await p.innerText('#page-date')) + '"',
     (await p.innerText('#page-date')).length > 6);

  console.log('\n==> one card heading, one size');
  const sizes = await p.$$eval('.ch h2, .ch h3, .rail h3, .b h2',
    e => [...new Set(e.map(x => getComputedStyle(x).fontSize + '/' + getComputedStyle(x).fontWeight))]);
  ok('every card title computes the same: ' + sizes.join(' '), sizes.length === 1 && sizes[0] === '17px/700');
  ok('no icon tile left on the dashboard', (await p.$$('.gl')).length === 0);

  console.log('\n==> the rail is two cards');
  const rail = await p.$$eval('.dash-rail > section:not([hidden])', e => e.map(x => x.id));
  ok('two visible rail cards: ' + rail.join(', '), rail.length === 2);
  const blks = await p.$$eval('.blk:not([hidden])', e => e.map(x => x.id));
  ok('four visible blocks inside them: ' + blks.join(', '), blks.length === 4);
  const lnks = await p.$$eval('.dash-rail .rail-l', e => e.map(x => x.innerText.trim()));
  ok('one link per card, not one per block: ' + lnks.join(' | '), lnks.length === 2);

  console.log('\n==> the same booking is not printed three times');
  const booking = await p.evaluate(() => {
    const t = document.body.innerText;
    return { band: /Today at .* with/.test(t),
             cal: !!document.querySelector('.cal-ev'),
             listShown: !document.getElementById('upcoming').hidden,
             listInDom: !!document.querySelector('#upcoming [data-cancel-booked]') };
  });
  ok('the band still says it', booking.band);
  ok('the calendar still shows it', booking.cal);
  ok('the list no longer repeats it', booking.listShown === false, JSON.stringify(booking));
  ok('but the row is still in the DOM, so the band can relay a cancel into it',
     booking.listInDom, JSON.stringify(booking));

  console.log('\n==> that relay still works');
  /* The band's Cancel is a relay: the visible button is in the band, the real
     one is a row inside #upcoming — which this change now hides while there is
     only one booking. Two things have to hold, and both are about the hiding.
     The click has to still reach the row, and the section has to be revealed
     BEFORE it lands, because otherwise a failure would be reported into
     something nobody can see. Recording the visibility from inside the row's
     own listener tests the ordering rather than the end state.
     A successful cancel ends in window.location.reload(), which is why the
     flag is parked in sessionStorage: anything on window is gone by the time
     it could be read, and reading undefined there looks exactly like a click
     that never arrived. */
  await p.evaluate(() => {
    sessionStorage.removeItem('relay');
    document.querySelector('#upcoming [data-cancel-booked]').addEventListener('click', () => {
      const seen = JSON.parse(sessionStorage.getItem('relay') || '[]');
      seen.push(document.getElementById('upcoming').hidden);
      sessionStorage.setItem('relay', JSON.stringify(seen));
    }, true);
  });
  await p.click('[data-relay="#upcoming [data-cancel-booked]"]');      /* arms */
  await p.waitForTimeout(150);
  await p.click('[data-relay="#upcoming [data-cancel-booked]"]');      /* fires */
  await p.waitForTimeout(400);
  const relay = await p.evaluate(() => JSON.parse(sessionStorage.getItem('relay') || '[]'));
  ok('the relayed click reaches the row even though the row is hidden',
     relay.length > 0, JSON.stringify(relay));
  ok('and the section is already visible when it lands',
     relay.length > 0 && relay.every(h => h === false), JSON.stringify(relay));
  await p.close();

  console.log('\n==> a card hides when all of its blocks do');
  p = await open(b, 'window.__noPartner = true;');
  const after = await p.$$eval('.dash-rail > section', e => e.map(x => x.id + (x.hidden ? ':hidden' : ':shown')));
  ok('with no partner, "Your pair" is gone and "Where you are" stays: ' + after.join(', '),
     after.includes('rail-pair:hidden') && after.includes('rail-where:shown'));
  ok('no empty card is drawn', (await p.$$eval('.dash-rail > section:not([hidden])',
      e => e.every(x => [...x.querySelectorAll('.blk')].some(k => !k.hidden)))));
  await p.close();

  await b.close();
  console.log(fails ? '\nfailed ' + fails : '\nall checks pass');
  process.exit(fails ? 1 : 0);
})();
