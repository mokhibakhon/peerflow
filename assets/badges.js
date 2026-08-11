/* PeerFlow badges.

   Every badge is derived from rows that already exist — finished sessions,
   partners who actually accepted, signup order, profile fields. Nothing is
   awarded for an intention, and a locked badge says exactly what is still
   missing rather than teasing.

   ── on the drawing ──────────────────────────────────────────────────────
   These used to be struck metal: a rimmed hexagon with a gradient face, a
   radial sheen and a hairline of light along one edge, in bronze, silver,
   gold and jade. Two things were wrong with that.

   It was the only skeuomorphic object in the product. Everything else here
   is flat, quiet and typographic — hairlines, one green, a mono caption —
   and a wall of faux-metal trophies read as though it had been imported
   from somewhere else.

   And the four metals ranked the badges without ever saying so. Nothing on
   the page explained why "Steady pair" was silver and "Ten sessions" gold,
   so the ranking was decoration carrying no information.

   What replaced it: the same hexagon, flat, in the brand green. Two states
   that differ in fill rather than in saturation, so a locked wall cannot be
   mistaken for one that failed to load. One quiet second tier for the four
   hardest. And, where a badge is a count, the count is drawn — a locked
   tile shows how far along you already are, which turns it from a tease
   into a target. That was the part actually missing.
   ────────────────────────────────────────────────────────────────────── */
window.pfBadges = (function(){

  /* Three faces: [top, bottom, glyph]. Milestone is one step deeper rather
     than a different metal — the only ranking the wall makes, and it reads
     as "further in" instead of "made of a rarer substance". */
  var FACE = {
    earned:    ['#22A87C', '#0B7F62', '#ffffff'],
    milestone: ['#12775E', '#06463A', '#ffffff'],
    locked:    ['#F1F2F6', '#E6E8EF', '#A6ACBD']
  };

  /* Glyphs live on a 24x24 grid, centred in the medal. Stroked rather than
     filled so they stay legible against a bright metal face. */
  var GLYPH = {
    seed:   '<path d="M12 20.5c0-5.2 3.2-9.2 8.2-10.2-1 6.2-4.2 9.2-8.2 10.2z"/>' +
            '<path d="M12 20.5c0-4.2-2-7.2-6.2-8.2.6 4.8 2.8 7.4 6.2 8.2z"/>' +
            '<path d="M12 20.5V13" stroke-linecap="round"/>',
    check:  '<path d="M5.5 12.5l4.4 4.4L18.5 8" stroke-linecap="round" stroke-linejoin="round"/>',
    pair:   '<circle cx="9.2" cy="9.5" r="3.1"/><circle cx="16.4" cy="11.4" r="2.5"/>' +
            '<path d="M3.6 19.2c.8-2.9 2.9-4.4 5.6-4.4s4.8 1.5 5.6 4.4" stroke-linecap="round"/>',
    video:  '<rect x="3.2" y="7" width="11.6" height="10.4" rx="2.4"/>' +
            '<path d="M15.6 11l5.2-2.6v7.6L15.6 13.4" stroke-linejoin="round"/>',
    star:   '<path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.6z" stroke-linejoin="round"/>',
    flame:  '<path d="M12 3.2s5.2 4.3 5.2 9.1a5.2 5.2 0 11-10.4 0c0-2 1-3.5 2.1-4.6.4 1.5 1.2 2.1 2.1 2.1.6 0 1-.5 1-1.5 0-1.7-.6-3.5-2-5.1z" stroke-linejoin="round"/>',
    anchor: '<circle cx="12" cy="5.4" r="2.3"/>' +
            '<path d="M12 8v12.2M5.8 13.2c0 4.1 2.8 6.7 6.2 6.7s6.2-2.6 6.2-6.7M8.4 11h7.2" stroke-linecap="round"/>',
    crown:  '<path d="M3.6 8.6l3.6 3.2L12 5l4.8 6.8 3.6-3.2-1.8 10.4H5.4L3.6 8.6z" stroke-linejoin="round"/>' +
            '<path d="M5.4 19h13.2" stroke-linecap="round"/>',
    clock:  '<circle cx="12" cy="12" r="8.4"/>' +
            '<path d="M12 7.2V12l3.4 2" stroke-linecap="round" stroke-linejoin="round"/>',
    weeks:  '<rect x="3.4" y="5.4" width="17.2" height="15.2" rx="2.6"/>' +
            '<path d="M3.4 10h17.2M8 3.2v3.6M16 3.2v3.6" stroke-linecap="round"/>' +
            '<path d="M8.4 14.6l2.2 2.2 4.6-4.8" stroke-linecap="round" stroke-linejoin="round"/>',
    trophy: '<path d="M7.4 4.2h9.2v5a4.6 4.6 0 11-9.2 0v-5z" stroke-linejoin="round"/>' +
            '<path d="M7.4 6.2H4.8v1.6a3 3 0 003 3M16.6 6.2h2.6v1.6a3 3 0 01-3 3" stroke-linecap="round"/>' +
            '<path d="M12 14v3.6M8.6 20.2h6.8" stroke-linecap="round"/>',
    users:  '<circle cx="8.4" cy="8.6" r="3"/><circle cx="16.6" cy="9.4" r="2.6"/>' +
            '<path d="M2.8 19c.7-3 2.8-4.6 5.6-4.6s4.9 1.6 5.6 4.6" stroke-linecap="round"/>' +
            '<path d="M15 14.6c2.6-.3 4.6 1.2 5.2 4.4" stroke-linecap="round"/>'
  };

  /* Rules run against whatever badgeStats() returns. `todo` is what a locked
     tile shows — a number you can act on, not a nudge. */
  var RULES = [
    { id:'complete', icon:'check', metal:'bronze', name:'Profile complete',
      desc:'Path, topic, stage and free times all filled in',
      earned:function(s){ return s.profileComplete; },
      todo:'Fill in your path, topic, stage and free times' },

    { id:'partner', icon:'pair', metal:'bronze', name:'First partner',
      desc:'Someone agreed to learn with you',
      earned:function(s){ return s.partners >= 1; },
      todo:'Ask someone on the People page' },

    { id:'first', icon:'video', metal:'bronze', name:'First session',
      desc:'Finished your first session together',
      earned:function(s){ return s.pastSessions >= 1; },
      todo:'Book a time and turn up' },

    { id:'five', icon:'star', metal:'silver', name:'Five sessions',
      desc:'Finished five sessions',
      earned:function(s){ return s.pastSessions >= 5; },
      at:function(s){ return s.pastSessions; }, need:5,
      todo:function(s){ return (5 - s.pastSessions) + ' more to go'; } },

    { id:'two', icon:'users', metal:'silver', name:'Two partners',
      desc:'Learned with two different people',
      earned:function(s){ return s.partners >= 2; },
      at:function(s){ return s.partners; }, need:2,
      todo:'Partner with a second person' },

    { id:'steady', icon:'anchor', metal:'silver', name:'Steady pair',
      desc:'Three sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 3; },
      at:function(s){ return s.mostWithOnePartner; }, need:3,
      todo:function(s){ return (3 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'ten', icon:'flame', metal:'gold', name:'Ten sessions',
      desc:'Finished ten sessions',
      earned:function(s){ return s.pastSessions >= 10; },
      at:function(s){ return s.pastSessions; }, need:10,
      todo:function(s){ return (10 - s.pastSessions) + ' more to go'; } },

    { id:'tenhours', icon:'clock', metal:'gold', name:'Ten hours',
      desc:'Ten hours sat with a partner',
      earned:function(s){ return (s.totalMinutes || 0) >= 600; },
      at:function(s){ return (s.totalMinutes || 0) / 60; }, need:10,
      note:function(s){ return Math.round((s.totalMinutes || 0) / 60) + ' hours so far'; },
      todo:function(s){ return Math.max(1, Math.ceil((600 - (s.totalMinutes || 0)) / 60)) + ' hours to go'; } },

    { id:'longhaul', icon:'trophy', metal:'gold', name:'Long haul',
      desc:'Ten sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 10; },
      at:function(s){ return s.mostWithOnePartner; }, need:10,
      todo:function(s){ return (10 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'early', icon:'seed', metal:'jade', name:'Early member',
      desc:'One of the first 25 people on PeerFlow',
      earned:function(s){ return s.joinRank <= 25; },
      note:function(s){ return 'Member number ' + s.joinRank; },
      todo:'Only the first 25 members' },

    { id:'sixweeks', icon:'weeks', metal:'jade', name:'Six weeks running',
      desc:'A session every week for six weeks',
      earned:function(s){ return (s.longestWeekStreak || 0) >= 6; },
      at:function(s){ return s.longestWeekStreak || 0; }, need:6,
      note:function(s){ return s.longestWeekStreak + ' weeks in a row'; },
      /* The chip under this one already says "4 of 6"; repeating it as
         "longest run so far: 4 weeks" was the tile talking to itself. What
         it can add is the rule the number does not carry. */
      todo:'Six weeks in a row, no gaps' },

    { id:'twentyfive', icon:'crown', metal:'jade', name:'Twenty-five sessions',
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

  /* One badge. The hexagon is kept — it is the shape people already know
     these by — but struck flat, with the ranking carried by depth of green
     rather than by pretending to be a different alloy.

     `pct`, on a locked badge that is really a count, draws the part of the
     rim you have already earned. A hexagon's perimeter is used as the dash
     length, which is why the outline is a <path> with a computed length
     rather than a <polygon>. */
  var uid = 0;
  var HEX = 'M36 5 63.4 20.5v31L36 67 8.6 51.5v-31Z';
  /* Perimeter of that path: four diagonals of 31.48 and two verticals of 31.
     Guessing it put the dash out by 7%, which drew the progress rim as a
     stray stub near the top vertex instead of tracing the shape. */
  var HEX_LEN = 187.92;

  function medal(iconKey, earned, metalKey, pct){
    var key = earned ? (MILESTONE[metalKey] ? 'milestone' : 'earned') : 'locked';
    var f = FACE[key];
    var n = ++uid;
    return '' +
      '<svg class="medal' + (earned ? ' on' : '') + '" viewBox="0 0 72 72" ' +
        'width="58" height="58" aria-hidden="true">' +
        '<defs><linearGradient id="bf' + n + '" x1="0" y1="0" x2=".3" y2="1">' +
          '<stop offset="0" stop-color="' + f[0] + '"/>' +
          '<stop offset="1" stop-color="' + f[1] + '"/>' +
        '</linearGradient></defs>' +
        '<path d="' + HEX + '" fill="url(#bf' + n + ')"/>' +
        /* How far round you are, on the ones that are a count. Drawn on the
           rim rather than as a bar under the tile, so the badge itself is
           the thing filling up. */
        (!earned && pct > 0
          /* No rotation: the path already starts at the top vertex and runs
             clockwise, which is where a fill should start and which way it
             should go. Rotating it moved the start to the left-hand corner. */
          ? '<path d="' + HEX + '" fill="none" stroke="#3FB78F" stroke-width="4" ' +
            'stroke-linejoin="round" stroke-linecap="butt" ' +
            'stroke-dasharray="' + (HEX_LEN * Math.min(1, pct)).toFixed(1) + ' ' + HEX_LEN + '"/>'
          : '') +
        '<g transform="translate(24 24)" fill="none" stroke="' + f[2] + '" ' +
          'stroke-width="2" stroke-linecap="round">' + (GLYPH[iconKey] || '') + '</g>' +
      '</svg>';
  }

  /* The four that were jade: the ones almost nobody has. */
  var MILESTONE = { jade: 1 };

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

      return { id:r.id, icon:r.icon, metal:r.metal, name:r.name,
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
        medal(b.icon, b.earned, b.metal, b.pct) +
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
