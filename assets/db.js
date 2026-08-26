/* Which build of the site the browser is actually running.
 *
 * There is no bundler and no content hashing, so assets/db.js is requested by
 * that exact name for ever and any layer in between — the browser, a CDN, a
 * captive-portal proxy — is free to answer with the copy it had last week.
 * The failure that costs the most time is not a wholly stale page: it is a
 * fresh app.html against a week-old db.js, which behaves like neither
 * version and matches no description of the bug.
 *
 * vercel.json now sends must-revalidate on everything, so this should not
 * happen. This exists to prove it: one line in the console on every load,
 * which turns "is it deployed?" into something you read rather than argue
 * about. Bump it when you change anything in assets/. */
window.PF_BUILD = '2026-08-25b';
try { console.info('PeerFlow build ' + window.PF_BUILD); } catch (e) {}

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

  /* The partnership a pre-migration room was named after. Rooms built from a
     user id rather than a request id simply don't match, which is the same
     answer the migration gives them: no partner history. */
  function legacyPair(room){
    var m = /PeerFlow-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/
              .exec(String(room || ''));
    return m ? m[1] : null;
  }

  /* A random id for a room name. crypto.randomUUID is everywhere current but
     is https-only and absent from older Safari, and this must not be the
     thing that stops somebody booking a session — the fallback is
     getRandomValues, which is far older, laid out in the same shape. */
  function newId(){
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = [];
      for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
      return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' +
             h.slice(6,8).join('') + '-' + h.slice(8,10).join('') + '-' + h.slice(10).join('');
    } catch (e) {
      /* No CSPRNG at all. Still unique enough to key two rows together, and
         the room's secrecy is not what authorises anybody — see the note on
         proposeSession. */
      return 'x' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    }
  }

  /* ---------- cached identity guard ---------- */
  /* A few things live in localStorage for first paint: your name, path and
     topic. They belong to ONE account. Log out and back in as someone else
     — or switch Google accounts — and every one of them is about the
     previous person. Stamp the cache with the user id it came from and
     throw the whole lot away the moment that id changes. */
  (function(){
    if (!client) return;
    var KEYS = ['pf_name','pf_email','pf_track','pf_topic','pf_pending',
                'pf_want_path','pf_paired','pf_streak'];
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

  /* A column or function this build knows about but the database has not been
     given yet, i.e. somebody deployed the site without running a migration.
     Everything that reads a newer column asks this first and falls back to the
     older shape, so a half-migrated database degrades instead of breaking. */
  function missingColumn(err){
    return !!err && (err.code === '42703' || err.code === 'PGRST204' ||
                     /column .* does not exist/i.test(String(err.message || '')));
  }
  function missingFunction(err){
    return !!err && (err.code === 'PGRST202' ||
                     /function .* does not exist/i.test(String(err.message || '')));
  }

  /* The database refusing a booking because the hour is already taken.
     supabase/migration-no-double-booking.sql raises PF001 from a trigger and
     from answer_session, with a sentence already written for the person
     reading it, so that one is passed straight through. 23P01 is the raw
     exclusion constraint underneath, which only surfaces when two requests
     race past the trigger in the same instant; its message names an index, so
     it gets a written one instead.

     Both are the same event as far as the page is concerned: the time went
     while you were looking at it. */
  function clashError(err){
    return !!err && (err.code === 'PF001' || err.code === '23P01' ||
                     /sessions_no_overlap/.test(String(err.message || '')));
  }
  function clashMessage(err){
    var m = String((err && err.message) || '');
    return (err && err.code === 'PF001' && m && !/sessions_no_overlap/.test(m))
      ? m
      : 'That time is already taken. Pick another one.';
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
      /* Arrives with migration-notify.sql. Same treatment as the two below:
         losing a whole profile save over a column this database has not got
         yet would be absurd, and the retry drops it. */
      if ('emailNotify' in profile)  row.email_notify = !!profile.emailNotify;
      function save(){
      return client.from('profiles').upsert(row).then(function(r){
        /* PGRST204: the column isn't in this database yet, i.e. schema.sql
           hasn't been re-run since first_name/last_name were added. Losing
           somebody's whole profile over a column they never asked for would
           be absurd — drop the two new fields and save the rest. `name`
           still carries the full name, so nothing visible is lost. */
        /* PGRST204: a column this database has not got yet. Drop whichever
           one it named and save the rest — losing somebody's whole profile
           over a column they never asked for would be absurd. It names one
           at a time, and each retry re-enters here, so a database missing
           several of them peels them off one by one.

           first_name/last_name arrive with schema.sql, email_notify with
           migration-notify.sql. `name` still carries the full name, and a
           missing email_notify simply means email is on, which is the
           default anyway. */
        var gone = /first_name|last_name|email_notify/.exec(r.error && r.error.message || '');
        if (r.error && r.error.code === 'PGRST204' && gone && (gone[0] in row)) {
          delete row[gone[0]];
          try {
            console.warn('PeerFlow: profiles.' + gone[0] + ' is missing. ' +
                         'Re-run supabase/schema.sql and supabase/migration-notify.sql.');
          } catch(e){}
          return save();
        }
        if (r.error) return fail(r.error, 'Could not save your profile. Please try again.');
        return { saved: true };
      });
      }
      return save();
    }).catch(function(e){
      return fail(e, 'Could not save your profile \u2014 check your connection and try again.');
    });
  }

  /* ---------- scheduled sessions ---------- */

  /* Every session booked for the signed-in user, soonest first. Rows are
     created when two partners agree a time; nothing is generated. */
  function fetchSessions(){
    if (!client) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      /* Newer columns arrive with later migrations, and asking for one the
         database has not got fails the whole select — so this is a ladder,
         widest first, stepping down one migration at a time.

         It used to be two rungs, FULL and BASE. Adding room_name to FULL
         would have meant a project that had run migration-mvp but not
         migration-video falling all the way to BASE and losing goals,
         attendance and the partnership with it. Each rung now costs exactly
         the migration it is missing, and the app keeps working at every one.

         The narrowest rung is what sessions looked like before any of this,
         so there is always something that reads. */
      var COLS = [
        /* A rung of its own for one column, so that a database which has not
           run migration-reschedule.sql loses exactly rescheduling and not
           attendance with it. That is what each rung is for: the cost of a
           missing migration should be the feature it brings and nothing
           else. */
        { need:'supabase/migration-reschedule.sql',
          cols:'id,partner_name,topic,starts_at,duration_min,room_url,room_name,pair_id,' +
               'status,proposed_by,note,goal,goal_done,cancelled_by,attended,joined_at,' +
               'completed_at,cancelled_at,attendance,attendance_source,settled_at,' +
               'partner_ok,checked_in_at,continue_pref,rescheduled_from' },
        { need:'supabase/migration-attendance.sql',
          cols:'id,partner_name,topic,starts_at,duration_min,room_url,room_name,pair_id,' +
               'status,proposed_by,note,goal,goal_done,cancelled_by,attended,joined_at,' +
               'completed_at,cancelled_at,attendance,attendance_source,settled_at,' +
               'partner_ok,checked_in_at,continue_pref' },
        { need:'supabase/migration-video.sql',
          cols:'id,partner_name,topic,starts_at,duration_min,room_url,room_name,pair_id,' +
               'status,proposed_by,note,goal,goal_done,cancelled_by,attended,' +
               'completed_at,cancelled_at' },
        { need:'supabase/migration-room-per-session.sql',
          cols:'id,partner_name,topic,starts_at,duration_min,room_url,pair_id,status,' +
               'proposed_by,note,goal,goal_done,cancelled_by,attended,completed_at,cancelled_at' },
        { need:'supabase/migration-mvp.sql',
          cols:'id,partner_name,topic,starts_at,duration_min,room_url,status,' +
               'proposed_by,note,cancelled_by' }
      ];
      function read(cols){
        return client.from('sessions').select(cols)
          .eq('user_id', uid).order('starts_at', { ascending: true });
      }
      function missingCol(err){
        return err && (err.code === '42703' || err.code === 'PGRST204' ||
                       /column .* does not exist/i.test(String(err.message || '')));
      }
      function climb(i){
        return read(COLS[i].cols).then(function(r){
          if (!missingCol(r.error) || i + 1 >= COLS.length) return r;
          try {
            console.warn('PeerFlow: sessions is missing a column. Run ' + COLS[i].need + '.');
          } catch(e){}
          return climb(i + 1);
        });
      }
      return climb(0)
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
              /* Null on every session booked before the call was ours, which
                 is how finished() below tells "nobody joined" from "there was
                 nothing here that could have noticed". */
              roomName: s.room_name || null,
              /* Which partnership this session belongs to. On a database that
                 has not run migration-room-per-session.sql the column is not
                 selected at all, so it is read back out of the room instead:
                 every room made before that migration is the literal string
                 'PeerFlow-' + the partner request id, which is the same thing
                 the migration's own backfill matches on. Streaks and session
                 counts therefore keep working un-migrated rather than quietly
                 reading zero. */
              pairId: s.pair_id || legacyPair(s.room_url),
              goal: s.goal || '',
              goalDone: (s.goal_done === true || s.goal_done === false) ? s.goal_done : null,
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
              /* Undefined on an un-migrated database, which reads everywhere
                 as "unknown" and never as "did not attend". */
              attended: (s.attended === true || s.attended === false) ? s.attended : null,
              joinedAt: s.joined_at ? new Date(s.joined_at) : null,
              completedAt: s.completed_at ? new Date(s.completed_at) : null,
              cancelledAt: s.cancelled_at ? new Date(s.cancelled_at) : null,
              /* The settled outcome — one of the five in assets/reliability.js,
                 or null. Null covers two quite different things and the pages
                 have to keep telling them apart: a session that has not
                 happened yet, and a session nothing was watching. Neither of
                 them is "did not attend", and the day this column starts
                 reading as one is the day somebody's record becomes a lie.

                 Undefined rather than null on a database that has not run
                 migration-attendance.sql, because the column is not selected
                 at all there and "we did not ask" is not "the answer was
                 nothing".

                 `'attendance' in s` and not `s.attendance || null`, which is
                 what this was and which coerced the undefined straight back
                 to null — destroying the distinction the comment above spends
                 six lines drawing. The cost was not theoretical: the
                 dashboard could no longer tell an un-migrated database from
                 an unsettled session, so it drew the post-session check-in on
                 a site whose session_checkin() did not exist, and all four
                 buttons answered "Check-ins aren't switched on for this site
                 yet". A control that cannot work should not be drawn. */
              attendance: ('attendance' in s) ? (s.attendance || null) : undefined,
              attendanceSource: s.attendance_source || null,
              settledAt: s.settled_at ? new Date(s.settled_at) : null,
              /* The check-in: what this person said about the other one, and
                 whether they want to carry on. Both are theirs alone — the
                 partner's answers live on the partner's row and are not
                 readable from here, which is deliberate. Nobody should be
                 able to see that they were the one who said stop. */
              partnerOk: (s.partner_ok === true || s.partner_ok === false) ? s.partner_ok : null,
              checkedInAt: s.checked_in_at ? new Date(s.checked_in_at) : null,
              continuePref: s.continue_pref || null,
              /* The time this session was moved from, or null if it was
                 booked outright.

                 Undefined rather than null on a database that has not run
                 migration-reschedule.sql, for the same reason `attendance` is
                 — the column is not selected at all there, and "we did not
                 ask" is not "the answer was nothing". The dashboard reads the
                 undefined as "rescheduling is not switched on here" and does
                 not draw the button, because a control that cannot do
                 anything should not be drawn. */
              rescheduledFrom: ('rescheduled_from' in s)
                ? (s.rescheduled_from ? new Date(s.rescheduled_from) : null)
                : undefined
            };
          });
        });
    }).catch(function(){ return null; });
  }

  /* Propose a time to your partner. Writes one row for each of you, sharing a
     start time and room, both 'proposed' — nothing lands on either calendar
     as a real session until the other person accepts. */
  /* An hour you have already given away.
   *
   * Nothing stopped two sessions sitting on top of each other — not the
   * page, not the insert policy, not a constraint. You could accept seven
   * o'clock from one partner and propose seven o'clock to another, and both
   * would land on your calendar as real bookings with two rooms opening at
   * once. Every reader downstream believed it: the streak counted two, the
   * calendar drew them stacked, and the band picked whichever sorted first.
   *
   * Two intervals overlap when each starts before the other ends. Cancelled
   * and declined rows are not bookings and hold no time. A proposal does
   * hold time, because the whole point of proposing is that it may become a
   * session, and offering the same hour twice is how you end up standing
   * somebody up.
   *
   * This is now advice rather than the rule. supabase/migration-no-double-
   * booking.sql puts an exclusion constraint on the table, which is the part
   * that is actually race-proof and the part that can see both people.
   *
   * It is still worth doing first, because it answers instantly, off
   * a calendar already in memory, and names the session you have clashed with
   * — none of which a constraint violation can do. It is the friendly half of
   * a rule whose enforcing half lives in the database.
   *
   * It is also stricter than the database on purpose. Here a proposal blocks
   * another proposal; there, only agreed sessions exclude each other, so that
   * two partners may each offer you the same hour and you pick one. Stricter
   * about what *you* offer, looser about what you may be offered. */
  function clashIn(list, startsAt, durationMin){
    var from = new Date(startsAt).getTime();
    var to   = from + (durationMin || 50) * 60000;
    return (list || []).filter(function(s){
      return s.status === 'confirmed' || s.status === 'proposed' ||
             s.status === 'completed';
    }).filter(function(s){
      var a = s.startsAt.getTime();
      return a < to && from < a + (s.durationMin || 50) * 60000;
    })[0] || null;
  }

  function proposeSession(opts){
    if (!client) return Promise.resolve({ demo: true });
    return currentUser().then(function(me){
      if (!me) return { demo: true };
      var myName = opts.myName || (me.email || '').split('@')[0];
      /* A room of its own, every time, and no longer an address.
         It used to be 'PeerFlow-' + the partner request id — the same public
         Jitsi URL for every session the two of you ever book, so anyone who
         had once been given it kept a working key to all the later ones.
         Then it became one URL per booking. Now it is not a URL at all: the
         room lives on our own server and the only way in is a signed token
         that call-token mints after checking the booking, so there is
         nothing left for an address to leak.

         room_url keeps its other job unchanged — it is the string that ties
         a booking's two rows together, and answer_session and drop_session
         still key on it. room_name is the room itself. */
      var id = newId();
      var common = {
        topic: opts.topic || null, starts_at: opts.startsAt,
        duration_min: opts.durationMin || 50,
        room_url: 'pf:' + id, room_name: 'pf-' + id,
        pair_id: opts.pairId || null, goal: opts.goal || null,
        status: 'proposed', proposed_by: me.id, note: opts.note || null
      };
      function row(userId, partnerName){
        var o = { user_id: userId, partner_name: partnerName };
        for (var k in common) if (common.hasOwnProperty(k)) o[k] = common[k];
        return o;
      }
      var rows = [ row(me.id, opts.partnerName || null), row(opts.partnerId, myName) ];

      /* pair_id arrives with migration-room-per-session.sql and room_name
         with migration-video.sql. Writing either to a database that hasn't
         run them fails the whole insert, and losing somebody's booking over
         a column they never asked for would be absurd — drop it and write
         the rest. A session that lands without room_name simply has no room
         until the migration is run, and says so plainly when somebody tries
         to join rather than sending them anywhere. */
      function put(list){
        return client.from('sessions').insert(list).then(function(r){
          var lost = /pair_id|goal|room_name/.exec(String(r.error && r.error.message || ''));
          if (r.error && missingColumn(r.error) && lost && list.length && (lost[0] in list[0])) {
            try {
              console.warn('PeerFlow: sessions.pair_id is missing. ' +
                           'Run supabase/migration-room-per-session.sql.');
            } catch(e){}
            return put(list.map(function(o){
              var c = {}; for (var k in o) if (o.hasOwnProperty(k) && k !== lost[0]) c[k] = o[k];
              return c;
            }));
          }
          /* The clash check below runs before this insert, but it reads the
             calendar the browser already has, and RLS means that calendar
             only ever contains your own rows. So two things still reach here:
             a partner who was already busy at that hour, which the browser
             cannot see at all, and a second device booking the same minute in
             the same instant. Both come back as a refusal from the database
             rather than a broken booking. */
          if (r.error && clashError(r.error)) return fail(r.error, clashMessage(r.error));
          if (r.error) return fail(r.error, 'Could not send that time. Please try again.');
          return { saved: true };
        });
      }
      /* Checked here rather than in the page, so every way of booking gets
         it \u2014 the form, a click on a free hour in the calendar, and the
         standing slot when it materialises next month's occurrences.

         A read that fails does not block a booking. Not knowing whether an
         hour is free is a much smaller problem than refusing to book
         anything the moment the network hiccups. */
      return fetchSessions().then(function(mine){
        var clash = mine && clashIn(mine, opts.startsAt, opts.durationMin);
        if (clash) {
          var when = clash.startsAt.toLocaleTimeString(undefined,
                       { hour:'numeric', minute:'2-digit' });
          return { error: 'You already have a session at ' + when +
                          (clash.partnerName ? ' with ' + clash.partnerName : '') +
                          '. Pick another time.' };
        }
        return put(rows);
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
        /* Accepting is the moment an offer becomes a commitment, so it is the
           moment the no-double-booking rule starts applying to it. Two people
           may each offer you the same hour quite legitimately; this is where
           the second yes is refused, and it has to say so specifically rather
           than as "could not accept that time", which reads like a fault. */
        if (clashError(r.error)) return fail(r.error, clashMessage(r.error));
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

  /* Move a session the two of you had already agreed.

     Everything about this is one call because it has to be one transaction.
     Rescheduling is four writes across two rooms — call off both copies of
     the old hour, offer both copies of a new one — and a browser can neither
     see all four rows (RLS hides your partner's) nor guarantee that the
     second pair happens if the first pair did. Doing it as cancel-then-book
     from here is how somebody ends up holding a cancelled evening while their
     partner holds a booking.

     So reschedule_session() in supabase/migration-reschedule.sql does the
     whole thing or none of it, and answers with the new room. The long note
     about what it refuses, and why each refusal is the database's job rather
     than the page's, is in that file.

     It is still a proposal. Nothing here books anything: the new time goes in
     as 'proposed' and the partner accepts it the way they accept any other,
     which is the rule this feature is least allowed to bend. */
  function rescheduleSession(startsAt, roomUrl, newStartsAt, newDuration, note){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc('reschedule_session', {
      p_starts_at: (startsAt instanceof Date ? startsAt.toISOString() : startsAt),
      p_room: roomUrl,
      p_new_starts_at: (newStartsAt instanceof Date ? newStartsAt.toISOString() : newStartsAt),
      p_new_duration: newDuration || null,
      p_note: note || null
    }).then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          return { needsMigration: true,
                   error: 'Moving a session isn\u2019t switched on for this site yet.' };
        }
        var code = r.error.code;
        /* Every one of these is a rule working correctly, so none of them is
           reported as a fault. They are also all states the page can reach
           legitimately by being a few seconds out of date, which is why each
           says what to do rather than only what went wrong. */
        if (code === 'PF001' || clashError(r.error)) return fail(r.error, clashMessage(r.error));
        if (code === 'PF021') return { error: 'That session isn\u2019t yours to move \u2014 refresh the page.' };
        if (code === 'PF022') return { error: 'That session can\u2019t be moved any more \u2014 refresh the page ' +
                                              'to see where it got to.' };
        if (code === 'PF023') return { error: 'That session has already started.' };
        if (code === 'PF024') return { error: 'That\u2019s in the past \u2014 pick a future time.' };
        if (code === 'PF025') return { error: 'That is the time it is already at.' };
        return fail(r.error, 'Could not move that session. Please try again.');
      }
      return { saved: true, roomUrl: r.data || null };
    }).catch(function(e){
      return fail(e, 'Could not move that session \u2014 check your connection and try again.');
    });
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
            /* The insert policy refusing it. Two rules sit behind that policy
               — you have blocked each other, or new requests are paused after
               three missed sessions — and the browser is told neither, on
               purpose: which of the two it is is a fact about somebody else's
               blocklist, and "you have been blocked" is not something PeerFlow
               says out loud.

               The page still explains the half it is allowed to. People
               already knows about its own cooldown, from partnering_status(),
               and puts a notice above the list and disables the buttons — so
               anybody who reaches this line during a pause has been told
               already, and this is the backstop rather than the explanation.

               What it must not do is what it used to: report a rule working
               correctly as "please try again", which invites somebody to
               press a button that will refuse them every time. */
            if (r.error.code === '42501') {
              return { error: 'You can’t send this person a request right now.' };
            }
            /* Safe to name: it describes what this person already did, not the schema. */
            return fail(r.error, 'Could not send the request. Please try again.');
          }
          /* And tell them. notify_request() has been in the database since the
             MVP migration — written, locked to pairs who genuinely have a
             request between them, granted to authenticated — and never once
             called from here. A request that only writes a row is a request
             the other person finds by accident, or not at all.

             The insert has already succeeded by this point, so a failure here
             is logged and swallowed: the request is real either way, and an
             error saying otherwise would misreport what happened. */
          return getProfile().then(function(me){
            var who = (me && me.name) ? me.name : 'Someone';
            return client.rpc('notify_request', {
              p_to: toUserId,
              p_title: who + ' wants to study with you',
              p_body: message || null
            }).then(function(n){
              if (n.error) {
                if (missingFunction(n.error)) {
                  console.warn('PeerFlow: notify_request is missing. Run ' +
                               'supabase/migration-mvp.sql so requests reach people.');
                } else {
                  try { console.warn('PeerFlow: notify_request', n.error); } catch(e){}
                }
              }
              return { sent: true, notified: !n.error };
            });
          }).catch(function(){ return { sent: true, notified: false }; });
        });
    }).catch(function(e){
      return fail(e, 'Could not send the request \u2014 check your connection and try again.');
    });
  }

  /* Every request involving the signed-in user, with the other person's
     profile attached. Returns { incoming: [], outgoing: [], me: uid }. */
  /* The standing-slot columns arrive with migration-standing.sql. Asked for
     separately from the rest so a database without it still loads partners. */
  var REQ_BASE = 'id,from_user,to_user,message,status,to_seen_at,from_seen_at,created_at';
  var REQ_FULL = REQ_BASE + ',standing_anchor,standing_minutes,standing_by,standing_set_at,standing_ok_at';
  /* dormant_nudged_at arrives with migration-dormancy.sql, and it gets a rung
     of its own for the same reason the sessions ladder gives one to
     rescheduled_from: a database that has standing slots but not dormancy
     should lose dormancy, not fall all the way to the base set and lose the
     standing slot with it. */
  var REQ_DORM = REQ_FULL + ',dormant_nudged_at';

  /* Widest first, one migration per step down. */
  var REQ_LADDER = [
    { cols: REQ_DORM, need: 'supabase/migration-dormancy.sql',
      what: 'the dormancy stamp is missing' },
    { cols: REQ_FULL, need: 'supabase/migrate-2026-08.sql',
      what: 'standing-slot columns are missing' },
    { cols: REQ_BASE, need: null, what: null }
  ];

  /* Which column set this database actually has, once we have found out.
     The fallback works, but it costs a failed request to discover — and
     myRequests runs at least twice on any page with the bell, so an
     un-migrated project logged a red 400 on partner_requests two or three
     times on every single load. The page was fine underneath; it did not
     look fine, and a console full of red is where somebody reasonably
     concludes the site is broken and stops reading.

     Remembered for the life of the page rather than stored: run the
     migration and the next load finds the wide set again, with no stale flag
     to clear. */
  var reqCols = null;

  function myRequests(){
    if (!client) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      function read(cols){
        return client.from('partner_requests')
          .select(cols)
          .or('from_user.eq.' + uid + ',to_user.eq.' + uid)
          .order('created_at', { ascending: false });
      }
      /* Once a rung has answered, stay on it for the life of the page. The
         fallback works but costs a failed request to discover, and myRequests
         runs at least twice on any page with the bell. */
      function climb(i){
        var rung = REQ_LADDER[i];
        return read(rung.cols).then(function(r){
          if (!missingColumn(r.error) || i + 1 >= REQ_LADDER.length) {
            if (!r.error) reqCols = rung.cols;
            return r;
          }
          try {
            console.warn('PeerFlow: ' + rung.what + '. Run ' + rung.need + '.');
          } catch(e){}
          return climb(i + 1);
        });
      }
      if (reqCols) return climb(REQ_LADDER.map(function(x){ return x.cols; }).indexOf(reqCols));
      return climb(0)
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

  /* Telling somebody you have said yes to them.

     Saying yes used to be silent. The row changed, and the person who asked
     found out the next time they happened to open PeerFlow and look at the
     bell — which is derived from partner_requests, so it only exists while
     the tab is open and never leaves the building. Nothing was emailed,
     because nothing was written to public.notifications, because the accept
     path never wrote a row there.

     That is the first half of the commonest way this product fails: two
     people say yes to each other, neither knows what to do next, and a
     fortnight later both assume the other lost interest. So the answer is a
     real notification — it survives, it goes in the log, and the trigger in
     migration-notify.sql posts it to notify-email like every other one.

     notify_partner() rather than notify_request(): the row is 'accepted' by
     the time this runs, so the partnership check passes, and notify_partner
     is the one that takes a kind and an href. notify_request would have
     worked too and would have landed everybody on People, which is a
     directory of strangers — the wrong place to send somebody who has just
     stopped needing one.

     The href names the accepter, so the link opens the booking form already
     pointed at them. See the ?plan= handler in app.html.

     The accept has already succeeded by the time this is called, so a failure
     here is logged and swallowed. The partnership is real either way, and an
     error saying otherwise would misreport what happened. */
  function notifyAccepted(toUserId){
    return getProfile().then(function(me){
      var who = (me && me.name) ? String(me.name).trim() : '';
      var first = who ? who.split(/\s+/)[0] : 'They';
      return client.rpc('notify_partner', {
        p_to: toUserId,
        p_kind: 'partner',
        p_title: (who || 'Your request') + ' said yes',
        p_body: 'You\u2019re partners now. Pick an hour you\u2019re both free and propose it \u2014 ' +
                'nothing is booked until ' + first + ' accepts.',
        p_href: 'app.html?plan=' + ((me && me.id) || '')
      }).then(function(n){
        if (n.error) {
          if (missingFunction(n.error)) {
            console.warn('PeerFlow: notify_partner is missing. Run ' +
                         'supabase/migration-mvp.sql so an accepted request reaches people.');
          } else {
            try { console.warn('PeerFlow: notify_partner', n.error); } catch(e){}
          }
        }
        return !n.error;
      });
    }).catch(function(){ return false; });
  }

  /* Accept or decline a request sent to you.

     Comes back with partnerId — who the answer was about — because every
     caller wants it and none of them has it: the inbox row on People knows a
     request id, and what it needs afterwards is a link to the person. Read
     off the updated row rather than passed in, so it cannot disagree with
     what the database actually changed. */
  function respondToRequest(id, status){
    if (!client) return Promise.resolve({ demo: true });
    return client.from('partner_requests')
      .update({ status: status, to_seen_at: new Date().toISOString() })
      .eq('id', id)
      /* Allowed by "read own requests": you are the to_user of anything you
         are answering. A database that refuses it still answers saved — the
         answer is the point, the id is a convenience. */
      .select('id,from_user,to_user')
      .then(function(r){
        if (r.error) return fail(r.error, 'Could not save that answer. Please try again.');
        var row = (r.data || [])[0] || null;
        var them = row ? row.from_user : null;
        if (status !== 'accepted' || !them) return { saved: true, partnerId: them };
        return notifyAccepted(them).then(function(notified){
          return { saved: true, partnerId: them, notified: notified };
        });
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
      var me = r.me;
      return r.incoming.concat(r.outgoing)
        .filter(function(x){ return x.status === 'accepted'; })
        .map(function(x){
          return {
            requestId: x.id,
            profile: x.other,
            /* When the request was sent, which is the closest thing this
               table has to when the partnership started — there is no
               accepted_at column and adding one is a migration for a date
               nothing displays. Used only to order partnerships you have
               never met on, oldest first, so the dashboard singles out the
               one that has been sitting longest rather than whichever the
               query happened to return first. */
            askedAt: x.created_at ? new Date(x.created_at) : null,
            /* When this partnership's dormancy was last raised with one of
               them, or waved off by one of them. The dashboard reads it as
               "leave this pair alone for now".

               Undefined rather than null without migration-dormancy.sql — the
               column is not selected on that rung at all — so the band can
               tell "nothing has been raised" from "this database cannot
               remember whether anything was", and does not offer a Not now
               that has nowhere to be stored. */
            dormantNudgedAt: ('dormant_nudged_at' in x)
              ? (x.dormant_nudged_at ? new Date(x.dormant_nudged_at) : null)
              : undefined,
            /* No roomUrl here any more. Handing out one address per
               partnership is what made it a standing key; a room is minted
               when a session is booked. requestId is what callers now use to
               mean "this partnership". */
            /* null on a database without migration-standing.sql, which the
               dashboard reads as "no standing slot" — the honest answer. */
            standing: x.standing_anchor ? {
              anchor:  new Date(x.standing_anchor),
              minutes: x.standing_minutes || 50,
              /* Who has to do something next, which is the only thing the
                 page needs out of standing_by and standing_ok_at. */
              agreed:  !!x.standing_ok_at,
              mine:    x.standing_by === me
            } : null
          };
        });
    });
  }

  /* ---------- standing weekly slot ----------
     Suggest a time, the other person agrees once, and it repeats until one of
     you stops it. All four are definer functions: the columns live on the
     partnership row, which both people can read but neither should be able to
     rewrite on the other's behalf. */

  function standingRpc(name, args, msg){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc(name, args).then(function(r){
      if (!r.error) return { saved: true, count: r.data };
      if (missingFunction(r.error)) {
        console.warn('PeerFlow: ' + name + ' is missing. Run supabase/migration-standing.sql.');
        return { needsMigration: true, error: 'Weekly slots aren’t switched on for this site yet.' };
      }
      return fail(r.error, msg);
    }).catch(function(e){
      return fail(e, msg);
    });
  }

  /* anchor is the first occurrence as a real instant, not a weekday and an
     hour: two people in two timezones would not agree on which Thursday 19:00
     they meant, and would each sit alone in a room the weekend one of them
     changed their clocks. */
  function setStanding(requestId, anchor, minutes){
    return standingRpc('set_standing_slot', {
      p_request: requestId,
      p_anchor: (anchor instanceof Date ? anchor.toISOString() : anchor),
      p_minutes: minutes || 50
    }, 'Could not set that up. Please try again.');
  }

  function acceptStanding(requestId){
    return standingRpc('accept_standing_slot', { p_request: requestId },
      'Could not agree to that. Please try again.');
  }

  function clearStanding(requestId){
    return standingRpc('clear_standing_slot', { p_request: requestId },
      'Could not stop it. Please try again.');
  }

  /* Books whatever is missing from the next few weeks. There is no scheduler
     behind a static site, so this runs when somebody opens the app — which is
     safe to do on every load, because it fills gaps rather than adding. */
  function materialiseStanding(requestId, weeks){
    return standingRpc('materialise_standing',
      { p_request: requestId, p_weeks: weeks || 4 },
      'Could not put this week’s sessions on the calendar.');
  }

  /* ================================================================
     Momentum — the streak, and the week it sits in.

     Lives here rather than on a page because two pages were counting it and
     disagreeing: Progress bucketed weeks with Math.floor(t / 604800000),
     which counts from the Unix epoch — a Thursday — so its weeks ran Thursday
     to Wednesday while the dashboard's ran Monday to Sunday. Same rows, two
     different streaks, depending which tab you were on.
     ================================================================ */

  /* Monday, local time. Everything about weeks starts here. */
  function weekStart(d){
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  }
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  /* A session that actually happened.
   *
   * This used to count bookings: confirmed, and its time has passed. That was
   * a compromise with a reason — nothing recorded attendance, so the only
   * alternative was asking people whether they turned up, and a self-reported
   * number is worse than none. Now the room reports it. LiveKit's webhook
   * writes attended on join, and close_room marks the people who never
   * arrived when the room ends, so there is something real to count.
   *
   * Three answers, and the third is the one that matters:
   *
   *   attended true    you were there. It counts, whatever the status says.
   *   attended false   you were not. It does not count, and no amount of
   *                    having booked it changes that.
   *   attended null    nothing observed — and that splits in two.
   *
   * A null on a session with no room_name is from before any of this existed.
   * We could not have seen it, and an absent verdict is not a verdict of
   * absent, so it falls back to the old rule and counts as a booking.
   *
   * A null on a session that HAD a room is different: something was watching
   * and saw nobody. The usual cause is that neither of you opened the page at
   * all, so LiveKit never created the room and no room_finished ever fired to
   * write the false. Counting that would let a streak live entirely on
   * sessions nobody attended, which is the exact thing this change exists to
   * stop. It is only read that way once the session is properly over — until
   * then there is still time to turn up.
   *
   * The reliability score is unaffected either way: it reads the column
   * itself, and stays blank until the room has written enough of them. */
  function finished(list, now){
    list = list || [];

    /* Whether the room has ever reported anything at all.
     *
     * This is the guard that stops the rule above being dangerous. Attendance
     * arrives from one place — LiveKit's webhook — and there are ordinary
     * ways for that to be silent: deployed without --no-verify-jwt, the
     * webhook URL never added, the keys rotated on one side only. In every
     * one of them attended stays null on every row forever, and "a room
     * existed and saw nobody" would then be true of every session ever
     * booked. Somebody's streak would go to zero overnight with nothing on
     * screen to explain it.
     *
     * Silence from something that has never spoken is not evidence. Until at
     * least one verdict exists somewhere in this person's history, the old
     * booking rule stands unchanged. The first real join switches it on. */
    var heard = list.some(function(s){
      return s.attended === true || s.attended === false;
    });

    return list.filter(function(s){
      if (s.attended === true) return true;
      if (s.attended === false) return false;
      if (s.status === 'completed') return true;
      if (s.status !== 'confirmed') return false;
      if (s.startsAt.getTime() + s.durationMin * 60000 > now) return false;
      return !heard || !s.roomName;
    });
  }

  /* Weeks in a row with at least one session in them, counted backwards.
     Two rules that are not obvious:

     The current week never breaks a streak. It is not over yet, so an empty
     Monday morning must not read as a failure — the streak stands until the
     week it belongs to has actually ended.

     One week off is forgiven, once per run. A streak that dies to a week of
     exams takes the person with it: the whole risk of a counter is that
     breaking it is a reason to stop altogether. The rest is only spent on a
     streak already worth protecting, never on the first week. */
  function streakOf(weeks, nowWeek){
    var n = 0, wk = nowWeek, rested = false;
    if (!weeks[wk]) wk -= WEEK_MS;          /* this week is still open */
    while (true) {
      if (weeks[wk]) { n++; wk -= WEEK_MS; continue; }
      if (!rested && n >= 2) { rested = true; wk -= WEEK_MS; continue; }
      break;
    }
    return { weeks: n, rested: rested };
  }

  /* The last `span` weeks, oldest first, ending with the one we are in.
     A streak is a claim about the past; this is the past itself, and it is the
     only part of the record that shows the shape of somebody's habit — the
     fortnight they missed, the month they did not. */
  function historyOf(weeks, nowWeek, span, goal){
    var out = [];
    for (var i = span - 1; i >= 0; i--) {
      var k = nowWeek - i * WEEK_MS;
      var n = weeks[k] || 0;
      out.push({ start: k, count: n, met: n >= goal, current: i === 0 });
    }
    return out;
  }

  function bestOf(weeks){
    var keys = Object.keys(weeks).map(Number).sort(function(a, b){ return a - b; });
    var best = keys.length ? 1 : 0, run = best;
    for (var i = 1; i < keys.length; i++) {
      run = (keys[i] === keys[i - 1] + WEEK_MS) ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }

  /* Today asks for the pair's streak and the top bar asks for yours, on the
     same page load, from the same two tables. Held briefly so that costs one
     read rather than two — short enough that nothing on screen can go stale
     behind it, since a session takes minutes to finish, not seconds, and every
     page that changes a session reloads afterwards. */
  var snap = null, snapAt = 0;
  function momentumSource(){
    var now = Date.now();
    if (!snap || now - snapAt > 10000) {
      snapAt = now;
      snap = Promise.all([fetchSessions(), getProfile()])
        .catch(function(e){ snap = null; throw e; });
    }
    return snap;
  }

  /* Everything the ring and the record need, from one read of the sessions.

     pairId, when given, narrows it to the sessions you had with one person —
     which is how a streak becomes "you and Amir" rather than "you".

     This used to filter on the room URL, which worked only while every
     session with the same person reused one room. Now that a room belongs to
     a single booking, the partnership is its own column and the filter reads
     that instead. */
  function momentum(pairId){
    return momentumSource().then(function(r){
      var list = r[0], profile = r[1] || {};
      if (!list) return null;

      var now = Date.now(), nowWeek = weekStart(now);
      var done = finished(list, now);
      if (pairId) done = done.filter(function(s){ return s.pairId === pairId; });

      var weeks = {};
      done.forEach(function(s){
        var k = weekStart(s.startsAt);
        weeks[k] = (weeks[k] || 0) + 1;
      });

      var st = streakOf(weeks, nowWeek);
      var goal = profile.sessions_per_week;
      goal = (goal >= 1 && goal <= 5) ? goal : 2;

      var thisWeek = weeks[nowWeek] || 0;

      /* Sunday night is the deadline, so "days left" counts the rest of the
         week including today. */
      var dayOfWeek = (new Date(now).getDay() + 6) % 7;

      return {
        done: done.length,
        minutes: done.reduce(function(a, s){ return a + (s.durationMin || 0); }, 0),
        streak: st.weeks,
        rested: st.rested,
        best: bestOf(weeks),
        goal: goal,
        thisWeek: thisWeek,
        metThisWeek: thisWeek >= goal,
        daysLeft: 7 - dayOfWeek,
        history: historyOf(weeks, nowWeek, 12, goal)
      };
    }).catch(function(){ return null; });
  }

  function saveGoal(n){
    if (!client) return Promise.resolve({ demo: true });
    n = Math.max(1, Math.min(5, n | 0));
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('profiles').update({ sessions_per_week: n }).eq('id', uid)
        .then(function(r){
          if (r.error) {
            if (missingColumn(r.error)) {
              console.warn('PeerFlow: sessions_per_week is missing. Run supabase/migration-goal.sql.');
              return { needsMigration: true, error: 'Weekly goals aren’t switched on for this site yet.' };
            }
            return fail(r.error, 'Could not save that. Please try again.');
          }
          return { saved: true };
        });
    }).catch(function(e){ return fail(e, 'Could not save that. Please try again.'); });
  }

  /* ---------- one person ---------- */

  /* Everything on somebody's profile, for the page that shows it. Profiles
     are readable by any signed-in user (the "profiles are viewable" policy)
     — this is a directory of people looking for a study partner, and you
     cannot judge whether somebody suits you from a name and a topic. */
  function getPerson(id){
    if (!client || !id) return Promise.resolve(null);
    return client.from('profiles')
      .select('id,name,track_id,topic,level,timezone,availability,created_at')
      .eq('id', id).limit(1)
      .then(function(r){
        if (r.error || !r.data || !r.data.length) return null;
        return r.data[0];
      }).catch(function(){ return null; });
  }

  /* ---------- messages ----------
     Who may message whom is decided in the database, not here: the insert
     policy requires a partner request between the two of you in some
     direction, so a stranger cannot open a thread with you uninvited. */

  var MSG_COLS = 'id,from_user,to_user,body,created_at,read_at';

  function messagesMissing(err){
    /* PGRST205 is "table not in the schema cache", i.e. migration-chat.sql
       has not been run. Everything messaging-related answers with a flag
       rather than an error so the page can say so in one sentence. */
    return !!err && (err.code === 'PGRST205' || err.code === '42P01' ||
                     /relation .* does not exist|find the table/i.test(String(err.message || '')));
  }

  function sendMessage(toId, body){
    if (!client) return Promise.resolve({ demo: true });
    var text = String(body == null ? '' : body).trim();
    if (!text) return Promise.resolve({ error: 'Write something first.' });
    if (text.length > 2000) return Promise.resolve({ error: 'That is too long — 2000 characters at most.' });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('messages')
        .insert({ from_user: uid, to_user: toId, body: text })
        .select(MSG_COLS)
        .then(function(r){
          if (r.error) {
            if (messagesMissing(r.error)) return { needsMigration: true,
              error: 'Messages aren’t switched on for this site yet.' };
            /* The insert policy is the only other thing that can refuse this,
               and it means exactly one thing. */
            if (r.error.code === '42501' || /policy/i.test(String(r.error.message || '')))
              return { error: 'You can only message someone you’ve asked, or who has asked you.' };
            return fail(r.error, 'Could not send that. Please try again.');
          }
          return { saved: true, message: (r.data || [])[0] || null };
        });
    }).catch(function(e){
      return fail(e, 'Could not send that — check your connection and try again.');
    });
  }

  /* One conversation, oldest first, which is the order it is read in. */
  function fetchThread(otherId){
    if (!client || !otherId) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      return client.from('messages').select(MSG_COLS)
        .or('and(from_user.eq.' + uid + ',to_user.eq.' + otherId + '),' +
            'and(from_user.eq.' + otherId + ',to_user.eq.' + uid + ')')
        .order('created_at', { ascending: true })
        .limit(400)
        .then(function(r){
          if (r.error) return messagesMissing(r.error) ? { needsMigration: true } : null;
          return (r.data || []).map(function(m){
            return { id: m.id, body: m.body, mine: m.from_user === uid,
                     at: new Date(m.created_at), readAt: m.read_at ? new Date(m.read_at) : null };
          });
        });
    }).catch(function(){ return null; });
  }

  /* Everybody you can talk to, newest conversation first, each with its last
     line and how many of theirs you have not read.

     Grouped here rather than in a view: at the size this app is, one query
     for your own messages is cheaper than a round trip per thread, and it
     keeps the schema to one table. */
  function threads(){
    if (!client) return Promise.resolve(null);
    return Promise.all([currentUid(), myRequests()]).then(function(both){
      var uid = both[0], reqs = both[1];
      if (!uid) return null;

      var people = {};
      if (reqs) reqs.incoming.concat(reqs.outgoing).forEach(function(r){
        var o = r.other || {};
        if (o.id) people[o.id] = { id: o.id, name: o.name || 'Someone', topic: o.topic || '',
                                   partner: r.status === 'accepted' };
      });

      return client.from('messages').select(MSG_COLS)
        .or('from_user.eq.' + uid + ',to_user.eq.' + uid)
        .order('created_at', { ascending: false })
        .limit(500)
        .then(function(r){
          if (r.error) return messagesMissing(r.error) ? { needsMigration: true } : null;

          (r.data || []).forEach(function(m){
            var otherId = m.from_user === uid ? m.to_user : m.from_user;
            var t = people[otherId];
            /* A thread with somebody whose request has since been deleted
               still has to be readable — you said those things to a real
               person. */
            if (!t) t = people[otherId] = { id: otherId, name: 'Someone', topic: '', partner: false };
            if (!t.last) { t.last = m.body; t.at = new Date(m.created_at); t.lastMine = m.from_user === uid; }
            if (m.to_user === uid && !m.read_at) t.unread = (t.unread || 0) + 1;
          });

          return Object.keys(people).map(function(k){ return people[k]; })
            .sort(function(a, b){
              /* Conversations that exist come before people you have never
                 written to; among those, most recent first. */
              if (a.at && b.at) return b.at - a.at;
              if (a.at) return -1;
              if (b.at) return 1;
              return String(a.name).localeCompare(String(b.name));
            });
        });
    }).catch(function(){ return null; });
  }

  function markThreadRead(otherId){
    if (!client || !otherId) return Promise.resolve({ demo: true });
    return client.rpc('mark_thread_read', { p_other: otherId }).then(function(r){
      if (r.error) return missingFunction(r.error) ? { needsMigration: true } : { error: true };
      return { saved: true, count: r.data };
    }).catch(function(){ return { error: true }; });
  }

  /* Just the number, for the badge on the Chat tab. */
  function unreadMessages(){
    if (!client) return Promise.resolve(0);
    return currentUid().then(function(uid){
      if (!uid) return 0;
      return client.from('messages').select('id', { count: 'exact', head: true })
        .eq('to_user', uid).is('read_at', null)
        .then(function(r){ return r.error ? 0 : (r.count || 0); });
    }).catch(function(){ return 0; });
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

  /* Whether you did the thing you sat down to do.

     Not attendance — that is the room's to report and there is no room yet.
     This is the one fact about a session no server can observe, and it is
     only ever asked about a session where somebody actually wrote a goal, so
     it cannot nag anyone who never set one.

     Your own row: the goal is the session's and shared by both copies, the
     answer is yours. */
  function markGoal(startsAt, roomUrl, done){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      var q = client.from('sessions')
        .update({ goal_done: !!done, completed_at: new Date().toISOString() })
        .eq('user_id', uid).eq('starts_at', startsAt);
      if (roomUrl) q = q.eq('room_url', roomUrl);
      return q.then(function(r){
        if (r.error && missingColumn(r.error)) {
          try { console.warn('PeerFlow: session goals need supabase/migration-mvp.sql.'); } catch(e){}
          return { needsMigration: true, error: 'Goals aren\u2019t switched on for this site yet.' };
        }
        if (r.error) return fail(r.error, 'Could not save that. Please try again.');
        return { saved: true };
      });
    }).catch(function(e){
      return fail(e, 'Could not save that \u2014 check your connection and try again.');
    });
  }

  /* ---------- the call ----------

     Asking to be let into a session's room. The answer is a signed LiveKit
     token, or a word saying why not.

     This is a raw fetch rather than functions.invoke because the refusal is
     the interesting part: invoke turns any non-2xx into an opaque error
     object and the reason has to be dug back out of it, and the reason is
     the whole message the page shows. Here the status and the body are just
     read.

     Nothing about which room, or who you are, is sent — only which session.
     The server reads the booking and decides both, which is what stops a
     room being somewhere you can talk your way into. */
  function callToken(sessionId){
    if (!client) return Promise.resolve({ ok: false, reason: 'offline' });
    return client.auth.getSession().then(function(res){
      var s = res && res.data && res.data.session;
      if (!s) return { ok: false, reason: 'signed-out' };

      return fetch(cfg.url + '/functions/v1/call-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.key,
          'Authorization': 'Bearer ' + s.access_token
        },
        body: JSON.stringify({ session: sessionId })
      }).then(function(r){
        return r.json().catch(function(){ return {}; }).then(function(body){
          if (r.ok && body.token) return Object.assign({ ok: true }, body);
          /* A function that was never deployed answers 404 with a body that
             is not ours. Telling those apart matters: one is "you cannot
             join this", the other is "this site is not finished". */
          var reason = body.reason ||
            (r.status === 404 ? 'not-deployed' : 'server');
          try {
            if (reason === 'not-deployed' || reason === 'not-configured') {
              console.warn('PeerFlow: the call-token function is not deployed or ' +
                           'has no LiveKit keys. See docs/VIDEO.md.');
            }
          } catch(e){}
          return { ok: false, reason: reason, status: r.status,
                   startsAt: body.startsAt || null };
        });
      });
    }).catch(function(e){
      try { console.error('PeerFlow:', e); } catch(err){}
      return { ok: false, reason: 'offline' };
    });
  }

  /* ---------- availability, across timezones ----------

     A profile stores when someone is free as day-band strings — "tue-evening"
     — chosen in their own local time, with the zone in a column beside them.
     Signup says as much: "Hours are shown in your own time, and your partner
     sees theirs."

     Every page that compared two people's availability used to intersect
     those strings directly, which asks whether two people wrote down the same
     words rather than whether they are free at the same time. For anyone in
     the same zone the two questions have the same answer, which is why it
     held together; across zones it inverts. Someone in Tashkent and someone
     in Los Angeles who both mark five evenings share no hour at all, and the
     People page ranked that pair top with "5 times you're both free" —
     printing America/Los_Angeles on the same card.

     setStanding, four hundred lines up, already says why: "two people in two
     timezones would not agree on which Thursday 19:00 they meant". Sessions
     are stored as instants and were always right. It was only the question
     of who to suggest, and which hours to offer, that was being asked in
     words instead of in time.

     So: expand each side's bands into real intervals on a UTC week,
     intersect those, and hand the result back in the viewer's own hours.

     Two things this deliberately does not do. It reads the offset as it
     stands today, because a weekly slot has no date to read it at — when the
     clocks go back, a shared window moves by an hour and both people see it
     move. And an hour is only reported as shared when the whole of it is
     inside both windows, so a half-hour zone loses an hour at each edge
     rather than a menu offering a time one of you never claimed. */

  var AV_DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
  /* Local clock hours each band covers, as [start, end). Night ends at 26
     rather than at 2 because it runs into the next day and the week wraps. */
  var AV_BANDS = { morning:[6,12], afternoon:[12,17], evening:[17,22], night:[22,26] };
  var WEEK_MIN = 7 * 24 * 60;

  /* Minutes east of UTC for an IANA zone, right now. Formatting an instant in
     the zone and reading the result back as though it were UTC gives the
     offset without carrying a timezone library. */
  function tzOffset(tz, when){
    if (!tz) return null;
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var p = {};
      f.formatToParts(when).forEach(function(x){ p[x.type] = x.value; });
      var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
      return Math.round((asUtc - when.getTime()) / 60000);
    } catch (e) { return null; }        /* a zone this browser doesn't know */
  }

  /* Fold a list of [start,end) minute intervals onto one week: wrap anything
     that runs past Saturday midnight round to Sunday, then sort and merge. */
  function avNormalise(list){
    var out = [];
    list.forEach(function(iv){
      var len = iv[1] - iv[0];
      if (len <= 0) return;
      var s = ((iv[0] % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
      if (s + len <= WEEK_MIN) out.push([s, s + len]);
      else { out.push([s, WEEK_MIN]); out.push([0, s + len - WEEK_MIN]); }
    });
    out.sort(function(a, b){ return a[0] - b[0]; });
    var merged = [];
    out.forEach(function(iv){
      var last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) { if (iv[1] > last[1]) last[1] = iv[1]; }
      else merged.push([iv[0], iv[1]]);
    });
    return merged;
  }

  /* Local day-band slots -> intervals on the UTC week. An unknown or missing
     zone is treated as UTC, which is the old behaviour for that row rather
     than a new kind of wrong. */
  function avToUtc(slots, tz){
    var off = tzOffset(tz, new Date());
    if (off === null) off = 0;
    var out = [];
    (slots || []).forEach(function(slot){
      var bits = String(slot).split('-');
      var day = AV_DAYS.indexOf(bits[0]), band = AV_BANDS[bits[1]];
      if (day < 0 || !band) return;
      var start = day * 1440 + band[0] * 60 - off;
      out.push([start, start + (band[1] - band[0]) * 60]);
    });
    return avNormalise(out);
  }

  function avIntersect(a, b){
    var out = [], i = 0, j = 0;
    while (i < a.length && j < b.length) {
      var s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
      if (e > s) out.push([s, e]);
      if (a[i][1] < b[j][1]) i++; else j++;
    }
    return out;
  }

  /* UTC intervals -> whole hours in the viewer's own week. An hour counts
     only when the whole of it is covered, which is what keeps a menu from
     offering a time that is only half inside somebody's window. */
  function avProject(intervals, viewerTz){
    var minutes = 0;
    intervals.forEach(function(iv){ minutes += iv[1] - iv[0]; });

    var off = tzOffset(viewerTz, new Date());
    if (off === null) off = 0;
    var local = avNormalise(intervals.map(function(iv){ return [iv[0] + off, iv[1] + off]; }));

    var byDay = {}, hours = 0;
    for (var h = 0; h < 168; h++) {
      var s = h * 60, e = s + 60, inside = false;
      for (var k = 0; k < local.length; k++) {
        if (local[k][0] <= s && local[k][1] >= e) { inside = true; break; }
      }
      if (!inside) continue;
      var d = Math.floor(h / 24);
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(h % 24);
      hours++;
    }
    return { hours: hours, minutes: minutes, byDay: byDay };
  }

  /* One person's week, read in somebody else's clock. What the partner page
     needs to shade "when they are free" against your own days rather than
     against theirs. */
  function availabilityHours(slots, tz, viewerTz){
    if (!slots || !slots.length) return { hours: 0, minutes: 0, byDay: {} };
    return avProject(avToUtc(slots, tz), viewerTz);
  }

  /* The one call every page makes.

     Returns the hours the two of you really share, counted and laid out by
     weekday in the *viewer's* local time, so a caller can rank on `hours`,
     say so in a sentence, light up a calendar or fill a menu without ever
     handling a zone itself. */
  function sharedAvailability(mine, myTz, theirs, theirTz){
    if (!mine || !mine.length || !theirs || !theirs.length)
      return { hours: 0, minutes: 0, byDay: {} };
    return avProject(avIntersect(avToUtc(mine, myTz), avToUtc(theirs, theirTz)), myTz);
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
           answered, and this used to require a path so those half-finished
           rows stayed out. It hid real people: somebody who signed up, sent a
           request and had not yet picked a path was invisible to the person
           they had asked — who then could not find them to answer.

           A name is the honest floor. Somebody who has told us who they are
           has joined; the ranking already sorts anyone with nothing in common
           to the bottom, which is where a half-finished profile belongs
           without being erased. */
        .not('name', 'is', null)
        .neq('name', '')
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
     Progress page support.

     app-progress.html is the one page kept from the MVP rebuild, so these
     are the only functions from it that remain: attendance counts, the
     learning-path stage, and recording an achievement so it can be
     announced once rather than on every page load.
     ================================================================ */

  /* How often somebody turns up, for people who are not you.

     Their session rows are not readable — RLS stops there, and should: a
     calendar is private. reliability_of() is security definer and returns
     four numbers per person, never a row, so a reputation can be public
     while a diary stays shut.

     Asked for the whole list at once. One call per face on the People page
     would be twenty round trips to draw one column. */
  function reliabilityOf(ids){
    if (!client) return Promise.resolve(null);
    var want = (ids || []).filter(Boolean);
    if (!want.length) return Promise.resolve({});
    return client.rpc('reliability_of', { p_users: want }).then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          console.warn('PeerFlow: reliability_of is missing. ' +
                       'Run supabase/migration-reliability.sql to turn on the score.');
          return null;
        }
        /* Including the column the migration adds — an older database has the
           function but not joined_at only if it was applied by hand. */
        if (missingColumn(r.error)) return null;
        return null;
      }
      var by = {};
      (r.data || []).forEach(function(x){
        by[x.uid] = { pct: x.pct, counted: x.counted,
                      attended: x.attended_n, noShows: x.noshow_n,
                      /* Added by migration-attendance.sql. Undefined against
                         the older function, which every reader treats as zero
                         — the counts are a detail line, and a profile missing
                         one clause is a much smaller problem than a page that
                         throws because a field it expected is not there. */
                      early: x.early_n || 0, late: x.late_n || 0,
                      expected: (x.expected_n === undefined || x.expected_n === null)
                        ? (x.attended_n || 0) + (x.noshow_n || 0)
                        : x.expected_n,
                      firstAt: x.first_at ? new Date(x.first_at) : null };
      });
      return by;
    }).catch(function(){ return null; });
  }

  /* The words that go in front of the number. A bare percentage invites
     arithmetic nobody wants to do — "is 82 good?" — so the label answers it
     and the number backs the label up.

     The bands themselves moved to assets/reliability.js, along with the rest
     of the scoring policy, so that the thresholds and the words that describe
     them sit next to each other and can be tested without a browser. This is
     the shim that keeps every existing caller working: the pages call
     pf.reliabilityLabel(pct) and always have.

     `counted` is new and optional, and it is the whole reason the shim is not
     just a rename. Without it a person with no score renders as an empty
     string, which is how a brand-new user came to show as a blank column
     between two people who had numbers — reading, to anybody scanning the
     list, as though PeerFlow knew something about them and would not say.
     With it they read as "New partner", which is the truth. */
  function reliabilityLabel(pct, counted){
    if (window.pfReliability) return window.pfReliability.label(pct, counted);
    /* assets/reliability.js not on the page. Every page that shows a score
       loads it, but db.js is loaded by pages that do not, so this stays
       rather than throwing at them. */
    if (pct === null || pct === undefined) return counted === undefined ? '' : 'New partner';
    if (pct >= 95) return 'Always turns up';
    if (pct >= 90) return 'Very reliable';
    if (pct >= 80) return 'Reliable';
    if (pct >= 65) return 'Usually turns up';
    return 'Often misses';
  }

  /* ================================================================
     Attendance.

     Four calls, all of them thin: the rules are in the database, because
     attendance that a browser can write is attendance nobody can rely on.
     What these do is ask, at the moments a page knows something has changed.
     ================================================================ */

  /* Decide the outcome of everything of yours that has finished.

     There is no scheduler behind a static site — the same problem
     migration-standing.sql solved by materialising occurrences on page load —
     so this runs when somebody opens the app. That is not a compromise here
     so much as the right shape: the person who most wants a no-show written
     down is the person who sat waiting through it, and they are exactly the
     one who opens PeerFlow afterwards to find out what happened.

     Silent about everything. A page that told somebody "could not settle
     attendance" would be reporting on plumbing they never asked about, and
     the answer is the same either way — try again next load. */
  function settleAttendance(){
    if (!client) return Promise.resolve(0);
    return client.rpc('settle_due', { p_limit: 30 }).then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          console.warn('PeerFlow: settle_due is missing. ' +
                       'Run supabase/migration-attendance.sql to turn on attendance.');
        }
        return 0;
      }
      return r.data || 0;
    }).catch(function(){ return 0; });
  }

  /* The reminders due on any session you are part of — including your
     partner's copy of it, which is the point. Your partner opening PeerFlow
     at lunchtime is what sends you the reminder for this evening.

     With pg_cron installed the database does this on a timer and this call
     finds nothing to do, every time, which is the intended steady state. */
  function sendReminders(){
    if (!client) return Promise.resolve(0);
    return client.rpc('send_due_reminders').then(function(r){
      return (r.error || !r.data) ? 0 : r.data;
    }).catch(function(){ return 0; });
  }

  /* The two questions after a session. Either may be omitted — answering one
     of them is a complete answer.

       showed    true or false: was the other person there
       carryOn   'continue' or 'stop'

     Comes back with what the database did with it, which the page needs
     because the honest answers are not all the same:

       confirmed   you vouched for them and it counted
       recorded    the miss is on their record
       unverified  kept, but it settled nothing — PeerFlow did not see either
                   of you in the room, so it has nothing to stand the claim on
       continuing  you both want to carry on
       ended       the partnership is over
       noted       stored, nothing else follows

     'unverified' is the one that matters. It is not a failure and it is not
     an error, and the page must not report it as either: it is PeerFlow
     declining to take somebody's word about somebody else when it has no way
     to check, which is the difference between a reliability system and a
     denunciation box. */
  function sessionCheckin(sessionId, showed, carryOn){
    if (!client) return Promise.resolve({ demo: true });
    if (!sessionId) return Promise.resolve({ error: 'No session to check in on.' });
    return client.rpc('session_checkin', {
      p_session: sessionId,
      p_showed: (showed === true || showed === false) ? showed : null,
      p_continue: carryOn || null
    }).then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          return { needsMigration: true,
                   error: 'Check-ins aren’t switched on for this site yet.' };
        }
        if (r.error.code === 'PF014') {
          return { error: 'That session isn’t over yet.' };
        }
        return fail(r.error, 'Could not save that. Please try again.');
      }
      return { saved: true, outcome: r.data || 'noted' };
    }).catch(function(e){
      return fail(e, 'Could not save that — check your connection and try again.');
    });
  }

  /* What happened on the other side of sessions you own a half of.

     Asked in one call for a handful of sessions rather than one call each,
     for the same reason reliabilityOf is: a page that needs four answers
     should not make four round trips to draw one sentence.

     Comes back keyed by session id, holding only what the dashboard has to
     know to say "your partner didn't make it" — their outcome, whether they
     were ever in the room, and whether they have answered their own check-in.
     Nothing else about their row is readable and nothing else is returned. */
  function partnerOutcomes(ids){
    if (!client) return Promise.resolve(null);
    var want = (ids || []).filter(Boolean);
    if (!want.length) return Promise.resolve({});
    return client.rpc('partner_outcomes', { p_sessions: want }).then(function(r){
      if (r.error) return null;
      var by = {};
      (r.data || []).forEach(function(x){
        by[x.session_id] = { attendance: x.attendance || null,
                             joined: !!x.joined, checkedIn: !!x.checked_in };
      });
      return by;
    }).catch(function(){ return null; });
  }

  /* Stop studying with somebody, without it being a report.

     Deliberately not blockPerson(). Blocking files somebody under "people I
     had to block", hides both profiles from each other for good, and is meant
     for somebody who did something. A pairing that simply is not working is
     not that — and if the only way out is the block button, people either use
     it wrongly or they stop replying, which is the ghosting this whole
     feature exists to reduce. */
  function endPartnership(requestId){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc('end_partnership', { p_request: requestId }).then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          return { needsMigration: true,
                   error: 'That isn’t switched on for this site yet.' };
        }
        return fail(r.error, 'Could not end that. Please try again.');
      }
      return { saved: true };
    }).catch(function(e){
      return fail(e, 'Could not end that — check your connection and try again.');
    });
  }

  /* ---------- a partnership that has gone quiet ----------

     Both of these are thin wrappers. The rules — what counts as dormant, who
     gets told, and how a pair is stopped from being asked twice — live in
     supabase/migration-dormancy.sql, where the browser cannot be talked round
     and where the function can see the other person's calendar. The long note
     is in that file.

     nudgeDormant is called on every load, next to settleAttendance and
     sendReminders, and for the same reason all three exist: there is no
     scheduler behind a static site, so somebody opening the app is what makes
     work happen — including work about the person who is not opening it. It
     answers with how many notes it raised, which on almost every load is
     zero.

     Silent about failure, like its two neighbours. Somebody who opened their
     dashboard did not ask about this and cannot act on it going wrong. */
  function nudgeDormant(){
    if (!client) return Promise.resolve(0);
    return client.rpc('nudge_dormant').then(function(r){
      if (r.error) {
        if (missingFunction(r.error)) {
          console.warn('PeerFlow: nudge_dormant is missing. ' +
                       'Run supabase/migration-dormancy.sql.');
        }
        return 0;
      }
      return r.data || 0;
    }).catch(function(){ return 0; });
  }

  /* Not now. Stamps the same column the nudge does, so the pair goes quiet
     for a cooldown — for both of them, which is the honest reading of one of
     the two saying they would rather not right now. */
  function snoozeDormant(requestId){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc('snooze_dormant', { p_request: requestId }).then(function(r){
      if (!r.error) return { saved: true };
      if (missingFunction(r.error)) {
        return { needsMigration: true,
                 error: 'That isn\u2019t switched on for this site yet.' };
      }
      if (r.error.code === 'PF031') {
        return { error: 'That partnership isn\u2019t yours. Refresh the page.' };
      }
      return fail(r.error, 'Could not put that away. Please try again.');
    }).catch(function(e){
      return fail(e, 'Could not put that away \u2014 check your connection and try again.');
    });
  }

  /* Your own standing: how many sessions you have missed inside the rolling
     window, and whether new partner requests are paused.

     Only ever about the caller. Somebody else's cooldown is not a fact this
     returns, and there is no function that does: a pause is between PeerFlow
     and the person in it, and what their existing partners see is the same
     reliability score everybody else sees.

     Null when the database has not been migrated, which every reader takes as
     "no restriction" — the honest default, since without the migration there
     is none. */
  function partneringStatus(){
    if (!client) return Promise.resolve(null);
    return client.rpc('partnering_status').then(function(r){
      if (r.error || !r.data || !r.data.length) return null;
      var x = r.data[0];
      return {
        noShows: x.no_shows || 0,
        restrictedUntil: x.restricted_until ? new Date(x.restricted_until) : null,
        windowDays: x.window_days || 30,
        allowed: x.allowed || 3
      };
    }).catch(function(){ return null; });
  }

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

  /* The twelve weeks, when somebody has rewritten them. Titles only: the
     default plans also carry a `src` naming where the material lives, and
     that is ours to keep pointing at rather than something to ask a learner
     to retype.

     Absent column means the migration has not been run, and the page says so
     once instead of offering an Edit button that fails when pressed. */
  function savePlan(weeks){
    if (!client) return Promise.resolve({ demo: true });

    var clean = (weeks || [])
      .map(function(w){ return String(w == null ? '' : w).trim().slice(0, 120); })
      .filter(function(w){ return w; })
      .slice(0, 24);
    if (!clean.length) return Promise.resolve({ error: 'A plan needs at least one week.' });

    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('profiles').update({ plan_weeks: clean }).eq('id', uid)
        .then(function(r){
          if (r.error) {
            if (missingColumn(r.error)) {
              console.warn('PeerFlow: plan_weeks is missing. Run supabase/migration-plan.sql.');
              return { needsMigration: true,
                       error: 'Editing the plan isn’t switched on for this site yet.' };
            }
            return fail(r.error, 'Could not save your plan. Please try again.');
          }
          return { saved: true, weeks: clean };
        });
    }).catch(function(e){ return fail(e, 'Could not save your plan. Please try again.'); });
  }

  /* Back to the default for your path. Null rather than a copy of the
     built-in list, so a plan that improves later improves for the people who
     never edited theirs. */
  function resetPlan(){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('profiles').update({ plan_weeks: null }).eq('id', uid)
        .then(function(r){
          if (r.error) {
            if (missingColumn(r.error)) return { needsMigration: true };
            return fail(r.error, 'Could not reset your plan. Please try again.');
          }
          return { saved: true };
        });
    }).catch(function(e){ return fail(e, 'Could not reset your plan. Please try again.'); });
  }

  function unlockedAchievements(){
    if (!client) return Promise.resolve(null);
    return currentUid().then(function(uid){
      if (!uid) return null;
      return client.from('achievements').select('code,unlocked_at').eq('user_id', uid)
        .then(function(r){ return r.error ? null : (r.data || []); });
    }).catch(function(){ return null; });
  }

  /* Duplicate inserts are expected and are not an error worth reporting. */
  function unlockAchievement(code){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('achievements').insert({ user_id: uid, code: code })
        .then(function(r){
          if (r.error && r.error.code !== '23505') {
            try { console.warn('PeerFlow: unlockAchievement', r.error); } catch(e){}
            return { saved: false };
          }
          return { saved: !r.error, fresh: !r.error };
        });
    }).catch(function(){ return { saved: false }; });
  }

  /* ---------- the notifications table ----------
   *
   * Rows land here from two places: raise_note(), called by the triggers on
   * public.sessions when somebody proposes or answers a time, and notifySelf()
   * below when you unlock something. Until now nothing read them back — the
   * bell was built entirely from myRequests() and fetchSessions(), so the
   * table filled up and was never shown, and docs/EMAIL.md's claim that "the
   * bell works immediately after step one" was describing a bell that was
   * reading somewhere else.
   *
   * Capped rather than paged. This is a log you glance at, not one you audit;
   * thirty is more than a panel can show and further back is not a thing
   * anybody asks the bell for.
   *
   * A missing table is not an error worth shouting about — the migration is
   * run by hand and may simply not have been — so this answers with an empty
   * list and says so once in the console, the way reliabilityOf does. */
  function notifications(limit){
    if (!client) return Promise.resolve([]);
    return client.from('notifications')
      .select('id,kind,title,body,href,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 30)
      .then(function(r){
        if (r.error) {
          try {
            console.warn('PeerFlow: notifications unreadable. ' +
                         'Run supabase/migration-notify.sql if the bell looks empty.',
                         r.error.message);
          } catch (e) {}
          return [];
        }
        return (r.data || []).map(function(x){
          return { id: x.id, kind: x.kind, title: x.title, body: x.body,
                   href: x.href, readAt: x.read_at, createdAt: x.created_at };
        });
      })
      .catch(function(){ return []; });
  }

  /* Read-state lives on the row, so it follows you between devices — which is
     the whole reason it is a column and not something in localStorage. */
  function markNotificationsRead(ids){
    if (!client || !ids || !ids.length) return Promise.resolve({ saved: true });
    return client.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids)
      .then(function(r){ return r.error ? { error: r.error.message } : { saved: true }; })
      .catch(function(){ return { error: 'Could not update.' }; });
  }

  /* A note to yourself — an unlocked achievement. Writing to your own list is
     not a privilege escalation, so the insert-own policy covers it. */
  function notifySelf(kind, title, body, href){
    if (!client) return Promise.resolve({ demo: true });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('notifications')
        .insert({ user_id: uid, kind: kind, title: title, body: body || null, href: href || null })
        .then(function(r){
          if (r.error) { try { console.warn('PeerFlow: notifySelf', r.error); } catch(e){} }
          return { saved: !r.error };
        });
    }).catch(function(){ return { saved: false }; });
  }

  /* ================================================================
     Safety — blocking, reporting, and closing your account.

     All four go through SECURITY DEFINER functions in
     supabase/migration-safety.sql rather than table writes, for the same
     reason in each case: every one of them has to touch a row that is not
     yours. Blocking ends the partnership and clears the other person's
     calendar; reporting writes down both names so the record survives either
     account; deleting warns your partner and takes your name off their
     history. A browser cannot be trusted with any of that, and doing it as
     three round trips means the second one can fail and leave somebody
     blocked but still bookable.
     ================================================================ */

  /* Every one of these can be called on a database where the migration has
     not been run, and the honest answer then is not "something went wrong" —
     it is that this feature is not switched on here yet, which is a different
     thing and points at a different fix. */
  function safetyRpc(name, args, msg){
    if (!client) return Promise.resolve({ demo: true });
    return client.rpc(name, args).then(function(r){
      if (!r.error) return { saved: true, data: r.data };
      if (missingFunction(r.error)) {
        console.warn('PeerFlow: ' + name + ' is missing. Run supabase/migration-safety.sql.');
        return { needsMigration: true,
                 error: 'That isn’t switched on for this site yet.' };
      }
      return fail(r.error, msg);
    }).catch(function(e){ return fail(e, msg); });
  }

  function blockPerson(userId){
    if (!userId) return Promise.resolve({ error: 'No one to block.' });
    return safetyRpc('block_person', { p_other: userId },
      'Could not block them. Please try again.');
  }

  /* The one operation here that is an ordinary table write: unblocking
     removes a row you own, the policy already says only the blocker may
     delete it, and nothing else has to happen at the same time. */
  function unblockPerson(userId){
    if (!client) return Promise.resolve({ demo: true });
    if (!userId) return Promise.resolve({ error: 'No one to unblock.' });
    return currentUid().then(function(uid){
      if (!uid) return { demo: true };
      return client.from('blocks').delete()
        .eq('blocker', uid).eq('blocked', userId)
        .then(function(r){
          if (r.error) return fail(r.error, 'Could not unblock them.');
          return { saved: true };
        });
    }).catch(function(e){ return fail(e, 'Could not unblock them.'); });
  }

  /* Who you have blocked, with enough to show a row — which means reading
     profiles, and profiles is exactly what the block policy now hides from
     you. So the names come out of the sessions and messages you already
     shared with them, and failing that the list still renders with the date
     and an Unblock button. Somebody who cannot remember who they blocked is
     still better served by an honest "someone, on 3 August" than by a row
     that will not draw at all. */
  function myBlocks(){
    if (!client) return Promise.resolve([]);
    return currentUid().then(function(uid){
      if (!uid) return [];
      return client.from('blocks')
        .select('blocked, created_at')
        .eq('blocker', uid)
        .order('created_at', { ascending: false })
        .then(function(r){
          if (r.error) {
            /* 42P01: no blocks table, i.e. the migration has not been run.
               An empty list is the truthful answer — nobody is blocked. */
            if (r.error.code !== '42P01') { try { console.warn('PeerFlow: myBlocks', r.error); } catch(e){} }
            return [];
          }
          var rows = r.data || [];
          if (!rows.length) return [];

          var ids = rows.map(function(b){ return b.blocked; });
          return client.from('sessions')
            .select('partner_name, starts_at')
            .eq('user_id', uid)
            .not('partner_name', 'is', null)
            .order('starts_at', { ascending: false })
            .limit(200)
            .then(function(sr){
              /* Sessions do not carry the partner's id, only their name, so
                 this cannot map a name to an id on its own. It is used only
                 to answer "have I ever sat with anybody?" — when the answer
                 is one name and one block, that name is who it is. Beyond
                 that the list stays honest and says nothing. */
              var names = (sr.data || []).map(function(x){ return x.partner_name; });
              var only = (rows.length === 1 && names.length &&
                          names.every(function(n){ return n === names[0]; }))
                         ? names[0] : null;
              return rows.map(function(b){
                return { id: b.blocked, at: b.created_at, name: only };
              });
            }, function(){
              return rows.map(function(b){
                return { id: b.blocked, at: b.created_at, name: null };
              });
            });
        });
    }).catch(function(){ return []; });
  }

  var REPORT_REASONS = ['harassment', 'no_show', 'spam', 'safety', 'other'];

  /* sessionId is optional and is checked server-side against your own rows,
     so passing one from a call is safe and passing a wrong one simply stores
     nothing rather than pointing the report at a stranger's booking. */
  function reportPerson(userId, reason, detail, sessionId, alsoBlock){
    if (!userId) return Promise.resolve({ error: 'No one to report.' });
    if (REPORT_REASONS.indexOf(reason) < 0) {
      return Promise.resolve({ error: 'Pick a reason.' });
    }
    return safetyRpc('report_person', {
      p_about:   userId,
      p_reason:  reason,
      p_detail:  (detail && String(detail).slice(0, 2000)) || null,
      p_session: sessionId || null,
      p_block:   alsoBlock !== false
    }, 'Could not send that report. Please try again.');
  }

  /* call.html knows the partner's name and not their id — session_for_call()
     returns `partner` as text. Reporting needs the account. Answers null for
     anything that is not your own session, which the caller reads as "no
     report button" rather than as an error. */
  function partnerForSession(sessionId){
    if (!client || !sessionId) return Promise.resolve(null);
    return client.rpc('partner_for_session', { p_session: sessionId })
      .then(function(r){
        if (r.error) {
          if (!missingFunction(r.error)) { try { console.warn('PeerFlow: partnerForSession', r.error); } catch(e){} }
          return null;
        }
        return r.data || null;
      }).catch(function(){ return null; });
  }

  /* Undo. The one-press flow files the report and blocks in the same breath,
     which is only a safe thing to build because this exists — see
     supabase/migration-safety.sql for what it will and will not put back.
     Answers false rather than erroring when there is nothing to undo: the
     caller is a button, and "that has already been read" is not a fault. */
  function withdrawReport(reportId, alsoUnblock){
    if (!reportId) return Promise.resolve({ error: 'Nothing to undo.' });
    return safetyRpc('withdraw_report', {
      p_id: reportId,
      p_unblock: alsoUnblock !== false
    }, 'Could not undo that. Please try again.').then(function(res){
      if (res && res.saved && res.data === false) {
        return { tooLate: true,
                 error: 'That report has already been read, so it can’t be taken back.' };
      }
      return res;
    });
  }

  /* The sentence somebody did not stop to write. A day to add it, because
     coming back to it once you have stopped shaking is the normal case. */
  function amendReport(reportId, detail){
    if (!reportId) return Promise.resolve({ error: 'No report to add to.' });
    return safetyRpc('amend_report', {
      p_id: reportId,
      p_detail: (detail && String(detail).slice(0, 2000)) || null
    }, 'Could not save that. Please try again.');
  }

  /* Irreversible, and the only thing in the data layer that is. The sign-out
     afterwards is not tidiness: the access token stays valid until it expires
     and every page it touches would 404 its way through a database where the
     account no longer exists. */
  function deleteAccount(){
    return safetyRpc('delete_own_account', {},
      'Could not delete your account. Please try again, or email hello@peerflow.dev.')
      .then(function(res){
        if (!res || !res.saved) return res;
        return signOut().then(function(){ return { saved: true }; },
                             function(){ return { saved: true }; });
      });
  }

  /* ---------- track labels (for display in the app) ---------- */

  var trackNames = {
    frontend:'Frontend', backend:'Backend', cybersecurity:'Cybersecurity',
    data:'Data Science', mobile:'Mobile', devops:'DevOps & Cloud',
    aiml:'AI & ML', design:'UX/UI Design'
  };

  return {
    ready: ready,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    signInOAuth: signInOAuth,
    markGoal: markGoal,
    callToken: callToken,
    sharedAvailability: sharedAvailability,
    availabilityHours: availabilityHours,
    currentUser: currentUser,
    getProfile: getProfile,
    signOut: signOut,
    changePassword: changePassword,
    sendPasswordReset: sendPasswordReset,
    saveProfile: saveProfile,
    fetchSessions: fetchSessions,
    blockPerson: blockPerson,
    unblockPerson: unblockPerson,
    myBlocks: myBlocks,
    reportPerson: reportPerson,
    partnerForSession: partnerForSession,
    withdrawReport: withdrawReport,
    amendReport: amendReport,
    reportReasons: REPORT_REASONS,
    deleteAccount: deleteAccount,
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
    rescheduleSession: rescheduleSession,
    sendPartnerRequest: sendPartnerRequest,
    myRequests: myRequests,
    respondToRequest: respondToRequest,
    markRequestsSeen: markRequestsSeen,
    acceptedPartners: acceptedPartners,

    /* Momentum */
    momentum: momentum,
    saveGoal: saveGoal,

    /* One person, for the profile page */
    getPerson: getPerson,

    /* Messages */
    sendMessage: sendMessage,
    fetchThread: fetchThread,
    threads: threads,
    markThreadRead: markThreadRead,
    unreadMessages: unreadMessages,

    /* Standing weekly slot */
    setStanding: setStanding,
    acceptStanding: acceptStanding,
    clearStanding: clearStanding,
    materialiseStanding: materialiseStanding,

    badgeStats: badgeStats,
    fetchPeers: fetchPeers,
    learnerStats: learnerStats,
    trackCounts: trackCounts,
    trackNames: trackNames,

    /* Progress page */
    reliabilityOf: reliabilityOf,
    reliabilityLabel: reliabilityLabel,

    /* Attendance */
    settleAttendance: settleAttendance,
    sendReminders: sendReminders,
    nudgeDormant: nudgeDormant,
    snoozeDormant: snoozeDormant,
    sessionCheckin: sessionCheckin,
    partnerOutcomes: partnerOutcomes,
    endPartnership: endPartnership,
    partneringStatus: partneringStatus,

    saveStage: saveStage,
    savePlan: savePlan,
    resetPlan: resetPlan,
    unlockedAchievements: unlockedAchievements,
    unlockAchievement: unlockAchievement,
    notifications: notifications,
    markNotificationsRead: markNotificationsRead,
    notifySelf: notifySelf
  };
})();
