/* Every surface in the signed-in app that draws another person.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/avatar-tests.js 9000
 *
 * There are six of them — People's card and row, a profile heading, the chat
 * list and the open thread's header, the partner rail and the who-menu on
 * Today, and a partner card on Sessions — and they were built at six
 * different times by six separate pieces of code. The photo reached the first
 * of them a day before this file was written and the other five kept drawing
 * a letter, which is the failure this suite exists to make loud: a feature
 * that is live on one page and absent on five looks like a bug on five pages
 * rather than like a feature on one.
 *
 * Each is checked in the three states it has to survive, and the third is the
 * one that is easy to forget:
 *
 *   1. a photo that loads          -> an <img> with pixels actually in it
 *   2. a photo whose URL is dead   -> back to the initial, no broken glyph.
 *      Google's photo URLs expire when somebody changes their picture, so
 *      this is an ordinary Tuesday rather than an edge case
 *   3. no avatar_url column at all -> the initial, and the page still whole.
 *      supabase/*.sql are pasted in by hand, so this is the state of every
 *      deployment between a merge and somebody opening the SQL editor, and a
 *      select naming a column the database has not got fails the whole query
 *      rather than the one field
 *
 * Every assertion requires slots > 0 as well as whatever else it is checking.
 * Without that, a surface the suite failed to reach — a menu that did not
 * open, a card that stayed hidden — passes every clause vacuously and reports
 * green for a page it never looked at. That is not hypothetical either: the
 * who-menu did exactly this on the first run of this file, because the
 * selector that opens it was a guess.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;

/* One green pixel, stretched over the avatar by object-fit. Enough to prove
   the image path was taken and clipped to the shape without needing a face,
   and it means the suite never asks the network for anything. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

const SURFACES = [
  { name: 'app-person heading',    url: '/app-person?id=u2', sel: '.pv-av' },
  { name: 'chat list and header',  url: '/app-chat?to=u2',   sel: '.ch-av' },
  { name: 'Today partner rail',    url: '/app',              sel: '.ptm .av' },
  { name: 'Today who-menu',        url: '/app',              sel: '#bk-sent .opt .av',
    /* The who field is a plain word with one partner and a menu with two, so
       the menu does not exist to be looked at until there are several. */
    dials: { __manyPartners: 3 },
    open: async p => {
      await p.click('#cal-new');
      await p.waitForTimeout(200);
      await p.click('#bk-sent .pick[data-k="who"] .trig');
      await p.waitForTimeout(200);
    } },
  { name: 'Sessions partner card', url: '/app-sessions',     sel: '.pcard-av span' },
  { name: 'People directory',      url: '/app-people',       sel: '.tp-av,.pt-av' },
];

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n);
                          else { fails++; console.log('  FAIL ' + n + (x ? '  ' + x : '')); } };

async function look(b, s, mode){
  const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  await p.route('https://lh3.googleusercontent.com/**', r =>
    mode === 'ok' ? r.fulfill({ contentType: 'image/png', body: PNG })
                  : r.fulfill({ status: 404, body: '' }));

  const dials = Object.assign({}, s.dials || {});
  if (mode === 'gone') dials.__avatarsMissing = true;
  await p.addInitScript(d => { for (const k in d) window[k] = d[k]; }, dials);

  await p.goto(BASE + s.url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  if (s.open) { try { await s.open(p); } catch (e) { errs.push('could not open: ' + e.message); } }
  await p.waitForTimeout(400);

  const r = await p.evaluate(sel => {
    const slots = [...document.querySelectorAll(sel)];
    return {
      slots: slots.length,
      imgs: slots.filter(c => c.querySelector('img')).length,
      /* An <img> that failed to load is still an <img> in the DOM, so
         naturalWidth is the only thing that says pixels arrived. Counting
         elements alone would pass the dead-URL case as a success. */
      loaded: slots.filter(c => { const i = c.querySelector('img');
                                  return i && i.naturalWidth > 0; }).length,
      letters: slots.filter(c => !c.querySelector('img') && c.textContent.trim()).length,
      /* Read off the rendered box rather than off the stylesheet: the bug
         these two catch is a new avatar class that nobody added to the one
         CSS rule, which reads perfectly in the markup and puts a square photo
         across a round hole. */
      clipped: slots.filter(c => getComputedStyle(c).overflow === 'hidden').length,
      fills: slots.filter(c => { const i = c.querySelector('img'); if (!i) return false;
                                 return getComputedStyle(i).objectFit === 'cover' &&
                                   Math.round(i.getBoundingClientRect().width) ===
                                   Math.round(c.getBoundingClientRect().width); }).length,
    };
  }, s.sel);
  await p.close();
  return { r, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME });
  for (const s of SURFACES) {
    console.log('\n==> ' + s.name + '  (' + s.sel + ')');

    const a = await look(b, s, 'ok');
    ok('the page draws somebody', a.r.slots > 0, JSON.stringify(a.r));
    ok('a photo renders as a photo',
       a.r.slots > 0 && a.r.loaded > 0 && a.r.loaded === a.r.imgs, JSON.stringify(a.r));
    ok('and is clipped to the avatar and fills it',
       a.r.slots > 0 && a.r.clipped === a.r.slots && a.r.fills === a.r.imgs, JSON.stringify(a.r));
    ok('no page errors', a.errs.length === 0, a.errs[0]);

    const d = await look(b, s, 'dead');
    ok('a dead photo URL falls back to the initial',
       d.r.slots > 0 && d.r.imgs === 0 && d.r.letters === d.r.slots, JSON.stringify(d.r));

    const g = await look(b, s, 'gone');
    ok('without the column: initials, and the page intact',
       g.r.slots > 0 && g.r.slots === a.r.slots && g.r.imgs === 0 &&
       g.r.letters === g.r.slots, JSON.stringify(g.r));
    ok('and no page errors without it', g.errs.length === 0, g.errs[0]);
  }
  await b.close();
  console.log('\n===================================================');
  console.log(fails ? fails + ' FAILED' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
