/* A stand-in for livekit-client, so the room can be driven on a machine that
 * can reach no media server.
 *
 * call.js reads window.LivekitClient at the moment it needs it rather than
 * capturing it at load, which is what makes this possible at all. The surface
 * it actually touches is small — a Room, nine RoomEvents, createLocalTracks,
 * and three methods — so this is the whole of it rather than a subset that
 * will surprise somebody later.
 *
 * Served in place of the CDN script by a Playwright route in
 * dev/call-shots.js. It is never referenced by call.html and never ships.
 */
(function(){
  function Emitter(){ this._h = {}; }
  Emitter.prototype.on = function(ev, fn){
    (this._h[ev] = this._h[ev] || []).push(fn); return this;
  };
  Emitter.prototype.emit = function(ev){
    var a = Array.prototype.slice.call(arguments, 1);
    (this._h[ev] || []).forEach(function(f){ try { f.apply(null, a); } catch (e) {} });
  };

  /* A canvas painting itself is a real MediaStreamTrack, so the tiles show
     moving video and the layout is exercised for real rather than against a
     black rectangle. */
  function fakeVideoTrack(label, hue){
    var c = document.createElement('canvas');
    c.width = 640; c.height = 400;
    var g = c.getContext('2d'), t = 0;
    (function paint(){
      t += 0.02;
      g.fillStyle = 'hsl(' + hue + ',22%,' + (16 + Math.sin(t) * 3) + '%)';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = 'hsla(' + hue + ',45%,62%,.9)';
      g.font = '600 26px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, c.width / 2, c.height / 2);
      requestAnimationFrame(paint);
    })();
    var stream = c.captureStream(24);
    return stream.getVideoTracks()[0];
  }

  function Track(kind, label, hue){
    this.kind = kind;
    this.mediaStreamTrack = kind === 'video'
      ? fakeVideoTrack(label, hue)
      : (function(){
          /* Silent, but a genuine audio track: the level meter reads from it
             and would otherwise throw. */
          var ac = new (window.AudioContext || window.webkitAudioContext)();
          var dst = ac.createMediaStreamDestination();
          var osc = ac.createOscillator();
          var g = ac.createGain(); g.gain.value = 0.0001;
          osc.connect(g); g.connect(dst); osc.start();
          return dst.stream.getAudioTracks()[0];
        })();
    this.isMuted = false;
  }
  Track.prototype.attach = function(){
    var el = document.createElement(this.kind === 'video' ? 'video' : 'audio');
    var ms = new MediaStream([this.mediaStreamTrack]);
    el.srcObject = ms; el.autoplay = true; el.playsInline = true;
    if (this.kind === 'video') el.muted = true;
    return el;
  };
  Track.prototype.detach = function(){ return []; };
  Track.prototype.stop = function(){ try { this.mediaStreamTrack.stop(); } catch (e) {} };
  Track.prototype.mute = function(){ this.isMuted = true; return Promise.resolve(); };
  Track.prototype.unmute = function(){ this.isMuted = false; return Promise.resolve(); };

  function Room(){
    Emitter.call(this);
    this.localParticipant = {
      publishTrack: function(){ return Promise.resolve(); },
      setScreenShareEnabled: function(){ return Promise.resolve(); }
    };
    this.state = 'disconnected';
  }
  Room.prototype = Object.create(Emitter.prototype);
  Room.prototype.connect = function(){
    var self = this;
    this.state = 'connected';
    /* The partner arrives a beat later, as one does, so the "waiting for…"
       state is passed through rather than skipped. */
    setTimeout(function(){
      if (!window.__pfNoPartner) {
        var p = { identity:'them', name:(window.__pfFarName || 'Amir Karimov') };
        self.emit('participantConnected', p);
        var vt = new Track('video', p.name, 168);
        setTimeout(function(){ self.emit('trackSubscribed', vt, { source:'camera' }, p); }, 200);
      }
    }, 400);
    return Promise.resolve();
  };
  Room.prototype.disconnect = function(){ this.state = 'disconnected'; this.emit('disconnected'); };

  window.LivekitClient = {
    Room: Room,
    RoomEvent: {
      Disconnected: 'disconnected',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted'
    },
    createLocalTracks: function(){
      return Promise.resolve([new Track('audio'), new Track('video', 'You', 220)]);
    }
  };
})();
