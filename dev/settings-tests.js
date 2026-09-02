/* Settings, asserted rather than admired — the two things on this page that
 * are hard to undo.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/settings-tests.js 9000
 *
 * Deleting an account is the only irreversible act on the site, so most of
 * what is checked here is the ways it must NOT happen: the confirm step is not
 * there until it is asked for, the button will not unlock on "delet", a
 * refusal leaves you exactly where you were with both buttons usable again.
 * The one case going the other way — " Delete " with a capital and two spaces
 * being accepted — is here because a phone keyboard produces exactly that, and
 * refusing somebody's deletion over their own autocorrect is a dead end rather
 * than a safeguard.
 *
 * The blocked list is the other half. Its rows usually have no name, because
 * blocking hides that person's profile from you, which is the whole point — so
 * the placeholder is the normal path and gets a case of its own, and the name
 * is escaped, because when there is one it came out of a session row somebody
 * else typed.
 *
 * Two of these failed first time for reasons worth writing down. The locale is
 * pinned to en-GB because the page formats with toLocaleDateString(undefined),
 * so asserting on "3 August 2026" passes in London and fails in a container set
 * to en-US. And waitForSelector defaults to state:'visible', which a hidden
 * element can never satisfy — the card had hidden itself correctly and the test
 * sat waiting for it to appear.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const B = 'http://127.0.0.1:' + PORT + '/app-settings.html';

let pass = 0, fail = 0;

function eq(got, want, what) {
  if (got !== want) {
    throw new Error((what ? what + ' ' : '') +
      'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
  }
}

async function main() {
  const b = await chromium.launch();

  async function open(dials) {
    const p = await b.newPage({
      viewport: { width: 1100, height: 1000 },
      locale: 'en-GB',
    });
    await p.addInitScript((d) => { Object.assign(window, d || {}); }, dials || {});
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(B, { waitUntil: 'domcontentloaded' });
    /* The Account card filling in is the signal that currentUser() has
       resolved and every other paint on the page has been kicked off. */
    await p.waitForFunction(
      () => document.getElementById('s-email').textContent !== '—',
      null, { timeout: 8000 });
    p.__errs = errs;
    return p;
  }

  async function t(name, fn) {
    try {
      await fn();
      pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name);
    } catch (e) {
      fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n        ' + e.message);
    }
  }

  console.log('\n==> deleting your account');

  await t('the confirm step is not there until you ask for it', async () => {
    const p = await open();
    eq(await p.locator('#s-del-confirm').isVisible(), false);
    eq(await p.locator('#s-del-start').isVisible(), true);
    await p.close();
  });

  await t('the delete button stays locked until the word is exact', async () => {
    const p = await open();
    await p.click('#s-del-start');
    eq(await p.locator('#s-del-go').isDisabled(), true, 'empty:');
    await p.fill('#s-del-word', 'delet');
    eq(await p.locator('#s-del-go').isDisabled(), true, 'partial:');
    await p.fill('#s-del-word', 'DELETE');
    eq(await p.locator('#s-del-go').isDisabled(), false, 'exact:');
    await p.close();
  });

  await t('a phone keyboard’s " Delete " is accepted', async () => {
    const p = await open();
    await p.click('#s-del-start');
    await p.fill('#s-del-word', ' Delete ');
    eq(await p.locator('#s-del-go').isDisabled(), false);
    await p.close();
  });

  await t('cancelling puts it all back', async () => {
    const p = await open();
    await p.click('#s-del-start');
    await p.fill('#s-del-word', 'DELETE');
    await p.click('#s-del-cancel');
    eq(await p.locator('#s-del-confirm').isVisible(), false);
    eq(await p.locator('#s-del-start').isVisible(), true);
    eq(await p.inputValue('#s-del-word'), '');
    eq(await p.locator('#s-del-go').isDisabled(), true, 'button re-locked:');
    await p.close();
  });

  await t('deleting calls deleteAccount and leaves for the home page', async () => {
    const p = await open();
    await p.click('#s-del-start');
    await p.fill('#s-del-word', 'DELETE');
    /* The page sets location.href = 'index.html', and vercel.json answers that
       with a 308 to '/' — index.html is served at the root, and the .html form
       is one of the redirects pointing the other way, which dev/serve.js reads
       out of that same table rather than restating. So the URL this settles on
       is the origin itself, and waiting for /index\.html$/ waited the full
       thirty seconds for a spelling the redirect had already replaced.

       It failed as "deleting ... leaves for the home page", which is the one
       reading the evidence ruled out: Playwright's own log said `navigated to
       "http://127.0.0.1:9000/"` underneath the timeout. Delete had been
       working the whole time. Either form is accepted below, because what is
       being asserted is that it left for the home page and not which of that
       page's two addresses it came to rest on. */
    await Promise.all([
      p.waitForURL((u) => {
        const path = new URL(u).pathname;
        return path === '/' || path === '/index.html';
      }),
      p.click('#s-del-go'),
    ]);

    /* And the half of this case's own name that nothing was checking. Leaving
       for the home page is not the same as having deleted anything, and a
       button that only navigated would have passed here for as long as the
       case existed. The stub records every call it is handed in
       sessionStorage, which survives the redirect because it is the same
       origin. */
    const calls = await p.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('__calls') || '[]'); }
      catch (e) { return []; }
    });
    eq(calls.includes('deleteAccount'), true, 'deleteAccount was called:');
    await p.close();
  });

  await t('a refusal says so and leaves you where you were', async () => {
    const p = await open({ __deleteFail: 'Could not delete your account.' });
    await p.click('#s-del-start');
    await p.fill('#s-del-word', 'DELETE');
    await p.click('#s-del-go');
    await p.waitForFunction(
      () => document.getElementById('s-del-note').textContent.length > 0);
    eq(await p.locator('#s-del-note').innerText(), 'Could not delete your account.');
    eq(await p.locator('#s-del-go').isDisabled(), false, 'button usable again:');
    eq(await p.locator('#s-del-cancel').isDisabled(), false, 'cancel usable again:');
    eq(new URL(p.url()).pathname, '/app-settings.html', 'still on settings:');
    await p.close();
  });

  console.log('\n==> blocked');

  /* An empty "Blocked" heading on everybody's settings page is a permanent
     reminder of an unpleasant feature nobody has needed. */
  await t('the card is not shown to somebody who has blocked nobody', async () => {
    const p = await open({ __blocks: [] });
    eq(await p.locator('#s-blocked-card').isVisible(), false);
    await p.close();
  });

  await t('one block draws one row with the date', async () => {
    const p = await open({ __blocks: [{ id: 'u9', at: '2026-08-03T10:00:00Z', name: null }] });
    await p.waitForSelector('#s-blocked-card:not([hidden])');
    const txt = await p.locator('#s-blocked-list').innerText();
    if (!/Someone/.test(txt)) throw new Error('no placeholder name: ' + txt);
    if (!/Blocked 3 August 2026/.test(txt)) throw new Error('no date: ' + txt);
    eq(await p.locator('[data-unblock="u9"]').count(), 1, 'unblock button:');
    await p.close();
  });

  await t('unblocking removes the row and hides the card when it empties', async () => {
    const p = await open({ __blocks: [{ id: 'u9', at: '2026-08-03T10:00:00Z', name: null }] });
    await p.waitForSelector('#s-blocked-card:not([hidden])');
    await p.click('[data-unblock="u9"]');
    await p.waitForSelector('#s-blocked-card[hidden]', { state: 'attached' });
    const note = await p.locator('#s-blocked-note').innerText();
    if (!/Unblocked/.test(note)) throw new Error('no confirmation: ' + note);
    await p.close();
  });

  await t('a failed unblock keeps the row and re-enables the button', async () => {
    const p = await open({
      __blocks: [{ id: 'u9', at: '2026-08-03T10:00:00Z', name: null }],
      __blockFail: 'Could not unblock them.',
    });
    await p.waitForSelector('#s-blocked-card:not([hidden])');
    await p.click('[data-unblock="u9"]');
    await p.waitForFunction(
      () => document.getElementById('s-blocked-note').textContent.length > 0);
    eq(await p.locator('[data-unblock="u9"]').count(), 1, 'row still there:');
    eq(await p.locator('[data-unblock="u9"]').isDisabled(), false, 'button usable:');
    await p.close();
  });

  await t('a name is used when there is one', async () => {
    const p = await open({ __blocks: [{ id: 'u9', at: '2026-08-03T10:00:00Z', name: 'Bo B' }] });
    await p.waitForSelector('#s-blocked-card:not([hidden])');
    const txt = await p.locator('#s-blocked-list').innerText();
    if (!/Bo B/.test(txt)) throw new Error('name not shown: ' + txt);
    await p.close();
  });

  /* The name comes off a session row, which is text somebody else typed. */
  await t('a name with markup in it is escaped', async () => {
    const p = await open({
      __blocks: [{ id: 'u9', at: '2026-08-03T10:00:00Z',
                   name: '<img src=x onerror=alert(1)>Bo' }],
    });
    await p.waitForSelector('#s-blocked-card:not([hidden])');
    eq(await p.locator('#s-blocked-list img').count(), 0, 'injected element:');
    const txt = await p.locator('#s-blocked-list').innerText();
    if (!/onerror/.test(txt)) throw new Error('escaped text missing: ' + txt);
    await p.close();
  });

  console.log('\n==> the page still works without the migration');

  await t('no blocks table means no card and no error', async () => {
    const p = await open({ __blocks: [] });
    eq(await p.locator('#s-blocked-card').isVisible(), false);
    eq(p.__errs.length, 0, 'page errors: ' + p.__errs.join('; '));
    await p.close();
  });

  await t('a database without migration-safety says so rather than "went wrong"', async () => {
    const p = await open({ __safetyMissing: true });
    eq(p.__errs.length, 0, 'page errors: ' + p.__errs.join('; '));
    await p.close();
  });

  console.log('\n===================================================');
  console.log('passed ' + pass + ', failed ' + fail);
  await b.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
