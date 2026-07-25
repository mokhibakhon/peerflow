/* PeerFlow badges.
   Every badge is derived from rows that already exist — finished sessions,
   partners you actually agreed with, signup order, profile fields. Nothing is
   awarded for something that didn't happen, and locked badges show exactly
   what is still missing rather than a vague hint. */
window.pfBadges = (function(){

  var ICON = {
    seed:  '<path d="M12 20c0-5 3-9 8-10-1 6-4 9-8 10z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
           '<path d="M12 20c0-4-2-7-6-8 .6 4.6 2.7 7.2 6 8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    pair:  '<circle cx="9" cy="9" r="3.2" stroke="currentColor" stroke-width="1.8"/>' +
           '<circle cx="16" cy="11" r="2.6" stroke="currentColor" stroke-width="1.8"/>' +
           '<path d="M3.5 19c.7-2.8 2.8-4.3 5.5-4.3s4.8 1.5 5.5 4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    video: '<rect x="3" y="6.5" width="12" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/>' +
           '<path d="M16 10.5l5-2.5v8l-5-2.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    star:  '<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.2 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7L12 3.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    flame: '<path d="M12 3s5 4.2 5 9a5 5 0 01-10 0c0-2 1-3.4 2-4.5.4 1.4 1.2 2 2 2 .6 0 1-.5 1-1.5 0-1.6-.6-3.4-2-5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    anchor:'<circle cx="12" cy="5.5" r="2.2" stroke="currentColor" stroke-width="1.8"/>' +
           '<path d="M12 8v12M6 13c0 4 2.7 6.5 6 6.5s6-2.5 6-6.5M8.5 11h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  };

  /* Each rule reads the stats object from pf.badgeStats(). */
  var RULES = [
    { id:'early',    icon:'seed',   name:'Early member',
      desc:'One of the first 25 people on PeerFlow',
      earned:function(s){ return s.joinRank <= 25; },
      note:function(s){ return 'You were number ' + s.joinRank; } },

    { id:'complete', icon:'check',  name:'Profile complete',
      desc:'Path, topic, stage and free times all filled in',
      earned:function(s){ return s.profileComplete; },
      todo:'Fill in the rest of your profile' },

    { id:'partner',  icon:'pair',   name:'First partner',
      desc:'Agreed to learn with someone',
      earned:function(s){ return s.partners >= 1; },
      todo:'Send or accept a partner request' },

    { id:'first',    icon:'video',  name:'First session',
      desc:'Finished your first session together',
      earned:function(s){ return s.pastSessions >= 1; },
      todo:'Meet your partner once' },

    { id:'five',     icon:'star',   name:'Five sessions',
      desc:'Finished five sessions',
      earned:function(s){ return s.pastSessions >= 5; },
      progress:function(s){ return [Math.min(s.pastSessions,5), 5]; } },

    { id:'ten',      icon:'flame',  name:'Ten sessions',
      desc:'Finished ten sessions',
      earned:function(s){ return s.pastSessions >= 10; },
      progress:function(s){ return [Math.min(s.pastSessions,10), 10]; } },

    { id:'steady',   icon:'anchor', name:'Steady pair',
      desc:'Three sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 3; },
      progress:function(s){ return [Math.min(s.mostWithOnePartner,3), 3]; } }
  ];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function evaluate(stats){
    return RULES.map(function(r){
      var got = false;
      try { got = !!r.earned(stats); } catch(e){ got = false; }
      var sub = '';
      if (got) {
        sub = r.note ? r.note(stats) : r.desc;
      } else if (r.progress) {
        var p = r.progress(stats);
        sub = p[0] + ' of ' + p[1];
      } else {
        sub = r.todo || r.desc;
      }
      return { id:r.id, icon:r.icon, name:r.name, desc:r.desc, earned:got, sub:sub };
    });
  }

  function render(el, stats){
    if (!el) return;
    if (!stats) {
      el.innerHTML = '<p class="bell-empty" style="padding:8px 0">Sign in to see your badges.</p>';
      return;
    }
    var list = evaluate(stats);
    var earned = list.filter(function(b){ return b.earned; }).length;
    el.innerHTML =
      '<p class="badge-count">' + earned + ' of ' + list.length + ' earned</p>' +
      '<div class="badge-grid">' +
      list.map(function(b){
        return '<div class="badge-tile' + (b.earned ? ' earned' : '') + '" title="' + esc(b.desc) + '">' +
          '<span class="badge-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            ICON[b.icon] + '</svg></span>' +
          '<b>' + esc(b.name) + '</b>' +
          '<span>' + esc(b.sub) + '</span>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  return { evaluate: evaluate, render: render };
})();
