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

  /* ---------- cached identity guard ---------- */
  /* A few things live in localStorage for first paint: your name, path and
     topic. They belong to ONE account. Log out and back in as someone else
     — or switch Google accounts — and every one of them is about the
     previous person. Stamp the cache with the user id it came from and
     throw the whole lot away the moment that id changes. */
  (function(){
    if (!client) return;
    var KEYS = ['pf_name','pf_email','pf_track','pf_topic','pf_pending'];
    client.auth.getSession().then(function(res){
      var s = res.data && res.data.session;
      var uid = (s && s.user && s.user.id) || '';
      var seen = '';
      try { seen = localStorage.getItem('pf_uid') || ''; } catch(e){ return; }
      if (uid === seen) return;
      try {
        if (seen) KEYS.forEach(function(k){ localStorage.removeItem(k); });
        if (uid) localStorage.setItem('pf_uid', uid);
        else localStorage.removeItem('pf_uid');
      } catch(e){}
    }).catch(function(){});
  })();

  /* ---------- errors ---------- */

  /* One place where a database error becomes something a person reads.
     Postgres and PostgREST errors name tables, columns, constraints and
     policies, and telling a visitor which migration to run hands them a map
     of the schema. The real error goes to the console, where whoever is
     debugging can see it; the page gets a sentence that says what happened
     without describing how anything is built.

     Only messages that describe the user's own situation are passed through,
     and each one is written here rather than taken from the database. */
  function fail(err, msg){
    try { console.error('PeerFlow:', err); } catch(e){}
    return { error: msg || 'Something went wrong on our side. Please try again.' };
  }

  /* ---------- auth ---------- */

  function signUpEmail(name, email, password){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name } }
    }).then(function(res){
      if (res.error) {
        var m = String(res.error.message || '');
        if (/already registered|already exists/i.test(m))
          return fail(res.error, 'There is already an account with that email address.');
        if (/password/i.test(m))
          return fail(res.error, 'That password is too short — use at least six characters.');
        return fail(res.error, 'Could not create your account. Please try again.');
      }
      // With email confirmation enabled there is a user but no session yet.'''
      return { user: res.data.user, session: res.data.session,
               needsConfirm: !!res.data.user && !res.data.session };
    }).catch(function(){ return { demo: true }; });
  }

  function signInEmail(email, password){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.signInWithPassword({ email: email, password: password })
      .then(function(res){
        /* One message for a wrong password and an address with no account,
           so the form can't be used to find out which emails are registered. */
        if (res.error) return fail(res.error, 'Your email or password is incorrect.');
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
      return res.error ? fail(res.error, 'Could not start that sign-in. Please try again.')
                       : { redirecting: true };
    }).catch(function(err){ return fail(err, 'Could not start that sign-in. Please try again.'); });
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

  /* Returns a promise. supabase-js clears the stored session only after its
     logout request comes back, so callers must wait before navigating —
     otherwise the navigation aborts the request and the session survives. */
  function signOut(){
    if (!client) return Promise.resolve();
    return client.auth.signOut().catch(function(){ return null; });
  }

  /* Email a reset link. The link lands on reset.html carrying a recovery
     token, which supabase-js turns into a short-lived session; changePassword
     then works there exactly as it does for a signed-in user.

     The answer is the same whether or not that address has an account. A
     different response for an unknown address would turn this box into a way
     of finding out who has signed up, which is the same reason the login form
     gives one message for a wrong password and a wrong address. */
  function sendPasswordReset(email){
    if (!client) return Promise.resolve({ demo: true });
    var base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return client.auth.resetPasswordForEmail(email, { redirectTo: base + 'reset.html' })
      .then(function(r){
        if (r.error) {
          var m = String(r.error.message || '');
          /* Rate limits are worth saying out loud: they're about how recently
             this person asked, not about whether the account exists. */
          if (/only request this after|rate limit|too many/i.test(m)) {
            return fail(r.error, 'You asked very recently — give it a minute and try again.');
          }
          try { console.error('PeerFlow:', r.error); } catch(e){}
        }
        return { sent: true };
      })
      .catch(function(e){
        return fail(e, 'Could not send that \u2014 check your connection and try again.');
      });
  }

  /* Change the signed-in user's password. Supabase requires a live session,
     so this works while logged in, and on reset.html once the recovery token
     in the link has been exchanged for one. */
  function changePassword(newPassword){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.updateUser({ password: newPassword }).then(function(r){
      if (r.error) {
        if (/password/i.test(String(r.error.message || '')))
          return fail(r.error, 'That password is too short — use at least six characters.');
        return fail(r.error, 'Could not change your password. Please try again.');
      }
      return { saved: true };
    }).catch(function(e){ return fail(e, 'Could not change your password. Please try again.'); });
  }

  /* ---------- profile ---------- */

  /* The signed-in user's profile row.
       row   — found it
       null  — signed out, or signed in with no row yet
       false — we couldn't ask (network, RLS, table missing)
     Callers must not treat false as "no profile": that turns a dropped
     request into "you never signed up". Every use is falsy-safe either way. */
  function getProfile(){
    if (!client) return Promise.resolve(null);
    return client.auth.getUser().then(function(res){
      var user = res.data && res.data.user;
      if (!user) return null;
      return client.from('profiles').select('*').eq('id', user.id).maybeSingle()
        .then(function(r){ return r.error ? false : (r.data || null); });
    }).catch(function(){ return false; });
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
      if ('firstName' in profile)    row.first_name = profile.firstName || null;
      if ('lastName' in profile)     row.last_name = profile.lastName || null;
      if ('track' in profile)        row.track_id = profile.track || null;
      if ('topic' in profile)        row.topic = profile.topic || null;
      if ('level' in profile)        row.level = profile.level || null;
      if ('goal' in profile)         row.goal = profile.goal || null;
      if ('timezone' in profile)     row.timezone = profile.timezone || null;
      if ('availability' in profile) row.availability = profile.availability || [];
      return client.from('profiles').upsert(row).then(function(r){
        /* PGRST204: the column isn't in this database yet, i.e. schema.sql
           hasn't been re-run since first_name/last_name were added. Losing
           somebody's whole profile over a column they never asked for would
           be absurd — drop the two new fields and save the rest. `name`
           still carries the full name, so nothing visible is lost. */
        if (r.error && r.error.code === 'PGRST204' &&
            /first_name|last_name/.test(r.error.message || '') &&
            ('first_name' in row || 'last_name' in row)) {
          delete row.first_name; delete row.last_name;
          try {
            console.warn('PeerFlow: profiles.first_name/last_name are missing. ' +
                         'Re-run supabase/schema.sql to store names split.');
          } catch(e){}
          return client.from('profiles').upsert(row).then(function(r2){
            return r2.error ? fail(r2.error, 'Could not save your profile. Please try again.')
                            : { saved: true };
          });
        }
        if (r.error) return fail(r.error, 'Could not save your profile. Please try again.');
        return { saved: true };
      });
    }).catch(function(e){
      return fail(e, 'Could not save your profile \u2014 check your connection and try again.');
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
      if (r.error) return fail(r.error, 'Could not add you to the list. Please try again.');
      return { saved: true };
    }).catch(function(e){
      return fail(e, 'Could not add you to the list \u2014 check your connection and try again.');
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
        .select('id,partner_name,topic,starts_at,duration_min,room_url,status,proposed_by,note')
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
              roomUrl: s.room_url,
              /* Rows written before proposals existed have no status; they
                 were already agreed, so they count as confirmed. */
              status: s.status || 'confirmed',
              proposedBy: s.proposed_by,
              note: s.note,
              mine: s.proposed_by === uid
            };
          });
        });
    }).catch(function(){ return null; });
  }

  /* Propose a time to your partner. Writes one row for each of you, sharing a
     start time and room, both 'proposed' — nothing lands on either calendar
     as a real session until the other person accepts. */
  function proposeSession(opts){
    if (!client) return Promise.resolve({ demo: true });
    return client.auth.getUser().then(function(res){
      var me = res.data && res.data.user;
      if (!me) return { demo: true };
      var myName = opts.myName || (me.email || '').split('@')[0];
      var room = opts.roomUrl || ('https://meet.jit.si/PeerFlow-' + (opts.pairId || me.id));
      var common = {
        topic: opts.topic || null, starts_at: opts.startsAt,
        duration_min: opts.durationMin || 50, room_url: room,
        status: 'proposed', proposed_by: me.id, note: opts.note || null
      };
      function row(userId, partnerName){
        var o = { user_id: userId, partner_name: partnerName };
        for (var k in common) if (common.hasOwnProperty(k)) o[k] = common[k];
        return o;
      }
      var rows = [ row(me.id, opts.partnerName || null), row(opts.partnerId, myName) ];
      return client.from('sessions').insert(rows).then(function(r){
        if (r.error) return fail(r.error, 'Could not send that time. Please try again.');
        return { saved: true };
      });
    }).catch(function(e){
      return fail(e, 'Could not send that time \u2014 check your connection and try again.');
    });
  }

  /* Accept a proposal: flip both copies of the meeting to 'confirmed'. Matched
     on the shared start and room, the same pair of facts cancelling uses. */
  function acceptSession(startsAt, roomUrl){
    if (!client) return Promise.resolve({ demo: true });
    return client.from('sessions')
      .update({ status: 'confirmed' })
      .eq('starts_at', startsAt)
      .eq('room_url', roomUrl)
      .then(function(r){
        return r.error ? fail(r.error, 'Could not accept that time. Please try again.')
                       : { saved: true };
      }).catch(function(e){
        return fail(e, 'Could not accept that time \u2014 check your connection and try again.');
      });
  }

  /* Cancel a session for both people (matched on the shared start + room). */
  function cancelSession(startsAt, roomUrl){
    if (!client) return Promise.resolve({ demo: true });
    return client.from('sessions').delete()
      .eq('starts_at', startsAt).eq('room_url', roomUrl)
      .then(function(r){
        return r.error ? fail(r.error, 'Could not cancel that. Please try again.') : { saved: true };
      })
      .catch(function(e){
        return fail(e, 'Could not cancel that \u2014 check your connection and try again.');
      });
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
            /* Safe to name: it describes what this person already did, not the schema. */
            return fail(r.error, 'Could not send the request. Please try again.');
          }
          return { sent: true };
        });
    }).catch(function(e){
      return fail(e, 'Could not send the request \u2014 check your connection and try again.');
    });
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
            .select('id,name,track_id,topic,level,timezone,availability')
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
        return r.error ? fail(r.error, 'Could not save that answer. Please try again.')
                       : { saved: true };
      }).catch(function(e){
        return fail(e, 'Could not save that answer \u2014 check your connection and try again.');
      });
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

        /* Total time actually sat, and the longest run of consecutive weeks
           with at least one session in them. Both come straight off the
           session rows — nothing here is awarded for an intention. */
        var minutes = past.reduce(function(a, s){ return a + (s.durationMin || 0); }, 0);
        var weeks = {}, WEEK = 7 * 864e5;
        past.forEach(function(s){ weeks[Math.floor(s.startsAt.getTime() / WEEK)] = true; });
        var idx = Object.keys(weeks).map(Number).sort(function(a, b){ return a - b; });
        var run = idx.length ? 1 : 0, best = run;
        for (var i = 1; i < idx.length; i++){
          run = (idx[i] === idx[i-1] + 1) ? run + 1 : 1;
          if (run > best) best = run;
        }

        return {
          pastSessions: past.length,
          partners: partners.length,
          mostWithOnePartner: mostWithOne,
          totalMinutes: minutes,
          longestWeekStreak: best,
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
        .select('id,name,track_id,topic,level,timezone,created_at,availability')
        /* Signing in with Google creates the row before any question is
           answered. Until a path is picked there is nothing to match on, so
           those half-finished rows stay out of the list — showing them would
           offer people a partner who never actually joined. */
        .not('track_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit || 24);
      if (uid) q = q.neq('id', uid);
      return q.then(function(r){ return r.error ? null : (r.data || []); });
    }).catch(function(){ return null; });
  }

  /* How many people have signed up, and how many share your topic. */
  function learnerStats(topic){
    if (!client) return Promise.resolve(null);
    /* Same rule as fetchPeers: only people who finished signing up count. */
    var total = client.from('profiles').select('id', { count: 'exact', head: true })
      .not('track_id', 'is', null);
    var same = topic
      ? client.from('profiles').select('id', { count: 'exact', head: true })
          .not('track_id', 'is', null).ilike('topic', topic)
      : Promise.resolve({ count: 0 });
    return Promise.all([total, same]).then(function(r){
      return { total: (r[0] && r[0].count) || 0, sameTopic: (r[1] && r[1].count) || 0 };
    }).catch(function(){ return null; });
  }

  /* How many people have signed up to each path. One request, tallied here,
     rather than eight count queries. Returns an object keyed by track id
     ({frontend: 2, backend: 0, ...}) or null if we can't reach the server —
     null and zero mean different things, so the caller can tell them apart. */
  function trackCounts(){
    if (!client) return Promise.resolve(null);
    return client.from('profiles').select('track_id').not('track_id', 'is', null).then(function(r){
      if (r.error) return null;
      var out = {};
      Object.keys(trackNames).forEach(function(id){ out[id] = 0; });
      (r.data || []).forEach(function(row){
        if (row.track_id && out.hasOwnProperty(row.track_id)) out[row.track_id]++;
      });
      return out;
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
    sendPasswordReset: sendPasswordReset,
    saveProfile: saveProfile,
    joinWaitlist: joinWaitlist,
    getMatch: getMatch,
    fetchSessions: fetchSessions,
    proposeSession: proposeSession,
    acceptSession: acceptSession,
    cancelSession: cancelSession,
    sendPartnerRequest: sendPartnerRequest,
    myRequests: myRequests,
    respondToRequest: respondToRequest,
    markRequestsSeen: markRequestsSeen,
    acceptedPartners: acceptedPartners,
    badgeStats: badgeStats,
    fetchPeers: fetchPeers,
    learnerStats: learnerStats,
    trackCounts: trackCounts,
    trackNames: trackNames
  };
})();
