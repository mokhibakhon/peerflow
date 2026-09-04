/* app-metrics.html, asserted rather than admired.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/metrics-tests.js 9000
 *
 * Everything here is geometry, and that is the point. This page is a chart, so
 * the ways it goes wrong are the ways charts go wrong, and not one of them
 * shows in the DOM: a bar of the right width in the wrong cell, segments
 * stacked upside down, a percentage measured against the wrong denominator, a
 * fill that never painted at all. The first version of the funnel drew seven
 * bars of exactly 0px — .fun-bar is a span, an inline element ignores width
 * outright, and the markup inspected perfectly. Every check below reads a
 * rectangle off the rendered page rather than an attribute off the source.
 *
 * The other half is who sees it. The numbers are aggregates and name nobody,
 * so the risk is not to members; it is that a page of business totals should
 * not be one URL guess away. funnel_counts() answers a non-admin with no rows,
 * db.js turns that into null, and the page has to show nothing at all rather
 * than a screen of zeroes — which would be indistinguishable from a real
 * platform where nobody had signed up.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

/* The webfont is not reachable from the container and the page loads it
   without blocking paint, so networkidle would mean waiting for it to give up.
   Nothing here is asserted about the font. */
async function open(b, dials){
  const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  if (dials) await p.addInitScript(dials);
  await p.goto(BASE + '/app-metrics.html', { waitUntil: 'domcontentloaded' });
  return p;
}

(async () => {
  const b = await chromium.launch();

  console.log('\n==> the funnel is drawn, and drawn in proportion');
  {
    const p = await open(b, null);
    await p.waitForSelector('#funnel .fun-row', { timeout: 15000 });
    const g = await p.evaluate(() => ({
      bars: [...document.querySelectorAll('.fun-bar')].map(e => +e.getBoundingClientRect().width.toFixed(1)),
      nums: [...document.querySelectorAll('.fun-n')].map(e => e.textContent.trim()),
      pcts: [...document.querySelectorAll('.fun-p')].map(e => e.textContent.trim())
    }));

    ok('all seven steps are there', g.bars.length === 7, JSON.stringify(g.bars));
    /* The check the 0px bug would have failed. A width of zero is not a small
       bar, it is no bar, and it looks identical in the source to a correct one. */
    ok('  every bar has actual width, so none of them is an unstyled inline span',
       g.bars.length === 7 && g.bars.every(w => w > 0), JSON.stringify(g.bars));
    /* The fixture is 11, 4, 2, 2, 2, 1, 1. Ratios rather than pixel values, so
       the case survives a change of card width or gutter. */
    ok('  width tracks the count: the 4 is about a third of the 11',
       Math.abs(g.bars[1] / g.bars[0] - 4 / 11) < 0.02,
       g.bars[1] + ' / ' + g.bars[0]);
    ok('  and three steps of 2 draw three identical bars',
       g.bars[2] === g.bars[3] && g.bars[3] === g.bars[4], JSON.stringify(g.bars.slice(2, 5)));
    ok('  which is exactly why the counts are printed beside them',
       JSON.stringify(g.nums) === JSON.stringify(['11','4','2','2','2','1','1']),
       JSON.stringify(g.nums));

    /* The share is of the step above, not of the top step. Measuring against
       the top would read 18% here instead of 50%, which is a different and
       much less useful claim — and both look plausible on screen. */
    ok('  the share is of the step above, not of the first step',
       g.pcts[2] === '50%' && g.pcts[3] === '100%',
       JSON.stringify(g.pcts));
    ok('  and the first step has none, having nothing above it',
       g.pcts[0] === '', JSON.stringify(g.pcts[0]));
    await p.close();
  }

  console.log('\n==> thirty days, stacked the right way up');
  {
    const p = await open(b, null);
    await p.waitForSelector('#days .day', { timeout: 15000 });
    const g = await p.evaluate(() => {
      /* Scoped to #days. This block waits on `#days .day` and then asked for
         `.day`, which was the same set only while the funnel owned the only
         bar row on the page. app-metrics.html now draws three more of them —
         visits per day, hour of day, day of week — all reusing the same
         primitive, and an unscoped query counted 91 columns and failed a
         check about 30. */
      const days = [...document.querySelectorAll('#days .day')];
      const info = days.map(d => {
        const parts = [...d.querySelectorAll('i')];
        return {
          total: +parts.reduce((s, i) => s + i.getBoundingClientRect().height, 0).toFixed(1),
          order: parts.map(i => i.className),
          tops:  parts.map(i => +i.getBoundingClientRect().top.toFixed(1))
        };
      });
      const tall = info.indexOf(info.reduce((m, x) => x.total > m.total ? x : m, info[0]));
      return { count: days.length, info, tall,
               rowHeight: document.getElementById('days').getBoundingClientRect().height };
    });

    ok('a column per day, including the empty ones', g.count === 30, 'got ' + g.count);
    /* A month with nothing in it would draw a flat row, and a flat row cannot
       show whether anything stacks correctly. The fixture puts one busy day
       six back from today so an off-by-one at either end is visible. */
    ok('  the fixture has a busy day to look at', g.info[g.tall].total > 0,
       JSON.stringify(g.info[g.tall]));
    ok('  the tallest day fills the row, so the scale is set by the data',
       Math.abs(g.info[g.tall].total - g.rowHeight) < 3,
       g.info[g.tall].total + ' vs row ' + g.rowHeight);
    /* Green at the bottom, grey above it. Reversed, the chart says the
       opposite of what its legend says and nothing about the DOM is wrong —
       the column is a flex column, so source order alone decides this. */
    ok('  the finished part sits at the bottom and the rest above it',
       g.info[g.tall].order.join(',') === 'd-rest,d-done' &&
       g.info[g.tall].tops[0] < g.info[g.tall].tops[1],
       JSON.stringify(g.info[g.tall]));
    ok('  a day nobody signed up on draws nothing rather than a floor',
       g.info.filter(d => d.total === 0).length > 0,
       'empty days: ' + g.info.filter(d => d.total === 0).length);
    await p.close();
  }

  console.log('\n==> and it is not everybody\'s page');
  {
    /* Both dials null: a signed-in member who is not in app_admins, and a
       database where migration-funnel.sql has never been pasted in. The page
       cannot tell them apart and does not try. */
    const p = await open(b, () => { window.__funnel = null; window.__funnelDays = null; });
    await p.waitForSelector('#notyours:not([hidden])', { timeout: 15000 });
    const g = await p.evaluate(() => ({
      data: !document.getElementById('data').hidden,
      notYours: !document.getElementById('notyours').hidden,
      rows: document.querySelectorAll('.fun-row').length,
      body: document.body.innerText
    }));

    ok('the not-yours screen is shown', g.notYours);
    /* Hidden is not enough on its own: a zeroed funnel rendered underneath a
       hidden parent is still a funnel somebody can read out of the DOM, and it
       would also be indistinguishable from a real empty platform. */
    ok('  and the numbers are not merely hidden, they were never drawn',
       g.data === false && g.rows === 0, 'data=' + g.data + ' rows=' + g.rows);
    ok('  no total leaks into the text of the page',
       !/\b11\b/.test(g.body), g.body.slice(0, 160));
    await p.close();
  }

  console.log('\n==> a platform where nothing has happened yet');
  {
    /* The state this page opens in on day one, and the one most easily got
       wrong: every count is zero, so every proportion divides by zero. */
    const p = await open(b, () => {
      window.__funnel = { accounts:0, profile_complete:0, request_sent:0, partnered:0,
                          session_proposed:0, session_booked:0, session_attended:0,
                          accounts_7d:0, accounts_prev_7d:0 };
      window.__funnelDays = [];
    });
    await p.waitForSelector('#funnel .fun-row', { timeout: 15000 });
    const g = await p.evaluate(() => ({
      body: document.body.innerText,
      bars: [...document.querySelectorAll('.fun-bar')].map(e => +e.getBoundingClientRect().width.toFixed(1)),
      rows: document.querySelectorAll('.fun-row').length,
      days: document.querySelectorAll('#days .day').length   /* scoped, as above */
    }));

    ok('it renders rather than dividing by zero',
       !/NaN|Infinity|undefined/.test(g.body), g.body.slice(0, 200));
    /* Not "every bar is narrow" — an empty .fun-bar list would satisfy that
       vacuously, and narrow is exactly what the bug drew. The claim is that no
       bar element exists, while the seven rows and their zeroes still do. */
    ok('  and an empty funnel draws no bar at all, rather than seven small ones',
       g.bars.length === 0 && g.rows === 7,
       'bars=' + JSON.stringify(g.bars) + ' rows=' + g.rows);
    ok('  a daily series with no rows leaves the row empty rather than throwing',
       g.days === 0, 'got ' + g.days);
    await p.close();
  }

  await b.close();
  console.log('\n' + '='.repeat(51));
  console.log(fails ? fails + ' failed' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
