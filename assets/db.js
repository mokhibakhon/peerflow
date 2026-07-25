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

  /* Save the signed-in user's profile. Called from onboarding (track +
     availability) and later from the app's optional "improve my match" prompt
     (level, goal, detailed availability). Same columns either way. */
  function saveProfile(profile){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.getUser().then(function(res){
      var user = res.data && res.data.user;
      if (!user) return { demo: true };            // not signed in (e.g. awaiting email confirm)
      var row = { id: user.id };
      if ('name' in profile)         row.name = profile.name || '';
      if ('track' in profile)        row.track_id = profile.track || null;
      if ('topic' in profile)        row.topic = profile.topic || null;
      if ('level' in profile)        row.level = profile.level || null;
      if ('goal' in profile)         row.goal = profile.goal || null;
      if ('timezone' in profile)     row.timezone = profile.timezone || null;
      if ('availability' in profile) row.availability = profile.availability || [];
      return client.from('profiles').upsert(row).then(function(r){
        if (r.error) {
          try { console.error('PeerFlow saveProfile error:', r.error); } catch(e){}
          var msg = r.error.message || 'Unknown error';
          if (r.error.code === '42P01' || /relation .* does not exist/i.test(msg)) {
            msg = 'The database tables are not set up yet. Run supabase/schema.sql in the Supabase SQL Editor.';
          }
          var detail = [];
          if (r.error.code) detail.push('code: ' + r.error.code);
          if (r.error.details) detail.push('details: ' + r.error.details);
          if (r.error.hint) detail.push('hint: ' + r.error.hint);
          return { error: msg, detail: detail.join('  ·  ') };
        }
        return { saved: true };
      });
    }).catch(function(e){
      try { console.error('PeerFlow saveProfile exception:', e); } catch(err){}
      return { error: (e && e.message) || 'Network error while saving your profile.' };
    });
  }

  /* ---------- waitlist ---------- */

  /* Someone left their email on the home page. Writes one row to the waitlist
     table. Returns { saved:true } only when the write really happened, so the
     UI never tells anyone they're on the list when they aren't. */
  function joinWaitlist(email, interest){
    if (!client) return Promise.resolve({ demo: true });
    return client.from('waitlist').insert({
      email: email,
      interest: interest || null
    }).then(function(r){
      if (r.error) {
        try { console.error('PeerFlow joinWaitlist error:', r.error); } catch(e){}
        var msg = r.error.message || 'Something went wrong.';
        if (r.error.code === '42P01' || /relation .* does not exist/i.test(msg)) {
          msg = 'The waitlist table is not set up yet. Run supabase/schema.sql in the Supabase SQL Editor.';
        }
        return { error: msg };
      }
      return { saved: true };
    }).catch(function(e){
      return { error: (e && e.message) || 'Network error — please try again.' };
    });
  }

  /* ---------- match (set by hand for now) ---------- */

  /* The signed-in user's partner, or null if not matched yet. A row is created
     by hand in Supabase when two people are paired: each person gets one row
     pointing at the other, and both rows share the same room_url. */
  function getMatch(){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var uid = res.data && res.data.user && res.data.user.id;
      if (!uid) return null;
      return client.from('matches')
        .select('partner_name,partner_topic,partner_times,room_url')
        .eq('user_id', uid).maybeSingle()
        .then(function(r){ return r.data || null; });
    }).catch(function(){ return null; });
  }

  /* ---------- scheduled sessions ---------- */

  /* Every session booked for the signed-in user, soonest first. Rows are
     created when two partners agree a time; nothing is generated. */
  function fetchSessions(){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var uid = res.data && res.data.user && res.data.user.id;
      if (!uid) return null;
      return client.from('sessions')
        .select('id,partner_name,topic,starts_at,duration_min,room_url')
        .eq('user_id', uid)
        .order('starts_at', { ascending: true })
        .then(function(r){
          if (r.error) return null;
          return (r.data || []).map(function(s){
            return {
              id: s.id,
              partnerName: s.partner_name,
              topic: s.topic,
              startsAt: new Date(s.starts_at),
              durationMin: s.duration_min || 50,
              roomUrl: s.room_url
            };
          });
        });
    }).catch(function(){ return null; });
  }

  /* ---------- other learners (real rows only) ---------- */

  /* Everyone else who has signed up, newest first. Never invents anyone:
     an empty list means the site genuinely has no one else yet. */
  function fetchPeers(limit){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var uid = res.data && res.data.user && res.data.user.id;
      var q = client.from('profiles')
        .select('id,name,track_id,topic,level,timezone,created_at')
        .order('created_at', { ascending: false })
        .limit(limit || 24);
      if (uid) q = q.neq('id', uid);
      return q.then(function(r){ return r.error ? null : (r.data || []); });
    }).catch(function(){ return null; });
  }

  /* How many people have signed up, and how many share your topic. */
  function learnerStats(topic){
    if (!client) return Promise.resolve(null);
    var total = client.from('profiles').select('id', { count: 'exact', head: true });
    var same = topic
      ? client.from('profiles').select('id', { count: 'exact', head: true }).ilike('topic', topic)
      : Promise.resolve({ count: 0 });
    return Promise.all([total, same]).then(function(r){
      return { total: (r[0] && r[0].count) || 0, sameTopic: (r[1] && r[1].count) || 0 };
    }).catch(function(){ return null; });
  }

  /* ---------- track labels (for display in the app) ---------- */

  var trackNames = {
    frontend:'Frontend', backend:'Backend', cybersecurity:'Cybersecurity',
    data:'Data & Analytics', mobile:'Mobile', devops:'DevOps & Cloud',
    aiml:'AI & ML', design:'UX/UI Design'
  };

  return {
    ready: ready,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    signInOAuth: signInOAuth,
    currentUser: currentUser,
    getProfile: getProfile,
    signOut: signOut,
    saveProfile: saveProfile,
    joinWaitlist: joinWaitlist,
    getMatch: getMatch,
    fetchSessions: fetchSessions,
    fetchPeers: fetchPeers,
    learnerStats: learnerStats,
    trackNames: trackNames
  };
})();
