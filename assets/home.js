(function(){
  /* Signed in, the landing page stays readable — people do come back to it
     to re-read the pitch, check the code of conduct, or see what a friend
     will see before sending the link. Bouncing them to the app would make
     the page unreachable to everyone who has an account, including you.

     What changes is the nav: the two auth buttons are no use to someone who
     already has an account, so they become one way into the app plus the
     same account chip the app uses. The hero and path buttons are left
     pointing at signup.html, which sends a finished account straight
     through to the app on its own.

     There are two copies of those links now — the inline row and the mobile
     menu panel — and only one of the two is ever on screen. Both still have to
     be swapped, because which one is showing depends on how wide the window is
     when you look, and a window can be resized after this has run. Hence
     querySelectorAll against .nav rather than querySelector against
     .nav-right; the match is still on href, never on the label.

     Every other route into signup goes too, not just the nav's. The hero
     button, the eight path cards and the closing button were left pointing at
     signup.html on the reasoning that it forwards a finished account to the
     app on its own — which it does, but only after loading a page, reading
     the session, fetching the profile and then redirecting. Someone who
     already has an account should not pay for that to press a button labelled
     as the way in. */

  if (!window.pf || !pf.currentUser) return;

  pf.currentUser().then(function(user){
    if (!user) return;

    var logins = document.querySelectorAll('.nav a[href="login.html"]');
    Array.prototype.forEach.call(logins, function(a){ a.remove(); });

    /* Starts-with, because the path cards carry ?path=. */
    var ctas = document.querySelectorAll('a[href^="signup.html"]');
    Array.prototype.forEach.call(ctas, function(a){
      var labelled = /find someone to learn with|sign up/i.test(a.textContent || '');
      a.href = 'app.html';
      /* Only the ones whose words promise signing up. A path card is a whole
         card with a name in it, and rewriting that to "Open app" would leave
         eight identical cards. */
      if (labelled) a.textContent = 'Open app';
    });
  });
})();

(function(){
  /* The mobile menu.

     The panel starts closed in the markup with the `hidden` attribute rather
     than a class, so it is display:none from the first byte and can't flash
     open while this file is still on its way down. Opening and closing is the
     same attribute, which keeps one source of truth: hidden means closed,
     aria-expanded reports it, and nothing else has to agree.

     No inline handlers, and the listeners on document are added only while the
     panel is open, so a closed menu costs nothing. */

  var btn   = document.querySelector('.menu-btn');
  var panel = document.getElementById('nav-menu');
  if (!btn || !panel) return;

  function isOpen(){ return !panel.hidden; }

  function open(){
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onOutside, true);
  }

  /* toButton is for the cases where the menu closes without the user going
     anywhere — Escape, or pressing the button again. Focus has to come back
     to something, and the button is where they were. Following a link is not
     one of those cases: the page is already moving. */
  function close(toButton){
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
    if (toButton) btn.focus();
  }

  function onKey(e){
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(true); }
  }

  /* Capture phase, so this runs before anything inside the panel can stop it.
     Clicks on the button itself are left alone — the button's own handler
     toggles, and closing here first would make it reopen immediately. */
  function onOutside(e){
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    close(false);
  }

  btn.addEventListener('click', function(){
    if (isOpen()) close(true); else open();
  });

  /* Closing on the link itself rather than on the panel covers both kinds of
     destination: another page, and a #hash that only scrolls. The second one
     never unloads anything, so without this the panel would sit open over the
     section it just jumped to. */
  Array.prototype.forEach.call(panel.querySelectorAll('a'), function(a){
    a.addEventListener('click', function(){ close(false); });
  });

  /* Widening the window past the breakpoint hides the panel by CSS but would
     leave aria-expanded lying about it. */
  window.addEventListener('resize', function(){
    if (isOpen() && getComputedStyle(btn).display === 'none') close(false);
  });
})();

(function(){
  /* Hero card: a pomodoro ticking 25:00 down to 00:00 and starting over,
     with the ring emptying as it goes. Purely illustrative — the card is
     example data, which is why it's aria-hidden in the markup. */

  var el = document.getElementById('pf-count');
  var arc = document.getElementById('pf-arc');
  if (!el) return;

  var TOTAL = 25 * 60;
  var RING = 270.18;  /* circumference of the r=43 circle in the SVG */

  function paint(){
    var left = TOTAL - (Math.floor(Date.now() / 1000) % TOTAL);
    var m = Math.floor(left / 60), s = left % 60;
    el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    if (arc) arc.style.strokeDashoffset = (RING * (1 - left / TOTAL)).toFixed(2);
  }

  paint();
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) setInterval(paint, 1000);
})();

(function(){
  /* Landing page: fill in how many people are on each path.

     The number comes from real sign-ups. If the server is unreachable we
     leave the line invisible rather than guessing — the space is already
     reserved in the CSS, so nothing shifts when it appears (or doesn't). */

  var slots = document.querySelectorAll('.waiting[data-track]');
  if (!slots.length || !window.pf || !pf.trackCounts) return;

  pf.trackCounts().then(function(counts){
    if (!counts) return;  /* offline or no server — say nothing at all */

    Array.prototype.forEach.call(slots, function(el){
      var n = counts[el.getAttribute('data-track')] || 0;
      var label = el.querySelector('span');

      if (n > 0) {
        label.textContent = n + ' waiting';
      } else {
        el.classList.add('none');
        label.textContent = 'be the first';
      }
      el.classList.add('shown');
    });
  });
})();
