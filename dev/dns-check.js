#!/usr/bin/env node
/* What the mail DNS for peerflow.dev is, against what it should be.
 *
 *     node dev/dns-check.js
 *
 * Every line it prints is a live lookup, not a copy of one. That is the whole
 * point: SETUP_GUIDE.md said "run these three migrations, that is all three"
 * for as long as it took six more to be merged, and a list of DNS records in
 * a markdown file would rot exactly the same way — silently, and in the one
 * direction nobody checks.
 *
 * It changes nothing. It cannot: DNS lives at Porkbun and this only reads.
 *
 * WHAT IT IS CHECKING, AND WHY EACH ONE MATTERS
 *
 * SPF is checked against the Return-Path, which for mail sent through Resend
 * on a verified subdomain is send.peerflow.dev — NOT the From header's
 * domain, and not the root. Getting that wrong is easy and the failure is
 * invisible: mail still arrives, because DMARC passes on DKIM alone.
 *
 * DKIM is the one that is already right. It is also the one carrying DMARC
 * single-handedly at the moment, which is fine until a forwarder rewrites a
 * body and breaks the signature — the case SPF exists to cover.
 *
 * DMARC at p=none asks nobody to do anything and reports to nobody. Both
 * halves are worth fixing, and in that order: rua first, read what comes
 * back, then enforce. Going to quarantine blind is how a domain quarantines
 * its own mail.
 *
 * BIMI is the sender avatar. It needs DMARC at enforcement before it does
 * anything at all, which is why it is last.
 */

const dns = require('dns').promises;

const ROOT = 'peerflow.dev';
const SEND = 'send.peerflow.dev';       /* Resend's verified subdomain, and
                                           therefore the Return-Path domain. */
const LOGO = 'https://www.peerflow.dev/assets/bimi-logo.svg';

let bad = 0;
const ok   = (s) => console.log('  \x1b[32mok\x1b[0m    ' + s);
const fail = (s, fix) => { bad++; console.log('  \x1b[31mMISSING\x1b[0m ' + s);
                           if (fix) console.log('        \x1b[2m' + fix + '\x1b[0m'); };
const note = (s) => console.log('        \x1b[2m' + s + '\x1b[0m');

async function txt(name){
  try { return (await dns.resolveTxt(name)).map(r => r.join('')); }
  catch (e) { return []; }
}
async function mx(name){
  try { return await dns.resolveMx(name); } catch (e) { return []; }
}

(async () => {
  console.log('\nReading live DNS. Nothing here is cached from the repository.\n');

  /* ---------- 1. SPF ---------- */
  console.log('1. SPF — who is allowed to send');
  const sendTxt = await txt(SEND);
  const sendSpf = sendTxt.find(t => /^v=spf1/i.test(t));
  if (sendSpf) {
    ok(SEND + '  ' + sendSpf);
    if (!/amazonses\.com/.test(sendSpf)) {
      note('but it does not include amazonses.com, which is what Resend sends through');
    }
  } else {
    fail(SEND + ' has no SPF record.',
         'TXT   host: send            value: v=spf1 include:amazonses.com ~all');
    note('This is the one that matters: SPF is checked against the Return-Path,');
    note('and Resend uses the verified subdomain for it, not the From domain.');
  }

  const rootSpf = (await txt(ROOT)).find(t => /^v=spf1/i.test(t));
  if (rootSpf) ok(ROOT + '  ' + rootSpf);
  else fail(ROOT + ' has no SPF record.',
            'TXT   host: (blank/@)     value: v=spf1 include:spf.improvmx.com ~all');

  /* ---------- 2. the bounce path ---------- */
  console.log('\n2. Bounces — where a rejection goes');
  const sendMx = await mx(SEND);
  if (sendMx.length) ok(SEND + '  ' + sendMx.map(r => r.exchange).join(', '));
  else {
    fail(SEND + ' has no MX record, so bounces are not reaching Resend.',
         'MX    host: send            value: from Resend, priority 10');
    note('Resend shows the exact hostname — it is feedback-smtp.<region>.amazonses.com');
    note('and the region is whichever one the domain was created in, so copy it');
    note('rather than guessing.');
  }

  /* ---------- 3. DKIM ---------- */
  console.log('\n3. DKIM — the signature');
  const dkim = await txt('resend._domainkey.' + SEND);
  if (dkim.length && /p=/.test(dkim[0])) ok('resend._domainkey.' + SEND + '  present (' + dkim[0].length + ' chars)');
  else fail('resend._domainkey.' + SEND + ' is missing — copy it from Resend.');

  /* ---------- 4. DMARC ---------- */
  console.log('\n4. DMARC — the policy, and the reports');
  const dmarc = (await txt('_dmarc.' + ROOT)).find(t => /^v=DMARC1/i.test(t));
  if (!dmarc) {
    fail('_dmarc.' + ROOT + ' has no DMARC record.',
         'TXT   host: _dmarc          value: v=DMARC1; p=none; rua=mailto:dmarc@peerflow.dev; fo=1;');
  } else {
    const policy = (dmarc.match(/\bp=(\w+)/) || [])[1];
    const rua = /rua=/.test(dmarc);
    console.log('        current: ' + dmarc);
    if (rua) ok('reports are going somewhere');
    else fail('no rua=, so nobody is being told what is failing.',
              'TXT   host: _dmarc          value: v=DMARC1; p=none; rua=mailto:dmarc@peerflow.dev; fo=1;');
    if (policy === 'quarantine' || policy === 'reject') ok('policy is at enforcement (p=' + policy + ')');
    else {
      fail('p=' + policy + ' asks nobody to do anything, and BIMI needs enforcement.',
           'TXT   host: _dmarc          value: v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@peerflow.dev; fo=1;');
      note('Do this one LAST of the four, and only after reading rua reports for a');
      note('week or two. Right now DMARC passes on DKIM alone — if anything is');
      note('quietly failing, enforcement is when it starts being quarantined.');
    }
  }

  /* ---------- 5. BIMI ---------- */
  console.log('\n5. BIMI — the sender avatar');
  const bimi = (await txt('default._bimi.' + SEND)).find(t => /^v=BIMI1/i.test(t));
  if (bimi) {
    ok('default._bimi.' + SEND + '  ' + bimi);
    if (!/\ba=/.test(bimi)) {
      note('No a= certificate. Yahoo and Fastmail will show the mark; GMAIL WILL NOT.');
      note('Gmail needs a VMC, which needs a registered trademark and about $1k a year.');
    }
  } else {
    fail('default._bimi.' + SEND + ' has no BIMI record.',
         'TXT   host: default._bimi.send   value: v=BIMI1; l=' + LOGO + ';');
    note('The l= URL is www, deliberately: peerflow.dev 308s to www, and not every');
    note('BIMI validator follows a redirect.');
    note('Pointless until DMARC is at enforcement — the record is read only then.');
  }

  console.log('\n' + '-'.repeat(66));
  console.log('At Porkbun, "host" is the part BEFORE the domain — send, _dmarc,');
  console.log('default._bimi.send — not the whole name. Leave it blank for the root.');
  console.log(bad ? '\n' + bad + ' record(s) to add.\n' : '\nAll present.\n');
  process.exit(0);
})();
