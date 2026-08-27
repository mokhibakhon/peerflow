/* The name in the corner of the header, asserted rather than assumed.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/usermenu-tests.js 9000
 *
 * This file exists because of a bug that survived a save, a refresh, and
 * every subsequent visit, and looked from the outside like the profile page
 * simply not saving.
 *
 * There are two copies of a person's name. auth.users.user_metadata.name is
 * written once, by signup, and nothing updates it afterwards.
 * public.profiles.first_name and .last_name are what app-profile.html edits.
 * usermenu.js read the first and never the second, so changing your name gave
 * you a profile page that said Shahnoza Rahimova and a chip that went on
 * saying whatever you typed on the way in.
 *
 * Nothing on the page could show it. The markup was right, the save really
 * saved, and the chip was faithfully rendering a value that was genuinely
 * there — just the wrong one of the two. So the assertions below are about
 * which source wins, which is the only place the bug ever lived.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

/* The chip fills in from two requests — the session, then the profile — so
   every read waits for a label rather than sampling whatever is painted at
   DOMContentLoaded, which is 'Account' and would pass nothing. */
async function chip(b, dials){
  if (!dials.dials && !dials.store) dials = { dials: dials, store: {} };
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  /* Neither the webfont nor the stub's Google avatar is reachable from the
     container, and both would otherwise spend fifteen seconds giving up. */
  await p.route('**://fonts.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  await p.route('**://lh3.googleusercontent.com/**', r => r.abort());
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  await p.addInitScript(d => {
    Object.assign(window, d.dials || {});
    try {
      Object.keys(d.store || {}).forEach(k => localStorage.setItem(k, d.store[k]));
    } catch (e) {}
    /* Every value the chip's label ever holds. A name that is painted and
       then replaced is invisible to a check that reads the DOM once, and
       "it flashes the old name on every page" is exactly that shape. */
    window.__seen = [];
    new MutationObserver(() => {
      const l = document.getElementById('um-label');
      const t = l && l.textContent.trim();
      if (t && window.__seen[window.__seen.length - 1] !== t) window.__seen.push(t);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, dials);
  await p.goto(BASE + '/app-profile.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const l = document.getElementById('um-label');
    return l && l.textContent.trim() && l.textContent.trim() !== 'Account';
  }, { timeout: 5000 }).catch(() => {});
  return {
    p,
    seen: await p.evaluate(() => window.__seen || []),
    label: (await p.evaluate(() => (document.getElementById('um-label') || {}).textContent || '')).trim(),
    full:  (await p.evaluate(() => (document.getElementById('um-name')  || {}).textContent || '')).trim(),
  };
}

(async () => {
  const b = await chromium.launch();

  console.log('\n==> the profile beats the name signup left on the auth record');
  /* __authName is the whole bug in one dial: a signup-time name that used to
     win over everything the person had edited since. */
  let c = await chip(b, { __authName: 'dfsf' });
  ok('the chip shows the profile name → ' + JSON.stringify(c.label),
     c.label === 'Mohibaxon', 'user_metadata.name is winning again');
  ok('and the menu shows the profile name in full → ' + JSON.stringify(c.full),
     c.full === 'Mohibaxon Omonhonova');
  await c.p.close();

  console.log('\n==> an email signup, which carries no metadata name at all');
  c = await chip(b, {});
  ok('the profile still beats the email prefix → ' + JSON.stringify(c.label),
     c.label === 'Mohibaxon', 'fell through to the local part of the address');
  await c.p.close();

  console.log('\n==> a save reaches the chip without a refresh');
  c = await chip(b, { __authName: 'dfsf' });
  await c.p.fill('#p-name', 'Shahnoza');
  await c.p.fill('#p-last', 'Rahimova');
  await c.p.click('#p-save');
  await c.p.waitForFunction(() => {
    const l = document.getElementById('um-label');
    return l && l.textContent.trim() === 'Shahnoza';
  }, { timeout: 5000 }).catch(() => {});
  const after = (await c.p.evaluate(() => (document.getElementById('um-label') || {}).textContent || '')).trim();
  ok('the chip repainted on save → ' + JSON.stringify(after), after === 'Shahnoza',
     'app-profile.html is not telling pfUserMenu, or setUser ignored it');
  /* The save knows the name and nothing else. Passing no avatar must not be
     read as "this account has no picture" — an OAuth account would lose its
     photo the moment it edited its name, which looks like the save breaking
     something. */
  ok('and the account photo survived that repaint',
     await c.p.evaluate(() => !!document.querySelector('#um-face img')),
     'setUser blanked the avatar when the caller only knew the name');
  await c.p.close();

  console.log('\n==> navigating with a warm cache never flashes the old name');
  /* The complaint this covers: the chip was right on the profile page, and
     every other page showed the signup name for a second before correcting.
     build() paints the cache synchronously and the session then repainted it
     with the stale metadata, so the fault was only ever visible between two
     paints — which is why this asserts on the sequence rather than the end
     state. pf_uid is what makes the cache trustworthy enough to keep. */
  c = await chip(b, {
    dials: { __authName: 'dfsf' },
    store: { pf_uid: 'u1', pf_name: 'Shahnoza Rahimova' },
  });
  ok('the chip never showed the signup name → ' + JSON.stringify(c.seen),
     c.seen.length > 0 && c.seen.indexOf('dfsf') === -1,
     c.seen.length ? 'the metadata name was painted over a cache that was already correct'
                   : 'nothing was recorded at all, so this proved nothing');
  ok('and it settles on the profile name → ' + JSON.stringify(c.label),
     c.label === 'Mohibaxon');
  await c.p.close();

  console.log('\n==> a cache belonging to somebody else never wins');
  /* Same warm cache, different account. Note what is NOT claimed: build()
     paints whatever pf_name holds synchronously, before any account is known,
     so the previous person's first name does appear in the sequence below and
     cannot be prevented without leaving the chip blank on every single load —
     a permanent cost to avoid a flash that only happens when somebody switches
     accounts. What matters is that the stale cache is never what the chip
     settles on: db.js clears it on a switch, and because that guard is async
     the stamp is checked in usermenu.js too rather than raced. */
  c = await chip(b, {
    dials: { __authName: 'Dilnoza Karimova' },
    store: { pf_uid: 'someone-else', pf_name: 'Previous Person' },
  });
  ok('it settles on this account, not the cached one → ' + JSON.stringify(c.seen),
     c.seen.length > 0 && c.seen[c.seen.length - 1] === 'Mohibaxon',
     c.seen.length ? 'a cache stamped for another account was trusted'
                   : 'nothing was recorded at all, so this proved nothing');
  ok('and the unstamped name was replaced rather than kept',
     c.label === 'Mohibaxon');
  await c.p.close();

  await b.close();
  console.log(fails ? '\n' + fails + ' check(s) failed.' : '\nAll account-menu checks passed.');
  process.exit(fails ? 1 : 0);
})();
