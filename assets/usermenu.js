/* PeerFlow account menu.
   Replaces the old "Profile" nav link and stray log-out link with the usual
   pattern: an avatar showing your initial, opening a menu with your account
   pages. Injected on every signed-in page so the header stays identical. */
window.pfUserMenu = (function(){
  var wrap, btn, menu, nameEl, mailEl;

  function initial(name){
    return (String(name || '').trim().charAt(0) || 'S').toUpperCase();
  }

  /* The chip shows a first name only. A surname adds nothing there — you
     know who you are — and it's the part most likely to overflow. The full
     name still appears in the menu, where it's account detail. */
  function firstName(name){
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  /* A stable colour per person, so your own avatar looks like *yours* rather
     than like a generic grey placeholder. Same name always lands on the same
     pair, and every pair is dark-on-light enough to read at 12px. */
  var TONES = [
    ['#EEEDFE','#3C3489'], ['#E1F5EE','#0F6E56'], ['#FBEAF0','#A94168'],
    ['#E6F1FB','#185FA5'], ['#FAEEDA','#854F0B'], ['#FAECE7','#993C1D'],
    ['#F5EAF8','#58256B'], ['#EDF0F3','#35414F']
  ];
  function tone(name){
    var s = String(name || '?'), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return TONES[h % TONES.length];
  }

  /* A real picture when the account has one (Google hands us one on sign-in),
     otherwise the initial on its colour. */
  function face(name, url, cls){
    var t = tone(name);
    var inner = url
      ? '<img src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">'
      : esc(initial(name));
    return '<span class="' + cls + '" style="background:' + t[0] + ';color:' + t[1] + '">' + inner + '</span>';
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function build(){
    var nav = document.querySelector('.nav-right');
    if (!nav) return false;

    var name = '', email = '';
    try {
      name  = localStorage.getItem('pf_name')  || '';
      email = localStorage.getItem('pf_email') || '';
    } catch(err) {}

    wrap = document.createElement('div');
    wrap.className = 'um-wrap';
    /* Hidden until currentUser() confirms somebody is signed in. Rendering
       first and hiding after showed a stray "S" chip to logged-out visitors
       for as long as the auth check took — forever, if it never answered. */
    wrap.hidden = true;
    wrap.innerHTML =
      '<button class="um-btn" id="nav-av" aria-haspopup="true" aria-expanded="false" aria-label="Your account">' +
        '<span id="um-face">' + face(name, '', 'um-face') + '</span>' +
        '<span class="um-label" id="um-label">' + esc(firstName(name) || 'Account') + '</span>' +
        '<svg class="um-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
          '<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="um-menu" id="um-menu" hidden role="menu">' +
        '<div class="um-head">' +
          '<span id="um-bigface">' + face(name, '', 'um-bigface') + '</span>' +
          '<span class="um-who">' +
            '<span class="um-name" id="um-name">' + esc(name || 'Your account') + '</span>' +
            '<span class="um-mail" id="um-mail">' + esc(email) + '</span>' +
          '</span>' +
        '</div>' +
        '<a class="um-item" role="menuitem" href="app-profile.html">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="8.5" r="3.6" stroke="currentColor" stroke-width="1.8"/>' +
            '<path d="M4.5 19.5c.9-3.6 3.8-5.5 7.5-5.5s6.6 1.9 7.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>Your profile</a>' +
        '<a class="um-item" role="menuitem" href="app-badges.html">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M12 3.5l7 3.8v5.2c0 4.3-2.9 7.4-7 8.5-4.1-1.1-7-4.2-7-8.5V7.3l7-3.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<path d="M9 12.2l2.2 2.2 4-4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>Badges</a>' +
        '<a class="um-item" role="menuitem" href="app-settings.html">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>' +
            '<path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1A1.6 1.6 0 007 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H1a2 2 0 010-4h.1A1.6 1.6 0 002.6 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H7a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
          '</svg>Settings</a>' +
        '<div class="um-sep"></div>' +
        '<button class="um-item danger" role="menuitem" id="um-logout">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M14 4.5H6.5v15H14M11 12h9m0 0l-3-3m3 3l-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>Log out</button>' +
      '</div>';

    nav.appendChild(wrap);
    btn    = document.getElementById('nav-av');
    menu   = document.getElementById('um-menu');
    nameEl = document.getElementById('um-name');
    mailEl = document.getElementById('um-mail');

    function close(){ menu.hidden = true; btn.setAttribute('aria-expanded','false'); }
    function toggle(e){
      e.stopPropagation();
      var open = !menu.hidden;
      menu.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    }
    btn.addEventListener('click', toggle);
    document.addEventListener('click', function(e){
      if (!menu.hidden && !wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); }
    });

    document.getElementById('um-logout').addEventListener('click', function(){
      var btn = this;
      btn.disabled = true;
      try {
        ['pf_name','pf_email','pf_track','pf_topic','pf_pending','pf_uid']
          .forEach(function(k){ localStorage.removeItem(k); });
      } catch(err) {}

      /* replace() rather than href: pressing back after logging out should
         not return you to a page that still looks signed in. */
      var left = false;
      function leave(){ if (left) return; left = true; window.location.replace('index.html'); }

      var out = window.pf && pf.signOut ? pf.signOut() : null;
      if (out && out.then) {
        out.then(leave, leave);
        /* Don't strand anyone on the menu if the network hangs — the local
           session is already gone by then either way. */
        setTimeout(leave, 2500);
      } else {
        leave();
      }
    });
    return true;
  }

  /* Pages call this once they know the real name/email from the profile. */
  function setUser(name, email, avatarUrl){
    if (!btn) return;
    if (name) {
      var f = document.getElementById('um-face');
      var bf = document.getElementById('um-bigface');
      if (f)  f.innerHTML  = face(name, avatarUrl, 'um-face');
      if (bf) bf.innerHTML = face(name, avatarUrl, 'um-bigface');
      var lab = document.getElementById('um-label');
      if (lab) lab.textContent = firstName(name);
      if (nameEl) nameEl.textContent = name;
    }
    if (email && mailEl) mailEl.textContent = email;
  }

  var ok = build();

  /* Fill in from the signed-in account without every page having to. */
  if (ok && window.pf) {
    pf.currentUser().then(function(user){
      if (!user) return;                       // stays hidden
      wrap.hidden = false;
      /* The signed-in account decides whose name this is. localStorage was
         being read first, so signing in as somebody else still showed the
         previous person's name until that cache happened to be rewritten.
         Cache is now only a fallback, and gets corrected from the session. */
      var meta = user.user_metadata || {};
      var cached = '';
      try { cached = localStorage.getItem('pf_name') || ''; } catch(e){}
      var nm = meta.name || meta.full_name || cached || (user.email || '').split('@')[0];
      setUser(nm, user.email, meta.avatar_url || meta.picture || '');
      try {
        if (nm && nm !== cached) localStorage.setItem('pf_name', nm);
        if (user.email) localStorage.setItem('pf_email', user.email);
      } catch(e){}
    });
  }

  return { setUser: setUser };
})();
