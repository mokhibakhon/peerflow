#!/usr/bin/env node
/* Lightweight SEO regression checks. No dependencies required. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const publicPages = [
  ['index.html', 'https://www.peerflow.dev/'],
  ['frontend-study-partner.html', 'https://www.peerflow.dev/frontend-study-partner.html'],
  ['backend-study-partner.html', 'https://www.peerflow.dev/backend-study-partner.html'],
  ['cybersecurity-study-partner.html', 'https://www.peerflow.dev/cybersecurity-study-partner.html'],
  ['data-science-study-partner.html', 'https://www.peerflow.dev/data-science-study-partner.html'],
  ['mobile-development-study-partner.html', 'https://www.peerflow.dev/mobile-development-study-partner.html'],
  ['devops-cloud-study-partner.html', 'https://www.peerflow.dev/devops-cloud-study-partner.html'],
  ['ai-machine-learning-study-partner.html', 'https://www.peerflow.dev/ai-machine-learning-study-partner.html'],
  ['ux-ui-design-study-partner.html', 'https://www.peerflow.dev/ux-ui-design-study-partner.html'],
];
const privatePages = [
  'app.html','app-badges.html','app-chat.html','app-people.html','app-person.html',
  'app-profile.html','app-progress.html','app-sessions.html','app-settings.html',
  'call.html','login.html','signup.html','reset.html','draft.html',
];
let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const has = (s, re) => re.test(s);

for (const [file, canonical] of publicPages) {
  const html = read(file);
  if (has(html, /<title>[^<]{10,70}<\/title>/i)) pass(`${file}: useful title`); else fail(`${file}: missing/weak title`);
  if (has(html, /<meta\s+name=["']description["']\s+content=["'][^"']{70,180}["']/i)) pass(`${file}: meta description`); else fail(`${file}: missing/weak description`);
  if (has(html, new RegExp(`<link\\s+rel=["']canonical["']\\s+href=["']${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i'))) pass(`${file}: canonical`); else fail(`${file}: canonical mismatch`);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count === 1) pass(`${file}: one H1`); else fail(`${file}: expected 1 H1, found ${h1Count}`);
  if (!has(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i)) pass(`${file}: indexable`); else fail(`${file}: unexpectedly noindex`);
  if (has(html, /property=["']og:title["']/i) && has(html, /name=["']twitter:card["']/i)) pass(`${file}: social metadata`); else fail(`${file}: missing social metadata`);
}

for (const file of privatePages) {
  const html = read(file);
  if (has(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i)) pass(`${file}: noindex`); else fail(`${file}: should be noindex`);
}

const robots = read('robots.txt');
if (/Sitemap:\s*https:\/\/peerflow\.dev\/sitemap\.xml/i.test(robots)) pass('robots.txt: sitemap declared'); else fail('robots.txt: sitemap missing');

const sitemap = read('sitemap.xml');
for (const [, canonical] of publicPages) {
  if (sitemap.includes(`<loc>${canonical}</loc>`)) pass(`sitemap.xml: ${canonical}`); else fail(`sitemap.xml: missing ${canonical}`);
}
for (const file of privatePages) {
  if (sitemap.includes(file)) fail(`sitemap.xml: private page included (${file})`);
}

const vercel = JSON.parse(read('vercel.json'));
const redirect = (vercel.redirects || []).find(r => r.source === '/index.html' && r.destination === '/' && r.permanent === true);
if (redirect) pass('vercel.json: /index.html canonical redirect'); else fail('vercel.json: missing /index.html redirect');

if (failures) {
  console.error(`\n${failures} SEO check(s) failed.`);
  process.exit(1);
}
console.log('\nAll SEO checks passed.');
