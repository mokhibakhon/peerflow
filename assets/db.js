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
        /* Same trap as changePassword had: /password/ matches almost every
           failure here, so the specific ones are tested first. */
        if (/should contain|character of each|requirement/i.test(m))
          return fail(res.error, 'That password needs a mix of upper and lower case, a number and a symbol.');
        if (/at least|too short|minimum|length/i.test(m))
          return fail(res.error, 'That password is too short — use at least eight characters.');
        return fail(res.error, 'Could not create your account. Please try again.');
      }
      // With email confirmation enabled there is a user but no session yet.
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

  /* The signed-in user's id, for filtering queries.

     This used to be client.auth.getUser(), which sends a request to the auth
     endpoint every time it's called — and it was called eight times across
     the data layer, chained one after another, so a dashboard load spent
     several serial round trips just re-asking who you are. getSession() reads
     the stored token locally and refreshes it only when it has expired. The
     server still decides what you may read: RLS runs off the JWT, not off
     anything answered here. */
  function currentUid(){
    if (!client) return Promise.resolve(null);
    return client.auth.getSession().then(function(res){
      var s = res.data && res.data.session;
      return (s && s.user && s.user.id) || null;
    }).catch(function(){ return null; });
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
        /* Matching on /password/ alone was wrong: nearly every failure here
           mentions the word, so a fifteen-character password came back as
           "too short". These are four different things to do about it, so
           each gets its own sentence, and anything unrecognised says only
           what it can stand behind. */
        var m = String(r.error.message || '');
        /* The character-requirements message reads "at least one character of
           each", so it has to be tested before the length check or it comes
           out as "too short" — which is how the last version of this got the
           answer wrong. */
        if (/should contain|character of each|requirement/i.test(m))
          return fail(r.error, 'That password needs a mix of upper and lower case, a number and a symbol.');
        if (/at least|too short|minimum|length/i.test(m))
          return fail(r.error, 'Use at least eight characters.');
        if (/should be different|same as the old|same_password/i.test(m))
          return fail(r.error, 'That is the password you already have — pick a different one.');
        if (/session|jwt|token|expired|not authenticated|missing/i.test(m))
          return fail(r.error, 'Your reset link has expired. Ask for a new one and try again.');
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
    return currentUser().then(function(user){
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
    return currentUser().then(function(user){
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
    return currentUid().then(function(uid){
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
    return currentUid().then(function(uid){
      if (!uid) return null;
      /* The attendance columns arrive with migration-mvp.sql. Asking for them
         on a database that hasn't run it yet fails the whole select, so the
         request falls back to the original column list and the UI simply has
         no attendance data to show — which is what an un-migrated project
         genuinely has. */
      var FULL = 'id,partner_name,topic,starts_at,duration_min,room_url,status,' +
                 'proposed_by,note,cancelled_by,confirmed_at,goal,goal_done,' +
                 'attended,completed_at,cancelled_at';
      var BASE = 'id,partner_name,topic,starts_at,duration_min,room_url,status,' +
                 'proposed_by,note,cancelled_by';

      function read(cols){
        return client.from('sessions')
          .select(cols)
          .eq('user_id', uid)
          .order('starts_at', { ascending: true });
      }

      return read(FULL).then(function(r){
        if (r.error && (r.error.code === '42703' || r.error.code === 'PGRST204' ||
                        /column .* does not exist/i.test(String(r.error.message || '')))) {
          try {
            console.warn('PeerFlow: session attendance columns are missing. ' +
                         'Run supabase/migration-mvp.sql to enable attendance.');
          } catch(e){}
          return read(BASE);
        }
        return r;
      })
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
              /* Explicitly false when proposed_by is missing, so a row from
                 before proposals existed can't read as "you proposed this". */
              mine: !!s.proposed_by && s.proposed_by === uid,
              /* Who called it off, so the person who did isn't told about
                 their own decision. */
              cancelledByMe: !!s.cancelled_by && s.cancelled_by === uid,
              /* Attendance. Undefined on an un-migrated database, which reads
                 as "not confirmed" everywhere and never as "did not attend". */
              confirmedAt: s.confirmed_at ? new Date(s.confirmed_at) : null,
              goal: s.goal || null,
              goalDone: (s.goal_done === true || s.goal_done === false) ? s.goal_done : null,
              attended: (s.attended === true || s.attended === false) ? s.attended : null,
              completedAt: s.completed_at ? new Date(s.completed_at) : null,
              cancelledAt: s.cancelled_at ? new Date(s.cancelled_at) : null
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
    return currentUser().then(function(me){
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

  /* Accepting, declining and cancelling all have to move BOTH copies of a
     meeting, and none of them can do that from here. "read own sessions"
     limits SELECT to your own rows, and Postgres applies SELECT policies to
     UPDATE and DELETE as well — so a filtered update from the browser only
     ever matched the caller's copy and left the partner's untouched. That is
     why a cancelled session stayed on the other person's calendar.

     The two functions below run in the database with the reach to see both
     rows, and check the caller owns a copy before touching anything. */
  function answer(startsAt, roomUrl, status, msg){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc('answer_session', {
      p_starts_at: startsAt, p_room: roomUrl, p_status: status
    }).then(function(r){
      if (r.error) {
        if (r.error.code === 'PGRST202' || /function .* does not exist/i.test(String(r.error.message || ''))) {
          return fail(r.error, 'This needs a database update that hasn\u2019t been applied yet.');
        }
        return fail(r.error, msg);
      }
      /* The function returns how many rows it changed. Zero means it matched
         nothing at all, which used to be reported as success and left both
         sides looking however they already looked. */
      if (r.data === 0) {
        return fail(new Error('answer_session matched no rows'),
          'That session has already been answered or removed. Refresh the page.');
      }
      try { if (r.data === 1) console.warn('PeerFlow: only one copy of the session moved.'); } catch(e){}
      return { saved: true };
    }).catch(function(e){ return fail(e, msg); });
  }

  function acceptSession(startsAt, roomUrl){
    return answer(startsAt, roomUrl, 'confirmed', 'Could not accept that time. Please try again.');
  }

  function declineSession(startsAt, roomUrl){
    return answer(startsAt, roomUrl, 'declined', 'Could not turn that down. Please try again.');
  }

  /* Call off a session the two of you had agreed. Both rows become
     'cancelled' rather than disappearing: deleting them cleared the other
     person's calendar with no explanation, which is indistinguishable from
     the app losing their session. They clear it once they've seen it. */
  function cancelBooked(startsAt, roomUrl){
    return answer(startsAt, roomUrl, 'cancelled',
                  'Could not cancel that. Please try again.');
  }

  /* Removes both rows outright. For withdrawing a proposal nobody has
     answered yet — nothing was agreed, so there is nothing to report — and
     for clearing a decline or a cancellation you have read. */
  function cancelSession(startsAt, roomUrl){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc('drop_session', { p_starts_at: startsAt, p_room: roomUrl })
      .then(function(r){
        if (r.error) {
          if (r.error.code === 'PGRST202' || /function .* does not exist/i.test(String(r.error.message || ''))) {
            return fail(r.error, 'This needs a database update that hasn\u2019t been applied yet.');
          }
          return fail(r.error, 'Could not cancel that. Please try again.');
        }
        if (r.data === 0) {
          return fail(new Error('drop_session matched no rows'),
            'That session has already been cancelled. Refresh the page.');
        }
        try { if (r.data === 1) console.warn('PeerFlow: only one copy of the session was removed.'); } catch(e){}
        return { saved: true };
      }).catch(function(e){
        return fail(e, 'Could not cancel that \u2014 check your connection and try again.');
      });
  }

  /* ---------- partner requests ---------- */

  /* Ask someone to be your learning partner. */
  function sendPartnerRequest(toUserId, message){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
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
    return currentUid().then(function(uid){
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
    return currentUid().then(function(uid){
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

  /* ================================================================
     MVP additions: one primary partnership, attendance, reliability,
     notifications, achievements, learning stage.

     Everything below follows the same two rules as the code above it: the
     server decides what may be read or written (RLS and the SECURITY DEFINER
     functions), and nothing here throws — a missing table or a file:// page
     resolves to null or demo data so the UI can say something useful instead
     of breaking.
     ================================================================ */

  /* ---------- availability vocabulary ---------- */
  /* Slots are stored as "tue-evening" day/band pairs, the shape signup writes
     and the calendar already reads. Bands match app.html's CAL_BANDS. */
  var DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];
  var DAY_LABEL = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday',
                    fri:'Friday', sat:'Saturday', sun:'Sunday' };
  var BAND_HOURS = { morning:[6,11], afternoon:[12,16], evening:[17,21], night:[22,23] };
  var BAND_LABEL = { morning:'morning', afternoon:'afternoon', evening:'evening', night:'night' };

  /* The slots two people both marked free, in week order. */
  function sharedSlots(mine, theirs){
    var a = mine || [], b = theirs || [];
    var set = {};
    b.forEach(function(s){ set[s] = true; });
    return a.filter(function(s){ return set[s]; }).sort(function(x, y){
      var dx = DAY_ORDER.indexOf(String(x).split('-')[0]);
      var dy = DAY_ORDER.indexOf(String(y).split('-')[0]);
      if (dx !== dy) return dx - dy;
      return String(x).localeCompare(String(y));
    });
  }

  function slotLabel(slot){
    var p = String(slot || '').split('-');
    var d = DAY_LABEL[p[0]] || p[0] || '';
    var b = BAND_LABEL[p[1]] || p[1] || '';
    return (d + ' ' + b).trim();
  }

  /* A band turned into the concrete hours you can actually propose. */
  function slotHours(slot){
    var band = BAND_HOURS[String(slot || '').split('-')[1]];
    if (!band) return [];
    var out = [];
    for (var h = band[0]; h <= band[1]; h++) out.push(h);
    return out;
  }

  /* The next real date/time for a slot+hour, always in the future. */
  function nextDateFor(slot, hour){
    var day = DAY_ORDER.indexOf(String(slot || '').split('-')[0]);
    if (day < 0) return null;
    var now = new Date();
    var d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(0);
    d.setHours(hour);
    var todayIdx = (now.getDay() + 6) % 7;          // Monday = 0
    var delta = (day - todayIdx + 7) % 7;
    if (delta === 0 && d.getTime() <= now.getTime()) delta = 7;
    d.setDate(d.getDate() + delta);
    return d;
  }

  /* ---------- one primary partnership ---------- */

  /* The current partner, or null. The MVP is built around one active
     partnership; if several accepted rows exist (older data), the most
     recently accepted one wins so behaviour stays predictable. */
  function primaryPartner(){
    return acceptedPartners().then(function(list){
      if (!list || !list.length) return null;
      return list[0];
    }).catch(function(){ return null; });
  }

  /* Walk away from a partnership. The row moves to 'ended' rather than being
     deleted: the sessions the two of you sat stay attributable, and the pair
     can still be shown in history. acceptedPartners() filters on 'accepted',
     so the partner disappears from the app the moment this lands. */
  function endPartnership(requestId){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('partner_requests')
        .update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: uid })
        .eq('id', requestId)
        .then(function(r){
          if (r.error) {
            if (/violates check constraint/i.test(String(r.error.message || ''))) {
              return fail(r.error, 'This needs a database update that hasn’t been applied yet.');
            }
            return fail(r.error, 'Could not end that partnership. Please try again.');
          }
          return { saved: true };
        });
    }).catch(function(e){
      return fail(e, 'Could not end that partnership — check your connection and try again.');
    });
  }

  /* ---------- ranked matches ---------- */

  /* A small ranked set, not a directory. Scores the people who have finished
     signing up against the signed-in learner and returns the strongest few,
     each carrying the reasons it scored well so the card can explain itself.

     Weighting follows the product order: same path first, then stage, then
     timezone, then how many hours you actually share. */
  function rankedMatches(limit){
    if (!client) return Promise.resolve(null);
    return Promise.all([getProfile(), fetchPeers(60), myRequests()]).then(function(r){
      var me = r[0], peers = r[1] || [], reqs = r[2];
      if (!me) return null;

      /* Anyone already asked, already partnered with, or who asked you, is
         not a match to show again. */
      var busy = {};
      if (reqs) {
        reqs.incoming.concat(reqs.outgoing).forEach(function(x){
          if (x.status === 'pending' || x.status === 'accepted') {
            busy[x.from_user] = true; busy[x.to_user] = true;
          }
        });
      }

      var myAvail = me.availability || [];
      var LEVELS = ['new','tutorials','builder','jobprep'];
      var myLevel = LEVELS.indexOf(me.level);

      var scored = peers.filter(function(p){ return !busy[p.id]; }).map(function(p){
        var why = [], score = 0;

        if (p.track_id && me.track_id && p.track_id === me.track_id) {
          score += 40; why.push('Same path');
        }
        if (p.topic && me.topic &&
            String(p.topic).trim().toLowerCase() === String(me.topic).trim().toLowerCase()) {
          score += 15; why.push('Same topic');
        }
        var theirLevel = LEVELS.indexOf(p.level);
        if (myLevel >= 0 && theirLevel >= 0) {
          var gap = Math.abs(myLevel - theirLevel);
          if (gap === 0) { score += 20; why.push('Same stage'); }
          else if (gap === 1) { score += 10; why.push('Close stage'); }
        }
        if (p.timezone && me.timezone && p.timezone === me.timezone) {
          score += 10; why.push('Same timezone');
        }
        var shared = sharedSlots(myAvail, p.availability || []);
        if (shared.length) {
          score += Math.min(15, shared.length * 5);
          why.push(shared.length + ' shared study window' + (shared.length === 1 ? '' : 's'));
        }

        return {
          id: p.id,
          name: p.name || 'Someone',
          trackId: p.track_id,
          trackName: trackNames[p.track_id] || p.track_id || '',
          topic: p.topic,
          level: p.level,
          timezone: p.timezone,
          shared: shared,
          why: why,
          score: score,
          /* A percentage people can read, capped so nothing ever claims 100%. */
          match: Math.max(40, Math.min(98, Math.round(score)))
        };
      });

      scored.sort(function(a, b){
        if (b.score !== a.score) return b.score - a.score;
        return b.shared.length - a.shared.length;
      });
      /* A handful of strong matches, deliberately not an endless list. */
      return scored.slice(0, limit || 8);
    }).catch(function(){ return null; });
  }

  /* ---------- attendance ---------- */

  function rpcSession(fn, args, msg){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc(fn, args).then(function(r){
      if (r.error) {
        if (r.error.code === 'PGRST202' ||
            /function .* does not exist/i.test(String(r.error.message || ''))) {
          return fail(r.error, 'This needs a database update that hasn’t been applied yet.');
        }
        return fail(r.error, msg);
      }
      return { saved: true, rows: r.data };
    }).catch(function(e){ return fail(e, msg); });
  }

  /* "I'm ready" — confirms only the caller's own row, so a partner can never
     confirm on your behalf. An optional goal is saved at the same time. */
  function confirmAttendance(startsAt, roomUrl, goal){
    return rpcSession('confirm_attendance',
      { p_starts_at: startsAt, p_room: roomUrl, p_goal: goal || null },
      'Could not confirm. Please try again.');
  }

  /* Whether the other person has confirmed and turned up. Their row is not
     readable directly — "read own sessions" is deliberately narrow — so this
     goes through a function that returns three booleans about a meeting the
     caller already owns a copy of, and nothing else from their row.
     Resolves null when unknown, which reads as "not confirmed yet" rather
     than as "did not attend". */
  function partnerState(startsAt, roomUrl){
    if (!client) return Promise.resolve(null);
    return client.rpc('session_partner_state', { p_starts_at: startsAt, p_room: roomUrl })
      .then(function(r){
        if (r.error || !r.data || !r.data.length) return null;
        var row = r.data[0];
        return { confirmed: !!row.confirmed, attended: !!row.attended, hasGoal: !!row.has_goal };
      }).catch(function(){ return null; });
  }

  function setSessionGoal(startsAt, roomUrl, goal){
    return rpcSession('set_session_goal',
      { p_starts_at: startsAt, p_room: roomUrl, p_goal: goal || '' },
      'Could not save that goal. Please try again.');
  }

  /* Checking out. Marks the caller present and moves the shared status to
     'completed'; the partner's attendance stays unknown until they check out
     too, which is what makes a no-show visible rather than assumed. */
  function finishSession(startsAt, roomUrl, goalDone){
    return rpcSession('finish_session',
      { p_starts_at: startsAt, p_room: roomUrl,
        p_goal_done: (goalDone === true || goalDone === false) ? goalDone : null },
      'Could not save that. Please try again.');
  }

  /* ---------- reliability ---------- */

  /* Plain counts, not an opaque score. Early cancellations are recorded but
     deliberately weigh far less than a no-show. */
  var LATE_MS = 2 * 60 * 60 * 1000;   // cancelling inside two hours is "late"

  function reliability(){
    return fetchSessions().then(function(list){
      if (!list) return null;
      var now = Date.now();
      var out = { attended: 0, noShow: 0, early: 0, late: 0, counted: 0, pct: null };

      list.forEach(function(s){
        var ended = s.startsAt.getTime() + s.durationMin * 60000;
        if (s.status === 'completed') {
          out.counted++;
          if (s.attended) out.attended++; else out.noShow++;
          return;
        }
        if (s.status === 'cancelled') {
          var when = s.cancelledAt ? s.cancelledAt.getTime() : null;
          var late = when !== null && (s.startsAt.getTime() - when) < LATE_MS;
          if (late) { out.late++; out.counted++; }
          else out.early++;
          return;
        }
        /* A confirmed session whose time has passed with nobody checking out
           is a no-show on both sides. */
        if (s.status === 'confirmed' && ended <= now) {
          out.counted++;
          if (s.attended) out.attended++; else out.noShow++;
        }
      });

      if (out.counted > 0) out.pct = Math.round((out.attended / out.counted) * 100);
      return out;
    }).catch(function(){ return null; });
  }

  /* ---------- notifications ---------- */

  function fetchNotifications(limit){
    if (!client) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      return client.from('notifications')
        .select('id,kind,title,body,href,read_at,created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(limit || 25)
        .then(function(r){ return r.error ? null : (r.data || []); });
    }).catch(function(){ return null; });
  }

  function markNotificationsRead(ids){
    if (!client) return Promise.resolve({ demo: true });
    if (!ids || !ids.length) return Promise.resolve({ saved: true });
    return client.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids)
      .then(function(r){ return r.error ? { error: 'Could not update.' } : { saved: true }; })
      .catch(function(){ return { error: 'Could not update.' }; });
  }

  /* Writing to somebody else's list goes through the database function, which
     refuses unless the two of you are actually partnered. Failures here are
     never surfaced: a notification that didn't send must not block the action
     that triggered it. */
  function notifyPartner(toId, kind, title, body, href){
    if (!client || !toId) return Promise.resolve({ demo: true });
    return client.rpc('notify_partner', {
      p_to: toId, p_kind: kind, p_title: title,
      p_body: body || null, p_href: href || null
    }).then(function(r){
      if (r.error) { try { console.warn('PeerFlow: notify_partner', r.error); } catch(e){} }
      return { sent: !r.error };
    }).catch(function(){ return { sent: false }; });
  }

  function notifyRequest(toId, title, body){
    if (!client || !toId) return Promise.resolve({ demo: true });
    return client.rpc('notify_request', {
      p_to: toId, p_title: title, p_body: body || null
    }).then(function(r){
      if (r.error) { try { console.warn('PeerFlow: notify_request', r.error); } catch(e){} }
      return { sent: !r.error };
    }).catch(function(){ return { sent: false }; });
  }

  /* ---------- achievements ---------- */

  function unlockedAchievements(){
    if (!client) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      return client.from('achievements')
        .select('code,unlocked_at')
        .eq('user_id', uid)
        .then(function(r){ return r.error ? null : (r.data || []); });
    }).catch(function(){ return null; });
  }

  /* Records that a badge has been seen to unlock, so it can be announced once
     rather than on every page load. Duplicate inserts are expected and are not
     an error worth reporting. */
  function unlockAchievement(code){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('achievements')
        .insert({ user_id: uid, code: code })
        .then(function(r){
          if (r.error && r.error.code !== '23505') {
            try { console.warn('PeerFlow: unlockAchievement', r.error); } catch(e){}
            return { saved: false };
          }
          return { saved: !r.error, fresh: !r.error };
        });
    }).catch(function(){ return { saved: false }; });
  }

  /* ---------- learning stage ---------- */

  function saveStage(index){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('profiles')
        .update({ stage_index: Math.max(0, index | 0) })
        .eq('id', uid)
        .then(function(r){
          return r.error ? fail(r.error, 'Could not save your progress. Please try again.')
                         : { saved: true };
        });
    }).catch(function(e){ return fail(e, 'Could not save your progress. Please try again.'); });
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
    /* Console check when something has moved on one side and not the other:
       pf.check().then(console.log) says which build is loaded and whether the
       database functions it needs are actually there. */
    check: function(){
      var out = { rpcInCode: /rpc\(/.test(String(cancelSession)), connected: !!client };
      if (!client) return Promise.resolve(out);
      return client.rpc('drop_session', { p_starts_at: '1970-01-01T00:00:00Z', p_room: '__none__' })
        .then(function(r){
          out.dropSessionExists = !(r.error && (r.error.code === 'PGRST202' ||
            /function .* does not exist/i.test(String(r.error.message || ''))));
          out.detail = r.error ? (r.error.code || r.error.message) : 'callable';
          return out;
        }).catch(function(e){ out.dropSessionExists = false; out.detail = String(e); return out; });
    },
    proposeSession: proposeSession,
    acceptSession: acceptSession,
    declineSession: declineSession,
    cancelBooked: cancelBooked,
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
    trackNames: trackNames,

    /* ---- MVP additions ---- */
    /* availability vocabulary */
    dayOrder: DAY_ORDER,
    dayLabel: DAY_LABEL,
    bandHours: BAND_HOURS,
    sharedSlots: sharedSlots,
    slotLabel: slotLabel,
    slotHours: slotHours,
    nextDateFor: nextDateFor,
    /* partnership */
    primaryPartner: primaryPartner,
    endPartnership: endPartnership,
    rankedMatches: rankedMatches,
    /* attendance */
    confirmAttendance: confirmAttendance,
    partnerState: partnerState,
    setSessionGoal: setSessionGoal,
    finishSession: finishSession,
    reliability: reliability,
    /* notifications */
    fetchNotifications: fetchNotifications,
    markNotificationsRead: markNotificationsRead,
    notifyPartner: notifyPartner,
    notifyRequest: notifyRequest,
    /* achievements + progress */
    unlockedAchievements: unlockedAchievements,
    unlockAchievement: unlockAchievement,
    saveStage: saveStage
  };
})();
