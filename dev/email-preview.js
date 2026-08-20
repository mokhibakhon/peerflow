#!/usr/bin/env node
/* Renders what the notification email actually looks like, without sending one.
 *
 *     node dev/email-preview.js            # writes dev/email-preview.html
 *     node dev/email-preview.js --shot     # …and screenshots it with Chromium
 *
 * The point is that it renders the real template. It does not keep a copy of
 * the markup to eyeball — it lifts the top of
 * supabase/functions/notify-email/index.ts, everything from the first const
 * down to the Deno.serve call, and runs that. A preview built from a copy is
 * a preview of the copy, and the copy is what rots.
 *
 * Node strips the TypeScript annotations itself (--experimental-strip-types,
 * on by default from 22.18), so the only thing standing in for Deno is the
 * three-line env shim below.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'supabase', 'functions', 'notify-email', 'index.ts');
const work = path.join(root, 'dev', '.email-preview.mts');
const out = path.join(root, 'dev', 'email-preview.html');

const file = fs.readFileSync(src, 'utf8');
const from = file.indexOf('const FROM');
const to = file.indexOf('Deno.serve(');
if (from < 0 || to < 0 || to < from) {
  console.error('could not find the template in ' + src + ' — has its shape changed?');
  process.exit(2);
}

/* The four notifications the triggers in migration-notify.sql actually raise,
   with the strings they actually build. Kept beside each other because the
   thing worth looking at is not one email but the set: the same frame has to
   hold a long topic line and a bare headline without either looking wrong. */
const CASES = [
  {
    label: 'A time proposed',
    title: 'Sarah Ahmed proposed a session time',
    note: 'Friday 22 Aug, 07:00 PM · React hooks and useEffect. Nothing is booked until you accept.',
    href: 'app.html',
    firstName: 'Munisa',
  },
  {
    label: 'Accepted',
    title: 'Sarah Ahmed said yes',
    note: 'Friday 22 Aug, 07:00 PM. It is now on both your calendars.',
    href: 'app.html',
    firstName: 'Munisa',
  },
  {
    label: 'Declined',
    title: 'Sarah Ahmed declined that time',
    note: 'Friday 22 Aug, 07:00 PM. Propose another time whenever you are ready.',
    href: 'app.html',
    firstName: 'Munisa',
  },
  {
    /* The older half of the accounts have nothing in first_name, and a long
       name has to survive the header without wrapping into the button. */
    label: 'Cancelled, and no first name on the profile',
    title: 'Abdurakhmonov Jasurbek cancelled your session',
    note: 'Friday 22 Aug, 07:00 PM. It has come off both calendars. Propose another time whenever you are ready.',
    href: 'app.html',
    firstName: null,
  },
];

const shim = `
const Deno = { env: { get: (k: string) => (k === 'PF_SITE_URL' ? 'https://peerflow.dev' : undefined) } };
`;

fs.writeFileSync(work, shim + file.slice(from, to) + `
const CASES = ${JSON.stringify(CASES)};
const out = CASES.map((c: any) => ({ label: c.label, ...body(c) }));
console.log(JSON.stringify(out));
`);

let rendered;
try {
  rendered = JSON.parse(
    execFileSync(process.execPath, ['--no-warnings', work], { encoding: 'utf8' }));
} finally {
  fs.unlinkSync(work);
}

/* The container cannot reach peerflow.dev — the agent proxy refuses it — so
   the header would preview as a broken image while being perfectly fine in a
   real inbox. Point the one asset at the working copy on disk. Only the
   preview does this; the template keeps the absolute URL it has to send. */
function local(html) {
  return html.replace('https://peerflow.dev/assets/', 'file://' + root + '/assets/');
}

/* Each email inside its own iframe, because the templates are whole documents
   with their own <body> background — dropping four of them into one page
   would let the last <body> rule win and hide the very thing being checked. */
const page = `<!doctype html><meta charset="utf-8"><title>PeerFlow email preview</title>
<style>
 body{margin:0;background:#22242E;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#C9CBD6}
 h2{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
    color:#8B8FA3;margin:28px 0 8px;padding:0 16px}
 iframe{display:block;width:100%;max-width:720px;height:560px;border:0;background:#F3F2F6;margin:0 auto}
 pre{max-width:720px;margin:10px auto 0;padding:14px 16px;background:#181A22;border-radius:8px;
     white-space:pre-wrap;font:12.5px/1.6 ui-monospace,Menlo,monospace;color:#9AA0B4}
</style>
${rendered.map((r, i) => `<h2>${r.label}</h2>
<iframe id="f${i}" srcdoc="${local(r.html).replace(/"/g, '&quot;')}"></iframe>
<pre>${r.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`).join('\n')}
`;

fs.writeFileSync(out, page);
console.log('wrote dev/email-preview.html (' + rendered.length + ' emails)');

/* The plain-text half is half the email and nothing renders it, so say the
   sizes out loud — a text part that has drifted empty is invisible otherwise. */
rendered.forEach((r) => {
  console.log('  ' + r.label.padEnd(40) + r.html.length + ' bytes html, ' +
              r.text.split('\n').length + ' lines text');
});
