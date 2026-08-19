/* PeerFlow — a notification, out of the building.
 *
 * Posted to by a trigger on public.notifications (see
 * supabase/migration-notify.sql). The body is one id and nothing else: this
 * function will only ever email that notification's own recipient, at the
 * address on their account, once. There is no secret in the request because
 * there is nothing a forged one could achieve — the worst it can do is ask
 * for an email that has already been sent, and claiming the row makes that a
 * no-op.
 *
 * It holds the service role, because it reads an address belonging to
 * somebody who is not making the request. That is also why it does as little
 * as possible: claim, read, send.
 *
 * Deploy:  supabase functions deploy notify-email --no-verify-jwt
 * Secrets: RESEND_API_KEY, and optionally PF_MAIL_FROM and PF_SITE_URL
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const FROM = Deno.env.get("PF_MAIL_FROM") ?? "PeerFlow <hello@peerflow.dev>";
const SITE = (Deno.env.get("PF_SITE_URL") ?? "https://peerflow.dev").replace(/\/+$/, "");

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/* Plain, and short enough to read in a notification preview without opening
   it. The subject is the headline the app already wrote, so the mail and the
   bell never say two different things about the same event. */
function body(title: string, note: string | null, href: string | null) {
  const link = SITE + "/" + (href ?? "app.html").replace(/^\/+/, "");
  const text = [
    title,
    note ?? "",
    "",
    link,
    "",
    "—",
    "You are getting this because it needs an answer from you.",
    "Turn these off in Settings: " + SITE + "/app-settings.html",
  ].filter((l) => l !== null).join("\n");

  const html =
    `<div style="font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171A2E">` +
    `<p style="margin:0 0 10px;font-size:18px;font-weight:700">${esc(title)}</p>` +
    (note ? `<p style="margin:0 0 18px;color:#4A4E68">${esc(note)}</p>` : "") +
    `<p style="margin:0 0 26px"><a href="${esc(link)}" ` +
    `style="background:#137A5C;color:#fff;text-decoration:none;padding:10px 18px;` +
    `border-radius:10px;display:inline-block;font-weight:600">Open PeerFlow</a></p>` +
    `<p style="margin:0;font-size:13px;color:#82869C">You are getting this because it needs an ` +
    `answer from you. <a href="${esc(SITE)}/app-settings.html" style="color:#82869C">` +
    `Turn these off in Settings</a>.</p></div>`;

  return { text, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.error("notify-email: RESEND_API_KEY is not set");
    return new Response("not configured", { status: 503 });
  }

  let id: string | undefined;
  try {
    id = (await req.json())?.id;
  } catch {
    return new Response("bad body", { status: 400 });
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad id", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  /* Claim it before doing anything else. Two calls for the same notification
     — a retry, a replay, pg_net firing twice — and only the first finds a row
     with emailed_at still null. Nobody gets told the same thing twice. */
  const { data: note, error } = await db
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", id)
    .is("emailed_at", null)
    .select("id, user_id, title, body, href")
    .maybeSingle();

  if (error) {
    console.error("notify-email: could not claim", error);
    return new Response("retry", { status: 500 });
  }
  /* Already sent, or never existed. Both are "nothing to do" and neither is
     worth a retry. */
  if (!note) return new Response("ok", { status: 200 });

  async function unclaim() {
    /* Put it back so it can be sent again. Failing to send is not the same
       as having sent. */
    await db.from("notifications").update({ emailed_at: null }).eq("id", id!);
  }

  const { data: profile } = await db
    .from("profiles").select("email_notify").eq("id", note.user_id).maybeSingle();

  /* Default on: a profile row written before this column existed reads as
     null, and the person has not opted out of anything. */
  if (profile && profile.email_notify === false) {
    return new Response("ok", { status: 200 });
  }

  const { data: who, error: whoErr } = await db.auth.admin.getUserById(note.user_id);
  const to = who?.user?.email;
  if (whoErr || !to) {
    console.error("notify-email: no address for that user", whoErr);
    await unclaim();
    return new Response("retry", { status: 500 });
  }

  const mail = body(note.title, note.body, note.href);
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to, subject: note.title, text: mail.text, html: mail.html,
    }),
  });

  if (!sent.ok) {
    console.error("notify-email: Resend refused", sent.status, await sent.text());
    await unclaim();
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
