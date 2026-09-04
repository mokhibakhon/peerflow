/* Renders the step pictures out of assets/how-frames.html.
 *
 *     PF_STUB=1 node dev/serve.js &
 *     node dev/how-frames-render.js 9000
 *
 * how-frames.html has been the source of these pictures since they were
 * drawn, but nothing in the repo turned it into a PNG — the files were made by
 * hand once and the HTML was left as a note about where they came from. That
 * is fine until somebody edits a frame, at which point the picture on the live
 * page and the markup that claims to draw it are two different things with no
 * way to tell which one is current.
 *
 * So this is the missing half. It writes assets/how-1-find.png at exactly the
 * 1280x841 index.html declares in the img tag, and refuses to write if the
 * frame does not measure that — a mismatch there is a layout shift on the
 * landing page, which is the one bug a picture can cause that nobody notices
 * while looking straight at it.
 *
 * It does not touch assets/how-3-call.webp, which is photographic and was
 * never drawn here, and it does not write the second frame: #f-time draws a
 * step the landing page dropped, and is kept only so the picture can be made
 * again if that step ever comes back.
 *
 * WHY IT ALSO WRITES A 322px COPY
 *
 * Into the scratch directory, not the repo. The card these are read in is
 * 322px wide, so the canvas is shown at a quarter size and every judgement
 * about whether a line is legible has to be made there rather than here. The
 * first version of this frame had column headers and a fourth row and both
 * looked fine at 1280; at 322 the headers were 2.5px of grey. Looking at the
 * big one proves nothing.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PORT = process.argv[2] || 9000;
const ROOT = path.resolve(__dirname, '..');
const SCRATCH = process.env.PF_SCRATCH || require('os').tmpdir();

/* The width the landing page actually shows these at. .how-grid is four
   columns of a 1320px container with 32px padding and 20px gaps, so a card is
   (1320 - 64 - 60) / 4 = 299 at the cap — 322 is that card at the width the
   row stops growing. Either way it is about a quarter, which is the number
   the sizes in how-frames.html are chosen against. */
const CARD = 322;

const TARGETS = [{ id: 'f-find', out: 'assets/how-1-find.png', w: 1280, h: 841 }];

let fails = 0;
const fail = (m) => { fails++; console.error('  FAIL ' + m); };

/* Chromium writes a full-colour PNG, which for this picture is about 165KB.
 * The file it replaces was 44KB, and the landing page is the page whose speed
 * everything else here has been spent on — tripling one of its images to gain
 * nothing visible would undo a chunk of that.
 *
 * A flat UI screenshot is what a palette is for: 64 colours takes it to about
 * 49KB with no visible loss. Floyd-Steinberg rather than a flat map because
 * the Send request button is an 80px vertical gradient and that is the one
 * thing in the frame a small palette could band.
 *
 * Pillow rather than pngquant only because pngquant is not installed here. If
 * neither is available the picture is still correct, just larger, and this
 * says so rather than failing — a heavier PNG is a worse file, not a wrong
 * one, and refusing to write it would be the wrong trade. */
function quantize(file) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
im.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(${JSON.stringify(file)}, optimize=True)
`;
  try {
    execFileSync('python3', ['-c', py], { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn('  note: could not palette-reduce the PNG (needs python3 + Pillow), so it is');
    console.warn('        larger than the file it replaces. The picture itself is correct.');
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  /* Two, not one. The picture that shipped is 2560x1682 for a 1280x841 box,
     and index.html declares the CSS size — so the file has to stay a 2x
     render or it gets softer on every screen that has ever displayed it. */
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => fail('page error: ' + e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/assets/how-frames.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(300);

  /* The typeface, before anything else.
   *
   * how-frames.html linked app.css and nothing else for its whole life, so it
   * never loaded Plus Jakarta Sans — every render took whatever the machine
   * happened to have. In a container with no webfonts that is a serif, and a
   * serif picture on a page set in Jakarta looks like a mistake somebody made
   * on purpose. It is also completely silent: the markup is right, the layout
   * is right, and the PNG is wrong.
   *
   * fonts.check() is the whole test. It answers false both when the stylesheet
   * did not load and when it loaded but the family is not available, which are
   * the two ways this goes wrong. */
  const font = await page.evaluate(() => {
    const el = document.querySelector('.pnm');
    /* Two different questions, and the first version only asked the first one.
       fonts.check says the face is available to the document; it says nothing
       about whether the element is asking for it. This frame was asking for
       var(--body), which was undeclared, so the declaration was invalid at
       computed-value time — the element fell all the way back to the browser
       default while fonts.check happily answered true. */
    return {
      available: document.fonts.check('700 44px "Plus Jakarta Sans"'),
      asked: el ? getComputedStyle(el).fontFamily : '(no .pnm in the frame)'
    };
  });
  if (!font.available || !/Plus Jakarta Sans/.test(font.asked)) {
    console.error('  FAIL the text would not be set in Plus Jakarta Sans.');
    console.error('       face available to the document: ' + font.available);
    console.error('       font-family the name is asking for: ' + font.asked);
    console.error('       Install it where fontconfig can see it, or give the browser a route to');
    console.error('       fonts.googleapis.com. Refusing to write a picture in the wrong typeface.');
    await browser.close();
    process.exit(1);
  }

  for (const t of TARGETS) {
    const el = page.locator('#' + t.id);
    const box = await el.boundingBox();
    const w = Math.round(box.width), h = Math.round(box.height);
    if (w !== t.w || h !== t.h) {
      fail(`#${t.id} measures ${w}x${h}, but index.html declares ${t.w}x${t.h} — ` +
           'fix the frame or the img tag, do not ship the mismatch');
      continue;
    }

    /* Nothing may be clipped or overflowing its row. A picture read at a
       quarter size hides an overflow as a smudge, so it is checked here where
       the numbers are still whole pixels. */
    const overflow = await page.evaluate((id) => {
      const bad = [];
      const frame = document.getElementById(id);
      const fr = frame.getBoundingClientRect();
      frame.querySelectorAll('*').forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.width && (r.right > fr.right + 0.5 || r.left < fr.left - 0.5)) {
          bad.push((n.className || n.tagName) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
        }
        if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible') {
          bad.push((n.className || n.tagName) + ' is scrolling its own content');
        }
      });
      return bad;
    }, t.id);
    if (overflow.length) { fail(`#${t.id} overflows: ` + overflow.join('; ')); continue; }

    /* And nothing may sit on top of its neighbour. This is the check that
       matters: the first version of this frame kept every element inside the
       frame, so the bounds check above passed, while the SAME PATH tag ran out
       of the person column and printed across the learning-focus text. Inside
       the frame and legible are different questions. */
    const collisions = await page.evaluate((id) => {
      const bad = [];
      /* The union of what a column actually PAINTS, not the box it was given.
         A flex item with a fixed basis keeps its box while its children
         happily overflow it, so comparing the boxes says everything is fine
         while the tag prints across the text next door — which is exactly
         what happened, and what the boxes-only version of this check missed. */
      const ink = (el) => {
        let l = Infinity, r = -Infinity;
        const walk = (n) => {
          if (n.nodeType === 3 && n.textContent.trim()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const b of range.getClientRects()) { l = Math.min(l, b.left); r = Math.max(r, b.right); }
          }
          if (n.nodeType === 1) {
            const b = n.getBoundingClientRect();
            const cs = getComputedStyle(n);
            /* A background or a border paints too, so a tag counts even
               where its text would have fitted. */
            if (b.width && (cs.backgroundImage !== 'none' ||
                            cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                            parseFloat(cs.borderTopWidth) > 0)) {
              l = Math.min(l, b.left); r = Math.max(r, b.right);
            }
            n.childNodes.forEach(walk);
          }
        };
        walk(el);
        return r > l ? { left: l, right: r } : null;
      };
      document.querySelectorAll('#' + id + ' .prow').forEach((row, i) => {
        const kids = [...row.children].map((n) => ({ n, r: ink(n) }))
          .filter((k) => k.r);
        for (let a = 0; a < kids.length; a++) {
          for (let b = a + 1; b < kids.length; b++) {
            if (kids[a].r.right > kids[b].r.left + 0.5 && kids[b].r.right > kids[a].r.left + 0.5) {
              bad.push(`row ${i + 1}: .${kids[a].n.className} overlaps .${kids[b].n.className}`);
            }
          }
        }
      });
      return bad;
    }, t.id);
    if (collisions.length) { fail(`#${t.id}: ` + collisions.join('; ')); continue; }

    /* Every learning goal on one line. Not a nicety: a goal that wraps makes
       its row taller than the other two, and at a quarter size an uneven row
       is the first thing the eye lands on — which is the wrong thing, since
       nothing about that row is more important. It happened once already,
       with "Networking fundamentals" in a 330px column. */
    const wrapped = await page.evaluate((id) =>
      [...document.querySelectorAll('#' + id + ' .pfocus')]
        .map((n, i) => {
          /* Over the TEXT, not the element. .pfocus is a flex item, so it is
             blockified and getClientRects() on the element returns exactly one
             box however many lines are inside it — which is how the first
             version of this check passed while the picture plainly wrapped.
             A Range across the text node returns one rect per line. */
          const range = document.createRange();
          range.selectNodeContents(n);
          return { i: i + 1, lines: range.getClientRects().length, text: n.textContent.trim() };
        })
        .filter((x) => x.lines > 1)
        .map((x) => `row ${x.i} ("${x.text}") wraps to ${x.lines} lines`), t.id);
    if (wrapped.length) { fail(`#${t.id}: ` + wrapped.join('; ')); continue; }

    const out = path.join(ROOT, t.out);
    const before = fs.existsSync(out) ? fs.statSync(out).size : 0;
    await el.screenshot({ path: out });
    const raw = fs.statSync(out).size;
    const saved = quantize(out);
    const after = fs.statSync(out).size;
    console.log(`  wrote ${t.out}  ${w}x${h}  ${(after / 1024).toFixed(1)}KB` +
                (saved ? `  (${(raw / 1024).toFixed(1)}KB before the palette)` : '') +
                (before ? `  (previous file ${(before / 1024).toFixed(1)}KB)` : ''));

    /* And the same frame at the size it is read at, for looking at. */
    const proof = path.join(SCRATCH, path.basename(t.out, '.png') + '-at-card-size.png');
    await page.evaluate(([id, cw]) => {
      const f = document.getElementById(id);
      f.style.transformOrigin = 'top left';
      f.style.transform = 'scale(' + cw / f.getBoundingClientRect().width + ')';
    }, [t.id, CARD]);
    await page.waitForTimeout(120);
    await page.screenshot({ path: proof, clip: { x: box.x, y: box.y, width: CARD, height: Math.ceil(t.h * CARD / t.w) } });
    console.log(`  wrote ${proof}  ${CARD}px — this is the one to judge it at`);
  }

  await browser.close();
  process.exit(fails ? 1 : 0);
})();
