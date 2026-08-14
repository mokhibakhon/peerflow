(function(){
  /* App pages are for signed-in people only. If you're not signed in there is
     nothing to render, so go to the login page and come back here afterwards
     rather than showing an empty dashboard with a banner on it.

     No redirect loop: login.html sends you here only when you ARE signed in,
     and this sends you there only when you are NOT.

     This file is loaded from <head> so the class below lands before the first
     paint. It used to sit at the end of <body>, which meant the dashboard was
     painted, read and only then replaced — a signed-out visitor saw a flash of
     somebody's app before being bounced. The session check itself still has to
     wait for db.js, which loads at the end of the body, so the hiding and the
     asking are deliberately separated. */

  var root = document.documentElement;
  root.classList.add('pf-gate');

  var shown = false;
  function reveal(){
    if (shown) return;
    shown = true;
    root.classList.remove('pf-gate');
  }

  /* Nothing may leave the page invisible: if db.js never arrives — the CDN is
     blocked, the connection died mid-load — the page comes back anyway and
     degrades to whatever it can show. */
  setTimeout(reveal, 3000);

  function check(){
    if (!window.pf || !pf.currentUser) { reveal(); return; }
    pf.currentUser().then(function(user){
      if (user) { reveal(); return; }
      var here = (location.pathname.split('/').pop() || 'app.html') + location.search;
      location.replace('login.html?next=' + encodeURIComponent(here));
    }, reveal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
