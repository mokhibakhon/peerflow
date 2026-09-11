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

/* One transactional email, laid out the way a person writes one.
 *
 * WHY THIS STOPPED BEING A CARD
 *
 * Everything below the next paragraph is the note this file used to carry,
 * and all of it is still true about how mail clients render. What it got
 * wrong was the target: it built the most robust possible *marketing*
 * template for a message that is not marketing, and Gmail agreed — these
 * landed in Promotions, which is where a session request is least likely to
 * be seen.
 *
 * A first version of this fix stripped everything — logo, button, the lot —
 * on the theory that the template shape was the cause. That was wrong, and
 * the counter-example is one line long: Apple's "Billing Problem" mail has a
 * logo, a grey product card and a blue call-to-action button, and it lands in
 * Primary. Shape is a real signal and it is the WEAKEST of the three that
 * matter. In order:
 *
 *   Sender reputation, and this recipient's history with this sender. Gmail
 *   has learned across every inbox it has that Apple billing mail gets opened
 *   and acted on. peerflow.dev is a new domain with no history at all, which
 *   is why the remaining signals carry more weight here than they would for
 *   anybody established — not because the template was wrong.
 *
 *   List-Unsubscribe. See the note at the send call: it is the header bulk
 *   senders are obliged to set, Apple does not set it on a billing notice,
 *   and this function used to. That is the change that matters.
 *
 *   What the words are doing. "A session needs an answer from you" is account
 *   language, the same register as "update your payment information". There
 *   is no offer in it and nothing to buy.
 *
 * So the logo is back, and so is a button. What stays gone is the shape that
 * is specifically a NEWSLETTER rather than a branded transactional note: the
 * 600px card floating on a grey page, the dark masthead band, the gradient
 * fill, the three-link legal footer. Apple's own mail is the reference — logo
 * on white, the fact in plain sentences, one flat button, a short footer.
 *
 * What is deliberately KEPT from the old version, because none of it is a
 * campaign signal:
 *
 *   The preheader. Still the first thing Gmail shows next to the subject.
 *
 *   Fixed colours on every element, and color-scheme: light. Dark mode
 *   inverts what it is not told, and a half-inverted email looks broken.
 *
 *   Tables for the frame. There is much less frame now, but Outlook still
 *   renders through Word, and what remains is still a table.
 *
 *   The settings link, in the body. Removing the List-Unsubscribe HEADER is
 *   not the same as hiding the control: the header is what marks a send as
 *   bulk, the link is what lets somebody act. Keeping the second without the
 *   first is the honest combination for one-to-one mail.
 *
 * The original note follows, and still applies to what is left.
 *
 * ---
 *
   One transactional email, laid out the way transactional email has to be
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
<body style="margin:0;padding:0;background:#FFFFFF;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF">
 <tr><td style="padding:24px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#171A2E">

  <div style="max-width:560px">

   <!-- The logo, on white rather than on a dark band. A masthead — a strip of
        brand colour running the full width with artwork in it — is the part
        that reads as a newsletter; the logo itself is just who is writing.
        Apple puts theirs top-left on white above a plain greeting, and that
        is what this is.

        Hosted PNG because Gmail strips inline SVG and base64 data URIs, so a
        file on the site is the only thing that arrives. Alt text carries the
        name for anybody who blocks images, which is most of the point of a
        logo surviving at all.

        -light, not email-logo.png. The original was drawn for the dark green
        band it used to sit on: the mark in --p2, "peer" in white, "flow" in
        --p1. Put that on white and "peer" disappears completely and the rest
        is too pale to read — the first render of this change showed a mark
        and the word "flow" floating on its own. The light file is the same
        artwork with those three remapped to what the site itself uses on a
        light ground (--p4, --ink, --p6), so it is the same logo rather than a
        second version of it. Both files are kept: the dark one is still
        correct on a dark band, should anything ever want one. -->
   <img src="${esc(SITE)}/assets/email-logo-light.png" width="122" height="32" alt="PeerFlow"
        style="display:block;border:0;width:122px;height:32px;margin:0 0 24px">

   ${hello ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#171A2E">${esc(hello)}</p>` : ""}

   <!-- The fact, at body size rather than as a 21px heading. A headline over
        a single sentence is a thing a campaign has; this is somebody telling
        you what happened. -->
   <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#171A2E">${esc(title)}</p>
   ${note ? `<p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#171A2E">${esc(note)}</p>` : ""}

   <!-- A flat button. The colour is p6 rather than the old gradient: a
        gradient fill is decoration, and decoration is the half of a button
        that reads as advertising. The label names the destination, which
        "Open PeerFlow" did not. -->
   <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px">
    <tr><td bgcolor="#0F6E56" style="background:#0F6E56;border-radius:8px">
      <a href="${esc(link)}"
         style="display:inline-block;padding:11px 20px;font-size:15px;font-weight:600;
                color:#FFFFFF;text-decoration:none">Open it on PeerFlow</a>
    </td></tr>
   </table>

   <p style="margin:0;font-size:13.5px;line-height:1.6;color:#82869C">
     You are getting this because a session on PeerFlow needs an answer from you.
     It is the only kind of email we send.
     <a href="${esc(settings)}" style="color:#82869C;text-decoration:underline">Turn it off in Settings</a>.
   </p>
  </div>

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
      /* No List-Unsubscribe header, and that is the deliberate half of the
         Promotions fix rather than an oversight.

         The header used to be here on the reasoning below, which is sound for
         the Spam folder and backwards for the tab: List-Unsubscribe is the
         header bulk senders are obliged to set, so setting it is one of the
         clearest ways to tell Gmail a send is a campaign. On a one-to-one
         message about a session somebody asked for, it buys protection
         against a filter that was never the problem and pays for it in the
         only currency that matters here — whether the recipient sees it.

         The control itself is not gone. The body carries a link to Settings,
         where the preference actually lives and can actually be changed. What
         is dropped is the machine-readable claim that this is a mailing list,
         because it is not one.

         Put it back if PeerFlow ever sends something that IS bulk — a digest,
         an announcement, anything going to more than one person at a time.
         The old note, still true of that case:

           Gmail and Apple Mail put their own Unsubscribe control next to the
           sender when this is present, and its absence on a repeating send is
           one of the things spam filters weigh. Deliberately without
           List-Unsubscribe-Post: one-click promises a POST that unsubscribes
           with no further interaction, and app-settings.html is a static page
           that would take the POST and do nothing. Claiming a control that
           does not work is worse than not claiming it. */
    }),
  });

  if (!sent.ok) {
    console.error("notify-email: Resend refused", sent.status, await sent.text());
    await unclaim();
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
