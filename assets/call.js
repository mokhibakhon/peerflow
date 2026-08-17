/* PeerFlow — the room.

   Four things happen here, in order, and each one can fail in a way somebody
   needs a sentence about:

     1. ask the server whether you may join this session   (pf.callToken)
     2. get hold of a camera and a microphone               (the lobby)
     3. connect to the room and publish them                (LiveKit)
     4. leave

   Nothing in this file decides who is allowed in. Step one is the whole of
   that decision and it happens in Postgres — see session_for_call() in
   supabase/migration-video.sql. What this file owns is what a person sees at
   each step, which is a different job and the reason the refusals get real
   sentences rather than a status code.

   The LiveKit SDK is read off window at the moment it is needed rather than
   captured at load. That is what lets the whole state machine be driven
   against a stub in the tests, on a machine that can reach no media server
   at all. */
(function(){
  var $ = function(id){ return document.getElementById(id); };

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* ---------- icons ----------
     Drawn rather than typed. An emoji microphone is a different picture on
     every operating system and two of them are a wedge of cheese. */
  var IC = {
    mic:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
          '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/>' +
          '<path d="M12 17.5V21"/></svg>',
    micOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
          '<path d="M15 4.8A3 3 0 0 0 9 5.5v5"/><path d="M9 13.4a3 3 0 0 0 5.2-.9"/>' +
          '<path d="M5.5 11a6.5 6.5 0 0 0 9.9 5.6M18.5 11v.6"/><path d="M12 17.5V21"/>' +
          '<path d="M3.5 3.5l17 17"/></svg>',
    cam:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round">' +
          '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 11l6-3.5v9l-6-3.5z"/></svg>',
    camOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">' +
          '<path d="M15.5 13.5V16a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1.4"/>' +
          '<path d="M10.5 6h3a2 2 0 0 1 2 2v1.2l6-3.2v9"/><path d="M3.5 3.5l17 17"/></svg>',
    share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">' +
          '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' +
          '<path d="M12 13.5v-6M9.4 10.1L12 7.5l2.6 2.6"/></svg>'
  };

  /* ---------- the five screens ---------- */
  var SCREENS = ['st-load', 'st-no', 'st-lobby', 'st-live', 'st-done'];
  function show(id){
    SCREENS.forEach(function(s){ var el = $(s); if (el) el.hidden = (s !== id); });
  }

  /* ---------- state ---------- */
  var pass    = null;   /* what the server said: token, url, room, the facts */
  var room    = null;   /* the LiveKit Room, once connected */
  var local   = { audio:null, video:null };  /* our own tracks, made in the lobby */
  var want    = { mic:true, cam:true };
  var sharing = false;
  var farName = 'Your partner';
  var clockT  = null;
  var meterT  = null;
  var flashT  = null;
  var left    = false;  /* we chose to leave, so a disconnect is not a failure */

  function sessionId(){
    var m = /[?&]s=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ---------- refusals ----------
     Every one of these is a real state somebody can be in, and each says the
     one thing they can do next. "Forbidden" is not a sentence. */
  function refuse(res){
    var k = 'Not now', h = 'This room is not open', s = '', a = '';
    var back = '<a class="btn" href="app.html">Back to today</a>';
    var when = res.startsAt ? new Date(res.startsAt) : null;
    var mins = when ? Math.round((when.getTime() - Date.now()) / 60000) : 0;

    if (res.reason === 'too-early') {
      k = 'Not yet';
      h = 'The room opens fifteen minutes before you start';
      s = when
        ? 'Your session is at ' + when.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' }) +
          (mins > 90 ? ' on ' + when.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' })
                     : ', so come back in about ' + (mins > 75 ? Math.round(mins/60) + ' hours'
                                                               : Math.max(1, mins - 15) + ' minutes') + '.')
        : 'Come back closer to the time.';
      /* The one refusal worth waiting on rather than leaving: if the room
         opens within a few minutes, the page lets you in when it does. */
      if (mins > 15 && mins < 25) {
        a = back;
        setTimeout(start, (mins - 15) * 60000 + 2000);
      } else {
        a = back;
      }
    } else if (res.reason === 'too-late') {
      k = 'Closed';
      h = 'This session is over';
      s = 'The room shuts twenty minutes after a session ends. If you both want longer, book another — it takes a few seconds.';
      a = back + '<a class="ghost" href="app.html">Book another</a>';
    } else if (res.reason === 'proposed') {
      k = 'Not agreed yet';
      h = 'Nobody has said yes to this time';
      s = 'A proposal is not a booking. Once the other person accepts, the room opens fifteen minutes before you start.';
      a = back;
    } else if (res.reason === 'cancelled' || res.reason === 'declined') {
      k = 'Called off';
      h = 'This session was cancelled';
      s = 'There is no room for a session that is not happening. Booking another takes a few seconds.';
      a = back;
    } else if (res.reason === 'not-partners') {
      k = 'Not available';
      h = 'You and this person are no longer partners';
      s = 'Sessions you booked together are closed along with the partnership. Nothing you booked with anybody else is affected.';
      a = back;
    } else if (res.reason === 'no-room') {
      k = 'Older booking';
      h = 'This one was booked before PeerFlow had its own room';
      s = 'Use the link you were given when you booked it. Everything booked from now on happens here.';
      a = back;
    } else if (res.reason === 'unknown') {
      k = 'Not found';
      h = 'We cannot find that session';
      s = 'The link may be old, or it may belong to somebody else’s calendar.';
      a = back;
    } else if (res.reason === 'signed-out') {
      k = 'Signed out';
      h = 'Log in to join your session';
      s = 'You will come straight back here.';
      a = '<a class="btn" href="login.html?next=' +
          encodeURIComponent('call.html' + location.search) + '">Log in</a>';
    } else if (res.reason === 'not-deployed' || res.reason === 'not-configured') {
      k = 'Not switched on';
      h = 'Calls are not set up on this site yet';
      s = 'The room needs its LiveKit keys before anybody can join. Nothing is wrong with your session — see docs/VIDEO.md.';
      a = back;
    } else if (res.reason === 'offline') {
      k = 'No connection';
      h = 'We could not reach PeerFlow';
      s = 'Check your connection and try again.';
      a = '<button class="btn" type="button" id="no-retry">Try again</button>' + back;
    } else {
      k = 'Something went wrong';
      h = 'We could not open the room';
      s = 'This is our end, not yours. Trying again usually works.';
      a = '<button class="btn" type="button" id="no-retry">Try again</button>' + back;
    }

    $('no-k').textContent = k;
    $('no-h').textContent = h;
    $('no-s').textContent = s;
    $('no-a').innerHTML = a;
    var retry = $('no-retry');
    if (retry) retry.addEventListener('click', function(){ show('st-load'); start(); });
    show('st-no');
  }

  /* ---------- the lobby ---------- */

  function icon(el, svg){ if (el) el.innerHTML = svg; }

  function paintLobbyToggles(){
    var m = $('lb-mic'), c = $('lb-cam');
    m.classList.toggle('on', want.mic);
    m.setAttribute('aria-pressed', String(want.mic));
    $('lb-mic-l').textContent = want.mic ? 'Mic on' : 'Mic off';
    icon($('lb-mic-ic'), want.mic ? IC.mic : IC.micOff);

    c.classList.toggle('on', want.cam);
    c.setAttribute('aria-pressed', String(want.cam));
    $('lb-cam-l').textContent = want.cam ? 'Camera on' : 'Camera off';
    icon($('lb-cam-ic'), want.cam ? IC.cam : IC.camOff);

    $('lb-off').hidden = want.cam;
  }

  function lobbyError(msg){
    $('lb-err').textContent = msg;
    $('lb-err').hidden = !msg;
  }

  /* Camera and microphone, asked for once, in the lobby, and carried into
     the call. Asking again at connect time would prompt twice and would
     leave the lobby preview holding the camera while the call wants it. */
  function openDevices(){
    var LK = window.LivekitClient;
    return LK.createLocalTracks({ audio:true, video:true }).then(function(tracks){
      tracks.forEach(function(t){
        if (t.kind === 'audio') local.audio = t;
        if (t.kind === 'video') local.video = t;
      });
      if (local.video) local.video.attach($('lb-v'));
      startMeter();
      listDevices();
      lobbyError('');
    }).catch(function(e){
      /* A refused camera is not a broken page. The call still works with a
         microphone alone, and plenty of people prefer it. */
      var name = (e && e.name) || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        lobbyError('Your browser is blocking the camera and microphone. Allow them in the address bar, then reload — or join with both off and turn them on later.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        lobbyError('We could not find a camera or a microphone. You can still join and listen.');
      } else {
        lobbyError('We could not start your camera. You can still join — the others will hear you if your microphone works.');
      }
      want.mic = !!local.audio;
      want.cam = !!local.video;
      paintLobbyToggles();
    });
  }

  /* A bar that moves, so nobody joins a call to discover the wrong
     microphone was selected. Read from the raw track — LiveKit hands us a
     MediaStreamTrack we can wrap in an analyser. */
  function startMeter(){
    stopMeter();
    if (!local.audio || !window.AudioContext) return;
    try {
      var ctx = new AudioContext();
      var src = ctx.createMediaStreamSource(new MediaStream([local.audio.mediaStreamTrack]));
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      var buf = new Uint8Array(an.frequencyBinCount);
      meterT = setInterval(function(){
        an.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        var pct = want.mic ? Math.min(100, Math.round((peak / 90) * 100)) : 0;
        $('lb-level').style.width = pct + '%';
      }, 100);
      meterT = { t: meterT, ctx: ctx };
    } catch (e) { /* no meter, no matter */ }
  }
  function stopMeter(){
    if (!meterT) return;
    try { clearInterval(meterT.t); meterT.ctx.close(); } catch(e){}
    meterT = null;
  }

  /* Device pickers only appear when there is a choice to make. One camera
     and one microphone is the common case and a select with a single option
     is furniture. */
  function listDevices(){
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function(all){
      var cams = all.filter(function(d){ return d.kind === 'videoinput'; });
      var mics = all.filter(function(d){ return d.kind === 'audioinput'; });
      if (cams.length < 2 && mics.length < 2) return;

      function fill(sel, list, label){
        sel.innerHTML = list.map(function(d, i){
          return '<option value="' + esc(d.deviceId) + '">' +
                 esc(d.label || (label + ' ' + (i + 1))) + '</option>';
        }).join('');
      }
      fill($('lb-cams'), cams, 'Camera');
      fill($('lb-mics'), mics, 'Microphone');
      $('lb-dev').hidden = false;

      $('lb-cams').addEventListener('change', function(){
        if (local.video) local.video.restartTrack({ deviceId: this.value })
          .then(function(){ local.video.attach($('lb-v')); }).catch(function(){});
      });
      $('lb-mics').addEventListener('change', function(){
        if (local.audio) local.audio.restartTrack({ deviceId: this.value })
          .then(startMeter).catch(function(){});
      });
    }).catch(function(){});
  }

  function lobby(){
    var who = pass.partner ? String(pass.partner).split(' ')[0] : '';
    $('lb-h').textContent = who ? 'Your session with ' + who : 'Your session';

    var starts = pass.startsAt ? new Date(pass.startsAt) : null;
    var bits = [];
    if (starts) {
      var late = Date.now() - starts.getTime();
      bits.push(late > 60000
        ? 'Started ' + Math.round(late / 60000) + ' minutes ago'
        : 'Starts at ' + starts.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' }));
    }
    if (pass.topic) bits.push(pass.topic);
    $('lb-s').textContent = bits.join(' · ');

    if (pass.goal) {
      $('lb-goal').innerHTML = '<b>What you said you’d do:</b> ' + esc(pass.goal);
      $('lb-goal').hidden = false;
    }

    paintLobbyToggles();
    show('st-lobby');
    openDevices();
  }

  /* ---------- the call ---------- */

  function paintControls(){
    function set(btn, on, ic){
      btn.classList.toggle('on', on);
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', String(on));
      icon($(btn.id + '-ic'), ic);
    }
    set($('c-mic'), want.mic, want.mic ? IC.mic : IC.micOff);
    set($('c-cam'), want.cam, want.cam ? IC.cam : IC.camOff);
    $('c-share').classList.toggle('on', sharing);
    $('c-share').classList.remove('off');
    $('c-share').setAttribute('aria-pressed', String(sharing));
    icon($('c-share-ic'), IC.share);
    $('me-off').hidden = want.cam;
  }

  function flash(msg){
    var el = $('rm-flash');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(flashT);
    flashT = setTimeout(function(){ el.hidden = true; }, 4200);
  }

  /* How long is left, from the booking rather than from when you joined —
     the session ends when it was always going to end. */
  function startClock(){
    stopClock();
    if (!pass.startsAt) return;
    var starts = new Date(pass.startsAt).getTime();
    function tick(){
      var mins = Math.round((Date.now() - starts) / 60000);
      var el = $('bar-clock');
      el.textContent = mins < 0 ? 'starts in ' + (-mins) + ' min'
                     : mins === 0 ? 'just started'
                     : mins + ' min in';
      /* The end of the booking, not the end of the token: the twenty extra
         minutes exist so a call is not cut off, not so it can be planned
         around. */
      var ends = pass.endsAt ? new Date(pass.endsAt).getTime() - 20 * 60000 : 0;
      el.classList.toggle('soon', !!ends && ends - Date.now() < 5 * 60000);
    }
    tick();
    clockT = setInterval(tick, 20000);
  }
  function stopClock(){ if (clockT) clearInterval(clockT); clockT = null; }

  function attachFar(track, participant){
    if (track.kind === 'video') {
      track.attach($('far-v'));
      $('far-wait').hidden = true;
      $('far-off').hidden = true;
      $('far-v').hidden = false;
      $('stage').classList.toggle('sharing', track.source === 'screen_share');
    } else if (track.kind === 'audio') {
      /* Audio has to be in the document to play at all; it is never seen. */
      var el = track.attach();
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    if (participant) {
      farName = participant.name || participant.identity || farName;
      $('far-n').textContent = farName;
      $('far-n').hidden = false;
    }
  }

  function farGone(msg){
    $('far-v').hidden = true;
    $('far-n').hidden = true;
    $('far-off').hidden = true;
    $('far-wait').hidden = false;
    $('far-who').textContent = pass.partner ? String(pass.partner).split(' ')[0] : 'your partner';
    $('stage').classList.remove('sharing');
    if (msg) flash(msg);
  }

  function join(){
    var LK = window.LivekitClient;
    var btn = $('lb-join');
    btn.disabled = true;
    btn.textContent = 'Joining…';

    room = new LK.Room({ adaptiveStream:true, dynacast:true });

    room.on(LK.RoomEvent.TrackSubscribed, function(track, pub, participant){
      attachFar(track, participant);
    });
    room.on(LK.RoomEvent.TrackUnsubscribed, function(track){
      try { track.detach().forEach(function(el){ el.remove(); }); } catch(e){}
      if (track.kind === 'video') {
        if (track.source === 'screen_share') {
          $('stage').classList.remove('sharing');
          flash(farName.split(' ')[0] + ' stopped sharing');
        } else {
          $('far-v').hidden = true;
          $('far-off').hidden = false;
        }
      }
    });
    room.on(LK.RoomEvent.ParticipantConnected, function(p){
      farName = p.name || farName;
      flash((farName.split(' ')[0] || 'Your partner') + ' joined');
    });
    room.on(LK.RoomEvent.ParticipantDisconnected, function(p){
      farGone((((p && p.name) || farName).split(' ')[0] || 'Your partner') + ' left the call');
    });
    room.on(LK.RoomEvent.Disconnected, function(){
      if (!left) done('You were disconnected', 'The connection dropped. If the session is still on, you can go straight back in.');
    });

    room.connect(pass.url, pass.token).then(function(){
      var pubs = [];
      if (local.audio) pubs.push(room.localParticipant.publishTrack(local.audio));
      if (local.video) pubs.push(room.localParticipant.publishTrack(local.video));
      return Promise.all(pubs);
    }).then(function(){
      if (local.video) local.video.attach($('me-v'));
      /* The toggles chosen in the lobby are wishes until now. */
      if (local.audio && !want.mic) local.audio.mute();
      if (local.video && !want.cam) local.video.mute();

      stopMeter();
      $('far-who').textContent = pass.partner ? String(pass.partner).split(' ')[0] : 'your partner';
      if (pass.goal) {
        $('bar-goal').innerHTML = '<b>Goal:</b> ' + esc(pass.goal);
        $('bar-goal').hidden = false;
      }
      paintControls();
      startClock();
      show('st-live');
    }).catch(function(e){
      try { console.error('PeerFlow: could not join the room', e); } catch(err){}
      btn.disabled = false;
      btn.textContent = 'Join the call';
      lobbyError('We could not connect to the room. Check your connection and try again — if it keeps failing, a network that blocks video calls is the usual cause.');
    });
  }

  function done(h, s){
    stopClock();
    stopMeter();
    $('done-h').textContent = h || 'You’ve left the call';
    $('done-s').textContent = s || '';
    /* Rejoining is only offered while the booking is still open, so the
       button never leads straight back to a refusal. */
    var open = pass && pass.endsAt && Date.now() < new Date(pass.endsAt).getTime();
    $('done-again').hidden = !open;
    show('st-done');
  }

  function leave(){
    left = true;
    if (room) { try { room.disconnect(); } catch(e){} }
    [local.audio, local.video].forEach(function(t){ if (t) { try { t.stop(); } catch(e){} } });
    local = { audio:null, video:null };
    /* Nothing underneath unless there is a goal to mention. Attendance is
       recorded either way and saying so was telling somebody about the
       plumbing at the one moment they have stopped caring about it. */
    done('You’ve left the call', pass && pass.goal
      ? 'Today will ask whether you got it done.'
      : '');
  }

  /* ---------- wiring ---------- */

  $('lb-mic').addEventListener('click', function(){
    want.mic = !want.mic;
    if (local.audio) { want.mic ? local.audio.unmute() : local.audio.mute(); }
    paintLobbyToggles();
  });
  $('lb-cam').addEventListener('click', function(){
    want.cam = !want.cam;
    if (local.video) { want.cam ? local.video.unmute() : local.video.mute(); }
    paintLobbyToggles();
  });
  $('lb-join').addEventListener('click', join);

  $('c-mic').addEventListener('click', function(){
    want.mic = !want.mic;
    if (local.audio) { want.mic ? local.audio.unmute() : local.audio.mute(); }
    paintControls();
  });
  $('c-cam').addEventListener('click', function(){
    want.cam = !want.cam;
    if (local.video) { want.cam ? local.video.unmute() : local.video.mute(); }
    paintControls();
  });
  $('c-share').addEventListener('click', function(){
    if (!room) return;
    var next = !sharing;
    room.localParticipant.setScreenShareEnabled(next).then(function(){
      sharing = next;
      paintControls();
    }).catch(function(){
      /* Cancelling the browser's own picker lands here, and is not an error
         worth a message. */
      sharing = false;
      paintControls();
    });
  });
  $('c-leave').addEventListener('click', leave);

  $('done-back').addEventListener('click', function(){ location.href = 'app.html'; });
  $('done-again').addEventListener('click', function(){
    left = false; room = null;
    show('st-load');
    start();
  });

  /* Closing the tab is leaving. Without this the partner watches a frozen
     tile until LiveKit times the connection out. */
  window.addEventListener('pagehide', function(){
    if (room) { try { room.disconnect(); } catch(e){} }
  });

  /* ---------- go ---------- */
  function start(){
    var id = sessionId();
    if (!id) { refuse({ reason:'unknown' }); return; }
    if (!window.LivekitClient) {
      refuse({ reason:'not-configured' });
      try { console.error('PeerFlow: the LiveKit client script did not load.'); } catch(e){}
      return;
    }
    if (!window.pf || !pf.callToken) { refuse({ reason:'offline' }); return; }

    pf.callToken(id).then(function(res){
      if (!res || !res.ok) { refuse(res || {}); return; }
      pass = res;
      lobby();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
