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
      /* Supabase expects the provider id in lower case ("google", not "Google");
         callers pass a display name for use in error messages. */
      provider: String(provider).toLowerCase(),
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

  /* Change the signed-in user's password. Supabase requires a live session,
     so this only works while logged in. */
  function changePassword(newPassword){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.updateUser({ password: newPassword }).then(function(r){
      if (r.error) return { error: r.error.message };
      return { saved: true };
    }).catch(function(e){ return { error: (e && e.message) || 'Could not change your password.' }; });
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

  /* ---------- partner requests ---------- */

  /* Ask someone to be your learning partner. */
  function sendPartnerRequest(toUserId, message){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.getUser().then(function(res){
      var uid = res.data && res.data.user && res.data.user.id;
      if (!uid) return { demo: true };
      if (uid === toUserId) return { error: 'You can’t send a request to yourself.' };
      return client.from('partner_requests')
        .insert({ from_user: uid, to_user: toUserId, message: message || null })
        .then(function(r){
          if (r.error) {
            if (r.error.code === '23505') return { error: 'You’ve already sent them a request.' };
            return { error: r.error.message || 'Could not send the request.' };
          }
          return { sent: true };
        });
    }).catch(function(e){ return { error: (e && e.message) || 'Network error.' }; });
  }

  /* Every request involving the signed-in user, with the other person's
     profile attached. Returns { incoming: [], outgoing: [], me: uid }. */
  function myRequests(){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var uid = res.data && res.data.user && res.data.user.id;
      if (!uid) return null;
      return client.from('partner_requests')
        .select('id,from_user,to_user,message,status,to_seen_at,from_seen_at,created_at')
        .or('from_user.eq.' + uid + ',to_user.eq.' + uid)
        .order('created_at', { ascending: false })
        .then(function(r){
          if (r.error) return null;
          var rows = r.data || [];
          var others = rows.map(function(x){ return x.from_user === uid ? x.to_user : x.from_user; });
          if (!others.length) return { incoming: [], outgoing: [], me: uid };
          return client.from('profiles')
            .select('id,name,track_id,topic,level,timezone')
            .in('id', others)
            .then(function(p){
              var byId = {};
              (p.data || []).forEach(function(x){ byId[x.id] = x; });
              var incoming = [], outgoing = [];
              rows.forEach(function(x){
                var otherId = x.from_user === uid ? x.to_user : x.from_user;
                x.other = byId[otherId] || { id: otherId, name: 'Someone' };
                (x.to_user === uid ? incoming : outgoing).push(x);
              });
              return { incoming: incoming, outgoing: outgoing, me: uid };
            });
        });
    }).catch(function(){ return null; });
  }

  /* Accept or decline a request sent to you. */
  function respondToRequest(id, status){
    if (!client) return Promise.resolve({ demo: true });
    return client.from('partner_requests')
      .update({ status: status, to_seen_at: new Date().toISOString() })
      .eq('id', id)
      .then(function(r){
        return r.error ? { error: r.error.message } : { saved: true };
      }).catch(function(e){ return { error: (e && e.message) || 'Network error.' }; });
  }

  /* Mark notifications read: incoming requests you've looked at, and answers
     to your own requests you've now seen. */
  function markRequestsSeen(incomingIds, outgoingIds){
    if (!client) return Promise.resolve({ demo: true });
    var now = new Date().toISOString(), jobs = [];
    if (incomingIds && incomingIds.length) {
      jobs.push(client.from('partner_requests').update({ to_seen_at: now }).in('id', incomingIds));
    }
    if (outgoingIds && outgoingIds.length) {
      jobs.push(client.from('partner_requests').update({ from_seen_at: now }).in('id', outgoingIds));
    }
    if (!jobs.length) return Promise.resolve({ saved: true });
    return Promise.all(jobs).then(function(){ return { saved: true }; })
      .catch(function(){ return { error: 'Could not update.' }; });
  }

  /* People you're actually partnered with: any accepted request, either way. */
  function acceptedPartners(){
    return myRequests().then(function(r){
      if (!r) return null;
      return r.incoming.concat(r.outgoing)
        .filter(function(x){ return x.status === 'accepted'; })
        .map(function(x){
          return {
            requestId: x.id,
            profile: x.other,
            roomUrl: 'https://meet.jit.si/PeerFlow-' + x.id
          };
        });
    });
  }

  /* ---------- badge inputs ---------- */

  /* Everything the badge rules need, all counted from real rows: finished
     sessions, partners you actually agreed with, and where you came in the
     signup order. Returns null when signed out or unreachable. */
  function badgeStats(){
    if (!client) return Promise.resolve(null);
    return getProfile().then(function(profile){
      if (!profile) return null;
      var rank = client.from('profiles')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', profile.created_at);
      return Promise.all([fetchSessions(), acceptedPartners(), rank]).then(function(r){
        var sessions = r[0] || [];
        var partners = r[1] || [];
        var earlier  = (r[2] && r[2].count) || 0;
        var now = Date.now();

        var past = sessions.filter(function(s){
          return s.startsAt.getTime() + s.durationMin * 60000 <= now;
        });

        /* How many finished sessions with the single most frequent partner. */
        var byPartner = {}, mostWithOne = 0;
        past.forEach(function(s){
          var k = (s.partnerName || '').trim().toLowerCase();
          if (!k) return;
          byPartner[k] = (byPartner[k] || 0) + 1;
          if (byPartner[k] > mostWithOne) mostWithOne = byPartner[k];
        });

        return {
          pastSessions: past.length,
          partners: partners.length,
          mostWithOnePartner: mostWithOne,
          profileComplete: !!(profile.name && profile.topic && profile.level &&
                              (profile.availability || []).length),
          joinRank: earlier + 1
        };
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
    changePassword: changePassword,
    saveProfile: saveProfile,
    joinWaitlist: joinWaitlist,
    getMatch: getMatch,
    fetchSessions: fetchSessions,
    sendPartnerRequest: sendPartnerRequest,
    myRequests: myRequests,
    respondToRequest: respondToRequest,
    markRequestsSeen: markRequestsSeen,
    acceptedPartners: acceptedPartners,
    badgeStats: badgeStats,
    fetchPeers: fetchPeers,
    learnerStats: learnerStats,
    trackNames: trackNames
  };
})();
