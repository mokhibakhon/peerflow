(function(){
  /* The signed-in top bar: brand, the path you're on, the tabs, and a slot
     on the right that notify.js and usermenu.js mount into.

     Rendered from here rather than pasted into five pages, so the nav can
     only ever be wrong in one place. Must load before notify.js and
     usermenu.js, which both look for .nav-right. */

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
      '<path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="#585C74" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };

  var TABS = [
    { href:'app.html',          label:'Sessions', icon:'sessions' },
    { href:'app-sessions.html', label:'Partner',  icon:'partner'  },
    { href:'app-people.html',   label:'People',   icon:'people'   }
  ];

  var here = (location.pathname.split('/').pop() || 'app.html').toLowerCase();

  var bar = document.createElement('header');
  bar.className = 'topbar';
  bar.innerHTML =
    '<div class="tb">' +
      '<a class="brand" href="app.html" aria-label="PeerFlow">' + LOGO + 'peerflow</a>' +
      '<span class="pathchip" id="pf-pathchip" hidden></span>' +
      '<nav class="tabs" aria-label="App">' +
        TABS.map(function(t){
          return '<a href="' + t.href + '"' + (t.href === here ? ' class="on" aria-current="page"' : '') + '>' +
                 ICON[t.icon] + t.label + '</a>';
        }).join('') +
      '</nav>' +
      '<div class="nav-right"></div>' +
    '</div>';
  document.body.insertBefore(bar, document.body.firstChild);

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
