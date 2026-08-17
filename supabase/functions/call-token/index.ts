/* PeerFlow — the door to a session's room.
 *
 * The browser asks "let me into session <id>" and gets back either a signed
 * LiveKit token or a reason it cannot have one. It does not say which room
 * it wants: the room comes out of the database, from the booking, so a
 * person cannot type their way into somebody else's call.
 *
 * This function decides nothing. Every rule about who may join lives in
 * session_for_call() in supabase/migration-video.sql, next to the rest of
 * the rules about a session, and this runs as the caller — the user's own
 * JWT is forwarded to Postgres, so auth.uid() is them. It never holds the
 * service role key, which means a bug here cannot become a way of reading
 * somebody else's calendar.
 *
 * Deploy:  supabase functions deploy call-token
 * Secrets: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { accessToken } from "../_shared/livekit.ts";

/* Auth is the JWT, not the origin, so there is nothing for a strict origin
   list to protect here — and getting it wrong is a site that silently cannot
   start a call. Set PF_ALLOWED_ORIGIN if you want it narrowed anyway. */
const ORIGIN = Deno.env.get("PF_ALLOWED_ORIGIN") ?? "*";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* Postgres answers with a word; this is where a word becomes an HTTP status.
   The page writes its own sentences — see call.js — because the sentence
   depends on things only the page knows, like how long until the room
   opens. */
const STATUS: Record<string, number> = {
  "signed-out": 401,
  "unknown": 404,
  "proposed": 409,
  "declined": 409,
  "cancelled": 409,
  "too-early": 403,
  "too-late": 403,
  "no-room": 409,
  "not-partners": 403,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ reason: "method" }, 405);

  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const url = Deno.env.get("LIVEKIT_URL");
  if (!apiKey || !apiSecret || !url) {
    console.error("call-token: LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL not set");
    /* The person in front of this has done nothing wrong and can do nothing
       about it, so it is our failure and it says so. */
    return json({ reason: "not-configured" }, 503);
  }

  let sessionId: string | undefined;
  try {
    sessionId = (await req.json())?.session;
  } catch {
    return json({ reason: "bad-request" }, 400);
  }
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return json({ reason: "bad-request" }, 400);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("session_for_call", { p_session: sessionId });
  if (error) {
    console.error("call-token: session_for_call failed", error);
    return json({ reason: "server" }, 500);
  }

  /* A set-returning function comes back as an array of one. */
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ reason: "unknown" }, 404);
  if (!row.ok) {
    return json({ reason: row.reason, startsAt: row.starts_at ?? null }, STATUS[row.reason] ?? 403);
  }

  /* The token dies when the room does. LiveKit disconnects a participant
     whose token has expired, so this is also the answer to "how long can
     somebody sit in a room they were let into" — not indefinitely, and not
     at some fixed hour after they arrived, but when this particular booking
     is over. A floor of fifteen minutes keeps a call joined right at the end
     of the window from expiring while it is being set up. */
  const endsAt = new Date(row.ends_at).getTime();
  const ttl = Math.max(15 * 60, Math.floor((endsAt - Date.now()) / 1000));

  const token = await accessToken({
    apiKey,
    apiSecret,
    identity: row.identity,
    name: row.display,
    ttlSeconds: ttl,
    grant: {
      room: row.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  return json({
    token,
    url,
    room: row.room,
    identity: row.identity,
    display: row.display,
    /* Everything the page puts on screen, from the same read that authorised
       the join — so the room, the name above the far tile and the goal in
       the corner cannot disagree with each other. */
    partner: row.partner,
    topic: row.topic,
    goal: row.goal,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });
});
