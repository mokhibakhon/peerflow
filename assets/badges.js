/* PeerFlow badges.

   Every badge is derived from rows that already exist — finished sessions,
   partners who actually accepted, signup order, profile fields. Nothing is
   awarded for an intention, and a locked badge says exactly what is still
   missing rather than teasing.

   Each is drawn as a struck metal medal: a rimmed hexagon, a gradient face,
   a sheen across the top-left, and a white glyph. Difficulty is carried by
   the metal — bronze, silver, gold, then jade for the rare ones — so the
   wall reads as a ranking rather than a row of coloured stickers. */
window.pfBadges = (function(){

  /* Four metals: [face top, face bottom, rim, sheen strength]. Jade is the
     brand green, so the top tier belongs to PeerFlow rather than looking
     like it came out of a stock icon pack. */
  var METAL = {
    bronze: ['#F2CBA0', '#B4692F', '#7C4318', .55],
    /* Silver has to be darker and cooler than it wants to be, or it lands
       within a few percent of the locked grey and the tier disappears. */
    silver: ['#FDFEFF', '#8C9BAC', '#5A6672', .62],
    gold:   ['#FDEDAE', '#DDA31A', '#96690A', .65],
    jade:   ['#DCF7EC', '#1D9E75', '#075040', .60],
    locked: ['#F4F4F8', '#DFDFE6', '#CFCFD8', .22]
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
      todo:function(s){ return (5 - s.pastSessions) + ' more to go'; } },

    { id:'two', icon:'users', metal:'silver', name:'Two partners',
      desc:'Learned with two different people',
      earned:function(s){ return s.partners >= 2; },
      todo:'Partner with a second person' },

    { id:'steady', icon:'anchor', metal:'silver', name:'Steady pair',
      desc:'Three sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 3; },
      todo:function(s){ return (3 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'ten', icon:'flame', metal:'gold', name:'Ten sessions',
      desc:'Finished ten sessions',
      earned:function(s){ return s.pastSessions >= 10; },
      todo:function(s){ return (10 - s.pastSessions) + ' more to go'; } },

    { id:'tenhours', icon:'clock', metal:'gold', name:'Ten hours',
      desc:'Ten hours sat with a partner',
      earned:function(s){ return (s.totalMinutes || 0) >= 600; },
      note:function(s){ return Math.round((s.totalMinutes || 0) / 60) + ' hours so far'; },
      todo:function(s){ return Math.max(1, Math.ceil((600 - (s.totalMinutes || 0)) / 60)) + ' hours to go'; } },

    { id:'longhaul', icon:'trophy', metal:'gold', name:'Long haul',
      desc:'Ten sessions with the same partner',
      earned:function(s){ return s.mostWithOnePartner >= 10; },
      todo:function(s){ return (10 - s.mostWithOnePartner) + ' more with one person'; } },

    { id:'early', icon:'seed', metal:'jade', name:'Early member',
      desc:'One of the first 25 people on PeerFlow',
      earned:function(s){ return s.joinRank <= 25; },
      note:function(s){ return 'Member number ' + s.joinRank; },
      todo:'Only the first 25 members' },

    { id:'sixweeks', icon:'weeks', metal:'jade', name:'Six weeks running',
      desc:'A session every week for six weeks',
      earned:function(s){ return (s.longestWeekStreak || 0) >= 6; },
      note:function(s){ return s.longestWeekStreak + ' weeks in a row'; },
      todo:function(s){ var w = s.longestWeekStreak || 0;
                        return 'Longest run so far: ' + w + (w === 1 ? ' week' : ' weeks'); } },

    { id:'twentyfive', icon:'crown', metal:'jade', name:'Twenty-five sessions',
      desc:'Finished twenty-five sessions',
      earned:function(s){ return s.pastSessions >= 25; },
      todo:function(s){ return (25 - s.pastSessions) + ' more to go'; } }
  ];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* One medal. Locked badges are struck from the same die in grey with the
     shine turned down, so they still read as an award you haven't got —
     not as a broken image. */
  var uid = 0;
  function medal(iconKey, earned, metalKey){
    var m = METAL[earned ? (metalKey || 'bronze') : 'locked'];
    var n = ++uid;
    var HEX = 'M36 4.6 63.2 20.3v31.4L36 67.4 8.8 51.7V20.3Z';
    var inset = ' transform="translate(36 36) scale(.9) translate(-36 -36)"';
    return '' +
      '<svg class="medal" viewBox="0 0 72 72" width="60" height="60" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="mf' + n + '" x1="0" y1="0" x2=".35" y2="1">' +
            '<stop offset="0" stop-color="' + m[0] + '"/>' +
            '<stop offset="1" stop-color="' + m[1] + '"/>' +
          '</linearGradient>' +
          '<radialGradient id="ms' + n + '" cx=".3" cy=".22" r=".75">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="' + m[3] + '"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
          '</radialGradient>' +
        '</defs>' +
        /* Rim, drawn as a thick stroke on the same path so the corners round. */
        '<path d="' + HEX + '" fill="' + m[2] + '" stroke="' + m[2] +
          '" stroke-width="6" stroke-linejoin="round"/>' +
        /* Face, inset inside the rim. */
        '<path d="' + HEX + '" fill="url(#mf' + n + ')" stroke="url(#mf' + n +
          ')" stroke-width="1.5" stroke-linejoin="round"' + inset + '/>' +
        '<path d="' + HEX + '" fill="url(#ms' + n + ')"' + inset + '/>' +
        /* Hairline of light along the top-right edge — the bit that sells metal. */
        '<path d="M36 9.6 58.6 22.6" fill="none" stroke="#fff" stroke-opacity="' +
          (earned ? '.5' : '.3') + '" stroke-width="2" stroke-linecap="round"/>' +
        '<g transform="translate(24 24)" fill="none" stroke="#fff" stroke-width="2" ' +
          'stroke-opacity="' + (earned ? '.97' : '.8') + '">' + (GLYPH[iconKey] || '') + '</g>' +
      '</svg>';
  }

  function evaluate(stats){
    return RULES.map(function(r){
      var got = false;
      try { got = !!r.earned(stats); } catch(e){ got = false; }
      var sub;
      if (got) sub = typeof r.note === 'function' ? r.note(stats) : r.desc;
      else     sub = typeof r.todo === 'function' ? r.todo(stats) : (r.todo || r.desc);
      return { id:r.id, icon:r.icon, metal:r.metal, name:r.name,
               desc:r.desc, earned:got, sub:sub };
    });
  }

  function render(el, stats){
    if (!el) return;
    if (!stats) {
      el.innerHTML = '<p class="badge-empty">Sign in to see your badges.</p>';
      return;
    }
    var list = evaluate(stats);
    var earned = list.filter(function(b){ return b.earned; }).length;
    el.innerHTML =
      '<p class="badge-count"><b>' + earned + '</b> of ' + list.length + ' earned</p>' +
      '<div class="badge-grid">' +
      list.map(function(b){
        return '<div class="badge-tile' + (b.earned ? ' earned' : '') +
                 '" title="' + esc(b.desc) + '">' +
          medal(b.icon, b.earned, b.metal) +
          '<b>' + esc(b.name) + '</b>' +
          '<span>' + esc(b.sub) + '</span>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  return { evaluate: evaluate, render: render, medal: medal };
})();
