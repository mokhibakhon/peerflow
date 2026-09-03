/* Something to have on in the background, for one person at a time.
 *
 * THE ONE RULE: THIS NEVER ENTERS THE CALL
 *
 * Nothing here is published, and nothing here goes anywhere near the
 * microphone track. Rain is broadband noise, which is precisely what the far
 * side's echo cancellation and noise suppression exist to remove — mixed into
 * what we send, it would sound clean here and mangled there, and the person
 * hearing the damage would be the one person who could not turn it off.
 *
 * So it is local playback, out of this machine's speakers, chosen per person.
 * Both of you can have rain, or one of you, or neither, and neither choice is
 * visible to the other.
 *
 * WHY IT IS GENERATED AND NOT DOWNLOADED
 *
 * A convincing rain loop is megabytes, and nothing in assets/ is
 * content-hashed — vercel.json caches assets/ for only five minutes, and did
 * not cache them at all before that — so a file that big is a real download
 * on any load that falls outside the window. Filtered noise costs nothing,
 * never has to be fetched at all, and has no loop seam because the buffer is
 * crossfaded into itself.
 *
 * The limit is worth being honest about: noise-based synthesis does rain,
 * water and deep noise convincingly, because those really are broadband noise
 * with slow movement through them. It cannot do a forest or a cafe. Birdsong
 * is tonal and irregular, and a synthesised bird sounds like a ringtone —
 * worse than no bird. If those are ever wanted they need recordings, and that
 * is a different trade to make deliberately.
 */
(function(root){

  var KEY = 'pf_ambience';      /* the texture, remembered per person */
  var VOL = 'pf_ambience_vol';  /* and how loud they like it */

  var TEXTURES = ['rain', 'noise', 'ocean'];

  var ctx = null, out = null, node = null, current = null;

  function stored(k, fallback){
    try { var v = localStorage.getItem(k); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function remember(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }

  /* 0..100 from the slider, squared, because loudness is not linear and a
     linear slider spends its top half doing almost nothing. */
  function gainFor(pct){ return Math.pow(Math.max(0, Math.min(100, pct)) / 100, 2); }

  function noiseBuffer(seconds, brown){
    var n = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    /* A looping noise buffer clicks at the seam — once per loop, for as long
       as it plays — because the last sample and the first are unrelated.
       Crossfading the tail over the head removes the discontinuity. Without
       this the whole idea is unusable, and the symptom (a faint tick every
       four seconds) does not obviously point at its cause. */
    var f = Math.min(Math.floor(ctx.sampleRate * 0.05), Math.floor(n / 4));
    for (var j = 0; j < f; j++) {
      var k = j / f;
      d[n - f + j] = d[n - f + j] * (1 - k) + d[j] * k;
    }
    return buf;
  }

  function source(buf){
    var s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.start();
    return s;
  }

  /* A very slow oscillator, used to move a filter or a gain so the texture
     breathes. Static noise through a static filter is a hiss; the movement is
     the entire difference between that and weather. */
  function drift(rateHz, depth, target, centre){
    var lfo = ctx.createOscillator(), amt = ctx.createGain();
    lfo.frequency.value = rateHz;
    amt.gain.value = depth;
    lfo.connect(amt); amt.connect(target);
    if (centre !== undefined) target.value = centre;
    lfo.start();
    return lfo;
  }

  function build(kind){
    var g = ctx.createGain();

    if (kind === 'noise') {
      /* Brown noise: no features at all, which is the point. There is nothing
         to notice, so there is nothing to be distracted by. */
      source(noiseBuffer(4, true)).connect(g);
      g.gain.value = 0.9;
      return g;
    }

    if (kind === 'rain') {
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 380;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.6;
      source(noiseBuffer(4, false)).connect(hp); hp.connect(lp); lp.connect(g);
      g.gain.value = 0.55;
      drift(0.08, 220, lp.frequency, 1600);   /* gusts passing through */
      return g;
    }

    /* Ocean. The swell is the whole thing: a long rise and fall in both
       loudness and brightness, because a wave coming in is louder AND
       brighter, and going out is quieter AND duller. Two drifts at rates that
       do not divide into each other, so the pattern never audibly repeats. */
    var body = ctx.createBiquadFilter();
    body.type = 'lowpass'; body.Q.value = 0.4;
    var swell = ctx.createGain();
    source(noiseBuffer(5, false)).connect(body);
    body.connect(swell); swell.connect(g);
    g.gain.value = 1.15;
    drift(0.075, 620, body.frequency, 900);   /* ~13s: brightness of the wave */
    drift(0.062, 0.34, swell.gain, 0.52);     /* ~16s: its weight */
    return g;
  }

  function ensure(){
    if (ctx) return true;
    var C = root.AudioContext || root.webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    out = ctx.createGain();
    out.gain.value = gainFor(parseInt(stored(VOL, '35'), 10));
    out.connect(ctx.destination);
    return true;
  }

  function stop(){
    if (node) { try { node.disconnect(); } catch (e) {} node = null; }
    current = null;
    remember(KEY, 'off');
  }

  /* Returns what is playing now, so a caller can paint from the answer rather
     than assume the click worked — an AudioContext can refuse to start. */
  function play(kind){
    if (kind === 'off' || !kind) { stop(); return null; }
    if (TEXTURES.indexOf(kind) < 0) return current;
    if (!ensure()) return null;
    /* Browsers suspend a context created without a gesture; this is called
       from a click, so resuming here is the moment it is allowed. */
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    if (node) { try { node.disconnect(); } catch (e) {} node = null; }
    node = build(kind);
    node.connect(out);
    current = kind;
    remember(KEY, kind);
    return current;
  }

  function volume(pct){
    if (pct === undefined) return parseInt(stored(VOL, '35'), 10);
    remember(VOL, String(pct));
    if (out) out.gain.value = gainFor(pct);
    return pct;
  }

  /* What this person had on last time. Deliberately not started here: audio
     may not begin without a gesture, and a room that starts making noise the
     instant you join it would be worse than one that waits to be asked. */
  function preferred(){
    var v = stored(KEY, 'off');
    return TEXTURES.indexOf(v) >= 0 ? v : 'off';
  }

  function playing(){ return current; }

  /* Leaving the call should leave the sound behind with it. */
  function shutdown(){
    stop();
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; out = null; }
  }

  /* The node everything is mixed into, or null before anything has started.
     Exposed so the output can be measured rather than assumed: a Web Audio
     graph wired wrongly throws nothing and plays nothing, and "the button
     says it is on" is not evidence of a sound. dev/call-shots.js puts an
     analyser here. */
  function output(){ return out; }

  root.pfAmbience = { play: play, stop: stop, volume: volume,
                      preferred: preferred, playing: playing, output: output,
                      shutdown: shutdown, TEXTURES: TEXTURES };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.pfAmbience;
})(typeof window !== 'undefined' ? window : globalThis);
