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
 * Not: any id, cookie, localStorage entry, fingerprint, IP address (it cannot
 * see one) or user agent string. Nothing is kept in the browser — there is no
 * state here at all, so two views by the same person are two unrelated rows and
 * cannot be joined. That is a real limitation, it is the point, and
 * supabase/migration-visits.sql says the same at more length.
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
