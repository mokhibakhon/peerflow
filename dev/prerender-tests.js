/* The writes that must not happen on a page nobody has opened.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/prerender-tests.js 9000
 *
 * assets/appshell.js asks Chrome to prerender the five nav tabs on hover, so
 * that a click lands on a document which has already fetched its data. That is
 * the whole point and it is a good trade for reads.
 *
 * It is not a good trade for writes, and four things this app does on load are
 * writes about what a person has looked at: settling finished sessions, marking
 * partner requests seen, marking a chat thread read, and unlocking a badge.
 * Prerendering runs all of that for pages nobody visits. Someone hovering the
 * People tab on their way to Chat would have their inbox marked seen; someone
 * hovering Progress would be told they had unlocked a badge on a page they
 * never opened.
 *
 * pf.whenActive() in assets/db.js holds those until activation. This is the
 * suite that says so, because nothing else can: every one of these writes is
 * invisible in the rendered page, so a regression here would look exactly like
 * working software.
 *
 * WHY IT SPIES RATHER THAN WATCHING THE NETWORK
 *
 * Under PF_STUB there is no network — dev/db-stub.js answers from fixtures — so
 * there is no request to observe. The test wraps the data layer's write methods
 * instead, which is a stronger check anyway: it catches a call that was made
 * whether or not it reached a server.
 *
 * The real browser check is not possible here. Chrome disables prerendering
 * under automation, so neither Playwright nor a headed run in this container
 * will actually prerender, with any eagerness. window.__prerendering in
 * db-stub.js exists to reach the same branch deterministically.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || 9000;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '  ' + x : '')); } };

/* Everything in the data layer that changes a row on page load. Named rather
   than pattern-matched, so adding a fifth write is a deliberate act that shows
   up here as a decision rather than being covered by accident. */
const WRITES = ['settleAttendance', 'sendReminders', 'nudgeDormant',
                'markRequestsSeen', 'unlockAchievement', 'markThreadRead'];

async function open(browser, path, prerendering) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([writes, pre]) => {
    window.__prerendering = pre;
    window.__writes = [];
    /* db.js assigns window.pf, so the setter catches it the instant it is
       defined and before any page script can call it. */
    let real;
    Object.defineProperty(window, 'pf', {
      configurable: true,
      get() { return real; },
      set(v) {
        real = v;
        writes.forEach((name) => {
          const orig = v[name];
          if (typeof orig !== 'function') return;
          v[name] = function () {
            window.__writes.push(name);
            return orig.apply(this, arguments);
          };
        });
      }
    });
  }, [WRITES, prerendering]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('  page error: ' + e.message); });
  await page.goto('http://127.0.0.1:' + PORT + path, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  for (const path of ['/app.html', '/app-progress.html', '/app-people.html']) {
    console.log('\n==> ' + path + ' while it is being prerendered');
    const { ctx, page } = await open(browser, path, true);

    const during = await page.evaluate(() => window.__writes.slice());
    ok('nothing is written to a page nobody has opened', during.length === 0,
       during.length ? 'called ' + during.join(', ') : '');

    /* The page still has to be USEFUL while prerendering — that is the entire
       reason for doing it. A guard that held the reads back too would make the
       click no faster than before and this suite would still be green. */
    const drew = await page.evaluate(() => document.body.innerText.length > 200);
    ok('  and it still renders, which is the point of prerendering', drew);

    await page.evaluate(() => {
      window.__prerendering = false;
      document.dispatchEvent(new Event('pf-stub-activate'));
    });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => window.__writes.slice());
    ok('  the writes go the moment it is activated', after.length > 0,
       after.length ? 'called ' + after.join(', ') : 'nothing was ever written');
    await ctx.close();
  }

  console.log('\n==> and a normal navigation is unaffected');
  const { ctx, page } = await open(browser, '/app.html', false);
  const normal = await page.evaluate(() => window.__writes.slice());
  ok('a page opened directly writes without waiting for anything',
     normal.length > 0, normal.length ? 'called ' + normal.join(', ') : 'no writes at all');
  await ctx.close();

  await browser.close();
  console.log('\n===================================================');
  console.log(fails ? fails + ' check(s) failed' : 'all prerender checks pass');
  process.exit(fails ? 1 : 0);
})();
