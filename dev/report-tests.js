/* Reporting somebody, asserted rather than admired.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/report-tests.js 9000
 *
 * The flow chosen on /draft is the one-press one: pick a reason and the report
 * is filed and the person blocked, with no form in between. That is only a
 * defensible thing to ship because of the undo, so the undo gets as many cases
 * as the sending does — including the two ways it is allowed to fail, since a
 * fifteen-minute window and an already-read report are both states somebody
 * will meet and neither is an error.
 *
 * Driven through app-person.html, which is the page that opens it with the
 * least ceremony. The component itself is shared, so what is checked here is
 * what call.html gets too; the call page has its own case at the end for the
 * one thing that differs — the button hiding itself when there is nobody on
 * the other side to report.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.argv[2] || process.env.PORT || 9000;
/* call.html loads livekit-client from a CDN this container cannot reach, so
   call.js bails before the session pass ever arrives and nothing on the page
   gets as far as arming the Report button. dev/call-shots.js already solved
   this: route the SDK to dev/livekit-fake.js, and strip the integrity hash
   from the page rather than faking it, so the rest of call.html stays
   byte-identical to what ships. */
const FAKE = fs.readFileSync(path.join(__dirname, 'livekit-fake.js'), 'utf8');
const PERSON = 'http://127.0.0.1:' + PORT + '/app-person.html?id=u2';
const CALL = 'http://127.0.0.1:' + PORT + '/call.html?s=s1';

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
    const p = await b.newPage({ viewport: { width: 1100, height: 950 } });
    await p.addInitScript((d) => { Object.assign(window, d || {}); }, dials || {});
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PERSON, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-report]', { timeout: 8000 });
    p.__errs = errs;
    return p;
  }

  /* Straight to the confirmation screen, which is where most of this lives. */
  async function sent(dials) {
    const p = await open(dials);
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="harassment"]');
    await p.waitForSelector('[data-undo]');
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

  console.log('\n==> one press');

  await t('the card is not in the document until it is opened', async () => {
    const p = await open();
    eq(await p.locator('.rp-wrap').count(), 0);
    await p.close();
  });

  await t('opening shows five reasons and nothing else to fill in', async () => {
    const p = await open();
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    eq(await p.locator('.rp-r').count(), 5, 'reasons:');
    eq(await p.locator('.rp-wrap textarea').count(), 0, 'textareas before sending:');
    eq(await p.locator('.rp-wrap input').count(), 0, 'inputs before sending:');
    await p.close();
  });

  await t('pressing a reason sends it and blocks, with no second confirmation', async () => {
    const p = await open({ __blocks: [] });
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="harassment"]');
    await p.waitForSelector('.rp-done');
    const txt = await p.locator('.rp-done').innerText();
    if (!/is blocked/.test(txt)) throw new Error('does not say they are blocked: ' + txt);
    eq(await p.evaluate(() => (window.__blocks || []).length), 1, 'block written:');
    await p.close();
  });

  /* Undoing does not put a cancelled session back, and somebody deciding
     whether to undo has to be able to read that before they decide. */
  await t('the confirmation says what blocking did that undo cannot reverse', async () => {
    const p = await sent();
    const txt = await p.locator('.rp-caveat').innerText();
    if (!/partnership/.test(txt)) throw new Error('no mention of the partnership: ' + txt);
    if (!/not those/.test(txt)) throw new Error('does not say undo will not restore them: ' + txt);
    await p.close();
  });

  await t('a refusal leaves all five reasons live to try again', async () => {
    const p = await open({ __reportFail: 'Could not send that report.' });
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="spam"]');
    await p.waitForFunction(() => {
      const n = document.querySelector('.rp-note');
      return n && n.textContent.length > 0;
    });
    eq(await p.locator('.rp-note').innerText(), 'Could not send that report.');
    eq(await p.locator('.rp-r:not([disabled])').count(), 5, 'reasons usable again:');
    eq(await p.locator('.rp-done').count(), 0, 'no false confirmation:');
    await p.close();
  });

  console.log('\n==> undo, which is the reason one press is allowed');

  await t('undo takes the report back and unblocks', async () => {
    const p = await sent({ __blocks: [] });
    eq(await p.evaluate(() => (window.__blocks || []).length), 1, 'blocked first:');
    await p.click('[data-undo]');
    await p.waitForSelector('.rp-h');
    const txt = await p.locator('.rp-card').innerText();
    if (!/Taken back/.test(txt)) throw new Error('no confirmation of undo: ' + txt);
    eq(await p.evaluate(() => (window.__blocks || []).length), 0, 'unblocked:');
    await p.close();
  });

  await t('an undo after the window says so rather than pretending', async () => {
    const p = await sent({ __undoTooLate: true });
    await p.click('[data-undo]');
    await p.waitForFunction(() => {
      const n = document.querySelector('.rp-note');
      return n && n.textContent.length > 0;
    });
    const txt = await p.locator('.rp-note').innerText();
    if (!/already been read/.test(txt)) throw new Error('wrong message: ' + txt);
    eq(await p.locator('[data-undo]').isDisabled(), false, 'button usable again:');
    await p.close();
  });

  console.log('\n==> the optional half');

  /* This is the bug that came back from real use: Save wrote "Saved." into the
     card and left it sitting there, with the page behind it unchanged. From
     where somebody is standing that is indistinguishable from nothing having
     happened, and the only way to find out was to reload. Closing is what says
     it worked, because closing is what lets the page redraw. */
  await t('saving detail closes the card rather than sitting there', async () => {
    const p = await sent();
    await p.fill('[data-detail]', 'they would not stop');
    await p.click('[data-save]');
    await p.waitForSelector('.rp-wrap', { state: 'detached', timeout: 5000 });
    await p.close();
  });

  await t('unchecking "keep blocked" and saving unblocks them, and closes', async () => {
    const p = await sent({ __blocks: [] });
    await p.uncheck('[data-keep]');
    await p.click('[data-save]');
    await p.waitForSelector('.rp-wrap', { state: 'detached', timeout: 5000 });
    eq(await p.evaluate(() => (window.__blocks || []).length), 0, 'unblocked:');
    await p.close();
  });

  await t('saving nothing just closes rather than making a request', async () => {
    const p = await sent();
    await p.click('[data-save]');
    await p.waitForSelector('.rp-wrap', { state: 'detached' });
    await p.close();
  });

  /* A failure must NOT close, or somebody walks away believing something was
     saved that was not. */
  await t('a save that fails stays open and says why', async () => {
    const p = await sent({ __amendFail: 'Could not save that.' });
    await p.fill('[data-detail]', 'more detail');
    await p.click('[data-save]');
    await p.waitForFunction(() => {
      const n = document.querySelector('.rp-note');
      return n && n.textContent.length > 0;
    });
    eq(await p.locator('.rp-note').innerText(), 'Could not save that.');
    eq(await p.locator('.rp-wrap').count(), 1, 'card still open:');
    eq(await p.locator('[data-save]').isDisabled(), false, 'Save usable again:');
    await p.close();
  });

  console.log('\n==> the page behind has to change');

  await t('blocking leaves the profile in a blocked state, not as it was', async () => {
    const p = await sent({ __blocks: [] });
    await p.click('[data-close]');
    await p.waitForSelector('#pv-blocked:not([hidden])', { timeout: 5000 });
    eq(await p.locator('#pv').evaluate((e) => e.hidden), true, 'old profile hidden:');
    const txt = await p.locator('#pv-blocked').innerText();
    if (!/You blocked Amir/.test(txt)) throw new Error('does not name them: ' + txt);
    /* Reloading would fetch a profile the database now hides, landing on
       "we couldn't find that person" — untrue, and the opposite of
       reassuring. */
    eq(await p.locator('#pv-miss').isVisible(), false, 'not the missing-person state:');
    await p.close();
  });

  await t('undoing does not leave the page claiming they are blocked', async () => {
    const p = await sent({ __blocks: [] });
    await p.click('[data-undo]');
    await p.waitForSelector('.rp-h');
    await p.click('[data-close]');
    await p.waitForSelector('[data-report]', { timeout: 8000 });
    eq(await p.locator('#pv-blocked').isVisible(), false);
    await p.close();
  });

  console.log('\n==> getting out');

  await t('Escape closes it', async () => {
    const p = await open();
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.rp-wrap', { state: 'detached' });
    await p.close();
  });

  await t('clicking the dimmed ground closes it', async () => {
    const p = await open();
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.locator('.rp-wrap').click({ position: { x: 8, y: 8 } });
    await p.waitForSelector('.rp-wrap', { state: 'detached' });
    await p.close();
  });

  /* An overlay you can tab out of leaves a keyboard somewhere it cannot see —
     on a call, that is the page behind a scrim. */
  await t('tab does not escape the card', async () => {
    const p = await open();
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
    const inside = await p.evaluate(() =>
      !!document.querySelector('.rp-card').contains(document.activeElement));
    eq(inside, true, 'focus stayed inside:');
    await p.close();
  });

  await t('closing puts focus back on the button that opened it', async () => {
    const p = await open();
    await p.click('[data-report]');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.rp-wrap', { state: 'detached' });
    eq(await p.evaluate(() =>
      document.activeElement && document.activeElement.hasAttribute('data-report')), true);
    await p.close();
  });

  console.log('\n==> on a call');

  async function call(dials) {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    await p.addInitScript((d) => { Object.assign(window, d || {}); }, dials || {});
    await p.route('**/call.html*', async (r) => {
      const res = await r.fetch();
      const html = (await res.text())
        .replace(/\s+integrity="[^"]*"/, '')
        .replace(/\s+crossorigin="anonymous"/, '');
      r.fulfill({ contentType: 'text/html', body: html });
    });
    await p.route('**/livekit-client*.js', (r) =>
      r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await p.goto(CALL, { waitUntil: 'domcontentloaded' });
    /* Through the lobby and into the room. The Report button lives in the
       call bar, which is inside the live screen — in the lobby it is armed
       but not visible, and asserting on visibility from there fails for a
       reason that has nothing to do with the button. */
    await p.waitForSelector('#st-lobby:not([hidden])', { timeout: 8000 });
    await p.click('#lb-join');
    await p.waitForSelector('#st-live:not([hidden])', { timeout: 8000 });
    return p;
  }

  await t('the Report button appears once the partner is known', async () => {
    const p = await call({ __farId: 'u2' });
    await p.waitForSelector('#c-report:not([hidden])', { timeout: 8000 });
    await p.close();
  });

  /* A control that opens onto an error is worse than one that is not there. */
  await t('and stays hidden when there is nobody to report', async () => {
    const p = await call({ __farId: null });
    await p.waitForTimeout(1200);
    eq(await p.locator('#c-report').isVisible(), false, 'not visible:');
    eq(await p.locator('#c-report').evaluate((e) => e.hidden), true, 'still marked hidden:');
    await p.close();
  });

  await t('it opens the same card the profile page opens', async () => {
    const p = await call({ __farId: 'u2' });
    await p.waitForSelector('#c-report:not([hidden])', { timeout: 8000 });
    await p.click('#c-report');
    await p.waitForSelector('.rp-wrap .rp-r');
    eq(await p.locator('.rp-r').count(), 5, 'same five reasons:');
    await p.close();
  });

  /* Blocking does not remove anybody from the LiveKit room — the block is a
     rule about what happens next, and the call is happening now. Staying on a
     video call with somebody you have just reported is not a state to leave
     anybody in. */
  await t('blocking says the call will end, before you close the card', async () => {
    const p = await call({ __farId: 'u2' });
    await p.waitForSelector('#c-report:not([hidden])', { timeout: 8000 });
    await p.click('#c-report');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="harassment"]');
    await p.waitForSelector('[data-undo]');
    const txt = await p.locator('.rp-caveat').innerText();
    if (!/leave the call/.test(txt)) throw new Error('no warning: ' + txt);
    await p.close();
  });

  await t('and closing the card actually leaves it', async () => {
    const p = await call({ __farId: 'u2' });
    await p.waitForSelector('#c-report:not([hidden])', { timeout: 8000 });
    await p.click('#c-report');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="harassment"]');
    await p.waitForSelector('[data-undo]');
    await p.click('[data-close]');
    /* Leaving swaps the room for the after-the-call screen. */
    await p.waitForSelector('#st-live[hidden]', { state: 'attached', timeout: 8000 });
    await p.close();
  });

  await t('undoing on a call keeps you in it', async () => {
    const p = await call({ __farId: 'u2' });
    await p.waitForSelector('#c-report:not([hidden])', { timeout: 8000 });
    await p.click('#c-report');
    await p.waitForSelector('.rp-wrap .rp-r');
    await p.click('[data-reason="harassment"]');
    await p.waitForSelector('[data-undo]');
    await p.click('[data-undo]');
    await p.waitForSelector('.rp-h');
    await p.click('[data-close]');
    await p.waitForTimeout(800);
    eq(await p.locator('#st-live').evaluate((e) => e.hidden), false, 'still in the room:');
    await p.close();
  });

  console.log('\n===================================================');
  console.log('passed ' + pass + ', failed ' + fail);
  await b.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
