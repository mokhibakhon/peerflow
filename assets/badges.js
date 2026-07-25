/* PeerFlow badges.
   Every badge is derived from rows that already exist — finished sessions,
   partners you actually agreed with, signup order, profile fields. Nothing is
   awarded for something that didn't happen, and locked badges show exactly
   what is still missing rather than a vague hint.

   Each badge is drawn as a hexagon medal: a gradient body, a bevel highlight,
   a white glyph, and its own colour so they read as distinct awards rather
   than a row of identical icons. */
window.pfBadges = (function(){

  /* glyphs are drawn on a 24x24 grid, centred inside the medal */
  var GLYPH = {
    seed:  '<path d="M12 20.5c0-5.2 3.2-9.2 8.2-10.2-1 6.2-4.2 9.2-8.2 10.2z"/>' +
           '<path d="M12 20.5c0-4.2-2-7.2-6.2-8.2.6 4.8 2.8 7.4 6.2 8.2z"/>' +
           '<path d="M12 20.5V13" stroke-linecap="round"/>',
    check: '<path d="M5.5 12.5l4.4 4.4L18.5 8" stroke-linecap="round" stroke-linejoin="round"/>',
    pair:  '<circle cx="9.2" cy="9.5" r="3.1"/>' +
           '<circle cx="16.4" cy="11.4" r="2.5"/>' +
           '<path d="M3.6 19.2c.8-2.9 2.9-4.4 5.6-4.4s4.8 1.5 5.6 4.4" stroke-linecap="round"/>',
    video: '<rect x="3.2" y="7" width="11.6" height="10.4" rx="2.4"/>' +
           '<path d="M15.6 11l5.2-2.6v7.6L15.6 13.4" stroke-linejoin="round"/>',
    star:  '<path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.6z" stroke-linejoin="round"/>',
    flame: '<path d="M12 3.2s5.2 4.3 5.2 9.1a5.2 5.2 0 11-10.4 0c0-2 1-3.5 2.1-4.6.4 1.5 1.2 2.1 2.1 2.1.6 0 1-.5 1-1.5 0-1.7-.6-3.5-2-5.1z" stroke-linejoin="round"/>',
    anchor:'<circle cx="12" cy="5.4" r="2.3"/>' +
           '<path d="M12 8v12.2M5.8 13.2c0 4.1 2.8 6.7 6.2 6.7s6.2-2.6 6.2-6.7M8.4 11h7.2" stroke-linecap="round"/>'
  };

  /* body colours per badge — session counts are deliberately tiered */
  var SKIN = {
    seed:   ['#34d399', '#047857'],   // emerald
    check:  ['#38bdf8', '#0369a1'],   // sky
    pair:   ['#a78bfa', '#6d28d9'],   // violet
    video:  ['#fb923c', '#c2410c'],   // amber
    star:   ['#d8a765', '#96602a'],   // bronze
    flame:  ['#fcd34d', '#b45309'],   // gold
    anchor: ['#f472b6', '#9d174d']    // rose
  };

  var RULES = [
    { id:'early',    icon:'seed',   name:'Early member',
      desc:'One of the first 25 people on PeerFlow',
      earned:function(s){ return s.joinRank <= 25; },
      note:function(s){ return 'Member number ' + s.joinRank; } },

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

  var uid = 0;   // keeps gradient ids unique if a page renders more than one set

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* A hexagon medal, 72x72. Locked badges use a flat grey body and a padlock
     instead of colour, so earned ones stand out at a glance. */
  function medal(iconKey, earned){
    var n = ++uid;
    var skin = SKIN[iconKey] || SKIN.seed;
    var top = earned ? skin[0] : '#dbe2df';
    var bot = earned ? skin[1] : '#b9c4bf';
    var hex = 'M36 4.5 L62 19 L62 53 L36 67.5 L10 53 L10 19 Z';

    return '<svg class="medal" viewBox="0 0 72 72" width="66" height="66" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="pfb' + n + '" x1="0" y1="0" x2="0.35" y2="1">' +
          '<stop offset="0" stop-color="' + top + '"/>' +
          '<stop offset="1" stop-color="' + bot + '"/>' +
        '</linearGradient>' +
        '<linearGradient id="pfs' + n + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ffffff" stop-opacity="' + (earned ? '.45' : '.3') + '"/>' +
          '<stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>' +
        '</linearGradient>' +
      '</defs>' +
      /* body + soft outer edge */
      '<path d="' + hex + '" fill="url(#pfb' + n + ')" stroke="' + bot + '" stroke-width="3" stroke-linejoin="round"/>' +
      /* inner bevel ring */
      '<path d="M36 10 L57 21.8 L57 50.2 L36 62 L15 50.2 L15 21.8 Z" fill="none" ' +
        'stroke="#ffffff" stroke-opacity="' + (earned ? '.38' : '.5') + '" stroke-width="1.4" stroke-linejoin="round"/>' +
      /* top shine */
      '<path d="' + hex + '" fill="url(#pfs' + n + ')"/>' +
      /* glyph */
      '<g transform="translate(24 24)" fill="none" stroke="#ffffff" stroke-width="1.9" ' +
        'stroke-opacity="' + (earned ? '1' : '.85') + '">' + (GLYPH[iconKey] || '') + '</g>' +
      (earned ? '' :
        /* padlock for locked badges */
        '<g transform="translate(50 48)">' +
          '<circle cx="0" cy="0" r="11" fill="#8d9a95" stroke="#ffffff" stroke-width="2"/>' +
          '<rect x="-4.5" y="-1.5" width="9" height="7.5" rx="1.6" fill="#ffffff"/>' +
          '<path d="M-2.6 -1.5v-2.4a2.6 2.6 0 015.2 0v2.4" fill="none" stroke="#ffffff" stroke-width="1.8"/>' +
        '</g>') +
      '</svg>';
  }

  function evaluate(stats){
    return RULES.map(function(r){
      var got = false;
      try { got = !!r.earned(stats); } catch(e){ got = false; }
      var sub;
      if (got)             sub = r.note ? r.note(stats) : r.desc;
      else if (r.progress) { var p = r.progress(stats); sub = p[0] + ' of ' + p[1]; }
      else                 sub = r.todo || r.desc;
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
      '<p class="badge-count"><b>' + earned + '</b> of ' + list.length + ' earned</p>' +
      '<div class="badge-grid">' +
      list.map(function(b){
        return '<div class="badge-tile' + (b.earned ? ' earned' : '') + '" title="' + esc(b.desc) + '">' +
          medal(b.icon, b.earned) +
          '<b>' + esc(b.name) + '</b>' +
          '<span>' + esc(b.sub) + '</span>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  return { evaluate: evaluate, render: render, medal: medal };
})();
