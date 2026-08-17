/* PeerFlow — the room reporting back.
 *
 * This is the piece that makes attendance a fact rather than a question.
 * LiveKit POSTs here when somebody joins a room, when they leave, and when
 * the room ends; those three events fill sessions.attended, joined_at and
 * left_at, and nobody is ever asked whether they turned up.
 *
 * It is the one function that holds the service role key, because it writes
 * on behalf of two people neither of whom is making the request. It is also
 * the one function reachable without a Supabase JWT — LiveKit has none —
 * which is why nothing in the body is believed until verifyWebhook() has
 * checked LiveKit's signature over the exact bytes received.
 *
 * Deploy:  supabase functions deploy livekit-webhook --no-verify-jwt
 * Secrets: LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 * Then point LiveKit's webhook URL at it (see docs/VIDEO.md).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyWebhook } from "../_shared/livekit.ts";

/* LiveKit sends seconds; Postgres wants a timestamp. Absent or zero means
   "it did not say", which must stay null rather than becoming 1970. */
function at(seconds: unknown): string | null {
  const n = Number(seconds);
  if (!n || !isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!apiKey || !apiSecret) {
    console.error("livekit-webhook: LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set");
    return new Response("not configured", { status: 503 });
  }

  /* Read the body as text once and verify that exact string. Parsing first
     and re-serialising would digest a different set of bytes, and the check
     would fail on any payload whose key order or spacing round-trips
     differently. */
  const raw = await req.text();
  const check = await verifyWebhook(req.headers.get("Authorization"), raw, apiKey, apiSecret);
  if (!check.ok) {
    console.warn("livekit-webhook: rejected —", check.why);
    /* Deliberately not 401: an unauthenticated caller learns nothing about
       why, and LiveKit itself will never see this branch. */
    return new Response("no", { status: 403 });
  }

  let evt: Record<string, any>;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("bad body", { status: 400 });
  }

  const room = evt?.room?.name as string | undefined;
  if (!room) return new Response("ok", { status: 200 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  /* The identity in the token was the user's id, so it is the user's id
     coming back. Anything else is a participant we did not admit, and the
     update simply matches no rows. */
  const identity = evt?.participant?.identity as string | undefined;

  try {
    if (evt.event === "participant_joined" && identity) {
      await db.rpc("record_presence", {
        p_room: room,
        p_user: identity,
        p_joined: at(evt.participant?.joinedAt) ?? new Date().toISOString(),
        p_left: null,
      });
    } else if (evt.event === "participant_left" && identity) {
      await db.rpc("record_presence", {
        p_room: room,
        p_user: identity,
        p_joined: at(evt.participant?.joinedAt),
        p_left: new Date().toISOString(),
      });
    } else if (evt.event === "room_finished") {
      /* Everybody who was going to arrive has arrived. A row still holding
         null attended is a no-show — observed rather than assumed, which is
         the whole difference between this and asking people. */
      await db.rpc("close_room", { p_room: room });
    }
  } catch (e) {
    console.error("livekit-webhook: write failed", e);
    /* 500 so LiveKit retries. Both writes are idempotent — record_presence
       keeps the earliest join and the latest leave, close_room only fills
       nulls — so a redelivery cannot corrupt anything. */
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
