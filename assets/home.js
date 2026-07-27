(function(){
  /* Signed in, the landing page stays readable — people do come back to it
     to re-read the pitch, check the code of conduct, or see what a friend
     will see before sending the link. Bouncing them to the app would make
     the page unreachable to everyone who has an account, including you.

     What changes is the nav: the two auth buttons are no use to someone who
     already has an account, so they become one way into the app plus the
     same account chip the app uses. The hero and path buttons are left
     pointing at signup.html, which sends a finished account straight
     through to the app on its own. */

  if (!window.pf || !pf.currentUser) return;

  pf.currentUser().then(function(user){
    if (!user) return;

    var login = document.querySelector('.nav-right a[href="login.html"]');
    if (login) login.remove();

    var cta = document.querySelector('.nav-right a[href="signup.html"]');
    if (cta) { cta.href = 'app.html'; cta.textContent = 'Open app'; }
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
