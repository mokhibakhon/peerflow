(function(){
  /* The signed-in top bar: brand, the path you're on, the tabs, the primary
     action, and a slot on the right that notify.js and usermenu.js mount into.

     Rendered from here rather than pasted into six pages, so the nav can only
     ever be wrong in one place. Must load before notify.js and usermenu.js,
     which both look for .nav-right.

     Two states, one difference: with a partner the second tab is Partner and
     the header carries a scheduling action; without one it is Find Partner and
     there is nothing to schedule yet. Both are never shown at once — offering
     "People" next to "Partner" is what made the old header read like a
     directory rather than a study app. */

  var LOGO = '<svg width="24" height="24" viewBox="0 0 173 171" fill="#0b8f66" aria-hidden="true">' +
    '<rect x="79" y="0" width="13" height="15"/><rect x="0" y="81" width="15" height="13"/>' +
    '<rect x="158" y="81" width="14" height="13"/><rect x="79" y="156" width="13" height="15"/>' +
    '<path d="M52 24H116V39H99V56H83V70H67V39H52Z"/><path d="M24 57H39V74H56V89H70V106H39V121H24Z"/>' +
    '<path d="M134 53H149V118H134V101H117V85H103V69H134Z"/><path d="M119 147H55V132H72V115H88V101H104V132H119Z"/></svg>';

  /* Stroke colour is overridden to white by .tabs a.on in app.css. */
  var S = 'stroke="#585C74" stroke-width="1.6"';
  var ICON = {
    home: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1z" ' + S +
      ' stroke-linejoin="round"/></svg>',
    partner: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<circle cx="7" cy="7" r="3" ' + S + '/><circle cx="14" cy="12" r="2.6" ' + S + '/>' +
      '<path d="M2 17c0-2.5 2.2-4 5-4" ' + S + ' stroke-linecap="round"/></svg>',
    find: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<circle cx="9" cy="9" r="5.2" ' + S + '/>' +
      '<path d="M13 13l4 4" ' + S + ' stroke-linecap="round"/></svg>',
    sessions: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<rect x="3" y="4" width="14" height="13" rx="2" ' + S + '/>' +
      '<path d="M3 8h14M7 2v3M13 2v3" ' + S + ' stroke-linecap="round"/></svg>',
    progress: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M4 15V9M10 15V5M16 15v-4" ' + S + ' stroke-linecap="round"/></svg>'
  };

  /* app-badges.html is kept as a redirect, so it maps onto Progress for the
     purpose of highlighting the current tab. */
  var ALIAS = { 'app-badges.html': 'app-progress.html', '': 'app.html' };
  var here = (location.pathname.split('/').pop() || 'app.html').toLowerCase();
  here = ALIAS[here] || here;

  function tabsFor(partnered){
    return [
      { href: 'app.html',          label: 'Home',     icon: 'home' },
      partnered
        ? { href: 'app-partner.html', label: 'Partner',      icon: 'partner' }
        : { href: 'app-people.html',  label: 'Find Partner', icon: 'find' },
      { href: 'app-sessions.html', label: 'Sessions', icon: 'sessions' },
      { href: 'app-progress.html', label: 'Progress', icon: 'progress' }
    ];
  }

  /* Whether this person has a partner decides which tab is drawn, and asking
     the server takes a round trip. Paint from the last known answer so the nav
     doesn't visibly rearrange itself, then reconcile. */
  var cachedPartner = false;
  try { cachedPartner = localStorage.getItem('pf_haspartner') === '1'; } catch (e) {}

  var bar = document.createElement('header');
  bar.className = 'topbar';
  document.body.insertBefore(bar, document.body.firstChild);

  function tabHtml(t){
    var on = t.href === here;
    return '<a href="' + t.href + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' +
           ICON[t.icon] + t.label + '</a>';
  }

  /* Built once. Reconciling later rewrites only the tabs and the CTA — never
     .nav-right, because notify.js and usermenu.js have already mounted their
     bell and avatar inside it and replacing it would silently remove them. */
  bar.innerHTML =
    '<div class="tb">' +
      '<a class="brand" href="app.html" aria-label="PeerFlow home">' + LOGO + 'peerflow</a>' +
      '<span class="pathchip" id="pf-pathchip" hidden></span>' +
      '<nav class="tabs" id="pf-tabs" aria-label="Main"></nav>' +
      '<a class="nav-cta" id="pf-cta" href="app-partner.html#schedule" hidden>+ Schedule</a>' +
      '<div class="nav-right"></div>' +
    '</div>';

  var tabsEl = bar.querySelector('#pf-tabs');
  var ctaEl  = bar.querySelector('#pf-cta');

  function paint(partnered){
    tabsEl.innerHTML = tabsFor(partnered).map(tabHtml).join('');
    ctaEl.hidden = !partnered;
  }
  paint(cachedPartner);

  /* ---------- the path chip ---------- */
  /* Only appears once we actually know the path — an empty chip would read as
     a loading bug. */
  var track = '';
  try { track = localStorage.getItem('pf_track') || ''; } catch (e) {}
  function paintChip(id){
    var chip = document.getElementById('pf-pathchip');
    var names = (window.pf && pf.trackNames) || {};
    if (!chip || !id || !names[id]) return;
    chip.textContent = names[id];
    chip.hidden = false;
  }
  paintChip(track);

  if (!window.pf) return;

  if (pf.getProfile) {
    pf.getProfile().then(function(p){
      if (!p || !p.track_id || p.track_id === track) return;
      try { localStorage.setItem('pf_track', p.track_id); } catch (e) {}
      paintChip(p.track_id);
    });
  }

  /* ---------- reconcile the partner state ---------- */
  if (pf.primaryPartner) {
    pf.primaryPartner().then(function(partner){
      var has = !!partner;
      try { localStorage.setItem('pf_haspartner', has ? '1' : '0'); } catch (e) {}
      if (has !== cachedPartner) paint(has);
      if (has) upgradeCta();
    }).catch(function(){});
  }

  /* ---------- the primary action ---------- */
  /* Normally "+ Schedule". When a confirmed session is close enough to join,
     the header's one obvious action becomes joining it — that is the thing the
     learner is there to do, and it should not be three clicks deep. */
  var JOIN_WINDOW_MS = 15 * 60 * 1000;   // matches the existing join rule

  function upgradeCta(){
    if (!pf.fetchSessions) return;
    pf.fetchSessions().then(function(list){
      if (!list) return;
      var now = Date.now(), soon = null;
      list.forEach(function(s){
        if (s.status !== 'confirmed') return;
        var start = s.startsAt.getTime();
        var end = start + s.durationMin * 60000;
        if (now >= start - JOIN_WINDOW_MS && now <= end) {
          if (!soon || start < soon.startsAt.getTime()) soon = s;
        }
      });
      var cta = document.getElementById('pf-cta');
      if (!cta || !soon) return;
      cta.textContent = 'Join session';
      cta.className = 'nav-cta join';
      cta.href = 'app-room.html?at=' + encodeURIComponent(soon.startsAt.toISOString()) +
                 '&room=' + encodeURIComponent(soon.roomUrl || '');
    }).catch(function(){});
  }
})();
