/* PeerFlow notifications.
   Injects the bell into the app header on every signed-in page, shows an
   unread count, and lets people answer partner requests from the panel.
   Everything here reads real rows — an empty panel means nothing has
   happened yet.

   TWO SECTIONS, AND ONLY ONE OF THEM IS THE BADGE

   The panel used to be one list holding two unlike things: requests waiting
   on you, which cleared when you opened the panel, and a session proposal,
   which deliberately did not — it cleared when you answered it, being "the one
   notification you can't afford to lose". Both looked identical, so the count
   went down for reasons you could not see and stayed up for reasons you could
   not see either.

   They are separated now. NEEDS YOU is what is still true and still yours to
   act on, and it is the only thing the badge counts, so the number always
   means "things on your plate" and it only ever goes down because you did
   something. RECENT is what has happened, read when you open the panel,
   because that is exactly what reading it is.

   WHERE EACH HALF COMES FROM

   Needs-you is derived live from myRequests() and fetchSessions() — it has to
   be, because "still outstanding" is a fact about the session, not about a
   row that was written once when it was proposed.

   Recent is public.notifications, which until now nothing read at all. The
   triggers in migration-notify.sql have been writing session events into it
   and notifySelf() has been writing achievements, and the bell was built
   entirely from the two derived sources — so the table filled up and was
   never shown, and docs/EMAIL.md's "the bell works immediately after step
   one" was describing a bell that read somewhere else. */
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

  var state = { incoming: [], outgoing: [], proposals: [], notes: [], loaded: false };

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

  /* NEEDS YOU: what is still true and still yours to answer. A partner
     request nobody has replied to, and a session time waiting on you.
     Nothing here clears by being looked at — each one clears when the thing
     it is about is dealt with, which is the difference the two sections
     exist to make visible.

     Answers to your own requests are NOT here. "Amir accepted your request"
     needs nothing from you, so it belongs in the log below with everything
     else that has already happened. It used to be counted, which is part of
     why the number moved for reasons nobody could see. */
  function needsYou(){
    var pending = state.incoming.filter(function(x){ return x.status === 'pending'; });
    return theirProposals().concat(pending);
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

  /* RECENT: the log, from public.notifications.
   *
   * The session triggers write a row for the same events needsYou() derives
   * live, so a proposal you have not answered yet would otherwise appear
   * twice — once as something to do, once as something that happened. The
   * duplicate is suppressed by matching the name the trigger puts at the
   * front of the title against the partners who currently have something
   * outstanding above.
   *
   * That is a string match, and it is a string match because the row carries
   * no reference to the session it is about: raise_note() writes user, kind,
   * title, body and href, and href is a bare 'app.html'. Giving the trigger
   * the session id and putting it in the href is the proper fix and would
   * make this exact; it needs a migration, so it is deliberately not in this
   * change. The cost of the approximation is small and one-directional — an
   * older note about a partner who happens to have something outstanding now
   * can be hidden a while longer than it should be. Nothing is ever shown
   * that should not be. */
  function recent(){
    var busy = {};
    needsYou().forEach(function(x){
      var who = x.partnerName || (x.other && x.other.name);
      if (who) busy[who] = true;
    });
    /* An accepted request is now written to the notifications table as well
       — that is what makes it survive, and what gets it emailed — and it was
       already derived from partner_requests by itemOutgoing above. Shown from
       both sources it appears twice, saying the same thing under two
       different sentences.
       
       The derived row is the one that stays, because it is the one that knows
       whether anything has been booked since and can say the right thing.
       Matched on the same leading-name rule as the session notes above, and
       against the accepted requests rather than the busy list, since an
       accepted request needs nothing from you and never appears in it. */
    var answered = {};
    state.outgoing.forEach(function(x){
      var who = x.status === 'accepted' && x.other && x.other.name;
      if (who) answered[who] = true;
    });

    return state.notes.filter(function(n){
      if (n.kind === 'partner') {
        for (var name in answered) {
          if (Object.prototype.hasOwnProperty.call(answered, name) &&
              String(n.title).indexOf(name) === 0) return false;
        }
        return true;
      }
      if (n.kind !== 'session') return true;
      for (var who in busy) {
        if (Object.prototype.hasOwnProperty.call(busy, who) &&
            String(n.title).indexOf(who) === 0) return false;
      }
      return true;
    });
  }

  function paintBadge(){
    var n = needsYou().length;
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

  /* Whether anything has ever been arranged with this partnership. A session
     row carries the partner request's id as its pair, so the accepted request
     and the sessions that came out of it can be matched exactly rather than
     by name. Cancelled and declined rows are not arrangements. */
  function everBooked(requestId){
    return state.proposals.some(function(s){
      return s.pairId === requestId &&
             s.status !== 'cancelled' && s.status !== 'declined';
    });
  }

  function itemOutgoing(x){
    var who = esc(x.other && x.other.name || 'Someone');
    if (x.status === 'accepted') {
      /* The whole point of the row. "See my partner" went to a page listing
         who you are paired with, which somebody who has just been told they
         are paired with this person already knows — so the one moment they
         are most likely to act ended on a page with nothing to do on it.
         The link now opens the booking form with them in it.

         Only while there is nothing arranged yet. Once a time is on the
         table, telling somebody to plan their first session is telling them
         to do a thing they have done. */
      var fresh = x.other && x.other.id && !everBooked(x.id);
      return '<div class="bell-item' + (x.from_seen_at ? '' : ' fresh') + '">' +
        '<p><b>' + who + '</b> accepted your request</p>' +
        '<p class="bell-time">' + ago(x.created_at) + '</p>' +
        '<div class="bell-actions"><a class="btn primary" href="' +
          (fresh ? 'app.html?plan=' + encodeURIComponent(x.other.id) : 'app-sessions.html') +
          '">' + (fresh ? 'Plan your first session' : 'See my partner') + '</a></div>' +
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
    /* A moved session is not a new one, and calling it "proposed" loses the
       only thing about it that changes what you do: it is the Thursday you
       had already agreed, at a different hour. The note the database raises
       says so, but recent() suppresses that note while the proposal it is
       about is still outstanding — which is exactly now — so this row is the
       one that has to carry it. */
    var moved = x.status === 'proposed' && !!x.rescheduledFrom;
    var verb = x.status === 'cancelled' ? 'cancelled '
             : x.status === 'declined'  ? 'can’t do '
             : moved ? 'moved your session to ' : 'proposed ';
    return '<div class="bell-item fresh">' +
      '<p><b>' + who + '</b> ' + verb + esc(whenLabel(x.startsAt)) + '</p>' +
      (moved ? '<p class="bell-msg">Was ' + esc(whenLabel(x.rescheduledFrom)) + '</p>' : '') +
      (x.note ? '<p class="bell-msg">“' + esc(x.note) + '”</p>' : '') +
      '<p class="bell-time">' + x.durationMin + ' minutes</p>' +
      /* Sessions, not Partner: answering moved with the rest of scheduling. */
      '<div class="bell-actions"><a class="btn primary" href="app.html">' +
        (turned ? 'Pick another time' : 'Answer it') + '</a></div>' +
      '</div>';
  }

  /* A row of the log, from public.notifications. The title links wherever the
     row points and there is nothing else to press: it has already happened,
     and answering things is what the section above is for. (An accepted
     partner request, which comes from partner_requests rather than this
     table, still carries its "See my partner" link — that is a shortcut to a
     page, not an answer to give.) */
  function itemNote(n){
    var body = n.body ? '<p class="bell-msg">' + esc(n.body) + '</p>' : '';
    var head = '<p><b>' + esc(n.title) + '</b></p>';
    if (n.href) head = '<a class="bell-go" href="' + esc(n.href) + '">' + head + '</a>';
    return '<div class="bell-item' + (n.readAt ? '' : ' fresh') + '">' +
      head + body +
      '<p class="bell-time">' + ago(n.createdAt) + '</p></div>';
  }

  function paintList(){
    var todo = theirProposals().map(itemProposal)
      .concat(state.incoming.filter(function(x){ return x.status === 'pending'; }).map(itemIncoming));
    /* Answers to your own requests are history now, so they join the log —
       but they come from partner_requests rather than the notifications
       table, which does not know about them. Both feed Recent. */
    var log = state.outgoing.filter(function(x){ return x.status !== 'pending'; }).map(itemOutgoing)
      .concat(recent().map(itemNote));

    var html = '';
    if (todo.length) html += '<p class="bell-sec">Needs you</p>' + todo.join('');
    if (log.length)  html += '<p class="bell-sec">Recent</p>' + log.join('');
    list.innerHTML = html ||
      '<p class="bell-empty">Nothing yet. When someone asks to be your partner, it shows up here.</p>';
  }

  function load(){
    /* notifications() answers with an empty list rather than rejecting when
       the table is unreadable — migration-notify.sql is run by hand and may
       simply not have been — so the panel degrades to the derived half
       instead of failing whole. */
    var notes = pf.notifications ? pf.notifications() : Promise.resolve([]);
    return Promise.all([pf.myRequests(), pf.fetchSessions(), notes]).then(function(res){
      var r = res[0];
      state.proposals = res[1] || [];
      state.notes = res[2] || [];
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

      /* Opening the panel reads the log, and only the log. Nothing in
         Needs-you is touched, so the badge cannot move because you looked at
         it — it moves when you answer something. That is the whole point of
         the split, and it is why paintBadge is not called from here any more:
         there is nothing for it to say that has changed.

         The rows still stop being 'fresh' underneath, so a second visit shows
         you what is new since the first. paintList, not paintBadge. */
      var inc = state.incoming.filter(function(x){ return x.status === 'pending' && !x.to_seen_at; });
      var out = state.outgoing.filter(function(x){ return x.status !== 'pending' && !x.from_seen_at; });
      if (inc.length || out.length) {
        var ids = function(a){ return a.map(function(x){ return x.id; }); };
        pf.markRequestsSeen(ids(inc), ids(out)).then(function(){
          var now = new Date().toISOString();
          inc.forEach(function(x){ x.to_seen_at = now; });
          out.forEach(function(x){ x.from_seen_at = now; });
          paintList();
        });
      }

      var fresh = state.notes.filter(function(n){ return !n.readAt; });
      if (fresh.length && pf.markNotificationsRead) {
        pf.markNotificationsRead(fresh.map(function(n){ return n.id; })).then(function(){
          var now = new Date().toISOString();
          fresh.forEach(function(n){ n.readAt = now; });
          paintList();
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
    /* Both arms hand the button back. Without the second one a rejected
       promise — the network dropping mid-request, say — left the button
       disabled reading "Accepting…" with no way out but a reload. */
    function give(msg){
      el.disabled = false;
      el.textContent = acc ? 'Accept' : 'Decline';
      alert(msg);
    }
    pf.respondToRequest(id, status).then(function(res){
      if (res && res.saved) {
        state.incoming.forEach(function(x){ if (x.id === id) { x.status = status; x.to_seen_at = new Date().toISOString(); } });
        paintBadge();
        paintList();
        return;
      }
      give((res && res.error) || 'Could not save that — please try again.');
    }, function(){
      give('Could not save that — check your connection and try again.');
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
