(function(){
  /* App pages are for signed-in people only. If you're not signed in there is
     nothing to render, so go to the login page and come back here afterwards
     rather than showing an empty dashboard with a banner on it.

     No redirect loop: login.html sends you here only when you ARE signed in,
     and this sends you there only when you are NOT. */

  if (!window.pf || !pf.currentUser) return;

  pf.currentUser().then(function(user){
    if (user) return;
    var here = (location.pathname.split('/').pop() || 'app.html') + location.search;
    location.replace('login.html?next=' + encodeURIComponent(here));
  });
})();
