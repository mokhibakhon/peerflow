(function(){
  /* The signed-in top bar: brand, the path you're on, the tabs, and a slot
     on the right that notify.js and usermenu.js mount into.

     Rendered from here rather than pasted into five pages, so the nav can
     only ever be wrong in one place. Must load before notify.js and
     usermenu.js, which both look for .nav-right. */

  /* The streak flame, drawn once and used in three places: the chip in this
     bar, the ring on Today, and anywhere else a streak is shown. Two paths —
     an outer flame and the bright core inside it — so it reads at 19px as
     well as at 44px. Exposed on window because Today draws its own. */
  /* The two paths are lifted from the Ten sessions badge rather than drawn
     again here — my own attempt read as a blob at 19px, and there is already
     a flame in this product that a designer shaped. Same 24-grid, same two
     parts: the body, and the brighter tongue inside it. */
  /* Today draws this twice — once in the bar, once on the ring — and a
     gradient id has to be unique in a document or the second copy paints
     with the first one's definition. Identical today, so nothing looks
     wrong; the moment the two want different colours, or the first is
     removed from the DOM, the other loses its fill. Numbered per call. */
  var flameId = 0;
  window.pfFlame = function(size, cls){
    var n = ++flameId, a = 'pf-fl' + n, b = 'pf-fc' + n;
    return '<svg class="flame' + (cls ? ' ' + cls : '') + '" width="' + size +
      '" height="' + size + '" viewBox="0 0 24 24" ' +
      'aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="' + a + '" x1=".25" y1="0" x2=".75" y2="1">' +
        '<stop offset="0" stop-color="#7BDC48"/>' +
        '<stop offset=".55" stop-color="#31B45C"/>' +
        '<stop offset="1" stop-color="#0E8A4E"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + b + '" x1=".5" y1="0" x2=".5" y2="1">' +
        '<stop offset="0" stop-color="#EAFFC4"/>' +
        '<stop offset="1" stop-color="#A6E75A"/>' +
      '</linearGradient></defs>' +
      '<path class="fl-o" fill="url(#' + a + ')" ' +
        'd="M12 2.2s7 5.2 7 12.2a7 7 0 1 1-14 0C5 7.4 12 2.2 12 2.2z"/>' +
      '<path class="fl-c" fill="url(#' + b + ')" ' +
        'd="M12 12.8s-3 2.6-3 5.6a3 3 0 1 0 6 0c0-2.6-3-3.2-3-5.6z"/>' +
      '</svg>';
  };

  var LOGO = '<svg width="24" height="24" viewBox="0 0 173 171" fill="#0b8f66" aria-hidden="true">' +
    '<rect x="79" y="0" width="13" height="15"/><rect x="0" y="81" width="15" height="13"/>' +
    '<rect x="158" y="81" width="14" height="13"/><rect x="79" y="156" width="13" height="15"/>' +
    '<path d="M52 24H116V39H99V56H83V70H67V39H52Z"/><path d="M24 57H39V74H56V89H70V106H39V121H24Z"/>' +
    '<path d="M134 53H149V118H134V101H117V85H103V69H134Z"/><path d="M119 147H55V132H72V115H88V101H104V132H119Z"/></svg>';

  /* Stroke colour is overridden to white by .tabs a.on in app.css. */
  var ICON = {
    sessions: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<rect x="3" y="4" width="14" height="13" rx="2" stroke="#585C74" stroke-width="1.6"/>' +
      '<path d="M3 8h14M7 2v3M13 2v3" stroke="#585C74" stroke-width="1.6" stroke-linecap="round"/></svg>',
    partner: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<circle cx="7" cy="7" r="3" stroke="#585C74" stroke-width="1.6"/>' +
      '<circle cx="14" cy="12" r="2.6" stroke="#585C74" stroke-width="1.6"/>' +
      '<path d="M2 17c0-2.5 2.2-4 5-4" stroke="#585C74" stroke-width="1.6" stroke-linecap="round"/></svg>',
    people: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<circle cx="10" cy="6.5" r="3" stroke="#585C74" stroke-width="1.6"/>' +
      '<path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="#585C74" stroke-width="1.6" stroke-linecap="round"/></svg>',
    progress: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M4 15V9M10 15V5M16 15v-4" stroke="#585C74" stroke-width="1.6" stroke-linecap="round"/></svg>',
    chat: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M17 12a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" ' +
      'stroke="#585C74" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };

  /* People only earns a permanent slot while you are still looking for
     someone. Once you have a partner it is a directory you never open again,
     and a tab nobody presses makes the three they do press harder to hit — it
     stays one click away on the Partner page. The reverse matters more: with
     nobody to study with, finding a person is the whole job.

     "Sessions" became "Today" in the same pass. The page was named after the
     card that used to dominate it, which left the app with a Sessions tab
     holding a Sessions card next to a Partner tab holding a partner. */
  var HOME    = { href:'app.html',          label:'Today',    icon:'sessions' };
  var PARTNER = { href:'app-sessions.html', label:'Partner',  icon:'partner'  };
  var CHAT    = { href:'app-chat.html',     label:'Chat',     icon:'chat'     };
  var PEOPLE  = { href:'app-people.html',   label:'People',   icon:'people'   };
  var PATH    = { href:'app-progress.html', label:'Progress', icon:'progress' };

  var here = (location.pathname.split('/').pop() || 'app.html').toLowerCase();

  /* Unknown draws the fuller bar: showing People to somebody who has a
     partner is untidy, hiding it from somebody who hasn't is a dead end.

     And the page you are standing on always gets a tab, whatever the rule
     says — dropping People while you are reading People would leave the bar
     with nothing marked current, which looks like the nav has lost you. */
  function tabsFor(paired){
    if (paired !== '1' || here === PEOPLE.href) return [HOME, PARTNER, CHAT, PEOPLE, PATH];
    return [HOME, PARTNER, CHAT, PATH];
  }
  function tabsHtml(paired){
    return tabsFor(paired).map(function(t){
      return '<a href="' + t.href + '"' + (t.href === here ? ' class="on" aria-current="page"' : '') + '>' +
             ICON[t.icon] + t.label +
             (t.icon === 'chat' ? '<span class="tabdot" id="pf-chatdot" hidden></span>' : '') +
             '</a>';
    }).join('');
  }

  /* Unread messages, as a count on the Chat tab. Exposed so the chat page can
     clear it the moment you read a thread, rather than leaving a badge up for
     eight seconds over messages you are looking at. */
  window.pfChatBadge = function(){
    if (!window.pf || !pf.unreadMessages) return;
    pf.unreadMessages().then(function(n){
      var dot = document.getElementById('pf-chatdot');
      if (!dot) return;
      dot.textContent = n > 9 ? '9+' : String(n);
      dot.hidden = !n;
    }).catch(function(){});
  };

  /* Drawn from the cache first. A bar that reorders itself half a second
     after paint reads as a glitch, so the common case never sees it move. */
  var paired = null;
  try { paired = localStorage.getItem('pf_paired'); } catch (e) {}

  var bar = document.createElement('header');
  bar.className = 'topbar';
  bar.innerHTML =
    '<div class="tb">' +
      '<a class="brand" href="app.html" aria-label="PeerFlow">' + LOGO + 'peerflow</a>' +
      '<span class="pathchip" id="pf-pathchip" hidden></span>' +
      '<nav class="tabs" aria-label="App" id="pf-tabs">' + tabsHtml(paired) + '</nav>' +
      '<a class="firechip" id="pf-fire" href="app-progress.html" hidden></a>' +
      '<div class="nav-right"></div>' +
    '</div>';
  document.body.insertBefore(bar, document.body.firstChild);

  /* Then reconciled against the truth, once. acceptedPartners() is already on
     its way for app.html and app-sessions.html; on the other pages this is one
     extra query, which is the price of a nav bar that is never wrong. */
  if (window.pf && pf.acceptedPartners) {
    pf.acceptedPartners().then(function(list){
      var now = (list && list.length) ? '1' : '0';
      try { localStorage.setItem('pf_paired', now); } catch (e) {}
      if (now === paired) return;
      paired = now;
      var nav = document.getElementById('pf-tabs');
      if (nav) nav.innerHTML = tabsHtml(now);
      pfChatBadge();   /* the redraw threw the old badge away */
    }).catch(function(){});
  }
  pfChatBadge();

  /* The streak, in the bar, on every page.
     The ring on Today explains it; this only has to remind you it exists while
     you are somewhere else. It stays hidden at zero: a dark flame reading "0"
     on a new account is a reproach for something you have not had a chance to
     do yet. Painted from the cache first for the same reason as the tabs, then
     reconciled — a number that appears late reads as a jump. */
  var fire = document.getElementById('pf-fire');
  function paintFire(n, safe, risk){
    if (!fire) return;
    if (!(n > 0)) { fire.hidden = true; return; }
    /* A drawn flame rather than 🔥. The emoji is a different picture on every
       platform — Apple's is orange and glossy, Google's is red, Windows' has
       a blue base — so the one part of the bar that is meant to be ours was
       whatever the reader's font vendor decided. This one is the same shape
       as the flame on the Ten sessions badge, in the same green. */
    fire.innerHTML = window.pfFlame(19) + '<b>' + n + '</b>';
    /* Same three states as the ring, so the bar and the dashboard never
       disagree about whether the week is in trouble. */
    fire.className = 'firechip' + (safe ? ' safe' : '') + (risk ? ' risk' : '');
    fire.setAttribute('aria-label',
      (n === 1 ? '1 week streak' : n + ' weeks streak') +
      (safe ? ', this week is done' : risk ? ', this week is not booked yet' : ''));
    fire.title = safe ? 'This week is done'
               : risk ? 'Nothing booked yet — this week ends soon'
                      : 'Book a session to keep this week';
    fire.hidden = false;
  }
  function atRisk(m){ return !!(m.streak && !m.metThisWeek && m.daysLeft <= 3); }
  try {
    var cached = JSON.parse(localStorage.getItem('pf_streak') || 'null');
    if (cached) paintFire(cached.n, cached.safe, cached.risk);
  } catch (e) {}
  if (window.pf && pf.momentum) {
    pf.momentum().then(function(m){
      if (!m) return;
      var risk = atRisk(m);
      try {
        localStorage.setItem('pf_streak',
          JSON.stringify({ n: m.streak, safe: m.metThisWeek, risk: risk }));
      } catch (e) {}
      paintFire(m.streak, m.metThisWeek, risk);
    }).catch(function(){});
  }

  /* The path chip only appears once we actually know the path — an empty
     chip would read as a loading bug. */
  var chip = document.getElementById('pf-pathchip');
  var track = '';
  try { track = localStorage.getItem('pf_track') || ''; } catch (e) {}
  function paintChip(id){
    var names = (window.pf && pf.trackNames) || {};
    if (!id || !names[id]) return;
    chip.textContent = names[id];
    chip.hidden = false;
  }
  /* Paint from the cache first so the chip doesn't pop in, then always
     reconcile against the profile. Only checking when the cache was empty
     meant a changed path never reached the header. */
  paintChip(track);
  if (window.pf && pf.getProfile) {
    pf.getProfile().then(function(p){
      if (!p || !p.track_id || p.track_id === track) return;
      try { localStorage.setItem('pf_track', p.track_id); } catch (e) {}
      paintChip(p.track_id);
    });
  }
})();
