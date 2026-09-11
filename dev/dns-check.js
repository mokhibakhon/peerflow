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

const dnsMod = require('dns');
let dns = dnsMod.promises;

/* Ask the zone's own nameservers, not whatever recursive resolver this
   machine is pointed at.
 *
 * This is not tidiness. The first version used the default resolver and told
 * me peerflow.dev had no SPF record about ninety seconds after a direct query
 * had returned one — a cached negative from before the record was added. A
 * false MISSING is the worst answer this tool can give: you go and add a
 * record that is already there, and on _dmarc that produces two records,
 * which per RFC 7489 means no DMARC at all. The tool would have caused the
 * exact failure it is meant to catch.
 *
 * So the zone's NS records are resolved once, their addresses become the
 * resolver, and every lookup after that is authoritative. If anything about
 * that fails it says so and carries on with the default resolver rather than
 * dying — a degraded answer with a warning on it beats no answer.
 *
 * Every one of them, separately, because they do not always agree.
 *
 * A zone with four nameservers propagates between them over seconds to
 * minutes, and this script is most useful in exactly that window — right
 * after somebody edited a record and wants to know whether they got it
 * right. Two consecutive runs against "the" authoritative server returned
 * different answers about the same record, because each run happened to ask
 * a different one and the edit had reached some and not others.
 *
 * So all of them are asked and the answers are compared. A record that some
 * have and some do not is neither present nor missing: it is in flight, and
 * saying so is the only true answer. */
const servers = [];   /* { name, resolver } */
const inFlight = new Set();

async function useAuthoritative(zone){
  try {
    const ns = await dnsMod.promises.resolveNs(zone);
    for (const host of ns) {
      try {
        const addrs = await dnsMod.promises.resolve4(host);
        if (!addrs.length) continue;
        const r = new dnsMod.promises.Resolver();
        r.setServers(addrs);
        servers.push({ name: host, resolver: r });
      } catch (e) {}
    }
    if (!servers.length) throw new Error('no addresses for ' + ns.join(', '));
    return servers.map(s => s.name);
  } catch (e) {
    console.log('  \x1b[33mnote\x1b[0m  could not reach the authoritative servers (' +
                e.message + ').');
    console.log('        \x1b[2mFalling back to the system resolver, so a record added in the last\x1b[0m');
    console.log('        \x1b[2mfew minutes may still read as missing. Re-run before acting on one.\x1b[0m\n');
    return null;
  }
}

/* Asks every nameserver and returns the union. Any name they disagree about
   is remembered, and reported once at the end rather than inline — a "some
   servers have this" note against six separate records is noise; the fact
   that the zone is still settling is one fact. */
async function every(name, kind){
  const seen = [];
  for (const s of servers.length ? servers : [{ name: 'system', resolver: dnsMod.promises }]) {
    try {
      const r = kind === 'MX' ? await s.resolver.resolveMx(name)
                              : await s.resolver.resolveTxt(name);
      seen.push(kind === 'MX' ? r.map(x => x.exchange).sort().join(',')
                              : r.map(x => x.join('')).sort().join('|'));
    } catch (e) { seen.push(''); }
  }
  if (new Set(seen).size > 1) inFlight.add(name + ' [' + kind + ']');
  const best = seen.filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  if (!best) return [];
  return kind === 'MX' ? best.split(',').map(exchange => ({ exchange }))
                       : best.split('|');
}

const ROOT = 'peerflow.dev';
const SEND = 'send.peerflow.dev';       /* Resend's verified subdomain, and
                                           therefore the Return-Path domain. */
const LOGO = 'https://www.peerflow.dev/assets/bimi-logo.svg';

let bad = 0;
const ok   = (s) => console.log('  \x1b[32mok\x1b[0m    ' + s);
const fail = (s, fix) => { bad++; console.log('  \x1b[31mMISSING\x1b[0m ' + s);
                           if (fix) console.log('        \x1b[2m' + fix + '\x1b[0m'); };
const note = (s) => console.log('        \x1b[2m' + s + '\x1b[0m');

/* Not everything absent is wrong.
 *
 * Two of the five steps are supposed to be undone for a fortnight: DMARC
 * enforcement waits on reports, and BIMI is ignored by every client until
 * enforcement, so adding it early does nothing at all. This printed both as a
 * red MISSING, identical in weight to the duplicate DMARC record that had
 * genuinely broken the domain — and the first person to finish the setup
 * correctly read "2 record(s) to add" and asked what was wrong.
 *
 * Nothing was. The tool was describing a schedule as a fault. A separate word
 * for "correct, and not yet" is the whole fix, and it counts separately at
 * the foot so a clean run can say so out loud. */
let waiting = 0;
const later = (s, fix) => { waiting++; console.log('  \x1b[36mLATER\x1b[0m   ' + s);
                            if (fix) console.log('        \x1b[2m' + fix + '\x1b[0m'); };

async function txt(name){ return every(name, "TXT"); }
async function mx(name){ return every(name, "MX"); }

/* The doubled label.
 *
 * Every DNS editor asks for the name in one of two ways — the host part on
 * its own ("send"), or the whole name ("send.peerflow.dev") — and nothing on
 * the screen says which. Give the full name to a field that wanted the host
 * part and you get send.send.peerflow.dev: created without complaint, shown
 * in the record list looking almost right, and resolving nowhere anything
 * reads.
 *
 * It is checked for by name because the failure is otherwise indistinguishable
 * from never having added the record at all — the check above just says
 * MISSING, you look at the dashboard, and the record is plainly there. That
 * is a long loop to be stuck in, and this shortens it to one line. */
async function doubled(host, zone){
  const bad = host + '.' + host + '.' + zone;
  const [t, m] = [await txt(bad), await mx(bad)];
  if (!t.length && !m.length) return false;
  console.log('  \x1b[33mWRONG NAME\x1b[0m ' + bad);
  if (t.length) note('TXT  ' + t[0]);
  if (m.length) note('MX   ' + m.map(r => r.exchange).join(', '));
  note('The label is in there twice. Whatever was typed went into a field that');
  note('appends the zone itself, so "' + host + '.' + zone + '" became the above.');
  note('Edit these so the full name reads exactly ' + host + '.' + zone + '.');
  return true;
}

(async () => {
  console.log('\nReading live DNS. Nothing here is cached from the repository.\n');
  const ns = await useAuthoritative(ROOT);
  if (ns) console.log('  asking ' + ns[0] + ' and ' + (ns.length - 1) + ' other nameserver(s)\n');

  if (await doubled('send', ROOT)) { bad++; console.log(''); }

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
         'TXT   send.peerflow.dev     v=spf1 include:amazonses.com ~all');
    note('This is the one that matters: SPF is checked against the Return-Path,');
    note('and Resend uses the verified subdomain for it, not the From domain.');
  }

  const rootSpf = (await txt(ROOT)).find(t => /^v=spf1/i.test(t));
  if (rootSpf) ok(ROOT + '  ' + rootSpf);
  else fail(ROOT + ' has no SPF record.',
            'TXT   peerflow.dev          v=spf1 include:spf.improvmx.com ~all');

  /* ---------- 2. the bounce path ---------- */
  console.log('\n2. Bounces — where a rejection goes');
  const sendMx = await mx(SEND);
  if (sendMx.length) ok(SEND + '  ' + sendMx.map(r => r.exchange).join(', '));
  else {
    fail(SEND + ' has no MX record, so bounces are not reaching Resend.',
         'MX    send.peerflow.dev     the hostname Resend shows, priority 10');
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
  const dmarcAll = (await txt('_dmarc.' + ROOT)).filter(t => /^v=DMARC1/i.test(t));
  /* More than one is worse than none, and it does not look worse.
   *
   * RFC 7489 6.6.3: a resolver finding multiple DMARC records treats the
   * domain as having no policy at all. So editing a record by adding the new
   * version beside the old — which is what every DNS editor invites, because
   * "add record" is the big button and "edit" is a small pencil — silently
   * turns a working p=none into nothing, and the dashboard shows two rows
   * that both look correct.
   *
   * Checked before the contents of any of them, because while this is true
   * nothing else on this line matters. */
  if (dmarcAll.length > 1) {
    bad++;
    console.log('  \x1b[31mTWO RECORDS\x1b[0m _dmarc.' + ROOT + ' has ' + dmarcAll.length + ' DMARC records.');
    dmarcAll.forEach(t => note(t));
    note('A resolver that finds more than one treats the domain as having NO');
    note('DMARC at all — worse than the single p=none that was there before.');
    note('Delete all but one. Keep whichever has rua= on it.');
    note('');
    note('Nothing else about DMARC is checked while this is true, because');
    note('nothing else about it is in effect. Fix this, re-run, and the rest');
    note('of this section will have something real to say.');
  } else if (!dmarcAll.length) {
    fail('_dmarc.' + ROOT + ' has no DMARC record.',
         'TXT   _dmarc.peerflow.dev    v=DMARC1; p=none; rua=mailto:dmarc@peerflow.dev; fo=1;');
  } else {
    const dmarc = dmarcAll[0];
    const policy = (dmarc.match(/\bp=(\w+)/) || [])[1];
    const rua = /rua=/.test(dmarc);
    console.log('        current: ' + dmarc);
    if (rua) ok('reports are going somewhere');
    else fail('no rua=, so nobody is being told what is failing.',
              'TXT   _dmarc.peerflow.dev   v=DMARC1; p=none; rua=mailto:dmarc@peerflow.dev; fo=1;');
    if (policy === 'quarantine' || policy === 'reject') ok('policy is at enforcement (p=' + policy + ')');
    else {
      later('p=' + policy + ' asks nobody to do anything. Enforcement comes after the reports.',
            'TXT   _dmarc.peerflow.dev   v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@peerflow.dev; fo=1;');
      note('Not yet. Read a week or two of rua reports first: right now DMARC');
      note('passes on DKIM alone, so anything quietly failing is quietly');
      note('delivered, and enforcement is the moment that stops.');
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
    later('default._bimi.' + SEND + ' has no BIMI record. It follows enforcement.',
          'TXT   default._bimi.send.peerflow.dev   v=BIMI1; l=' + LOGO + ';');
    note('Adding this before DMARC is at enforcement does nothing whatsoever —');
    note('no client reads the record until then. So it is last, not forgotten.');
    note('The l= URL is www deliberately: peerflow.dev 308s to www, and not');
    note('every BIMI validator follows a redirect.');
  }

  console.log('\n' + '-'.repeat(66));
  /* Not "the host field wants X". Porkbun's classic view and the newer
     Cloudflare-backed one disagree about that, and guessing on the reader's
     behalf is what produced send.send.peerflow.dev. The instruction that
     survives both editors is about the result, not the input. */
  console.log('Names above are the FULL record name. Whatever your DNS editor');
  console.log('wants typed in, the saved record must read exactly that.');

  if (inFlight.size) {
    console.log('\n\x1b[33mThe nameservers do not all agree yet:\x1b[0m');
    [...inFlight].forEach(n => console.log('  ' + n));
    console.log('A zone still settling after an edit, not a fault. Anything above may');
    console.log('simply not have reached every server — re-run in a few minutes before');
    console.log('changing it.');
  }
  /* The two counts are reported separately, and the wording of the good case
     is the point of the whole change: somebody who has done everything
     correctly should be told so in as many words, not handed a number that
     reads like a bill. */
  console.log('');
  if (bad) console.log('\x1b[31m' + bad + ' thing(s) to fix.\x1b[0m');
  else     console.log('\x1b[32mNothing to fix — everything that should be set up is.\x1b[0m');
  if (waiting) {
    console.log('\x1b[36m' + waiting + ' step(s) waiting on time rather than on you.\x1b[0m ' +
                'Read the DMARC reports');
    console.log('arriving at dmarc@peerflow.dev for a week or two, then do them in the');
    console.log('order above. Nothing to do until then.');
  }
  console.log('');
  process.exit(0);
})();
