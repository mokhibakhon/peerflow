/* The two hand-written JWTs in supabase/functions/_shared/livekit.ts, checked.
 *
 *     node dev/livekit-tests.js
 *
 * That file writes out LiveKit's cryptography rather than importing
 * livekit-server-sdk, which is a good trade — it keeps the dependency list at
 * "Supabase, and nothing else" — but it only stays a good trade while
 * something proves the output is right. A token this file signs wrongly does
 * not fail here; it fails as "could not join" on somebody's call, which is a
 * long way from the cause.
 *
 * So the check is deliberately independent: the real .ts is transpiled and
 * run, and everything it produces is compared against Node's own crypto
 * module, which shares no code with it. Node 22 has the same Web Crypto API
 * Deno does, so the source runs unmodified once the types are stripped.
 *
 * There is no network here, so this cannot install livekit-server-sdk and
 * diff against the real thing. An HS256 JWT is a fully specified object
 * though, and Node computing the same HMAC over the same signing input is the
 * same evidence for the part that could plausibly be wrong.
 */
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const TS = path.join(__dirname, '..', 'supabase/functions/_shared/livekit.ts');
const ts = require('/opt/node22/lib/node_modules/typescript');

const js = ts.transpileModule(fs.readFileSync(TS, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

/* Deno has btoa/atob as globals and Node does not, so they are passed in
   rather than the file being changed to suit the test. */
const mod = { exports: {} };
new Function('exports', 'module', 'require', 'crypto', 'btoa', 'atob', 'TextEncoder', js)(
  mod.exports, mod, require, globalThis.crypto,
  (s) => Buffer.from(s, 'binary').toString('base64'),
  (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder
);
const { accessToken, verifyWebhook } = mod.exports;

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256';
const KEY = 'APIabcdef123456';

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  \x1b[32mPASS\x1b[0m ' + name); return; }
  fails++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '\n        ' + extra : ''));
}

/* What LiveKit would send us, built with Node only. */
function livekitToken(claims, secret = SECRET) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signing = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims);
  return signing + '.' +
    nodeCrypto.createHmac('sha256', secret).update(signing).digest('base64url');
}

(async () => {
  console.log('\n==> the token that gets somebody into a room');

  const tok = await accessToken({
    apiKey: KEY, apiSecret: SECRET, identity: 'user-1', name: 'Amir',
    ttlSeconds: 600,
    grant: { room: 'pf-abc', roomJoin: true, canPublish: true, canSubscribe: true }
  });
  const [h, p, s] = tok.split('.');

  ok('it is three dot-separated parts', tok.split('.').length === 3);
  /* base64url, not base64. A '+' or '/' in a signature is the classic way a
     hand-rolled JWT works on most inputs and fails on some of them. */
  ok('no padding, and no + or / anywhere', !/[=+/]/.test(tok), tok);
  ok('the signature is the HS256 HMAC Node computes over the same input',
    s === nodeCrypto.createHmac('sha256', SECRET).update(h + '.' + p)
      .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));

  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  ok('the header says HS256/JWT', header.alg === 'HS256' && header.typ === 'JWT');
  ok('iss is the API key, sub is the identity',
    claims.iss === KEY && claims.sub === 'user-1');
  ok('the grant names the room', claims.video && claims.video.room === 'pf-abc');
  ok('the token expires exactly ttl after it becomes valid',
    claims.exp - claims.nbf === 600, 'exp-nbf=' + (claims.exp - claims.nbf));

  /* The grant interface deliberately has no room-admin or metadata powers,
     because a one-to-one study call has no moderator. If somebody widens
     VideoGrant later, this is where it should be argued about. */
  ok('no moderator powers are granted',
    !('roomAdmin' in claims.video) && !('roomCreate' in claims.video) &&
    !('canUpdateOwnMetadata' in claims.video), JSON.stringify(claims.video));

  const short = JSON.parse(Buffer.from(
    (await accessToken({ apiKey: KEY, apiSecret: SECRET, identity: 'u', ttlSeconds: 1,
      grant: { room: 'r', roomJoin: true } })).split('.')[1], 'base64url').toString());
  ok('a ttl below the floor is raised to 60s', short.exp - short.nbf === 60);

  console.log('\n==> deciding whether a webhook really came from LiveKit');

  const body = JSON.stringify({ event: 'participant_joined', room: { name: 'pf-abc' } });
  const digest = nodeCrypto.createHash('sha256').update(body).digest('base64');
  const now = Math.floor(Date.now() / 1000);
  const good = livekitToken({ iss: KEY, exp: now + 300, sha256: digest });

  ok('a genuine webhook is accepted', (await verifyWebhook(good, body, KEY, SECRET)).ok === true,
    JSON.stringify(await verifyWebhook(good, body, KEY, SECRET)));
  ok('an Authorization: Bearer prefix is tolerated',
    (await verifyWebhook('Bearer ' + good, body, KEY, SECRET)).ok === true);

  /* The digest claim is the whole reason the body cannot be swapped after the
     fact. Without it a captured webhook could be replayed with any payload. */
  ok('the same token with a different body is refused',
    (await verifyWebhook(good,
      JSON.stringify({ event: 'participant_left', room: { name: 'pf-abc' } }),
      KEY, SECRET)).ok === false);
  ok('a token signed with the wrong secret is refused',
    (await verifyWebhook(livekitToken({ iss: KEY, exp: now + 300, sha256: digest }, 'nope'),
      body, KEY, SECRET)).ok === false);
  ok('a token issued by another API key is refused',
    (await verifyWebhook(livekitToken({ iss: 'OTHER', exp: now + 300, sha256: digest }),
      body, KEY, SECRET)).ok === false);
  ok('an expired token is refused',
    (await verifyWebhook(livekitToken({ iss: KEY, exp: now - 10, sha256: digest }),
      body, KEY, SECRET)).ok === false);
  ok('a missing header is refused',
    (await verifyWebhook(null, body, KEY, SECRET)).ok === false);
  ok('something that is not a JWT is refused',
    (await verifyWebhook('garbage', body, KEY, SECRET)).ok === false);

  /* LiveKit sends the body digest as standard base64 with padding, not
     base64url. The comment in livekit.ts says comparing it against a
     base64url encoding fails on any digest containing a + or a /; this finds
     such a digest and proves the code is on the right side of that. */
  let tricky = null;
  for (let i = 0; i < 5000 && !tricky; i++) {
    const b = JSON.stringify({ n: i });
    const d = nodeCrypto.createHash('sha256').update(b).digest('base64');
    if (d.includes('+') || d.includes('/')) tricky = { b, d };
  }
  ok('found a digest containing + or / to test the encoding with', !!tricky);
  if (tricky) {
    ok('a digest containing + or / still verifies',
      (await verifyWebhook(livekitToken({ iss: KEY, exp: now + 300, sha256: tricky.d }),
        tricky.b, KEY, SECRET)).ok === true, 'digest was ' + tricky.d);
  }

  console.log('\n===================================================');
  console.log(fails ? ('failed ' + fails) : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
