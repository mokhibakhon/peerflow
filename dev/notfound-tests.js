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
     h1.length === 1 && h1[0] === "That page isn't here");
  ok('the shell is here: header, footer and the destination list',
     (await p.$$('header .logo')).length === 1 && (await p.$$('footer')).length === 1
     && (await p.$$('.nf-list a')).length === 4);
  ok('the address is printed back: "' + (await p.innerText('.nf-asked')) + '"',
     (await p.innerText('.nf-asked')).indexOf('/random') > -1);
  ok('and nothing is guessed at, because /random is nothing', (await guess(p)) === null);
  await p.close();

  console.log('\n==> the near misses, which are why the resolver exists');
  /* Each of these is a real address somebody types. The first three are the
     shapes: an extensionless page, the short name of a long page, a spelling
     slip. The last two are the parsing — a path with directories in front of
     it is still a guess about its last segment, and an address that already
     ends in .html is the same guess as one that does not. */
  for (const [url, expect, href] of [
    ['/privacy',           'the privacy policy',        '/privacy.html'],
    ['/frontend',          'frontend study partners',   '/frontend-study-partner.html'],
    ['/data',              'data science study partners', '/data-science-study-partner.html'],
    ['/singup',            'the sign-up page',          '/signup.html'],
    ['/tems',              'the terms',                 '/terms.html'],
    ['/app',               'your sessions',             '/app.html'],
    ['/docs/privacy',      'the privacy policy',        '/privacy.html'],
    ['/privacy.html/',     'the privacy policy',        '/privacy.html'],
    ['/PRIVACY',           'the privacy policy',        '/privacy.html'],
  ]) {
    const t = await open(b, url);
    const g = await guess(t.p);
    ok(url + ' → ' + JSON.stringify(g), g && g.text === expect && g.href === href);
    await t.p.close();
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
