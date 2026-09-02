#!/usr/bin/env node
/*
 * SEO regression checks. No dependencies.  Run:  node dev/seo-tests.js
 *
 * The previous version of this file hardcoded the list of public pages and the
 * expected robots.txt line. Both went stale, and in the same way: when the site
 * moved to the www canonical host, robots.txt was updated and the assertion
 * here was not, so the suite failed for a reason that had nothing to do with a
 * real defect. Worse, privacy.html, terms.html and conduct.html were never in
 * the hardcoded list at all, so nothing noticed that they still pointed their
 * canonicals at the apex host or that they were missing from the sitemap.
 *
 * So the rules here derive what they can from the files. ORIGIN is stated once
 * and everything else — which pages are public, what each canonical should be,
 * what robots.txt should advertise — follows from it and from the pages on
 * disk. A new landing page is covered the moment it is committed; nobody has to
 * remember to add it here.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const { indexable, ordered, urlFor, ORIGIN } = require('./sitemap-build.js');

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL  ${msg}`); };
const pass = (msg) => process.env.PF_QUIET || console.log(`PASS  ${msg}`);
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const allPages = fs.readdirSync(root).filter((f) => f.endsWith('.html')).sort();
const noindexPages = allPages.filter((f) => !indexable.includes(f));

// Anything a search engine may index has to satisfy the full set; anything else
// has to be genuinely unreachable to a crawler. Every page falls into exactly
// one bucket, which is the property that was missing before.
console.log(`\n── ${indexable.length} indexable, ${noindexPages.length} noindex, ${allPages.length} total\n`);

const titles = new Map();
const descriptions = new Map();

for (const f of indexable) {
  const html = read(f);
  const url = urlFor(f);
  const attr = (re) => { const m = html.match(re); return m && m[1]; };

  const title = attr(/<title>([^<]*)<\/title>/i);
  check(title && title.length >= 10 && title.length <= 70,
    `${f}: title 10-70 chars (${title ? title.length : 'missing'})`);
  if (title) {
    if (titles.has(title)) fail(`${f}: title duplicates ${titles.get(title)}`);
    else titles.set(title, f);
  }

  const desc = attr(/<meta name="description" content="([^"]*)">/i);
  check(desc && desc.length >= 70 && desc.length <= 165,
    `${f}: description 70-165 chars (${desc ? desc.length : 'missing'})`);
  if (desc) {
    if (descriptions.has(desc)) fail(`${f}: description duplicates ${descriptions.get(desc)}`);
    else descriptions.set(desc, f);
  }

  // A canonical must name the page it sits on. A canonical pointing anywhere
  // else quietly hands the page's ranking to another URL.
  const canonical = attr(/<link rel="canonical" href="([^"]*)">/i);
  check(canonical === url, `${f}: canonical is ${url}`);
  check(attr(/<meta property="og:url" content="([^"]*)">/i) === url, `${f}: og:url matches canonical`);

  // Every absolute self-reference has to use the canonical host. This is the
  // check that would have caught the three legal pages sitting on the apex
  // domain while the rest of the site had moved to www.
  const wrongHost = (html.match(/https:\/\/(?!www\.)peerflow\.dev[^\s"']*/g) || []);
  check(wrongHost.length === 0, `${f}: no non-canonical host URLs${wrongHost.length ? ' — ' + wrongHost.join(', ') : ''}`);

  const h1s = html.match(/<h1\b/gi) || [];
  check(h1s.length === 1, `${f}: exactly one H1 (found ${h1s.length})`);

  check(/property="og:title"/.test(html) && /name="twitter:card"/.test(html)
    && /property="og:image"/.test(html) && /property="og:image:alt"/.test(html)
    && /property="og:locale"/.test(html),
    `${f}: complete social metadata`);

  // An internal link to /index.html is a link to a URL that permanently
  // redirects. It still resolves, but it spends a round trip and a little of
  // the page's link equity to arrive somewhere the site could have named
  // directly. The three legal pages did this in their footers.
  const hops = (html.match(/href="[^"]*index\.html[^"]*"/g) || []);
  check(hops.length === 0, `${f}: no internal links to the redirecting /index.html${hops.length ? ' — ' + hops.join(', ') : ''}`);

  check(/<html lang="en">/.test(html), `${f}: lang declared`);
  check(/<meta charset="utf-8">/i.test(html), `${f}: charset declared`);
  check(/<meta name="viewport"/.test(html), `${f}: viewport declared`);
}

for (const f of noindexPages) {
  const html = read(f);
  check(/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html), `${f}: noindex`);
  // A noindex page must not also be advertised as canonical from elsewhere, and
  // must not carry a canonical pointing at an indexable page, which would be a
  // contradictory instruction.
  check(!/<link rel="canonical"/.test(html) || /noindex/.test(html), `${f}: no conflicting canonical`);
}

// ── structured data ────────────────────────────────────────────────────────
for (const f of indexable) {
  const html = read(f);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  check(blocks.length === 1, `${f}: exactly one JSON-LD block (found ${blocks.length})`);
  if (!blocks.length) continue;

  let data;
  try { data = JSON.parse(blocks[0][1]); }
  catch (e) { fail(`${f}: JSON-LD does not parse — ${e.message}`); continue; }
  pass(`${f}: JSON-LD parses`);

  const graph = data['@graph'] || [data];
  const types = graph.map((n) => n['@type']);
  check(types.includes('WebPage'), `${f}: declares a WebPage node`);

  // Every @id a node references must resolve to a node that is actually
  // present, or the graph is broken and consumers drop the relationship.
  const ids = new Set(graph.map((n) => n['@id']).filter(Boolean));
  const refs = [];
  JSON.stringify(graph, (k, v) => {
    if (v && typeof v === 'object' && v['@id'] && !v['@type'] && Object.keys(v).length === 1) refs.push(v['@id']);
    return v;
  });
  const dangling = refs.filter((r) => !ids.has(r));
  check(dangling.length === 0, `${f}: no dangling @id references${dangling.length ? ' — ' + [...new Set(dangling)].join(', ') : ''}`);

  const urlsInGraph = [];
  JSON.stringify(graph, (k, v) => {
    if (typeof v === 'string' && v.startsWith('http') && v.includes('peerflow.dev')) urlsInGraph.push(v);
    return v;
  });
  check(urlsInGraph.every((u) => u.startsWith(ORIGIN)), `${f}: schema URLs on canonical host`);

  // FAQ markup that states an answer the page does not show is a structured
  // data violation, so assert each question and answer is really rendered.
  //
  // The script blocks have to come out before the tags do. Stripping only tags
  // leaves the JSON-LD source itself inside the text being searched, so every
  // answer trivially "appears on the page" — it appears in the schema. That
  // made this check pass no matter how far the copy drifted from the markup.
  const faq = graph.find((n) => n['@type'] === 'FAQPage');
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  if (faq) {
    const missing = [];
    for (const q of faq.mainEntity) {
      if (!visible.includes(q.name)) missing.push(`Q: ${q.name}`);
      if (!visible.includes(q.acceptedAnswer.text)) missing.push(`A: ${q.name}`);
    }
    check(missing.length === 0, `${f}: FAQ schema matches visible copy${missing.length ? ' — ' + missing.join('; ') : ''}`);
  } else if (/<details><summary>/.test(html)) {
    fail(`${f}: page renders an FAQ but declares no FAQPage schema`);
  }
}

// ── internal linking ───────────────────────────────────────────────────────
// A page in the sitemap that nothing links to is a page search engines will
// discount. Check each indexable page is linked from at least one other one.
for (const f of indexable) {
  if (f === 'index.html') continue;
  const linkers = indexable.filter((o) => o !== f && new RegExp(`href="(\\./)?${f}[?#"]`).test(read(o)));
  check(linkers.length > 0, `${f}: linked from ${linkers.length} other indexable page(s)`);
}

// ── sitemap ────────────────────────────────────────────────────────────────
const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const expected = ordered.map(urlFor);
check(JSON.stringify(locs) === JSON.stringify(expected),
  `sitemap.xml lists exactly the ${expected.length} indexable pages`);
if (JSON.stringify(locs) !== JSON.stringify(expected)) {
  for (const u of expected.filter((u) => !locs.includes(u))) fail(`  sitemap.xml: missing ${u}`);
  for (const u of locs.filter((u) => !expected.includes(u))) fail(`  sitemap.xml: unexpected ${u}`);
  console.error('  run: node dev/sitemap-build.js');
}
check(!locs.includes(`${ORIGIN}/index.html`), 'sitemap.xml: lists / not /index.html');
check([...sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)]
  .every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m[1])), 'sitemap.xml: lastmod values well formed');

// ── robots.txt ─────────────────────────────────────────────────────────────
const robots = read('robots.txt');
// Derived from ORIGIN rather than matched with an optional www, which is the
// other obvious repair for the stale assertion this file used to carry. An
// optional www passes on either host, so it would go on passing if robots.txt
// drifted back to the apex — and the apex is exactly what every canonical was
// moved away from. Asserting the one host the site actually claims is the
// point of the check.
check(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), `robots.txt: declares ${ORIGIN}/sitemap.xml`);
check(/User-agent:\s*\*/i.test(robots), 'robots.txt: has a wildcard user-agent group');
// robots.txt Disallow would hide pages from crawling entirely, which also stops
// a crawler from ever seeing the noindex tag on them. The app pages rely on the
// meta tag, so nothing here may be disallowed.
check(!/^\s*Disallow:\s*\S/mi.test(robots), 'robots.txt: no Disallow that would mask a noindex tag');

// ---------- the icon Google actually fetches ----------
// Every page used to declare its favicon as a data: URI with the SVG inlined in
// the href. That paints a browser tab correctly, which is why it never looked
// broken from the inside — but Google fetches a favicon as its own URL, and a
// data: URI is not one. There was nothing to fetch, so the search result showed
// the generic globe next to a competitor with a real icon.
//
// It had also drifted three ways while nobody could see it: seventeen pages
// carried the mark in #1D9E75, nine in #0b8f66 (one of the greens tokens.css was
// written to retire), and the two newest guides carried a truncated copy with
// one of the eight shapes left in — a single small rectangle. Nothing could
// catch that, because a favicon is the one asset no page renders visibly.
const ICON_FILES = ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'];
for (const f of ICON_FILES) {
  check(fs.existsSync(path.join(root, f)), `${f}: exists at the site root`);
}

// A favicon is fetched from the root of whatever host is asked, and 404.html is
// served AT the address that was missing — so a relative href on that page
// resolves against the bad path. Root-relative is the only form that survives.
const ICON_LINKS = [
  [/<link rel="icon" href="\/favicon.ico" sizes="32x32">/, 'links /favicon.ico'],
  [/<link rel="icon" href="\/icon.svg" type="image\/svg\+xml">/, 'links /icon.svg'],
  [/<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/, 'links /apple-touch-icon.png'],
];
let iconOk = 0;
for (const f of allPages) {
  const html = read(f);
  if (/<link rel="icon"[^>]*href="data:/.test(html)) {
    fail(`${f}: favicon is a data: URI, which Google cannot fetch`);
    continue;
  }
  const missing = ICON_LINKS.filter(([re]) => !re.test(html)).map(([, name]) => name);
  if (missing.length) fail(`${f}: ${missing.join(', ')} — missing or not root-relative`);
  else iconOk++;
}
check(iconOk === allPages.length,
      `every page links the same three icon files, root-relative (${iconOk}/${allPages.length})`);

// The ICO has to be a real multi-frame ICO rather than a PNG that was renamed,
// which is the easy way to produce a file that looks right in a listing and
// fails in a browser. Header: reserved 0, type 1, then the frame count.
const ico = fs.readFileSync(path.join(root, 'favicon.ico'));
check(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1,
      'favicon.ico: is an ICO, not a renamed PNG');
check(ico.readUInt16LE(4) >= 3,
      `favicon.ico: carries at least 3 frames (${ico.readUInt16LE(4)})`);

// icon.svg is the bare mark on a transparent ground, in the ramp accent. It was
// briefly a white mark knocked out of a green tile, because a tile is what
// survives being shrunk to the 16px a search result uses and the four thin
// arrows do scatter at that size — but the owner looked at both live and chose
// the plain mark, which is the brand as it appears everywhere else on the site.
// That is a taste decision and it is theirs; what is asserted here is only that
// it stays a ramp green and stays whole.
const iconSvg = read('icon.svg');
check(!/#0b8f66/i.test(iconSvg), 'icon.svg: does not use a retired green');
check(/fill="#1D9E75"/.test(iconSvg), 'icon.svg: uses the ramp accent');

// Google's favicon documentation asks for a square icon, and the mark is
// 173x171. Shipping the mark's own viewBox meant shipping a non-square favicon,
// and rendering it into square ICO frames squashed it about 1%. It now sits
// centred on a square 192 canvas — 192 because it is 4x48 and 48 is the size
// Google names. Asserted because "the logo, as it is" is a design decision and
// "square" is a spec, and the second one is easy to lose while honouring the
// first.
const vb = iconSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
check(!!vb && vb[1] === vb[2], `icon.svg: square viewBox (${vb ? vb[1] + 'x' + vb[2] : 'missing'})`);

// Eight shapes, because the favicon's worst historical failure was silent: two
// pages shipped a copy with seven of them deleted, which renders as a single
// small rectangle, and nothing caught it because no page draws its own favicon.
const shapes = (iconSvg.match(/<(rect|path)\b/g) || []).length;
check(shapes === 8, `icon.svg: the mark is whole (${shapes} of 8 shapes)`);

// The one icon that deliberately does NOT follow the transparent decision. iOS
// composites a transparent touch icon onto black, which would turn the green
// mark into a black square with a green scribble on it, so this one keeps an
// opaque ground. It is the home-screen icon only and is not what Google shows.
check(fs.statSync(path.join(root, 'apple-touch-icon.png')).size > 0,
      'apple-touch-icon.png: present (opaque on purpose — iOS has no transparency)');

// ── IndexNow ───────────────────────────────────────────────────────────────
// IndexNow only verifies ownership if the key file is reachable at
// /<key>.txt and contains that same key. The file was committed as
// YOUR_NEW_KEY.txt, a placeholder name, so verification could never succeed.
const keyFiles = fs.readdirSync(root).filter((f) => /^[a-f0-9]{8,128}\.txt$/.test(f));
check(keyFiles.length === 1, `IndexNow: exactly one key file at the site root (found ${keyFiles.length})`);
for (const kf of keyFiles) {
  check(read(kf).trim() === path.basename(kf, '.txt'), `IndexNow: ${kf} contains its own key`);
}
check(!fs.existsSync(path.join(root, 'YOUR_NEW_KEY.txt')), 'IndexNow: no placeholder key filename');

// ── deploy config ──────────────────────────────────────────────────────────
const vercel = JSON.parse(read('vercel.json'));
check((vercel.redirects || []).some((r) => r.source === '/index.html' && r.destination === '/' && r.permanent === true),
  'vercel.json: /index.html redirects permanently to /');
// A build command here has broken every production deploy before. There is
// nothing to build, and SEO fixes are worthless if they never ship.
check(vercel.buildCommand === '' && vercel.installCommand === '',
  'vercel.json: build and install commands stay empty');

// ── the not-found page ─────────────────────────────────────────────────────
// Vercel serves 404.html from the output root for any path that matches no
// file and no rewrite. Nothing in this repo names the file, so nothing else
// would notice it being renamed or deleted: the site would silently go back to
// the hosting platform's black error page and look broken rather than missing.
check(fs.existsSync(path.join(root, '404.html')), '404.html: exists at the site root');

if (fs.existsSync(path.join(root, '404.html'))) {
  const nf = read('404.html');

  // A catch-all rewrite is the other way to answer a missing page, and it is
  // the wrong one: a rewrite serves the body under a 200, so every mistyped
  // URL becomes an indexable duplicate of the not-found page instead of a
  // 404. The file-based 404 keeps the status. Guard the rewrite from being
  // added later by somebody who cannot see why it is absent.
  const catchAll = (vercel.rewrites || []).filter((r) => /^\/[:*(]|\(\.\*\)|\/:path\*/.test(r.source || ''));
  check(catchAll.length === 0,
    `vercel.json: no catch-all rewrite, which would turn every 404 into a soft 200${catchAll.length ? ' — ' + JSON.stringify(catchAll) : ''}`);

  // The "did you mean" list inside the page is hand-written, because a static
  // site has no build step to generate it. That is fine as long as it cannot
  // drift: every page it names has to exist, and every page a visitor could
  // plausibly be aiming at has to be named. The second half is the one that
  // rots — a ninth learning path would be a page the resolver never offers.
  const listed = [...nf.matchAll(/\['([a-z0-9.-]+\.html)',/g)].map((m) => m[1]);
  check(listed.length > 0, `404.html: the resolver's page list parses (found ${listed.length})`);
  const ghosts = listed.filter((f) => !fs.existsSync(path.join(root, f)));
  check(ghosts.length === 0, `404.html: every page it can suggest exists${ghosts.length ? ' — ' + ghosts.join(', ') : ''}`);
  const uncovered = indexable.filter((f) => !listed.includes(f));
  check(uncovered.length === 0,
    `404.html: suggests every indexable page${uncovered.length ? ' — missing ' + uncovered.join(', ') : ''}`);

  // Relative hrefs are correct on every other page here and wrong on this one:
  // it is served AT the address that was asked for, so href="login.html" under
  // /a/b/c resolves to /a/b/login.html. A page for recovering from a bad URL
  // must not hand out more of them.
  const relative = [...nf.matchAll(/href="(?!https?:|mailto:|data:|\/|#)([^"]+)"/g)].map((m) => m[1]);
  check(relative.length === 0,
    `404.html: every link is root-relative${relative.length ? ' — ' + relative.join(', ') : ''}`);
}

// ── extensionless addresses ────────────────────────────────────────────────
// URLs here carry .html, so /privacy is not a page — it is a typo the site
// makes easy to commit. Each root page redirects its bare name to its file, so
// the address works and the .html form stays the single canonical one. The
// other direction — cleanUrls, which also 308s /privacy.html to /privacy —
// would point all 12 canonicals, 11 sitemap entries and 217 internal links at
// redirecting URLs, so it is not a config flag but a rewrite of the whole URL
// surface, and it is not what was chosen.
//
// The list is generated from the files rather than curated, because a curated
// one goes stale exactly the way the hardcoded page list in this file's own
// history did. Three pages are out, and each for a different reason worth
// stating, since "why is this one missing" is the question a reader will have:
//   index.html  is served at / and already redirects the other way
//   draft.html  is a rewrite, not a redirect — /draft serves the page itself
//   404.html    must never answer 200 at any address. A /404 that served it
//               would be a soft 404, which is the thing that page's own
//               comment exists to warn about.
{
  const SKIP = { 'index.html': 'served at /', 'draft.html': 'a rewrite, not a redirect',
                 '404.html': 'must never answer 200' };
  const want = new Map(allPages.filter((f) => !SKIP[f])
    .map((f) => ['/' + f.replace(/\.html$/, ''), '/' + f]));

  // The eight learning paths also answer to a nickname, and the nickname is
  // not chosen here: every landing page links signup.html?path=<name>, and that
  // is the product's own word for the track. Deriving it from the page is what
  // keeps /frontend and the signup form from ever meaning different things —
  // and it is why these eight are defensible where eight invented ones would
  // not have been. A page naming two paths, or none, is a defect in the page.
  for (const f of allPages.filter((f) => f.endsWith('-study-partner.html'))) {
    const names = [...new Set([...read(f).matchAll(/signup\.html\?path=([a-z]+)/g)].map((m) => m[1]))];
    check(names.length === 1, `${f}: names exactly one learning path${names.length === 1 ? ` (${names[0]})` : ` — found ${names.length}: ${names.join(', ')}`}`);
    if (names.length === 1) want.set('/' + names[0], '/' + f);
  }

  const got = new Map((vercel.redirects || []).map((r) => [r.source, r]));

  const missing = [...want].filter(([src]) => !got.has(src)).map(([src]) => src);
  check(missing.length === 0,
    `vercel.json: every page has an extensionless address, and every path its nickname${missing.length ? ' — missing ' + missing.join(', ') : ` (${want.size})`}`);

  const wrong = [...want].filter(([src, dest]) => got.has(src) &&
    (got.get(src).destination !== dest || got.get(src).permanent !== true))
    .map(([src, dest]) => `${src} should be a permanent redirect to ${dest}`);
  check(wrong.length === 0, `vercel.json: each one is permanent and points at its own file${wrong.length ? ' — ' + wrong.join('; ') : ''}`);

  // An extra redirect is not harmless: it either shadows a real file or sends
  // somebody to one that is not there.
  const extra = [...got.keys()].filter((src) => !want.has(src) && src !== '/index.html');
  check(extra.length === 0, `vercel.json: no redirect that no page asked for${extra.length ? ' — ' + extra.join(', ') : ''}`);

  for (const [f, why] of Object.entries(SKIP)) {
    const src = '/' + f.replace(/\.html$/, '');
    check(!got.has(src), `vercel.json: no redirect for ${src} — ${why}`);
  }
  // The one that would be silent if it broke: /draft has to stay a rewrite, so
  // the preview page keeps its own address instead of bouncing to draft.html.
  check((vercel.rewrites || []).some((r) => r.source === '/draft' && r.destination === '/draft.html'),
    'vercel.json: /draft is still a rewrite');
}

// ── the build marker ───────────────────────────────────────────────────────
// PF_BUILD answers "is it deployed?" from the browser console, and CLAUDE.md
// leans on it: ask for the build before believing a bug report about behaviour
// you have already fixed. That only works while the number goes up.
//
// It went down once. A branch carried
//   -window.PF_BUILD = '2026-08-26d'
//   +window.PF_BUILD = '2026-08-26c'
// because the bump was written blind — a substitution over whatever was there
// rather than a read of the current value and a step past it — and landing it
// wrote an older marker back over a newer one. The fix that branch was shipping
// was live and correct; only the number was wrong, which is worse than it
// sounds, because the number is the thing you check instead of arguing.
//
// Two sessions work this repository at a time and assets/db.js is the one file
// both are guaranteed to touch, so this is not a rare shape of mistake. It sits
// in this file, beside the vercel.json checks, for the reason those are here:
// a fix nobody can tell has shipped is most of the way to a fix that has not.
{
  const build = read('assets/db.js').match(/window\.PF_BUILD\s*=\s*'([^']*)'/);
  check(!!build, 'assets/db.js: declares PF_BUILD');

  // A marker that does not parse cannot be ordered, and a near miss like
  // 2026-8-26e sorts before 2026-08-25a rather than after it.
  const parse = (v) => {
    const m = /^(\d{4}-\d{2}-\d{2})([a-z]+)$/.exec(v || '');
    return m && { date: m[1], rev: m[2], raw: v };
  };
  const here = build && parse(build[1]);
  check(!!here, `assets/db.js: PF_BUILD is YYYY-MM-DD plus a letter (got ${build ? build[1] : 'nothing'})`);

  // Dates are ISO so they sort as strings; the suffix is compared by length
  // first so that a two-letter revision lands after 'z' rather than between
  // 'a' and 'b'.
  const cmp = (a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : a.rev.length !== b.rev.length ? a.rev.length - b.rev.length
        : a.rev < b.rev ? -1 : a.rev > b.rev ? 1 : 0;

  // origin/main is the baseline. A clone that has never fetched it has nothing
  // to compare against, and a check that fails for that reason teaches people
  // to ignore the suite — which is the failure this file's own header is about
  // — so it says why it did not run and moves on.
  let base = null, changed = null;
  try {
    const at = (rev, f) => execFileSync('git', ['show', `${rev}:${f}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    base = parse((at('origin/main', 'assets/db.js').match(/window\.PF_BUILD\s*=\s*'([^']*)'/) || [])[1]);
    changed = execFileSync('git', ['diff', '--name-only', 'origin/main', '--', 'assets/'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').filter(Boolean);
  } catch (e) {
    console.log('SKIP  PF_BUILD ordering — no origin/main to compare against (git fetch origin main)');
  }

  if (here && base) {
    const order = cmp(here, base);
    // Equal is fine only while assets/ is untouched. The moment a byte in there
    // differs from main, the marker has to move: a stale marker over changed
    // assets is the same lie as a marker that went backwards, told quietly.
    if (changed.length) {
      check(order > 0,
        `PF_BUILD moves past main's ${base.raw}, which ${changed.length} changed file(s) under assets/ require`
        + (order > 0 ? ` (now ${here.raw})` : ` — it is ${here.raw}; bump it past ${base.raw} (changed: ${changed.join(', ')})`));
    } else {
      check(order >= 0, `PF_BUILD ${here.raw} is not behind main's ${base.raw}`);
    }
  }
}

// ── CSS custom properties ──────────────────────────────────────────────────
// A var() naming a property nobody declared does not warn and does not fall
// back — the whole declaration is dropped, so the rule silently does nothing.
// call.css asked for --p7 for as long as the room has existed. There is no
// --p7; the ramp is 0, 1, 2, 4, 6, 8. "Join the call" had no hover colour, and
// nobody noticed because the lift and the shadow come from app.css and those
// still fired: the button moved, it just never changed.
//
// This is not an SEO check. It is here because this is the one suite that runs
// over the whole repository, and a second file nobody remembers to run would
// have caught this exactly as often as no file at all.
//
// Resolution is per page, not per file, because that is how the cascade sees
// it: seo.css uses --live-deep and does not declare it, which is fine, because
// every page that links seo.css links home.css first and home.css does. Checking
// files in isolation reports that as broken, and a check that cries wolf is one
// people stop reading.
{
  // Comments come out first, and that is not a detail. The first draft of this
  // check scanned them, so the comment two files over explaining that "there is
  // no --p7:" declared --p7 by saying its name in front of a colon — the check
  // passed on the exact defect it was written for. A codebase whose comments
  // name custom properties this often cannot afford to read them as code.
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const declared = (css) => new Set([...strip(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  // var(--x, fallback) is not a bug even when --x is missing, so only count a
  // reference that closes straight after the name.
  const referenced = (css) => new Set(
    [...strip(css).matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].filter((m) => m[2] === ')').map((m) => m[1]));

  const orphans = [];
  for (const f of allPages) {
    const html = read(f);
    // Local stylesheets only: a Google Fonts URL declares nothing we can read.
    const sheets = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
      .filter((t) => /rel="stylesheet"/.test(t) && !/href="https?:/.test(t))
      .map((t) => (t.match(/href="([^"]+)"/) || [])[1])
      .filter(Boolean);
    // Plus whatever the page declares itself, and anything a style attribute
    // reaches for — index.html carried its headline colour that way for a while.
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const attrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]).join(';');

    let css = inline + '\n' + attrs;
    let missingSheet = null;
    for (const href of sheets) {
      const at = path.join(root, href.replace(/^\//, ''));
      if (!fs.existsSync(at)) { missingSheet = href; break; }
      css += '\n' + fs.readFileSync(at, 'utf8');
    }
    if (missingSheet) { fail(`${f}: links a stylesheet that is not in the repo — ${missingSheet}`); continue; }

    const have = declared(css);
    const want = [...referenced(css)].filter((v) => !have.has(v));
    if (want.length) orphans.push(`${f}: ${want.join(', ')}`);
  }
  check(orphans.length === 0,
    `every var() resolves on the page that uses it${orphans.length ? ' — ' + orphans.join('; ') : ''}`);
}

if (failures) {
  console.error(`\n${failures} SEO check(s) failed.`);
  process.exit(1);
}
console.log('\nAll SEO checks passed.');
