/* The People directory's three answers, which the page used to give two of.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/people-tests.js 9000
 *
 * "Nobody else has signed up" and "the directory could not be read" are
 * different facts, and the two figures at the top of this page said the same
 * thing about both: an em-dash. That dash is right for the second — a number
 * nobody could fetch should not be printed — and wrong for the first, where
 * the true answer is 1 and 0 and the person is entitled to it. The first
 * account on the platform got two dashes above a paragraph telling them they
 * were first, which is what a broken page looks like.
 *
 * It is worth a suite of its own because the failure is silent in both
 * directions. Printing zeros unconditionally would be the same bug reversed:
 * a failed read claiming the platform is empty, which is a lie that reads as
 * a fact. So all three states are pinned here, and the middle one — an
 * ordinary directory — is included so that a change which fixes the empty case
 * by breaking the normal one cannot pass.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

async function open(b, dials){
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  await p.addInitScript(dials);
  await p.goto(BASE + '/app-people.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1600);
  return p;
}

const figures = (p) => p.evaluate(() => ({
  total: document.getElementById('st-total').textContent.trim(),
  same:  document.getElementById('st-same').textContent.trim(),
  msg:   ((document.querySelector('#people .n') || {}).textContent || '').trim(),
}));

(async () => {
  const b = await chromium.launch();

  console.log('\n==> the first person on the platform');
  {
    const p = await open(b, () => { window.__peers = []; });
    const g = await figures(p);
    /* people.length + 1, because the reader is not in their own directory. */
    ok('"People here" counts the reader, so it reads 1 rather than a dash',
       g.total === '1', 'got ' + JSON.stringify(g.total));
    ok('  and "On your path" is a true zero, not an unknown',
       g.same === '0', 'got ' + JSON.stringify(g.same));
    ok('  with the message that explains why the list is empty',
       /you’re first|you're first/.test(g.msg), g.msg.slice(0, 80));
    await p.close();
  }

  console.log('\n==> a directory that could not be read');
  {
    /* The one case where an em-dash is the honest answer. Nothing was
       counted, so nothing may be printed as a count. */
    const p = await open(b, () => { window.__peers = null; });
    const g = await figures(p);
    ok('both figures stay as an em-dash',
       g.total === '—' && g.same === '—', JSON.stringify(g));
    ok('  and the page says it could not load rather than that nobody is here',
       /[Cc]ould not load/.test(g.msg) && !/first/.test(g.msg), g.msg.slice(0, 80));
    await p.close();
  }

  console.log('\n==> and an ordinary directory still counts');
  {
    /* Here so that fixing the empty case by printing zeros everywhere, or by
       moving the assignment somewhere it never runs, cannot pass. */
    const p = await open(b, () => {});
    const g = await figures(p);
    const n = Number(g.total);
    ok('the total is a real number above one',
       isFinite(n) && n > 1, 'got ' + JSON.stringify(g.total));
    ok('  and on-your-path is a number no larger than it',
       isFinite(Number(g.same)) && Number(g.same) <= n, JSON.stringify(g));
    ok('  and no empty-state message is shown',
       !/first/.test(g.msg), g.msg.slice(0, 80));
    await p.close();
  }

  await b.close();
  console.log('\n' + '='.repeat(51));
  console.log(fails ? fails + ' failed' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
