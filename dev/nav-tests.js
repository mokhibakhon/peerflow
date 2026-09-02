/* The signed-in top bar, measured rather than looked at.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/nav-tests.js 9000
 *
 * This suite exists because of a bug that was invisible in every way except
 * on screen. .tabs is overflow-x:auto with the scrollbar hidden, so when the
 * five tabs are wider than the room left for them the markup stays perfect,
 * no error is raised, every link is present and focusable, and the last tab is
 * simply cut off mid-word with nothing to say it can be scrolled to. Progress
 * was unreachable-looking on any laptop under about 1150px, and on a phone,
 * and the only symptom was a screenshot.
 *
 * So nothing here reads the DOM for what it contains. Every check measures a
 * rectangle: how wide the strip's content is against how wide its box is, and
 * whether the last tab's right edge is inside the bar's. A test that asserted
 * "five links exist" would have passed throughout.
 *
 * The widths are not round numbers for their own sake. 1180 and 880 are the
 * two breakpoints in app.css, 1160 and 870 are just inside them, 980 was the
 * worst case before the fix (the path chip only disappeared at 960, so the
 * middle of the range was tighter than either end), and 390 is an iPhone 15.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

/* Every app page, because the bar is built by appshell.js and shared, and a
   page that styled its own main column differently could still change what is
   left over for the bar. */
const PAGES = ['app.html', 'app-sessions.html', 'app-people.html',
               'app-progress.html', 'app-badges.html', 'app-metrics.html'];
const WIDTHS = [1440, 1280, 1200, 1180, 1160, 1100, 1000, 980,
                900, 880, 870, 840, 820, 760, 700, 660, 600, 480, 430, 390];

async function measure(b, page, width){
  const p = await b.newPage({ viewport: { width, height: 800 } });
  /* The webfont is unreachable from the container and is loaded without
     blocking paint, so networkidle would mean waiting for it to time out.
     It matters more here than in most suites: these are text-width
     measurements, and they are taken in the fallback face on purpose —
     whichever face is used, it has to be the same one every run. */
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  await p.goto(BASE + '/' + page, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tabs a', { timeout: 15000 });
  const g = await p.evaluate(() => {
    const tabs = document.querySelector('.tabs');
    const bar  = document.querySelector('.tb');
    const links = [...document.querySelectorAll('.tabs a')];
    const last = links[links.length - 1].getBoundingClientRect();
    const barBox = bar.getBoundingClientRect();
    return {
      over: tabs.scrollWidth - Math.round(tabs.getBoundingClientRect().width),
      count: links.length,
      labels: links.map(a => a.innerText.trim()),
      lastInside: last.right <= barBox.right + 1 && last.left >= barBox.left - 1,
      /* Tap targets, since the phone rule buys its fit with padding. 40px is
         below the 44px both platforms ask for and is deliberately the floor
         rather than the target: the bar is 44px tall, so the vertical half is
         already right, and this only guards against the width being squeezed
         to nothing in some later attempt to fit a sixth tab. */
      narrowest: Math.min(...links.map(a => Math.round(a.getBoundingClientRect().width))),
      pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  await p.close();
  return g;
}

(async () => {
  const b = await chromium.launch();

  console.log('\n==> the five tabs fit the bar at every width');
  for (const w of WIDTHS) {
    const g = await measure(b, 'app-badges.html', w);
    ok(String(w) + 'px: the strip does not overflow its box',
       g.over <= 1, 'content ' + g.over + 'px wider than the box');
    ok('  and the last tab ("' + g.labels[g.labels.length - 1] + '") is inside the bar',
       g.lastInside, JSON.stringify(g.labels));
  }

  console.log('\n==> nothing was lost making it fit');
  {
    /* The fix hides icons and moves the strip to its own row. What it must
       never do is drop a tab: a nav that fits because Progress is gone has
       not been fixed, and the overflow check alone would call that a pass. */
    for (const w of [1440, 980, 700, 390]) {
      const g = await measure(b, 'app-badges.html', w);
      ok(String(w) + 'px: all five destinations are still there',
         g.count === 5, JSON.stringify(g.labels));
      ok('  and no tab is squeezed below a usable width',
         g.narrowest >= 40, 'narrowest ' + g.narrowest + 'px');
      ok('  and the page itself does not scroll sideways',
         !g.pageScrollsX);
    }
  }

  console.log('\n==> and it holds on every page that draws the bar');
  {
    /* 980 was the worst width before the fix — worse than either end of the
       range, because the path chip took its 104px until 960. */
    for (const page of PAGES) {
      const g = await measure(b, page, 980);
      ok(page + ' at 980px', g.over <= 1 && g.lastInside && g.count === 5,
         'over=' + g.over + ' lastInside=' + g.lastInside + ' tabs=' + g.count);
    }
  }

  await b.close();
  console.log('\n' + '='.repeat(51));
  console.log(fails ? fails + ' failed' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
