(function(){
  /* Hero card: a pomodoro ticking 25:00 down to 00:00 and starting over,
     with the ring emptying as it goes. Purely illustrative — the card is
     example data, which is why it's aria-hidden in the markup. */

  var el = document.getElementById('pf-count');
  var arc = document.getElementById('pf-arc');
  if (!el) return;

  var TOTAL = 25 * 60;
  var RING = 276.46;  /* circumference of the r=44 circle in the SVG */

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
