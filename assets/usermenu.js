/* PeerFlow account menu.
   Replaces the old "Profile" nav link and stray log-out link with the usual
   pattern: an avatar showing your initial, opening a menu with your account
   pages. Injected on every signed-in page so the header stays identical. */
window.pfUserMenu = (function(){
  var wrap, btn, menu, nameEl, mailEl;

  function initial(name){
    return (String(name || '').trim().charAt(0) || 'S').toUpperCase();
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
    wrap.innerHTML =
      '<button class="av-nav um-btn" id="nav-av" aria-haspopup="true" aria-expanded="false" title="Your account">' +
        esc(initial(name)) +
      '</button>' +
      '<div class="um-menu" id="um-menu" hidden role="menu">' +
        '<div class="um-head">' +
          '<span class="um-name" id="um-name">' + esc(name || 'Your account') + '</span>' +
          '<span class="um-mail" id="um-mail">' + esc(email) + '</span>' +
        '</div>' +
        '<a class="um-item" role="menuitem" href="app-profile.html">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="8.5" r="3.6" stroke="currentColor" stroke-width="1.8"/>' +
            '<path d="M4.5 19.5c.9-3.6 3.8-5.5 7.5-5.5s6.6 1.9 7.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>Your profile</a>' +
        '<a class="um-item" role="menuitem" href="app-profile.html#badges">' +
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
        '<a class="um-item" role="menuitem" href="conduct.html">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M5 4.5h11l3 3v12H5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<path d="M8.5 10h7M8.5 14h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>Code of conduct</a>' +
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
      try {
        ['pf_name','pf_email','pf_track','pf_topic','pf_pending']
          .forEach(function(k){ localStorage.removeItem(k); });
      } catch(err) {}
      if (window.pf) pf.signOut();
      window.location.href = 'index.html';
    });
    return true;
  }

  /* Pages call this once they know the real name/email from the profile. */
  function setUser(name, email){
    if (!btn) return;
    if (name) {
      btn.textContent = initial(name);
      if (nameEl) nameEl.textContent = name;
    }
    if (email && mailEl) mailEl.textContent = email;
  }

  var ok = build();

  /* Fill in from the signed-in account without every page having to. */
  if (ok && window.pf) {
    pf.currentUser().then(function(user){
      if (!user) { wrap.hidden = true; return; }
      var meta = user.user_metadata || {};
      var nm = '';
      try { nm = localStorage.getItem('pf_name') || ''; } catch(e){}
      setUser(nm || meta.name || meta.full_name || (user.email || '').split('@')[0], user.email);
    });
  }

  return { setUser: setUser };
})();
