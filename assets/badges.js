/* PeerFlow badges.

   Every badge is derived from rows that already exist — finished sessions,
   partners who actually accepted, signup order, profile fields. Nothing is
   awarded for an intention, and a locked badge says exactly what is still
   missing rather than teasing.

   ── on the drawing ──────────────────────────────────────────────────────
   The artwork is a set of SVG files in assets/badges, two per badge: "-on"
   for earned and "-off" for not. Earned badges are coloured and carry a
   tick; unearned ones are the same shape in grey. Nothing in this file
   draws them any more — it decides which of the two to show, and how far
   round the rim to fill.

   That rim is the part this file does draw. Nine of the twelve badges are
   counts, and a locked tile saying "21 more to go" never showed that you
   were already four of the way there. The rim traces the fraction earned,
   and the figure under the tile says what the fraction is of, so a locked
   badge is a target rather than a tease.
   ────────────────────────────────────────────────────────────────────── */
window.pfBadges = (function(){

  /* The faces and the glyph table that used to live here are gone with the
     drawing they described: the artwork is now twelve pairs of SVG files in
     assets/badges, so there is no palette or icon path for this file to hold
     an opinion about. What is left is the rules and the arithmetic.
     ------------------------------------------------------------------ */

  /* Rules run against whatever badgeStats() returns. `todo` is what a locked
     tile shows — a number you can act on, not a nudge. */
  var RULES = [
    { id:'complete', name:'Profile complete',
      desc:'Path, topic, stage and free times all filled in',
      earned:function(s){ return s.profileComplete; },
      todo:'Fill in your path, topic, stage and free times' },

    { id:'partner', name:'First partner',
      desc:'Someone agreed to learn with you',
      earned:function(s){ return s.partners >= 1; },
      todo:'Ask someone on the People page' },

    { id:'first', name:'First session',
      desc:'Finished your first session together',
      earned:function(s){ return s.pastSessions >= 1; },
      todo:'Book a time and turn up' },

    { id:'five', name:'Five sessions',
      desc:'Finished five sessions',
      earned:function(s){ return s.pastSessions >= 5; },
      at:function(s){ return s.pastSessions; }, need:5,
      todo:function(s){ return (5 - s.pastSessions) + ' more to go'; } },

    { id:'two', name:'Two partners',
      desc:'Learned with two different people',
      earned:function(s){ return s.partners >= 2; },
      at:function(s){ return s.partners; }, need:2,
      todo:'Partner with a second person' },

    { id:'steady', name:'Steady pair',
      desc:'Three sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 3; },
      at:function(s){ return s.mostWithOnePartner; }, need:3,
      todo:function(s){ return (3 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'ten', name:'Ten sessions',
      desc:'Finished ten sessions',
      earned:function(s){ return s.pastSessions >= 10; },
      at:function(s){ return s.pastSessions; }, need:10,
      todo:function(s){ return (10 - s.pastSessions) + ' more to go'; } },

    { id:'tenhours', name:'Ten hours',
      desc:'Ten hours sat with a partner',
      earned:function(s){ return (s.totalMinutes || 0) >= 600; },
      at:function(s){ return (s.totalMinutes || 0) / 60; }, need:10,
      note:function(s){ return Math.round((s.totalMinutes || 0) / 60) + ' hours so far'; },
      todo:function(s){ return Math.max(1, Math.ceil((600 - (s.totalMinutes || 0)) / 60)) + ' hours to go'; } },

    { id:'longhaul', name:'Long haul',
      desc:'Ten sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 10; },
      at:function(s){ return s.mostWithOnePartner; }, need:10,
      todo:function(s){ return (10 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'early', name:'Early member',
      desc:'One of the first 25 people on PeerFlow',
      earned:function(s){ return s.joinRank <= 25; },
      note:function(s){ return 'Member number ' + s.joinRank; },
      todo:'Only the first 25 members' },

    { id:'sixweeks', name:'Six weeks running',
      desc:'A session every week for six weeks',
      earned:function(s){ return (s.longestWeekStreak || 0) >= 6; },
      at:function(s){ return s.longestWeekStreak || 0; }, need:6,
      note:function(s){ return s.longestWeekStreak + ' weeks in a row'; },
      /* The chip under this one already says "4 of 6"; repeating it as
         "longest run so far: 4 weeks" was the tile talking to itself. What
         it can add is the rule the number does not carry. */
      todo:'Six weeks in a row, no gaps' },

    { id:'twentyfive', name:'Twenty-five sessions',
      desc:'Finished twenty-five sessions',
      earned:function(s){ return s.pastSessions >= 25; },
      at:function(s){ return s.pastSessions; }, need:25,
      todo:function(s){ return (25 - s.pastSessions) + ' more to go'; } }
  ];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* The artwork lives in assets/badges as two files per badge — "-on" for
     earned and "-off" for not — and is loaded as an image rather than inlined.
     Twelve <img> the browser caches beats a 111KB sprite parsed on every page
     that happens to show a wall.

     File names are their own thing, not the rule ids: the ids are what the
     database and the achievements table know these by, and renaming them to
     match a drawing would be the tail wagging the dog. */
  var ART = {
    complete:'profile-complete', partner:'first-partner', first:'first-session',
    two:'two-partners',          early:'early-member',    steady:'steady-pair',
    five:'five-sessions',        sixweeks:'six-weeks',     ten:'ten-sessions',
    longhaul:'long-haul',        tenhours:'ten-hours',     twentyfive:'twentyfive-sessions'
  };

  /* The five that are not a count came with their unearned art still in the
     badge's own colour — for the seven that are, it is already grey. Left
     alone, "Two partners" sat under "Still to come" in full amber, looking
     every bit as earned as the five above it. These are desaturated in CSS
     rather than by shipping a second set of files, and only these: running
     grayscale over art that is already grey would shift its blue-grey to a
     flat neutral the drawings were not made in. */
  var ONE_SHOT = { complete:1, partner:1, first:1, two:1, early:1 };

  /* The drawn hexagon has rounded corners, so its perimeter is not something
     to work out on paper — the last one was hand-computed and the one before
     that was guessed. The browser knows the length of a path it has just
     drawn; ask it once and cache the answer. */
  var HEX = 'M39.75 8.17 L58.23 18.84 A7.5 7.5 0 0 1 61.98 25.33 L61.98 46.67 ' +
            'A7.5 7.5 0 0 1 58.23 53.17 L39.75 63.84 A7.5 7.5 0 0 1 32.25 63.84 ' +
            'L13.77 53.17 A7.5 7.5 0 0 1 10.02 46.67 L10.02 25.33 ' +
            'A7.5 7.5 0 0 1 13.77 18.84 L32.25 8.17 A7.5 7.5 0 0 1 39.75 8.17 Z';
  var hexLen = null;
  function rimLength(){
    if (hexLen !== null) return hexLen;
    hexLen = 188;                                   /* if measuring is not available */
    try {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', HEX);
      svg.appendChild(p);
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      document.body.appendChild(svg);
      var n = p.getTotalLength();
      document.body.removeChild(svg);
      if (n > 0) hexLen = n;
    } catch(e){}
    return hexLen;
  }

  /* One badge: the drawing, plus — on a locked one that is really a count —
     a rim tracing how far round you already are, laid over the top. */
  function medal(id, earned, pct){
    var file = ART[id] || 'profile-complete';
    var src = 'assets/badges/' + file + (earned ? '-on' : '-off') + '.svg';
    var rim = '';
    if (!earned && pct > 0) {
      var L = rimLength();
      rim = '<svg class="medal-rim" viewBox="0 0 72 72" aria-hidden="true">' +
              '<path d="' + HEX + '" fill="none" stroke="#1D9E75" stroke-width="4" ' +
                'stroke-linecap="butt" ' +
                'stroke-dasharray="' + (L * Math.min(1, pct)).toFixed(1) + ' ' + L.toFixed(1) + '"/>' +
            '</svg>';
    }
    return '<span class="medal' + (earned ? ' on' : ' off') +
             (!earned && ONE_SHOT[id] ? ' grey' : '') + '">' +
             '<img src="' + src + '" width="58" height="58" alt="" loading="lazy">' +
             rim +
           '</span>';
  }

  function evaluate(stats){
    return RULES.map(function(r){
      var got = false;
      try { got = !!r.earned(stats); } catch(e){ got = false; }

      /* Every call into a rule is guarded, not only earned(). A caption that
         throws on a missing stat used to take the whole wall down with it,
         which is a lot of page to lose over one line of text. */
      var sub = r.desc;
      try {
        if (got) sub = typeof r.note === 'function' ? r.note(stats) : r.desc;
        else     sub = typeof r.todo === 'function' ? r.todo(stats) : (r.todo || r.desc);
      } catch(e){ sub = r.desc; }

      /* How far along, for the ones that are a count. Guarded the same way
         earned() is: a rule that throws must not take the wall down. */
      var have = null, pct = 0;
      if (r.need && typeof r.at === 'function') {
        try { have = Math.max(0, r.at(stats) || 0); } catch(e){ have = null; }
        if (have !== null) pct = Math.max(0, Math.min(1, have / r.need));
      }

      return { id:r.id, name:r.name,
               desc:r.desc, earned:got, sub:sub,
               have:have, need:r.need || null, pct:got ? 1 : pct };
    });
  }

  function render(el, stats){
    if (!el) return;
    if (!stats) {
      el.innerHTML = '<p class="badge-empty">Sign in to see your badges.</p>';
      return;
    }
    var list = evaluate(stats);
    var got  = list.filter(function(b){ return b.earned; });
    var left = list.filter(function(b){ return !b.earned; });

    /* Nearest first. A fixed order buried the badge you are one session away
       from between two you will not see for months, which is the difference
       between a wall of trophies and something that pulls you forward. */
    left.sort(function(a, b){ return b.pct - a.pct; });

    function tile(b){
      /* The figure behind the rim: the rim shows the fraction, this says what
         the fraction is of. Only on badges that are genuinely a count. */
      var count = (!b.earned && b.need && b.have !== null)
        ? '<span class="bdg-n">' + fmt(b.have) + ' of ' + b.need + '</span>' : '';
      return '<div class="badge-tile' + (b.earned ? ' earned' : '') +
               '" title="' + esc(b.desc) + '">' +
        medal(b.id, b.earned, b.pct) +
        '<b>' + esc(b.name) + '</b>' +
        '<span>' + esc(b.sub) + '</span>' + count +
      '</div>';
    }

    function section(label, items){
      if (!items.length) return '';
      return '<p class="bdg-h">' + label + '</p>' +
             '<div class="badge-grid">' + items.map(tile).join('') + '</div>';
    }

    el.innerHTML =
      '<p class="badge-count"><b>' + got.length + '</b> of ' + list.length + ' earned</p>' +
      section('Earned', got) +
      section(got.length ? 'Still to come' : 'To earn', left);
  }

  /* Whole numbers. Hours arrive as a fraction, and "3.3 of 10" on a tile
     whose caption already reads "7 hours to go" is precision nobody asked
     for twice. */
  function fmt(v){ return Math.round(v); }

  return { evaluate: evaluate, render: render, medal: medal };
})();
