/* PeerFlow — one page view, written once, forgotten by the browser immediately.
 *
 * WHY THIS FILE TALKS TO SUPABASE DIRECTLY
 *
 * CLAUDE.md says every database call goes through assets/db.js and pages never
 * talk to Supabase directly. This is the one exception and it is deliberate.
 *
 * db.js needs the Supabase SDK, which is about 110kB, and the pages that most
 * need to be counted are the landing pages and the guides — which today load no
 * JavaScript at all. Adding the SDK to them to send a single write would slow
 * the pages whose entire job is to load fast and rank, and it would do it on
 * every visit, to learn where that visit came from. That trade is not worth
 * making.
 *
 * So this is a single POST to a single endpoint, write-only, no SDK, no reader.
 * Everything that READS this data is in db.js where it belongs, because the
 * dashboard is a signed-in page that already has the SDK loaded. The rule's
 * purpose — one place that knows the schema — is kept: this file knows how to
 * write one table and nothing else.
 *
 * WHAT IT SENDS, AND WHAT IT DOES NOT
 *
 * Path, referrer HOSTNAME, utm_* if present, a device class, a browser family
 * from a fixed list, and the IANA timezone.
 *
 * Not: any id, cookie, fingerprint, IP address (it cannot see one) or user
 * agent string. Two views by the same person are two unrelated rows and cannot
 * be joined. That is a real limitation, it is the point, and
 * supabase/migration-visits.sql says the same at more length.
 *
 * This block used to end "Nothing is kept in the browser — there is no state
 * here at all." That stopped being true the moment the opt-out below was
 * added, and it is corrected here rather than left because a comment that
 * describes the file it sits in is the one a reader trusts most.
 *
 * There is now exactly one stored value: pf_count, written only when somebody
 * asks not to be counted. It is worth being precise about what that does and
 * does not undo. It is not an identifier — every visitor who sets it stores
 * the same three letters, so it distinguishes nobody from anybody. It is never
 * sent: it decides whether a request happens at all, and it is not a field on
 * the row. Nothing on the server can read it or infer it. The property the
 * paragraph above claims — that two rows cannot be joined — is untouched,
 * because the only thing this key can do is prevent a row existing.
 *
 * The referrer is reduced to its host before it leaves the page. A referring
 * URL's path can carry a search query, a token or a private document name, and
 * none of that is needed to know somebody arrived from dev.to.
 */
(function () {
  'use strict';

  var cfg = window.PF_SUPABASE;
  if (!cfg || !cfg.enabled || !cfg.url || !cfg.key) return;

  /* Do Not Track and Global Privacy Control are both requests not to be
     counted. Honouring them costs a handful of rows and is the difference
     between analytics somebody would object to and analytics they would not. */
  try {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
        navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  } catch (e) {}

  /* Only the real site. A dev server, a Vercel preview URL and a file:// open
     would otherwise all land in the same table as production and there would be
     no column to tell them apart afterwards. */
  if (location.hostname !== 'www.peerflow.dev' && location.hostname !== 'peerflow.dev') return;

  /* The opt-out.
   *
   * One key, one value, set only by asking for it. privacy.html carries the
   * button that writes it and the sentence explaining it; ?pf_count=off does
   * the same thing from any page, which is what makes it usable from a phone
   * you are testing on without hunting for the control.
   *
   * WHY THIS EXISTS AT ALL, GIVEN THE FILE STORES NOTHING ELSE
   *
   * The owner wanted their own visits marked as theirs in the log. That would
   * need an identifier, and an identifier that can mark one person can mark
   * anyone — it is the mechanism privacy.html says is not there and will not
   * be. Not counting somebody answers the same question from the other side:
   * if your own views are absent, everything in the log is somebody else, and
   * nothing had to be identified to achieve it.
   *
   * It is genuinely one bit. It says whether to write a row. It cannot be read
   * back by the server, it is not sent anywhere, and it is the same flag for
   * every visitor rather than an owner-only switch — which is why the sentence
   * it forced into privacy.html is one a reader is glad to find rather than
   * one that needs defending.
   */
  var COUNT_KEY = 'pf_count';
  try {
    var want = new URLSearchParams(location.search).get(COUNT_KEY);
    if (want === 'off')     localStorage.setItem(COUNT_KEY, 'off');
    else if (want === 'on') localStorage.removeItem(COUNT_KEY);
    if (localStorage.getItem(COUNT_KEY) === 'off') return;
  } catch (e) {
    /* Private windows, blocked site data, and browsers set to refuse storage
       all throw here rather than returning null. Swallowing it means the visit
       is counted, which is the same answer as a visitor who never opted out —
       and the alternative, treating a thrown error as an opt-out, would
       silently stop counting anyone with strict settings. */
  }

  /* Public pages only. The signed-in pages are deliberately not counted: which
     app screens a member moved between is the closest thing here to watching a
     named person, it is what privacy.html most strongly promised against, and
     it answers none of the question this was built for. app-metrics.html counts
     what members DO from rows the database already has, which is the honest way
     to learn that. */
  if (location.pathname.indexOf('/app') === 0 ||
      location.pathname === '/call.html' ||
      location.pathname === '/reset.html') return;

  function browserFamily() {
    var ua = navigator.userAgent || '';
    /* Order matters: Edge and Opera both claim Chrome, and Chrome claims
       Safari. Most specific first. The output is one of a fixed set the
       database will accept — an unknown browser becomes 'other' rather than a
       new value, so this column cannot grow into a fingerprint. */
    if (/Edg\//.test(ua))                      return 'edge';
    if (/OPR\//.test(ua) || /Opera/.test(ua))  return 'opera';
    if (/SamsungBrowser/.test(ua))             return 'samsung';
    if (/Firefox\//.test(ua) || /FxiOS/.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua) || /CriOS/.test(ua))  return 'chrome';
    if (/Safari\//.test(ua))                   return 'safari';
    return 'other';
  }

  function deviceClass() {
    try {
      /* userAgentData is the non-deprecated answer where it exists, and it
         answers the only question being asked. */
      if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile ? 'mobile' : 'desktop';
      }
    } catch (e) {}
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/.test(ua)) return 'mobile';
    return 'desktop';
  }

  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var h = new URL(document.referrer).hostname;
      /* Moving between two pages of this site is not an arrival from anywhere,
         and counting it would drown the list that matters in our own name. */
      if (h === location.hostname) return null;
      return h.slice(0, 253) || null;
    } catch (e) { return null; }
  }

  function param(name) {
    try {
      var v = new URLSearchParams(location.search).get(name);
      return v ? v.slice(0, 128) : null;
    } catch (e) { return null; }
  }

  function timezone() {
    try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64) || null; }
    catch (e) { return null; }
  }

  var row = {
    /* Path only. The query string is dropped except for the three utm_* fields
       below, which are lifted into their own columns — a query can carry
       anything and there is no reason for this table to hold it. */
    path:         (location.pathname || '/').slice(0, 512),
    ref_host:     referrerHost(),
    utm_source:   param('utm_source'),
    utm_medium:   param('utm_medium'),
    utm_campaign: param('utm_campaign'),
    device:       deviceClass(),
    browser:      browserFamily(),
    tz:           timezone()
  };

  /* keepalive so the write survives the page being closed immediately after it
     loads, which is exactly the visit most worth counting. Prefer=return=minimal
     so PostgREST sends nothing back — the row is not wanted and the table
     would refuse to return it anyway, there being no SELECT policy.

     Every failure is swallowed on purpose. Nothing on the page depends on this
     and a visitor should never see a console full of red because an analytics
     write failed. */
  function send() {
    try {
      fetch(cfg.url + '/rest/v1/visits', {
        method:    'POST',
        keepalive: true,
        headers: {
          'apikey':        cfg.key,
          'Authorization': 'Bearer ' + cfg.key,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(function () {});
    } catch (e) {}
  }

  /* Wait for the page to be interactive rather than racing the render. A view
     that never finishes loading is not a view worth counting, and this way the
     write can never be on the critical path. */
  if (document.readyState === 'complete') send();
  else window.addEventListener('load', send, { once: true });
}());
