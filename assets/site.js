(function(){
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ticking focus timer in the home-page session mockup */
  var clock = document.getElementById('clock');
  var arc = document.getElementById('arc');
  if (clock && arc) {
    var total = 50*60, left = 42*60+17;
    var C = 414.7; /* 2πr, r=66 */
    var paint = function(){
      var m = Math.floor(left/60), s = left%60;
      clock.textContent = (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
      arc.style.strokeDashoffset = (C*(1-left/total)).toFixed(1);
    };
    paint();
    if (!reduced) {
      setInterval(function(){ left = left>0 ? left-1 : total; paint(); }, 1000);
    }
  }

  /* honest "next session" line — top of the real hour */
  var ns = document.getElementById('next-session');
  if (ns) {
    var mins = 60 - new Date().getMinutes();
    ns.textContent = 'Next session starts in ' + mins + ' min — at the top of the hour';
  }
})();
