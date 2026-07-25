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
