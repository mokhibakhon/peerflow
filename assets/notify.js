/* PeerFlow notifications.
   Injects the bell into the app header on every signed-in page, shows an
   unread count, and lets people answer partner requests from the panel.
   Everything here reads real rows — an empty panel means nothing has
   happened yet. */
(function(){
  var nav = document.querySelector('.nav-right');
  if (!nav || !window.pf) return;

  /* ---------- markup ---------- */
  var wrap = document.createElement('div');
  wrap.className = 'bell-wrap';
  wrap.innerHTML =
    '<button class="bell" id="pf-bell" aria-label="Notifications" aria-expanded="false">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M18 8.5a6 6 0 10-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>' +
        '<path d="M10.3 19a2 2 0 003.4 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="badge" id="pf-badge" hidden>0</span>' +
    '</button>' +
    '<div class="bell-panel" id="pf-panel" hidden>' +
      '<div class="bell-head">Notifications</div>' +
      '<div class="bell-list" id="pf-list">' +
        '<p class="bell-empty">Loading…</p>' +
      '</div>' +
    '</div>';
  nav.insertBefore(wrap, nav.firstChild);

  var bell  = document.getElementById('pf-bell');
  var badge = document.getElementById('pf-badge');
  var panel = document.getElementById('pf-panel');
  var list  = document.getElementById('pf-list');

  var state = { incoming: [], outgoing: [], proposals: [], loaded: false };

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function ago(d){
    var mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (isNaN(mins)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  /* Unread = requests waiting on you, answers you haven't seen yet, and any
     time your partner has proposed that you haven't answered. Sessions carry
     no seen-at column, so a proposal counts until it's accepted or declined —
     it's the one notification you can't afford to lose. */
  function unread(){
    var a = state.incoming.filter(function(x){ return x.status === 'pending' && !x.to_seen_at; });
    var b = state.outgoing.filter(function(x){ return x.status !== 'pending' && !x.from_seen_at; });
    return a.concat(b).concat(theirProposals());
  }

  /* Two kinds of session news: a time waiting on you to answer, and a time of
     yours that got turned down. Both need you to go and do something. */
  function theirProposals(){
    var now = Date.now();
    return state.proposals.filter(function(x){
      if (x.startsAt.getTime() <= now) return false;
      if (x.status === 'proposed') return !x.mine;
      if (x.status === 'declined')  return x.mine;
      return x.status === 'cancelled' && !x.cancelledByMe;
    });
  }

  function paintBadge(){
    var n = unread().length;
    if (n > 0) { badge.hidden = false; badge.textContent = n > 9 ? '9+' : String(n); bell.classList.add('has-unread'); }
    else { badge.hidden = true; bell.classList.remove('has-unread'); }
  }

  function itemIncoming(x){
    var who = esc(x.other && x.other.name || 'Someone');
    var topic = x.other && x.other.topic ? ' · learning ' + esc(x.other.topic) : '';
    if (x.status === 'pending') {
      return '<div class="bell-item' + (x.to_seen_at ? '' : ' fresh') + '">' +
        '<p><b>' + who + '</b> wants to learn with you' + topic + '</p>' +
        (x.message ? '<p class="bell-msg">“' + esc(x.message) + '”</p>' : '') +
        '<p class="bell-time">' + ago(x.created_at) + '</p>' +
        '<div class="bell-actions">' +
          '<button class="btn primary" data-accept="' + esc(x.id) + '">Accept</button>' +
          '<button class="btn ghost" data-decline="' + esc(x.id) + '">Decline</button>' +
        '</div></div>';
    }
    return '<div class="bell-item"><p>You ' + (x.status === 'accepted' ? 'accepted' : 'declined') +
      ' <b>' + who + '</b></p><p class="bell-time">' + ago(x.created_at) + '</p></div>';
  }

  function itemOutgoing(x){
    var who = esc(x.other && x.other.name || 'Someone');
    if (x.status === 'accepted') {
      return '<div class="bell-item' + (x.from_seen_at ? '' : ' fresh') + '">' +
        '<p><b>' + who + '</b> accepted your request</p>' +
        '<p class="bell-time">' + ago(x.created_at) + '</p>' +
        '<div class="bell-actions"><a class="btn primary" href="app-sessions.html">See my partner</a></div>' +
        '</div>';
    }
    if (x.status === 'declined') {
      return '<div class="bell-item' + (x.from_seen_at ? '' : ' fresh') + '">' +
        '<p><b>' + who + '</b> declined your request</p>' +
        '<p class="bell-time">' + ago(x.created_at) + '</p></div>';
    }
    return '<div class="bell-item"><p>Waiting for <b>' + who + '</b> to answer</p>' +
      '<p class="bell-time">sent ' + ago(x.created_at) + '</p></div>';
  }

  function whenLabel(d){
    return d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  }

  /* Answering happens on Sessions, next to the form for a counter-offer —
     the bell's job is only to tell you it's waiting. */
  function itemProposal(x){
    var who = esc(x.partnerName || 'Your partner');
    var turned = x.status === 'declined' || x.status === 'cancelled';
    var verb = x.status === 'cancelled' ? 'cancelled '
             : x.status === 'declined'  ? 'can’t do ' : 'proposed ';
    return '<div class="bell-item fresh">' +
      '<p><b>' + who + '</b> ' + verb + esc(whenLabel(x.startsAt)) + '</p>' +
      (x.note ? '<p class="bell-msg">“' + esc(x.note) + '”</p>' : '') +
      '<p class="bell-time">' + x.durationMin + ' minutes</p>' +
      /* Sessions, not Partner: answering moved with the rest of scheduling. */
      '<div class="bell-actions"><a class="btn primary" href="app.html">' +
        (turned ? 'Pick another time' : 'Answer it') + '</a></div>' +
      '</div>';
  }

  function paintList(){
    var items = theirProposals().map(itemProposal)
      .concat(state.incoming.map(itemIncoming))
      .concat(state.outgoing.map(itemOutgoing));
    list.innerHTML = items.length
      ? items.join('')
      : '<p class="bell-empty">Nothing yet. When someone asks to be your partner, it shows up here.</p>';
  }

  function load(){
    return Promise.all([pf.myRequests(), pf.fetchSessions()]).then(function(res){
      var r = res[0];
      state.proposals = res[1] || [];
      if (!r) { state.loaded = true; list.innerHTML = '<p class="bell-empty">Could not load notifications.</p>'; return; }
      state.incoming = r.incoming;
      state.outgoing = r.outgoing;
      state.loaded = true;
      paintBadge();
      paintList();
    });
  }

  /* ---------- interactions ---------- */
  bell.addEventListener('click', function(e){
    e.stopPropagation();
    var open = !panel.hidden;
    panel.hidden = open;
    bell.setAttribute('aria-expanded', String(!open));
    if (!open) {
      if (!state.loaded) load();
      /* Opening the panel counts as reading. */
      /* Proposals stay unread on purpose: they clear when you answer them,
         not when you glance at the panel. */
      var inc = state.incoming.filter(function(x){ return x.status === 'pending' && !x.to_seen_at; });
      var out = state.outgoing.filter(function(x){ return x.status !== 'pending' && !x.from_seen_at; });
      if (inc.length || out.length) {
        var ids = function(a){ return a.map(function(x){ return x.id; }); };
        pf.markRequestsSeen(ids(inc), ids(out)).then(function(){
          var now = new Date().toISOString();
          inc.forEach(function(x){ x.to_seen_at = now; });
          out.forEach(function(x){ x.from_seen_at = now; });
          paintBadge();
        });
      }
    }
  });

  document.addEventListener('click', function(e){
    if (!panel.hidden && !wrap.contains(e.target)) {
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
      bell.focus();
    }
  });

  list.addEventListener('click', function(e){
    var acc = e.target.closest('[data-accept]');
    var dec = e.target.closest('[data-decline]');
    var el = acc || dec;
    if (!el) return;
    var id = el.getAttribute(acc ? 'data-accept' : 'data-decline');
    var status = acc ? 'accepted' : 'declined';
    el.disabled = true;
    el.textContent = acc ? 'Accepting…' : 'Declining…';
    pf.respondToRequest(id, status).then(function(res){
      if (res && res.saved) {
        state.incoming.forEach(function(x){ if (x.id === id) { x.status = status; x.to_seen_at = new Date().toISOString(); } });
        paintBadge();
        paintList();
      } else {
        el.disabled = false;
        el.textContent = acc ? 'Accept' : 'Decline';
        alert((res && res.error) || 'Could not save that — please try again.');
      }
    });
  });

  /* Load once at start so the badge is right without opening the panel. */
  pf.currentUser().then(function(user){
    if (!user) { wrap.hidden = true; return; }
    state.me = user.id;
    load();
    /* Light refresh so a request that arrives while the tab is open shows up. */
    setInterval(function(){ if (panel.hidden) load(); }, 60000);
  });
})();
