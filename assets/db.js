/* PeerFlow data layer.
   Talks to Supabase when it's reachable; every function degrades gracefully
   so the site keeps working as an offline demo (file://, no network, or
   before the schema has been created). */
window.pf = (function(){
  var cfg = window.PF_SUPABASE || {};
  var client = null;
  try {
    if (cfg.enabled && cfg.url && cfg.key && window.supabase) {
      client = window.supabase.createClient(cfg.url, cfg.key);
    }
  } catch (err) { client = null; }

  function ready(){ return !!client; }

  /* ---------- auth ---------- */

  function signUpEmail(name, email, password){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name } }
    }).then(function(res){
      if (res.error) return { error: res.error.message };
      // With email confirmation enabled there is a user but no session yet.
      return { user: res.data.user, session: res.data.session,
               needsConfirm: !!res.data.user && !res.data.session };
    }).catch(function(){ return { demo: true }; });
  }

  function signInEmail(email, password){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.signInWithPassword({ email: email, password: password })
      .then(function(res){
        if (res.error) return { error: res.error.message };
        return { user: res.data.user, session: res.data.session };
      }).catch(function(){ return { demo: true }; });
  }

  function signInOAuth(provider, redirectPath){
    if (!client || !cfg.realOAuth) return Promise.resolve({ demo: true });
    var base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return client.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: base + (redirectPath || 'app.html') }
    }).then(function(res){
      return res.error ? { error: res.error.message } : { redirecting: true };
    }).catch(function(err){ return { error: (err && err.message) || 'Sign-in failed' }; });
  }

  /* Current signed-in user (after an OAuth redirect, the session is in the URL
     and supabase-js stores it automatically). Resolves null when signed out. */
  function currentUser(){
    if (!client) return Promise.resolve(null);
    return client.auth.getSession().then(function(res){
      var s = res.data && res.data.session;
      return s ? s.user : null;
    }).catch(function(){ return null; });
  }

  function signOut(){
    if (client) client.auth.signOut();
  }

  /* ---------- profile ---------- */

  /* The signed-in user's profile row, or null (signed out / no row yet). */
  function getProfile(){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var user = res.data && res.data.user;
      if (!user) return null;
      return client.from('profiles').select('*').eq('id', user.id).maybeSingle()
        .then(function(r){ return r.data || null; });
    }).catch(function(){ return null; });
  }

  function saveProfile(profile){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.getUser().then(function(res){
      var user = res.data && res.data.user;
      if (!user) return { demo: true };            // not signed in (e.g. awaiting email confirm)
      return client.from('profiles').upsert({
        id: user.id,
        name: profile.name || '',
        track_id: profile.track || null,
        level: profile.level || null,
        goal: profile.goal || null,
        timezone: profile.timezone || null,
        availability: profile.availability || []
      }).then(function(r){
        if (r.error) {
          try { console.error('PeerFlow saveProfile error:', r.error); } catch(e){}
          var msg = r.error.message || 'Unknown error';
          if (r.error.code === '42P01' || /relation .* does not exist/i.test(msg)) {
            msg = 'The database tables are not set up yet. Run supabase/schema.sql in the Supabase SQL Editor.';
          }
          return { error: msg };
        }
        return { saved: true };
      });
    }).catch(function(e){
      try { console.error('PeerFlow saveProfile exception:', e); } catch(err){}
      return { error: (e && e.message) || 'Network error while saving your profile.' };
    });
  }

  /* ---------- sessions ---------- */

  function fetchUpcomingSessions(limit){
    if (!client) return Promise.resolve(null);
    var since = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // include running ones
    return client.from('sessions')
      .select('id,title,track_id,kind,starts_at,duration_min,capacity,meet_url,session_members(user_id)')
      .gte('starts_at', since)
      .order('starts_at', { ascending: true })
      .limit(limit || 8)
      .then(function(res){
        if (res.error || !res.data || !res.data.length) return null;
        return res.data.map(function(s){
          return {
            id: s.id,
            title: s.title,
            track: s.track_id,
            kind: s.kind,
            startsAt: new Date(s.starts_at),
            capacity: s.capacity,
            taken: (s.session_members || []).length,
            meetUrl: s.meet_url || 'https://meet.google.com/new',
            live: new Date(s.starts_at) <= new Date()
          };
        });
      }).catch(function(){ return null; });
  }

  function joinSession(sessionId, goalText){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.getUser().then(function(res){
      var user = res.data && res.data.user;
      if (!user) return { demo: true };
      return client.from('session_members').upsert({
        session_id: sessionId,
        user_id: user.id,
        goal_text: goalText || ''
      }).then(function(r){
        return r.error ? { error: r.error.message } : { joined: true };
      });
    }).catch(function(){ return { demo: true }; });
  }

  /* ---------- board rendering (shared by app pages) ---------- */

  var trackNames = {
    frontend:'Frontend', backend:'Backend', cybersecurity:'Cybersecurity',
    data:'Data & Analytics', mobile:'Mobile', devops:'DevOps & Cloud',
    aiml:'AI & ML', design:'UX/UI Design'
  };

  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function renderBoard(el, sessions){
    el.innerHTML = sessions.map(function(s){
      var when = s.live ? 'now'
        : s.startsAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      var trackLabel = s.track ? (trackNames[s.track] || s.track) : 'All tracks';
      var kindLabel = s.kind === 'silent' ? '2 × 50 min' : 'collaborative';
      return '<div class="slot">' +
        '<span class="when">' + esc(when) + '</span>' +
        '<span class="what"><b>' + esc(s.title) + '</b><span>' + esc(trackLabel) + ' · ' + esc(kindLabel) + '</span></span>' +
        '<span class="seats">' + s.taken + '/' + s.capacity + ' seats</span>' +
        '<a class="btn primary" href="' + esc(s.meetUrl) + '" target="_blank" rel="noopener" data-session="' + esc(s.id) + '">Join</a>' +
        '</div>';
    }).join('');
    el.addEventListener('click', function(e){
      var a = e.target.closest('[data-session]');
      if (a) joinSession(a.getAttribute('data-session'), '');
    });
  }

  /* Replaces a board's demo content with live data when available. */
  function liveBoard(el, limit){
    if (!el) return;
    fetchUpcomingSessions(limit).then(function(sessions){
      if (sessions && sessions.length) renderBoard(el, sessions);
      /* null → keep the hardcoded demo board */
    });
  }

  return {
    ready: ready,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    signInOAuth: signInOAuth,
    currentUser: currentUser,
    getProfile: getProfile,
    signOut: signOut,
    saveProfile: saveProfile,
    fetchUpcomingSessions: fetchUpcomingSessions,
    joinSession: joinSession,
    liveBoard: liveBoard
  };
})();
