/* The "Where you are" card in each of the three states it really has.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/momentum-tests.js 9000 /tmp/shots
 *
 * The card spends real time in all three and they are not interchangeable: a
 * treatment that reads well on "You, going strong" can fall apart on "Don't
 * leave Amir hanging". The dial sets renderMomentum's inputs rather than its
 * verdict, so metThisWeek and atRisk are still derived by the code under test.
 *
 * The check worth keeping is the one comparing the sentence against .rail-l.
 * The first attempt at making it stand out was green at 13px/700, which is
 * exactly what the link at the foot of every rail card is set in — so the
 * sentence read as something you could click. Nothing in the markup says
 * that; you only see it on the card, or by measuring both. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || 9070;
const OUT  = process.argv[3] || '.';
require('fs').mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '  ' + x : '')); } };

/* metThisWeek / atRisk are derived inside renderMomentum from these, so the
   dial sets the inputs rather than the verdict. */
const STATES = {
  'going well': '{ thisWeek:3, goal:2, streak:4, metThisWeek:true,  daysLeft:5, done:true }',
  'slipping':   '{ thisWeek:1, goal:2, streak:4, metThisWeek:false, daysLeft:3, done:true }',
  'nothing yet':'{ thisWeek:0, goal:2, streak:0, metThisWeek:false, daysLeft:5, done:false }'
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [name, m] of Object.entries(STATES)) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
    p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
    await p.addInitScript('window.__momentum = ' + m + ';');
    await p.goto('http://127.0.0.1:' + PORT + '/app.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);

    const r = await p.evaluate(() => {
      const q = s => document.querySelector(s);
      const h = q('#mo-h'), w = q('#mo-w');
      const cs = getComputedStyle(h);
      const link = getComputedStyle(document.querySelector('.rail-l'));
      return {
        card: q('#rail-where').className,
        figure: q('#mo-n').innerText.replace(/\s+/g, ' ').trim(),
        sentence: h.innerText.trim(),
        under: w.hidden ? null : w.innerText.trim(),
        set: cs.fontSize + '/' + cs.fontWeight + ' ' + cs.color,
        linkSet: link.fontSize + '/' + link.fontWeight + ' ' + link.color,
        planHasSource: !!q('#wk-t .wk-src')
      };
    });

    console.log('\n==> ' + name + '   (' + r.card + ')');
    console.log('    ' + r.figure + '  /  ' + r.sentence + (r.under ? '  /  ' + r.under : ''));
    ok('the figure does not repeat its own label', !/this week/i.test(r.figure), r.figure);
    ok('the plan block has no source line', r.planHasSource === false);
    ok('the sentence is set as a sentence, not a label (' + r.set + ')',
       r.set.indexOf('17px/600') === 0);
    /* The reason C was chosen over A: at 13px/700 green it was indistinguishable
       from the link at the foot of every rail card. */
    ok('  and cannot be mistaken for the card link (' + r.linkSet + ')',
       r.set !== r.linkSet && parseFloat(r.set) > parseFloat(r.linkSet));

    if (name === 'going well')
      ok('  green when the week is going well', /rgb\(15, 110, 86\)/.test(r.set), r.set);
    if (name === 'slipping') {
      ok('  amber when it is slipping', /rgb\(147, 100, 26\)/.test(r.set), r.set);
      ok('  and the how-many-by-when line is kept', r.under && /days left/.test(r.under), String(r.under));
    }
    if (name === 'nothing yet') {
      ok('  ink when there is nothing to say yet', /rgb\(23, 26, 46\)/.test(r.set), r.set);
      ok('  and no second line under it', r.under === null, String(r.under));
    }
    if (name === 'going well')
      ok('  no "Back on Monday." under it', r.under === null, String(r.under));

    await p.locator('#rail-where').screenshot({ path: OUT + '/' + name.replace(/ /g, '-') + '.png' });
    await p.close();
  }
  await b.close();
  console.log(fails ? '\nfailed ' + fails : '\nall checks pass');
  process.exit(fails ? 1 : 0);
})();
