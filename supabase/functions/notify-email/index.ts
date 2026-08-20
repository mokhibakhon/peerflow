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

/* One transactional email, laid out the way transactional email has to be
   laid out rather than the way a web page is.
 *
 * This was a bare <div> with a few inline styles. It rendered, and it looked
 * like something a script had sent — which for the only message PeerFlow ever
 * puts in somebody's inbox is the wrong first impression, particularly when
 * the message is "a stranger has proposed spending an hour with you".
 *
 * Four things it now does that the <div> did not:
 *
 *   Tables, not divs. Outlook on Windows renders through Word, which has no
 *   flexbox and unreliable div widths, so the frame is nested tables with
 *   presentation roles — the one place in this codebase where that is the
 *   correct answer rather than a museum piece.
 *
 *   A preheader. The hidden line right after <body> is what Gmail and Apple
 *   Mail show next to the subject in the list. Left out, they helpfully show
 *   whatever text comes first instead, which is the logo's alt text.
 *
 *   The logo as a hosted PNG. Inline SVG is stripped by Gmail and Outlook,
 *   and base64 data URIs are stripped by Gmail, so a hosted file is the only
 *   thing that actually arrives. It has alt text and sits on a green band
 *   that is set with both bgcolor and CSS, so a client that blocks images
 *   still shows a branded header with the word PeerFlow in it.
 *
 *   Fixed colours on every element. Gmail and Outlook dark mode invert what
 *   they are not told, so the card states #ffffff and the ink states #171A2E
 *   rather than inheriting.
 */
function body(opts: {
  title: string;
  note: string | null;
  href: string | null;
  firstName: string | null;
}) {
  const { title, note, href, firstName } = opts;
  const link = SITE + "/" + (href ?? "app.html").replace(/^\/+/, "");
  const settings = SITE + "/app-settings.html";

  /* No "Hi there" when the name is missing. A greeting addressed to nobody
     reads worse than no greeting at all, and half the profiles written before
     the name split have nothing in first_name. */
  const hello = firstName ? "Hi " + firstName + "," : "";

  const text = [
    /* Both null rather than "" when there is no name, or the plain-text part
       opens with a blank line where the greeting would have been. */
    hello || null,
    hello ? "" : null,
    title,
    note ?? null,
    "",
    "Open PeerFlow: " + link,
    "",
    "—",
    "You are receiving this because a session on PeerFlow needs an answer",
    "from you. It is the only kind of email we send.",
    "",
    "Manage email:   " + settings,
    "Privacy policy: " + SITE + "/privacy.html",
    "Terms:          " + SITE + "/terms.html",
  ].filter((l) => l !== null).join("\n");

  /* Gmail truncates the preview at roughly 100 characters and pads the rest
     with the zero-width joiners below, which stops the footer being dragged
     into the inbox list behind a short line. */
  const preheader = esc((note ?? title).slice(0, 140)) +
    "&#847;&zwnj;&nbsp;".repeat(60);

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F2F6;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#F3F2F6">
 <tr><td align="center" style="padding:32px 12px">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E4E3EB;border-radius:14px;overflow:hidden">

   <tr><td bgcolor="#12352C" style="background:#12352C;padding:20px 28px">
     <img src="${esc(SITE)}/assets/email-logo.png" width="158" height="42" alt="PeerFlow"
          style="display:block;border:0;width:158px;height:42px">
   </td></tr>

   <tr><td style="padding:30px 28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
     ${hello ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#4A4E68">${esc(hello)}</p>` : ""}
     <h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;font-weight:700;color:#171A2E">${esc(title)}</h1>
     ${note ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#4A4E68">${esc(note)}</p>` : ""}

     <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="#16865F" style="border-radius:10px">
        <a href="${esc(link)}"
           style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;
                  color:#FFFFFF;text-decoration:none;border-radius:10px;
                  background-image:linear-gradient(180deg,#1D9E75,#0F6E56)">Open PeerFlow</a>
      </td></tr>
     </table>

     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:26px 0 0">
        <div style="height:1px;background:#E4E3EB;line-height:1px;font-size:0">&nbsp;</div>
      </td></tr>
     </table>

     <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#82869C">
       You are receiving this because a session on PeerFlow needs an answer from you.
       It is the only kind of email we send.
       <a href="${esc(settings)}" style="color:#0F6E56;text-decoration:underline">Manage email in Settings</a>.
     </p>
   </td></tr>
  </table>

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;max-width:600px">
   <tr><td style="padding:18px 28px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.6;color:#82869C">
     PeerFlow &middot; <a href="${esc(SITE)}" style="color:#82869C;text-decoration:none">peerflow.dev</a><br>
     <a href="${esc(SITE)}/privacy.html" style="color:#82869C">Privacy</a> &middot;
     <a href="${esc(SITE)}/terms.html" style="color:#82869C">Terms</a> &middot;
     <a href="${esc(SITE)}/conduct.html" style="color:#82869C">Code of conduct</a>
   </td></tr>
  </table>

 </td></tr>
</table>
</body></html>`;

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

  /* first_name comes along for the greeting. It is one column on a row we
     were already fetching, so the personalisation costs nothing — and an
     email that opens with somebody's name is the cheapest signal there is
     that a person set this up rather than a script. */
  const { data: profile } = await db
    .from("profiles").select("email_notify, first_name, name").eq("id", note.user_id).maybeSingle();

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

  /* Profiles written before the name was split have everything in `name`, so
     fall back to its first word rather than losing the greeting on the older
     half of the accounts. */
  const firstName =
    (profile?.first_name || "").trim() ||
    (profile?.name || "").trim().split(/\s+/)[0] ||
    null;

  const mail = body({
    title: note.title, note: note.body, href: note.href, firstName,
  });

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to, subject: note.title, text: mail.text, html: mail.html,
      /* Gmail and Apple Mail put their own Unsubscribe control next to the
         sender when this is present, and its absence on a repeating send is
         one of the things spam filters weigh. Deliberately without
         List-Unsubscribe-Post: one-click promises a POST that unsubscribes
         with no further interaction, and app-settings.html is a static page
         that would take the POST and do nothing. Claiming a control that does
         not work is worse than not claiming it. */
      headers: {
        "List-Unsubscribe":
          "<mailto:hello@peerflow.dev?subject=unsubscribe>, <" + SITE + "/app-settings.html>",
      },
    }),
  });

  if (!sent.ok) {
    console.error("notify-email: Resend refused", sent.status, await sent.text());
    await unclaim();
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
