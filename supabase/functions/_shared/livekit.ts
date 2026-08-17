/* LiveKit's two pieces of cryptography, written out rather than imported.
 *
 * A LiveKit access token is an ordinary HS256 JWT whose payload carries a
 * `video` grant, and a LiveKit webhook is authenticated by a JWT in the
 * Authorization header whose `sha256` claim is the digest of the request
 * body. Both are about thirty lines of Web Crypto, which the Deno runtime
 * has built in.
 *
 * Doing it here rather than pulling in livekit-server-sdk keeps a cold start
 * to the function's own code and keeps the whole project's dependency list
 * where it has always been: Supabase, and nothing else.
 *
 * That is only a good trade while something proves the output is right, so
 * `node dev/livekit-tests.js` runs this file against Node's own crypto
 * module, which shares no code with it: same HMAC over the same signing
 * input, plus the refusals verifyWebhook has to make. A token signed wrongly
 * here would not fail here — it would fail as "could not join" on somebody's
 * call, a long way from the cause.
 *
 * This comment used to claim the output was checked byte-for-byte against
 * the official SDK. It was not: that suite lived in a scratchpad and went
 * with it, leaving the file asserting a guarantee nothing was providing.
 */

const enc = new TextEncoder();

/* JWT wants base64url with no padding; btoa gives base64 with it. */
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(enc.encode(JSON.stringify(value)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const body = b64urlJson({ alg: "HS256", typ: "JWT" }) + "." + b64urlJson(payload);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64url(new Uint8Array(sig));
}

export interface VideoGrant {
  room: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  /* Deliberately never set: a participant who can update another
     participant's metadata, or remove them, is a moderator, and a
     one-to-one study call has no moderator. */
}

/* The token that gets somebody into one room, under one name, until one
 * moment. Everything the server will let them do is decided here — the
 * browser is handed the result and cannot widen it, because widening it
 * would mean forging this signature. */
export async function accessToken(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  ttlSeconds: number;
  grant: VideoGrant;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await signJwt({
    exp: now + Math.max(60, Math.floor(opts.ttlSeconds)),
    iss: opts.apiKey,
    nbf: now,
    sub: opts.identity,
    /* LiveKit reads `jti` as the identity too on older servers, and it costs
       nothing to agree with both. */
    jti: opts.identity,
    ...(opts.name ? { name: opts.name } : {}),
    video: opts.grant,
  }, opts.apiSecret);
}

/* ---------- the other direction: is this really LiveKit? ---------- */

async function sha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(body));
  /* LiveKit sends the digest as standard base64, padding included — not
     base64url. Comparing against a base64url encoding of the same bytes
     fails on any digest containing a + or a /, which is most of them. */
  let s = "";
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s);
}

/* A webhook is a POST from the open internet, so nothing in it is believed
 * until this passes: the Authorization header is a JWT signed with our own
 * API secret, and its `sha256` claim has to be the digest of the exact body
 * we just read. The signature proves who sent it; the digest proves the body
 * was not swapped out afterwards. */
export async function verifyWebhook(
  authHeader: string | null,
  rawBody: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!authHeader) return { ok: false, why: "no Authorization header" };

  const parts = authHeader.replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return { ok: false, why: "not a JWT" };

  const signed = enc.encode(parts[0] + "." + parts[1]);
  const sig = Uint8Array.from(
    atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  const valid = await crypto.subtle.verify("HMAC", await hmacKey(apiSecret), sig, signed);
  if (!valid) return { ok: false, why: "bad signature" };

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return { ok: false, why: "unreadable claims" };
  }

  if (claims.iss !== apiKey) return { ok: false, why: "wrong api key" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) {
    return { ok: false, why: "expired" };
  }

  /* Without this check the signature only proves that LiveKit sent *some*
     webhook at some point, and a captured one could be replayed with a
     different body attached. */
  if (claims.sha256 !== await sha256(rawBody)) {
    return { ok: false, why: "body does not match digest" };
  }

  return { ok: true };
}
