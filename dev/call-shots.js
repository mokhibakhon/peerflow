/* Drive the real call page all the way to the live screen and look at it.
 *
 *     PF_STUB=1 PORT=9013 node dev/serve.js &
 *     node dev/call-shots.js /tmp/shots
 *
 * The CDN's livekit-client is routed to dev/livekit-fake.js, so the whole
 * state machine — lobby, join, partner arrives, bar — runs on a machine that
 * can reach no media server. That is only possible because call.js reads
 * window.LivekitClient at the moment it needs it rather than capturing it at
 * load, which is worth not undoing.
 *
 * It asserts as well as photographs: the phase pill's text and colour at
 * several points in the booking, and whether the ambience actually makes a
 * sound rather than silently building a graph that is wired wrong.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || '.';
const PORT = process.env.PORT || 9013;
const BASE = 'http://127.0.0.1:' + PORT;
const FAKE = fs.readFileSync(path.join(__dirname, 'livekit-fake.js'), 'utf8');
const STUB = path.join(__dirname, 'db-stub.js');

let fails = 0;
const ok = (name, cond, extra) => {
  if (cond) { console.log('  \x1b[32mPASS\x1b[0m ' + name); return; }
  fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '\n        ' + extra : ''));
};

async function room(browser, dials){
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  page.on('pageerror', e => { fails++; console.log('  \x1b[31mpage error\x1b[0m ' + e.message); });
  page.on('console', m => {
    if (m.type() === 'error' && !/net::ERR_/.test(m.text()))
      console.log('  console error: ' + m.text().slice(0, 160));
  });
  /* The SDK, replaced. The real tag carries a subresource-integrity hash, so
     a substituted body would be refused by the browser before it ran — the
     integrity attribute is stripped from the page itself rather than the hash
     being faked, which keeps the rest of call.html byte-identical to what
     ships. */
  await page.route('**/call.html*', async r => {
    const res = await r.fetch();
    let html = await res.text();
    html = html.replace(/\s+integrity="[^"]*"/, '').replace(/\s+crossorigin="anonymous"/, '');
    r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.route('**/livekit-client*.js', r =>
    r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  /* The dials go in ahead of the stub, which is what reads them. */
  await page.route('**/assets/db.js', r =>
    r.fulfill({ contentType: 'text/javascript', body: dials + '\n' + fs.readFileSync(STUB, 'utf8') }));

  await page.goto(BASE + '/call.html?s=demo', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#st-lobby:not([hidden])', { timeout: 8000 });
  await page.click('#lb-join');
  await page.waitForSelector('#st-live:not([hidden])', { timeout: 8000 });
  await page.waitForTimeout(900);   /* let the partner arrive */
  return page;
}

const pill = () => ({
  cls: document.getElementById('bar-clock').className,
  text: document.getElementById('bar-clock').innerText.replace(/\s+/g, ' ').trim(),
  rail: document.querySelectorAll('#ph-rail i.on').length + '/' +
        document.querySelectorAll('#ph-rail i').length
});

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required'] });

  console.log('\n==> the phase pill, at four points in a 50-minute booking');
  /* 50 minutes is 25 | 5 | 20, so: early focus, the break, the last stretch,
     and after the end. */
  for (const [mins, expect, why] of [
        [4,  'Focus 1 of 2', 'four minutes in'],
        [26, 'Break',        'one minute into the break'],
        [34, 'Focus 2 of 2', 'the second stretch'],
        [52, 'Session over', 'past the end']]) {
    const page = await room(browser, 'window.__callMinsIn=' + mins + ';');
    const r = await page.evaluate(pill);
    ok(why.padEnd(26) + '-> ' + r.text,
       r.text.indexOf(expect) === 0,
       'expected to start with "' + expect + '"');
    if (mins === 26) {
      ok('  the break is the state that changes colour', /\bbrk\b/.test(r.cls), r.cls);
      await page.locator('.rm-bar').screenshot({ path: OUT + '/call-break.png' });
    }
    if (mins === 4) {
      ok('  focus is not coloured, it stays quiet', !/\bbrk\b/.test(r.cls), r.cls);
      ok('  the rail shows the whole session', r.rail === '1/3', r.rail);
      await page.locator('.rm-bar').screenshot({ path: OUT + '/call-bar.png' });
      await page.screenshot({ path: OUT + '/call-live.png' });
    }
    await page.close();
  }

  console.log('\n==> the sound picker');
  const page = await room(browser, 'window.__callMinsIn=4;');
  await page.click('#c-sound');
  await page.waitForTimeout(250);
  ok('the panel opens from the bar', await page.isVisible('#sound-pop'));
  ok('it offers off, rain, deep noise and ocean',
     (await page.$$eval('#snd-grid .snd-b', b => b.map(x => x.getAttribute('data-snd')).join(','))) ===
     'off,rain,noise,ocean');
  await page.locator('#sound-pop').screenshot({ path: OUT + '/call-sound.png' });

  for (const kind of ['rain', 'noise', 'ocean']) {
    await page.click('[data-snd="' + kind + '"]');
    await page.waitForTimeout(600);
    const m = await page.evaluate(async () => {
      const a = window.pfAmbience;
      if (!a || !a.playing()) return { reason: 'not playing' };
      /* Measure what comes out, rather than trusting that a graph was built:
         a Web Audio graph wired wrongly reports itself as running and makes
         no sound at all. */
      const out = a.output(), ctx = out.context;
      const an = ctx.createAnalyser(); an.fftSize = 2048;
      out.connect(an);
      await new Promise(r => setTimeout(r, 320));
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let sum = 0, peak = 0;
      for (const v of buf) { sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
      out.disconnect(an);
      return { playing: a.playing(), rms: Math.sqrt(sum / buf.length), peak: peak,
               pressed: document.querySelector('.snd-b[aria-pressed="true"]').getAttribute('data-snd') };
    });
    ok(kind + ' is chosen, audible and not clipping  (rms ' +
         (m.rms || 0).toFixed(4) + ', peak ' + (m.peak || 0).toFixed(3) + ')',
       m.playing === kind && m.pressed === kind && m.rms > 0.0005 && m.peak <= 1.0001,
       JSON.stringify(m));
  }
  /* Pressing the chosen tile again turns it off. */
  await page.click('[data-snd="ocean"]');
  await page.waitForTimeout(200);
  ok('pressing the chosen texture again turns it off',
     (await page.evaluate(() => window.pfAmbience.playing())) === null);

  await page.screenshot({ path: OUT + '/call-sound-open.png' });
  await page.close();
  await browser.close();

  console.log('\n===================================================');
  console.log(fails ? ('failed ' + fails) : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
