#!/usr/bin/env node
/*
 * Regenerates sitemap.xml from the pages themselves.
 *
 * The sitemap used to be hand-maintained, and it drifted: privacy.html,
 * terms.html and conduct.html were indexable, linked from every page footer,
 * and absent from the sitemap for as long as they had existed. Deriving the
 * list from the files removes the step a human has to remember. A page is in
 * the sitemap when it is a root-level .html file that is not noindex and not
 * the homepage's redirect source; everything else is excluded by that rule
 * alone, so adding a landing page needs no edit here.
 *
 * lastmod comes from git rather than the filesystem, because a fresh clone
 * gives every file the checkout time and would claim the whole site changed
 * today. Run this after changing page content:  node dev/sitemap-build.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.peerflow.dev';

// Discovering pages by reading them keeps one source of truth: the robots meta
// tag on the page decides whether the page is listed.
const indexable = fs.readdirSync(root)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    return !/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  })
  .sort();

// The homepage is served at / and vercel.json permanently redirects
// /index.html there, so the sitemap must advertise the destination, never the
// source. Listing a URL that 301s is a self-inflicted crawl error.
const urlFor = (f) => (f === 'index.html' ? ORIGIN + '/' : `${ORIGIN}/${f}`);

const lastmodFor = (f) => {
  const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: root })
    .toString().trim();
  return out || new Date().toISOString().slice(0, 10);
};

// index.html first because it is the site root; the rest alphabetically, which
// is what readdir + sort already gave us.
const ordered = [...indexable].sort((a, b) =>
  (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

const body = ordered.map((f) =>
  `  <url>\n    <loc>${urlFor(f)}</loc>\n    <lastmod>${lastmodFor(f)}</lastmod>\n  </url>`
).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
  console.log(`sitemap.xml: ${ordered.length} URLs`);
  for (const f of ordered) console.log(`  ${urlFor(f)}`);
}

module.exports = { indexable, ordered, urlFor, ORIGIN };
