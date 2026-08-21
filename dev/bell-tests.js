/* The notification bell: what it counts, and what reading it changes.
 *
 *     PF_STUB=1 PORT=9000 node dev/serve.js &
 *     node dev/bell-tests.js 9000 /tmp/shots
 *
 * The panel holds two unlike things and used to hold them in one list:
 * requests waiting on you, which cleared when you opened the panel, and a
 * session proposal, which deliberately did not. Both looked identical, so the
 * count went down for reasons you could not see and stayed up for reasons you
 * could not see either.
 *
 * The check that matters is the one about opening: the badge must not move.
 * If it does, the split has failed at the only job it has — making the number
 * mean "things still on your plate", so it only ever falls because you acted.
 *
 * The other half is that public.notifications is read at all. The triggers in
 * migration-notify.sql have been writing into it and nothing displayed a
 * single row.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = process.argv[2] || process.env.PORT || 9000;
const OUT  = process.argv[3] || require('os').tmpdir() + '/peerflow-shots';
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

async function open(b, dials){
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on('pageerror', e => { fails++; console.log('  page error: ' + e.message); });
  if (dials) await p.addInitScript(dials);
  await p.goto('http://127.0.0.1:' + PORT + '/app.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  return p;
}
const panel = p => p.evaluate(() => ({
  badge:    document.getElementById('pf-badge').hidden ? null
              : document.getElementById('pf-badge').textContent.trim(),
  sections: [...document.querySelectorAll('#pf-list .bell-sec')].map(x => x.innerText.trim()),
  items:    [...document.querySelectorAll('#pf-list .bell-item')].map(x =>
              x.innerText.replace(/\s+/g, ' ').trim().slice(0, 62)),
  fresh:    document.querySelectorAll('#pf-list .bell-item.fresh').length
}));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n==> the panel has two halves');
  let p = await open(b);
  await p.click('#pf-bell');
  await p.waitForTimeout(500);
  let v = await panel(p);
  console.log('    sections: ' + v.sections.join(' | '));
  v.items.forEach(i => console.log('      · ' + i));
  ok('both sections are drawn', v.sections.length === 2, v.sections.join(' | '));
  /* Compared case-insensitively: .bell-sec is text-transform:uppercase, so
     innerText gives what is painted rather than what the markup says. */
  ok('"Needs you" comes first', /^needs you$/i.test(v.sections[0]), v.sections[0]);

  console.log('\n==> the table is actually read');
  /* Titles only the notifications table can produce — the derived half has no
     idea achievements exist. */
  ok('an achievement from notifySelf() is shown',
     v.items.some(i => /Achievement unlocked/.test(i)),
     v.items.join(' / '));
  ok('a session event from the triggers is shown',
     v.items.some(i => /accepted your time|declined that time/.test(i)),
     v.items.join(' / '));
  await p.close();

  console.log('\n==> opening the panel does not move the badge');
  p = await open(b);
  const before = (await panel(p)).badge;
  await p.click('#pf-bell');
  await p.waitForTimeout(900);
  const openBadge = (await panel(p)).badge;
  /* Close, reopen, and check again — the read has landed by now. */
  await p.click('#pf-bell'); await p.waitForTimeout(200);
  await p.click('#pf-bell'); await p.waitForTimeout(700);
  const after = (await panel(p)).badge;
  console.log('    badge: ' + before + ' -> ' + openBadge + ' -> ' + after);
  ok('the count is the same before, during and after reading',
     before === openBadge && openBadge === after, before + ' / ' + openBadge + ' / ' + after);
  ok('and it counts something', before !== null && Number(before) > 0, String(before));

  console.log('\n==> but reading still marks the log read');
  const seen = await p.evaluate(() => {
    let c = []; try { c = JSON.parse(sessionStorage.getItem('__calls') || '[]'); } catch (e) {}
    return c.filter(x => /markNotificationsRead/.test(x));
  });
  ok('markNotificationsRead was called: ' + (seen.join(', ') || 'no'), seen.length > 0);
  await p.locator('#pf-panel').screenshot({ path: OUT + '/bell.png' });
  await p.close();

  console.log('\n==> a proposal is not listed twice');
  /* The trigger writes a row for the same event needsYou() derives live. The
     fixture's default session list has a proposal from Amir Karimov waiting;
     a note titled with his name must not also appear in the log. */
  p = await open(b, `window.__notes = [
    { id:'d1', kind:'session', title:'Amir Karimov proposed a session time',
      body:'Friday at 19:00.', href:'app.html', readAt:null,
      createdAt:new Date(Date.now()-120000).toISOString() },
    { id:'d2', kind:'achievement', title:'Achievement unlocked: First session',
      body:'Finished your first session together.', href:'app-badges.html',
      readAt:null, createdAt:new Date(Date.now()-600000).toISOString() }
  ];`);
  await p.click('#pf-bell');
  await p.waitForTimeout(600);
  v = await panel(p);
  v.items.forEach(i => console.log('      · ' + i));
  const proposedTwice = v.items.filter(i => /Amir Karimov proposed/.test(i)).length;
  ok('the live item is there once, not twice (' + proposedTwice + ')', proposedTwice === 1);
  ok('and the achievement is untouched by the de-duplication',
     v.items.some(i => /First session/.test(i)));
  await p.close();

  console.log('\n==> the migration not having been run degrades quietly');
  p = await open(b, 'window.__notes = null;');
  await p.click('#pf-bell');
  await p.waitForTimeout(600);
  v = await panel(p);
  ok('the derived half still draws', v.items.length > 0, JSON.stringify(v.sections));
  ok('and the badge still counts it', v.badge !== null, String(v.badge));
  await p.close();

  await b.close();
  console.log(fails ? '\nfailed ' + fails : '\nall checks pass');
  process.exit(fails ? 1 : 0);
})();
