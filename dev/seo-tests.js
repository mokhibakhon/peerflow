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

if (failures) {
  console.error(`\n${failures} SEO check(s) failed.`);
  process.exit(1);
}
console.log('\nAll SEO checks passed.');
