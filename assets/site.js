(function(){
  /* Home-page email captures (the "what we're starting with" form and the
     bottom call-to-action). Both write to the waitlist via the data layer.
     We only tell someone they're on the list when the write actually succeeds. */
  function wire(formId, emailId, interestId, noteId, okText){
    var form = document.getElementById(formId);
    if (!form || !window.pf) return;
    var note = document.getElementById(noteId);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var email = (document.getElementById(emailId).value || '').trim();
      var interest = (document.getElementById(interestId).value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        note.textContent = 'Please enter a valid email address.';
        return;
      }
      var btn = form.querySelector('button');
      var label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      pf.joinWaitlist(email, interest).then(function(res){
        btn.disabled = false; btn.textContent = label;
        if (res && res.saved) {
          form.reset();
          note.textContent = okText;
        } else if (res && res.demo) {
          note.textContent = 'This preview isn’t connected to the server, so nothing was sent.';
        } else {
          note.textContent = (res && res.error) || 'Something went wrong — please try again.';
        }
      });
    });
  }

  wire('track-form', 'track-email', 'track-interest', 'track-note',
       'Thanks — we’ll email you when it opens.');

  /* Hero preview: a pomodoro-style session timer, ticking down 25:00 → 00:00
     and looping. Purely illustrative — the card is example data. */
  (function(){
    var el = document.getElementById('mp-count');
    if (!el) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var TOTAL = 25 * 60;
    function paint(){
      var left = TOTAL - (Math.floor(Date.now() / 1000) % TOTAL);
      var m = Math.floor(left / 60), s = left % 60;
      el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    paint();
    if (!reduced) setInterval(paint, 1000);
  })();
})();
