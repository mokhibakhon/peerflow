/* 404.html, asserted rather than admired.
 *
 *     PORT=9000 node dev/serve.js &
 *     node dev/notfound-tests.js 9000
 *
 * No PF_STUB: this page has no data layer and nothing to sign in to. What it
 * does have is the only surface on the site whose input is the address bar —
 * somebody else's typo, or somebody else's link — and three things follow from
 * that, none of which read as wrong in the markup.
 *
 * The status has to stay 404. A page that says "not found" under a 200 is a
 * soft 404: search engines index it, and every mistyped URL on the domain
 * becomes a duplicate of it. Nothing in the HTML can show that, which is why
 * the check is here and not in dev/seo-tests.js.
 *
 * Its links have to be root-relative. This is the one page served AT whatever
 * address was asked for, so href="login.html" under /a/b/c means
 * /a/b/login.html — a page whose whole job is recovering from a bad URL,
 * handing out more of them. seo-tests.js checks the source for it; this checks
 * what the browser actually resolves, which is the thing that matters.
 *
 * And the address it prints is attacker-supplied. Whoever sends the link
 * chooses the path, so /<img src=x onerror=...> is a URL somebody can send.
 * It goes in through textContent and this asserts nothing ever executes.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

async function open(b, url){
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  /* The webfont is not reachable from the container and the page loads it
     without blocking paint, so waiting for the network to go idle means
     waiting for that request to give up — around fifteen seconds, times the
     two dozen addresses below. Nothing here is asserted about the font: the
     weights and sizes come from the stylesheet, which is local. */
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/net::ERR_/.test(m.text())) return;
    /* Every page here IS a 404, and the browser logs the document's own status
       as a console error. That is the thing being tested, not a failure. An
       asset that 404s has a different location and still fails the run. */
    if (m.location().url === p.url() && /status of 404/.test(m.text())) return;
    fails++; console.log('  console error: ' + m.text().slice(0,140));
  });
  const res = await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  return { p, status: res.status() };
}

/* What the page is offering, if anything: the guess line's text and where its
   link points, with a null when the line is still hidden. */
async function guess(p){
  return p.evaluate(() => {
    const el = document.querySelector('.nf-guess');
    if (!el || el.hidden) return null;
    const a = el.querySelector('a');
    return { text: a.textContent, href: a.getAttribute('href') };
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n==> a missing page is a 404, and it is this page');
  let { p, status } = await open(b, '/random');
  ok('the status is 404, not a soft 200: ' + status, status === 404);
  const h1 = await p.$$eval('h1', e => e.map(x => x.innerText.trim()));
  ok('exactly one <h1>, and it is the page: ' + JSON.stringify(h1),
     h1.length === 1 && h1[0] === 'Page not found');
  ok('the shell is here: the site nav, and one way out under the sentence',
     (await p.$$('header .logo')).length === 1 && (await p.$$('header .nav-right a')).length === 2
     && (await p.$$('.nf-acts .btn')).length === 1);
  /* The header used to run flush to the viewport edge on every page sharing
     this shell — .nav's padding shorthand beats .wrap's at the same
     specificity because it is declared later — which on a dark ground reads
     as a broken page rather than a wide one. Fixed for this page only, so
     assert the gutter is really there rather than trusting the rule to have
     landed. */
  const gutter = await p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('header .wrap'));
    return parseFloat(cs.paddingLeft);
  });
  ok('the header has its side gutter back (' + gutter + 'px)', gutter >= 20);
  ok('the address is printed back: "' + (await p.innerText('.nf-asked')) + '"',
     (await p.innerText('.nf-asked')).indexOf('/random') > -1);
  ok('and nothing is guessed at, because /random is nothing', (await guess(p)) === null);
  await p.close();

  console.log('\n==> the number, which is 207 cells and no text');
  /* The graphic is the page. It is also 207 elements that all look identical
     in the markup, so the ways it breaks are geometric: a column count that
     lets the digits wrap, a mask that never loaded and leaves 117 blank
     squares, a cell that is not square. None of those show in the DOM. */
  const fp = await open(b, '/random');
  const field = await fp.p.evaluate(() => {
    const el = document.querySelector('.nf-field');
    const cells = [...el.querySelectorAll('i')];
    const first = cells.find((c) => c.className);
    const cs = getComputedStyle(first);
    const r = first.getBoundingClientRect();
    return {
      cells: cells.length,
      painted: cells.filter((c) => c.className).length,
      rows: new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top))).size,
      cols: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      square: Math.abs(r.width - r.height) < 0.6,
      masked: (cs.webkitMaskImage || cs.maskImage || '').indexOf('svg+xml') > -1,
      text: el.textContent.trim().length,
    };
  });
  ok('207 cells in 23 columns and 9 rows: ' + JSON.stringify(field),
     field.cells === 207 && field.cols === 23 && field.rows === 9);
  ok('117 of them are painted, and each is a square carrying the mark as a mask',
     field.painted === 117 && field.square && field.masked, JSON.stringify(field));
  ok('and none of them carries text, so nothing here is a font we do not ship',
     field.text === 0);
  ok('it is labelled for a screen reader, which sees 207 empty spans otherwise',
     (await fp.p.getAttribute('.nf-field', 'aria-label')) === '404');
  await fp.p.close();

  console.log('\n==> the near misses, which are why the resolver exists');
  /* Each of these is a real address somebody types. /privacy and /app used to
     head this list and do not any more: vercel.json now redirects the bare name
     of every page to its file, so they never reach this page at all. The
     The prefix rule went the same way when the eight paths gained nicknames:
     /frontend and /data are redirects now too, so the two cases proving that
     rule are addresses no redirect claims — a path with a directory in front of
     it, and a partial name nobody would alias.

     The exact-slug rule is still worth having and still covered, by the three at
     the bottom — a path with directories in front of it, one
     that already ends in .html, and one in the wrong case — none of which match
     a redirect source, all of which resolve on the last segment. */
  for (const [url, expect, href] of [
    ['/docs/frontend',     'frontend study partners',   '/frontend-study-partner.html'],
    ['/backend-study',     'backend study partners',    '/backend-study-partner.html'],
    ['/singup',            'the sign-up page',          '/signup.html'],
    ['/tems',              'the terms',                 '/terms.html'],
    ['/docs/privacy',      'the privacy policy',        '/privacy.html'],
    ['/privacy.html/',     'the privacy policy',        '/privacy.html'],
    ['/PRIVACY',           'the privacy policy',        '/privacy.html'],
  ]) {
    const t = await open(b, url);
    const g = await guess(t.p);
    ok(url + ' → ' + JSON.stringify(g), g && g.text === expect && g.href === href);
    await t.p.close();
  }

  console.log('\n==> the addresses that never get here any more');
  /* Two kinds now: the extensionless form of a page's own name, and the eight
     nicknames the learning paths already had in signup.html?path=. */
  /* The redirects are in vercel.json and dev/serve.js reads that file rather
     than restating it, so this exercises the real table. Two things have to
     hold and only one of them is obvious. The bare name has to move, and the
     .html form has to stay exactly where it is — the whole reason for choosing
     this direction over cleanUrls is that no canonical, sitemap entry or
     internal link had to change, and a redirect pointing the other way would
     quietly undo all of it. */
  {
    const req = (await b.newPage()).request;
    for (const [url, status, to] of [
      ['/privacy',      308, '/privacy.html'],
      ['/login',        308, '/login.html'],
      ['/app',          308, '/app.html'],
      ['/terms',        308, '/terms.html'],
      ['/index.html',   308, '/'],
      ['/frontend',     308, '/frontend-study-partner.html'],
      ['/design',       308, '/ux-ui-design-study-partner.html'],
      ['/privacy.html', 200, null],
      ['/draft',        200, null],
      ['/404',          404, null],
      ['/random',       404, null],
      ['/assets/db.js', 200, null],
    ]) {
      const r = await req.get(BASE + url, { maxRedirects: 0 });
      const loc = r.headers()['location'];
      const where = loc ? loc.replace(BASE, '') : null;
      ok(url + ' → ' + r.status() + (where ? ' ' + where : ''),
         r.status() === status && (to === null ? !loc : where === to));
    }
    /* The query has to survive: call.html is reached as /call?s=<booking> and
       arriving without it is a room with no session behind it. */
    const q = await req.get(BASE + '/call?s=abc123', { maxRedirects: 0 });
    ok('/call?s=abc123 keeps its query → ' + (q.headers()['location'] || '').replace(BASE, ''),
       (q.headers()['location'] || '').endsWith('/call.html?s=abc123'));
  }

  console.log('\n==> and the guesses it declines to make');
  /* A "did you mean" that fires on anything teaches people to stop reading it,
     so the rules have floors: three characters before a prefix counts, four
     before a spelling distance does. /ap is two edits from app.html and must
     not be offered. */
  for (const url of ['/random', '/ap', '/xy', '/blog/2024/hello', '/wp-admin']) {
    const t = await open(b, url);
    ok(url + ' → no guess', (await guess(t.p)) === null);
    await t.p.close();
  }

  console.log('\n==> the offer has to be a real page');
  let t = await open(b, '/frontend');
  const g = await guess(t.p);
  const followed = await t.p.request.get(BASE + g.href);
  ok('the suggested link resolves: ' + g.href + ' → ' + followed.status(), followed.status() === 200);
  await t.p.close();

  console.log('\n==> a path deep enough to break relative links');
  /* The failure this catches: served at /a/b/c, a relative href="login.html"
     resolves to /a/b/login.html, which 404s to this same page, which offers
     the same broken links. Assert on resolved URLs — the .href property, not
     the attribute — because the attribute is what looks fine. */
  t = await open(b, '/a/b/c/nope');
  const bad = await t.p.$$eval('a[href]', els => els
    .filter(a => a.protocol === 'http:' || a.protocol === 'https:')
    .map(a => a.pathname)
    .filter(pth => pth.indexOf('/a/b/') === 0));
  ok('every same-origin link points at the site root, not /a/b/'
     + (bad.length ? ': ' + bad.join(', ') : ''), bad.length === 0, JSON.stringify(bad));
  ok('the stylesheet still loaded from /assets, so the page is styled',
     await t.p.evaluate(() => getComputedStyle(document.querySelector('h1')).fontWeight === '800'));
  /* The mask is a data URI in auth.css, so it survives any depth of address —
     but the stylesheet reaching the page at all is the thing at risk here, and
     an unpainted field is 117 invisible squares rather than an error. */
  ok('and the number is still painted at this depth',
     await t.p.evaluate(() => {
       const c = document.querySelector('.nf-field i[class]');
       return getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)';
     }));
  await t.p.close();

  console.log('\n==> the address is somebody else\'s text');
  /* pageerror and console listeners above already fail the run if anything
     executes; these assert the payload arrived, was printed, and stayed
     inert — a page that silently dropped the path would pass a "no alert"
     check without proving anything. */
  t = await open(b, '/' + encodeURIComponent('<img src=x onerror="document.title=1">'));
  const shown = await t.p.evaluate(() => {
    const el = document.getElementById('nf-path');
    return { text: el.textContent, tags: el.querySelectorAll('*').length, title: document.title };
  });
  ok('printed as text: ' + JSON.stringify(shown.text), shown.text.indexOf('<img') > -1);
  ok('no element was created from it', shown.tags === 0);
  ok('and nothing ran: title is still ' + JSON.stringify(shown.title), shown.title !== '1');
  await t.p.close();

  console.log('\n==> a path long enough to push the page apart');
  t = await open(b, '/' + 'x'.repeat(400));
  const echoed = await t.p.evaluate(() => document.getElementById('nf-path').textContent);
  ok('the echo is capped at 64 characters (' + echoed.length + ')', echoed.length === 64);
  ok('and says it was cut', echoed.slice(-1) === '…');
  const overflow = await t.p.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  ok('the page still does not scroll sideways', overflow);
  await t.p.close();

  await b.close();
  console.log(fails ? '\n' + fails + ' check(s) failed.\n' : '\nAll not-found checks passed.\n');
  process.exit(fails ? 1 : 0);
})();
