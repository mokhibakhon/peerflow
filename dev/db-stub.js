/* Stand-in for assets/db.js. Local screenshots and Playwright checks only —
   never served in production; dev/serve.js swaps it in behind PF_STUB=1.

   Same function names and return shapes as the real db.js, with fixed sample
   rows instead of Supabase, so every page renders signed-in with no network
   and no account. Each state the pages can be in is a window.__ dial, set
   before this file loads:

     __partners    array of {requestId, roomUrl, standing, profile}
     __manyPartners  a count, for the rail with more than one person in it —
                   the fixture has one partner, and one partner hides
                   everything that only goes wrong at four
     __sessions    array of session rows (startsAt must be a real Date)
     __noPartner   true for the no-partner-yet state
     __empty       true for no sessions at all
     __momentum    object merged over the streak fixture, or null for none
     __unread      unread message count
     __goalCol     weekly goal, or null to act as though the column is missing
     __planWeeks   the twelve-week plan as stored on the profile
     __standing    {minutes, agreed, mine} for a standing slot
     __sharedBy    shared hours by JS weekday, overriding the default
     __theirBy     the other person's own hours by JS weekday, for the read-only
                   week on their profile
     __callRefuse  a reason string, to see call.html turn one down
     __callMinsIn  how far into the booked session the room thinks it is, so
                   the phase pill can be caught mid-break
     __pfNoPartner true to keep the far tile empty (read by dev/livekit-fake.js)
     __notes       rows for the notifications table, or [] for none — what
                   raise_note() and notifySelf() write. null acts as though
                   migration-notify.sql has not been run
     __clash       a sentence, to see a booking refused because the hour has
                   gone — what the database now says when two people reach the
                   same minute at once, or when the partner is already busy
     __provider    'google' to see the Settings page treat this as an OAuth
                   account, which has no PeerFlow password to change
     __authName    a name on the auth record's user_metadata, which signup
                   writes once and nothing updates afterwards. The header chip
                   preferred it over the profile, so a name changed on
                   app-profile.html never reached the corner of the screen
     __blocks      rows for the blocked list in Settings, as
                   [{id, at, name}] — name is usually null in real life,
                   because blocking hides their profile from you
     __blockFail   an error sentence, so the unblock button's failure path can
                   be seen
     __deleteFail  an error sentence, to see delete-your-account refused
     __reportFail  an error sentence, so the reporting card's failure path can
                   be seen with the five reasons still live
     __undoFail    an error sentence for the undo button
     __undoTooLate true to answer as the database does when the fifteen-minute
                   window has closed or somebody has already read the report
     __amendFail   an error sentence for saving the added detail
     __farId       the partner's account id on a call, or null for a session
                   with nobody on the other side — which hides Report
     __safetyMissing  true to act as though migration-safety.sql has not been
                   run: every safety call answers needsMigration
     __rel         reliability by user id, as
                   {u2:{pct, counted, attended, noShows, early, late, expected}} —
                   omit somebody and they come back unscored, which is the
                   "New partner" state and the one most easily got wrong
     __relMissing  true to act as though migration-reliability.sql has not run
     __partnerOut  the other side of your sessions, as
                   {sessionId:{attendance, joined, checkedIn}} — this is what
                   decides whether the dashboard says your partner stood you
                   up, and it is the only way to see that band
     __standingStatus  {noShows, restrictedUntil, windowDays, allowed} for the
                   cooldown notice on People, or null for no restriction
     __checkinOut  what session_checkin answers: 'confirmed', 'recorded',
                   'unverified', 'continuing', 'ended' or 'noted'. 'unverified'
                   is the one worth looking at — it is the branch that keeps
                   the row on screen and explains itself instead of reloading
     __checkinFail an error sentence for the check-in's failure path
     __incoming    requests waiting on you, as partner_requests rows with an
                   `other` profile attached — what the People inbox and the
                   bell answer from
     __rescheduleMissing  true to act as though migration-reschedule.sql has
                   not been run: sessions arrive without rescheduled_from and
                   reschedule_session() answers needsMigration, which is
                   exactly when the Reschedule button must not be drawn
     __rescheduleFail  an error sentence, for the failure path — the one that
                   has to leave the original booking untouched
     __rescheduleClash  the sentence the exclusion constraint produces, for
                   the case where one of you has since agreed to something
                   else at the new time
     __dormantAt   what partner_requests.dormant_nudged_at holds for the
                   partnership — a Date, or null for "never raised". Leave it
                   undefined and the fixture behaves as a migrated database
                   with nothing raised yet
     __dormancyMissing  true to act as though migration-dormancy.sql has not
                   been run: the column is not selected, nudge_dormant and
                   snooze_dormant answer as missing, and the gone-quiet band
                   must not be drawn — there would be nowhere to put a Not now
     __snoozeFail  an error sentence for the Not now failure path
     __attendanceMissing  true to act as though migration-attendance.sql has
                   not been run: settling, check-ins and the cooldown all go
                   quiet and the pages fall back to what they said before
     __funnel      the seven funnel totals plus the two weekly ones, merged
                   over the fixture — {accounts, profile_complete, request_sent,
                   partnered, session_proposed, session_booked,
                   session_attended, accounts_7d, accounts_prev_7d}. null acts
                   as though the caller is not named in app_admins, which is
                   also what a missing migration-funnel.sql looks like: the two
                   are the same screen and there is nothing to tell apart
     __funnelDays  thirty days as [{day, accounts, profile_complete}], oldest
                   first, or null for the same not-yours state. Left undefined
                   it is generated from the fixture with one busy day in it,
                   because a month of zeroes cannot show whether the columns
                   are drawn the right way up

     __peers       the People directory, overriding the fixture outright. Two
                   values matter and the page must not confuse them: [] is the
                   first person to finish signing up, null is a directory that
                   could not be read. The fixture has four people in it and
                   always has, so neither screen had ever been rendered
     __latency     milliseconds to hold every answer for, so that two reads of
                   the same row can actually be in flight at once. Off by
                   default, and the default is why it exists: a stub that
                   answers instantly can never show whether db.js's in-flight
                   dedupe is doing anything, because there is never anything in
                   flight. Set it to something like 120 to measure a page the
                   way a browser on a real connection sees it

   Add a dial rather than editing a fixture in place: the fixtures are shared
   by every test, and quietly changing one moves the ground under the others. */
window.pf = (function(){
  var DAY_ORDER=['mon','tue','wed','thu','fri','sat','sun'];
  var DAY_LABEL={mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'};
  var BAND_HOURS={morning:[6,11],afternoon:[12,16],evening:[17,21],night:[22,23]};
  var BAND_LABEL={morning:'morning',afternoon:'afternoon',evening:'evening',night:'night'};
  function sharedSlots(a,b){a=a||[];b=b||[];var s={};b.forEach(function(x){s[x]=1});
    return a.filter(function(x){return s[x]}).sort(function(x,y){
      return DAY_ORDER.indexOf(x.split('-')[0])-DAY_ORDER.indexOf(y.split('-')[0])});}
  function slotLabel(s){var p=String(s).split('-');return ((DAY_LABEL[p[0]]||'')+' '+(BAND_LABEL[p[1]]||'')).trim();}
  function slotHours(s){var b=BAND_HOURS[String(s).split('-')[1]];if(!b)return[];var o=[];for(var h=b[0];h<=b[1];h++)o.push(h);return o;}
  function nextDateFor(slot,hour){var d=new Date();d.setSeconds(0,0);d.setMinutes(0);d.setHours(hour);
    var day=DAY_ORDER.indexOf(String(slot).split('-')[0]);var t=(new Date().getDay()+6)%7;
    var k=(day-t+7)%7; if(k===0&&d<=new Date())k=7; d.setDate(d.getDate()+k); return d;}

  var MY_AVAIL=['tue-evening','thu-evening','sat-morning'];
  var THEIR_AVAIL=['tue-evening','thu-evening','sun-evening'];

  var soon=new Date(); soon.setHours(soon.getHours()+2,0,0,0);
  var prop=new Date(); prop.setDate(prop.getDate()+3); prop.setHours(19,0,0,0);
  /* A session that has already happened. `att` is what the room observed, and
     the settled outcome is derived from it rather than passed separately, so
     a fixture cannot say "attended: false" and "attendance: attended" at the
     same time — which is a state the database cannot produce and a test that
     relied on it would be testing nothing.

     checkedInAt is null throughout: an unanswered check-in is the state the
     dashboard actually has to draw, and every fixture row here is old enough
     that the question has passed anyway (renderCheckins only asks about the
     last few days). __sessions is the dial for anything else. */
  function past(d,st,att){var x=new Date();x.setDate(x.getDate()-d);x.setHours(19,0,0,0);
    return {id:'p'+d,partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:x,durationMin:50,
      roomUrl:'pf:demo',pairId:'r1',status:st,proposedBy:'me',note:null,mine:true,
      cancelledByMe:false,confirmedAt:x,goal:'Read a packet capture',goalDone:true,attended:att,
      completedAt:x,cancelledAt:null,
      joinedAt:att===true?x:null,
      attendance:att===true?'attended':att===false?'no_show':null,
      attendanceSource:att===null||att===undefined?null:'livekit',
      settledAt:att===null||att===undefined?null:x,
      partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null};}

  var SESSIONS=[
    {id:'s1',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:soon,durationMin:50,
     roomUrl:'pf:demo',pairId:'r1',status:'confirmed',proposedBy:'them',note:null,
     mine:false,cancelledByMe:false,confirmedAt:null,goal:'Wireshark TCP practice',goalDone:null,
     attended:null,completedAt:null,cancelledAt:null,
     joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
     partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null},
    {id:'s2',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:prop,durationMin:50,
     roomUrl:'pf:demo2',pairId:'r1',status:'proposed',proposedBy:'them',note:null,
     mine:false,cancelledByMe:false,confirmedAt:null,goal:null,goalDone:null,attended:null,
     completedAt:null,cancelledAt:null,
     joinedAt:null,attendance:null,attendanceSource:null,settledAt:null,
     partnerOk:null,checkedInAt:null,continuePref:null,rescheduledFrom:null},
    past(7,'completed',true), past(14,'completed',true), past(21,'completed',true),
    past(28,'completed',false)
  ];

  function standingOf(){
    var s=window.__standing; if(!s) return null;
    var a=new Date(); a.setHours(19,0,0,0);
    a.setDate(a.getDate()+((4-a.getDay()+7)%7||7));
    return {anchor:a,minutes:s.minutes||50,agreed:!!s.agreed,mine:!!s.mine};
  }

  var PARTNER={requestId:'r1',roomUrl:'pf:demo',
    /* When the request was sent. The dashboard orders partnerships you have
       never met on by this, oldest first, so a fixture without it cannot show
       which of two new partners the band should name. */
    askedAt:new Date('2026-06-02T00:00:00Z'),
    /* Undefined when the migration is missing, the way the real
       acceptedPartners reports a column its rung did not select. */
    get dormantNudgedAt(){
      if (window.__dormancyMissing) return undefined;
      var snoozed = null;
      try{ snoozed = sessionStorage.getItem('pf_stub_snoozed'); }catch(e){}
      if (snoozed) return new Date(snoozed);
      return window.__dormantAt || null; },
    get standing(){return standingOf();},
    profile:{id:'u2',name:'Amir Karimov',track_id:'cybersecurity',topic:'Cybersecurity',
      level:'tutorials',timezone:'Asia/Tashkent',availability:THEIR_AVAIL}};

  /* More than one partner. The single-partner fixture is the state the app
     was designed around and it hides a whole class of problem: a card headed
     "Your pair" reads fine over one name and is simply wrong over four, and a
     rail sized for one face is a directory at four. Real names of real
     lengths, including one long enough to test the row. */
  var MORE=[
    {name:'Asalxon Axmadxo’jayeva', topic:null,            track:'cybersecurity'},
    {name:'Chatgpt',                     topic:'flutter',       track:'mobile'},
    {name:'wer',                         topic:'Blue team',     track:'cybersecurity'},
    {name:'test',                        topic:'Python basics', track:'backend'}
  ];
  function manyPartners(n){
    var out=[PARTNER];
    for(var i=0;i<Math.min(n-1,MORE.length);i++){
      var m=MORE[i];
      out.push({requestId:'r'+(i+2), roomUrl:'pf:demo'+(i+2), standing:null,
        dormantNudgedAt: window.__dormancyMissing ? undefined : null,
        /* Later than PARTNER's, so "the one that has been waiting longest" is
           a question with a stable answer in the fixture. */
        askedAt:new Date(Date.parse('2026-06-02T00:00:00Z')+(i+1)*86400000),
        profile:{id:'u'+(i+3), name:m.name, track_id:m.track, topic:m.topic,
          level:'tutorials', timezone:'Asia/Tashkent', availability:THEIR_AVAIL}});
    }
    return out;
  }

  var PROFILE={id:'u1',name:'Mohibaxon Omonhonova',
    /* The split columns a real row has carried since schema.sql. The fixture
       predated them, so nothing local could show the header chip reading the
       profile rather than the signup metadata. */
    first_name:'Mohibaxon',last_name:'Omonhonova',
    track_id:'cybersecurity',topic:'Cybersecurity',
    level:'tutorials',timezone:'Asia/Tashkent',availability:MY_AVAIL,stage_index:3,pref_minutes:50,
    created_at:'2026-06-01T00:00:00Z',
    get sessions_per_week(){ return window.__goalCol===null?undefined:(window.__goalCol||3); },
    get plan_weeks(){ return window.__planWeeks||null; }};

  /* Answers to sessions, kept where a reload cannot lose them. Keyed on the
     pair the real acceptSession/declineSession are called with, so the stub
     is answering the same question the database is. */
  var ANS='pf_stub_answers';
  function answersMap(){
    try{ return JSON.parse(sessionStorage.getItem(ANS)||'{}'); }catch(e){ return {}; }
  }
  function answerKey(at,room){
    var d = at instanceof Date ? at : new Date(at);
    return String(room)+'@'+(isNaN(d.getTime())?String(at):d.toISOString());
  }
  function answer(at,room,status){
    var m=answersMap(); m[answerKey(at,room)]=status;
    try{ sessionStorage.setItem(ANS,JSON.stringify(m)); }catch(e){}
  }
  /* Copies rather than editing the fixture: SESSIONS is shared by every test
     and a status written into it would outlive the page that wrote it. */
  function applyAnswers(list){
    var m=answersMap();
    for(var k in m){ if(Object.prototype.hasOwnProperty.call(m,k)){
      return (list||[]).map(function(s){
        var status=m[answerKey(s.startsAt,s.roomUrl)];
        if(!status) return s;
        var c={}; for(var p in s){ if(Object.prototype.hasOwnProperty.call(s,p)) c[p]=s[p]; }
        c.status=status;
        if(status==='cancelled') c.cancelledByMe=true;
        return c;
      });
    }}
    return list;
  }

  /* Sessions created by a reschedule, kept where a reload cannot lose them
     for the same reason answers are: the whole point of the feature is what
     the page looks like AFTER the move, and a stub that forgets would let a
     test pass on a page that had not actually changed. */
  var MOVES='pf_stub_moves';
  function movesList(){
    try{ return JSON.parse(sessionStorage.getItem(MOVES)||'[]'); }catch(e){ return []; }
  }
  function addMove(m){
    var a=movesList(); a.push(m);
    try{ sessionStorage.setItem(MOVES,JSON.stringify(a)); }catch(e){}
  }
  function movedRows(){
    return movesList().map(function(m,i){
      return {id:'mv'+i,partnerName:m.partnerName,topic:m.topic,
        startsAt:new Date(m.at),durationMin:m.len,roomUrl:m.room,roomName:'pf-mv'+i,
        pairId:m.pairId,status:'proposed',proposedBy:'u1',note:m.note||null,mine:true,
        cancelledByMe:false,goal:null,goalDone:null,attended:null,joinedAt:null,
        attendance:null,attendanceSource:null,settledAt:null,partnerOk:null,
        checkedInAt:null,continuePref:null,rescheduledFrom:new Date(m.from)};
    });
  }

  /* Every stubbed reader resolves through here. It was Promise.resolve, which
     settles on the next microtask — near enough to instant that two callers
     asking the same question a few milliseconds apart never overlap, because
     the first has already finished. That is not how the real db.js behaves,
     and it hid the one thing worth watching: db.js dedupes concurrent reads by
     handing every caller the same in-flight promise, and against an instant
     stub there is never an in-flight promise to hand out. So a page that fires
     four reads of the same row measured as four calls and one request here,
     and as four calls and four requests in a browser talking to Supabase —
     which is what the owner's network panel had been showing all along.

     window.__latency puts a delay in front of every answer so that overlap can
     happen and be measured. It is off by default: every existing test asserts
     on what is on screen after the data arrives, and adding milliseconds to a
     few hundred stubbed calls would only make those suites slower. */
  var P=function(v){
    var ms = window.__latency;
    if (!ms) return Promise.resolve(v);
    return new Promise(function(res){ setTimeout(function(){ res(v); }, ms); });
  };
  function note(k){ try{ var a=JSON.parse(sessionStorage.getItem('__calls')||'[]');
    a.push(k); sessionStorage.setItem('__calls',JSON.stringify(a)); }catch(e){} }
  return {
    ready:function(){return true},
    /* A real Supabase user always carries an address and a provider, and the
       Settings page reads both. Without them the Account card sat on two em
       dashes, which is a state no signed-in account is ever actually in. */
    /* user_metadata carries a Google avatar, because that is the only way a
       page ever asks for an image from a host outside this project — and it
       is a host the CSP has to name. Without it, dev/csp-tests.js could not
       see the img-src directive at all: removing lh3.googleusercontent.com
       from the policy left the suite green, which is exactly how that origin
       came to be missing from the first policy that shipped.
    
       __noAvatar drops back to the initial, which is what an email signup
       gets and what the menu falls back to. */
    currentUser:function(){return P({id:'u1',email:'you@example.edu',
      app_metadata:{provider:window.__provider||'email'},
      user_metadata:Object.assign(
        window.__authName ? {name:window.__authName} : {},
        window.__noAvatar ? {} : {
          avatar_url:'https://lh3.googleusercontent.com/a/pf-stub-avatar=s96-c'
        })})},
    getProfile:function(){return P(PROFILE)},
    saveProfile:function(){note('saveProfile');return P({saved:true})},
    fetchPeers:function(){
      /* window.__peers overrides the directory outright, and the two states
         worth having a dial for are the two the page must not confuse: [] is
         the first person to finish signing up, and null is a directory that
         could not be read. The fixture has always had four people in it, so
         neither screen had ever been looked at.

         Tested against undefined rather than for truthiness, because null is
         one of the two values being set deliberately — `if (window.__peers)`
         would have sent it to the fixture and quietly answered the failure
         case with four people. */
      if (window.__peers !== undefined) return P(window.__peers);
      return P([
      {id:'m1',name:'Amir Karimov',track_id:'cybersecurity',topic:'SOC analyst',level:'tutorials',
       timezone:'Asia/Tashkent',availability:THEIR_AVAIL},
      {id:'m2',name:'Dilnoza Rahimova',track_id:'cybersecurity',topic:'Pentesting',level:'tutorials',
       timezone:'Asia/Tashkent',availability:['thu-evening']}]
      .concat(window.__trackless?[{id:'m3',name:'Nodira Yusupova',track_id:null,topic:'',
       level:null,timezone:null,availability:[]}]:[]))},
    learnerStats:function(){return P({total:12,sameTopic:3})},

    /* --- profile + chat --- */
    getPerson:function(id){
      var PEOPLE={
        u2:{id:'u2',name:'Amir Karimov',track_id:'cybersecurity',topic:'SOC analyst',
            level:'tutorials',timezone:'Asia/Tashkent',availability:THEIR_AVAIL,
            created_at:'2026-05-14T00:00:00Z'},
        u9:{id:'u9',name:'Nobody Yet',track_id:'frontend',topic:'',level:'new',
            timezone:'',availability:[],created_at:null}};
      return P(PEOPLE[id]||null);
    },
    threads:function(){
      if(window.__chatMissing) return P({needsMigration:true});
      var t=new Date(); t.setMinutes(t.getMinutes()-9);
      return P(window.__noThreads?[]:[
        {id:'u2',name:'Amir Karimov',topic:'SOC analyst',partner:true,
         last:'see you Thursday then',at:t,lastMine:false,unread:2},
        {id:'m2',name:'Dilnoza Rahimova',topic:'Pentesting',partner:false,
         last:'sure, I will look at it',at:new Date(Date.now()-864e5*2),lastMine:true,unread:0},
        {id:'m3',name:'Bekzod Yusupov',topic:'CTFs',partner:false}
      ]);
    },
    fetchThread:function(id){
      if(window.__chatMissing) return P({needsMigration:true});
      if(id!=='u2') return P([]);
      var a=new Date(Date.now()-864e5-3600e3), b=new Date(Date.now()-9*60e3);
      var t=function(m){return new Date(a.getTime()+m*60e3);};
      return P([
        {id:'x1',body:'hey — are you free Thursday evening?',mine:true,at:t(0),readAt:t(3)},
        {id:'x2',body:'yes, 7pm works',mine:false,at:t(7),readAt:null},
        {id:'x3',body:'I want to go through a packet capture',mine:false,at:t(7),readAt:null},
        {id:'x4',body:'perfect',mine:true,at:t(9),readAt:t(11)},
        {id:'x5',body:'I\u2019ll bring one from the lab',mine:true,at:t(9),readAt:null},
        {id:'x6',body:'see you Thursday then',mine:false,at:b,readAt:null}
      ]);
    },
    sendMessage:function(){note('sendMessage');return P({saved:true,message:null});},
    markThreadRead:function(){note('markThreadRead');return P({saved:true,count:2});},
    unreadMessages:function(){return P(window.__unread===undefined?2:window.__unread);},
    setStanding:function(){note('set');return P({saved:true})},
    acceptStanding:function(){note('accept');return P({saved:true})},
    clearStanding:function(){note('clear');return P({saved:true})},
    materialiseStanding:function(){note('materialise');
      return P({saved:true,count:window.__materialiseCount||0})},
    /* __attendanceMissing has to change the SHAPE of a row, not just make the
       attendance RPCs answer needsMigration. The real fetchSessions climbs
       down a ladder of column sets, so on an un-migrated database the
       attendance columns are never selected and arrive undefined — and
       `attendance === undefined` is exactly what the dashboard reads to
       decide whether the post-session check-in can be stored at all.

       A dial that left the keys in place while the RPCs refused was worse
       than no dial: it made the un-migrated case look migrated to every
       reader on the page, which is how the check-in card came to be drawn on
       a site that could not save it. */
    fetchSessions:function(){
      var rows = applyAnswers(window.__sessions||(window.__empty?[]:SESSIONS))
                   .concat(movedRows());
      /* Its own rung in the real ladder, so its own dial here: a database
         without migration-reschedule.sql still has attendance, and the page
         has to be able to tell those two apart. */
      if(window.__rescheduleMissing) rows=(rows||[]).map(function(s){
        var c={}; for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)
          && k!=='rescheduledFrom') c[k]=s[k]; }
        return c; });
      if(!window.__attendanceMissing) return P(rows);
      var GONE = ['attendance','attendanceSource','settledAt','partnerOk',
                  'checkedInAt','continuePref','joinedAt'];
      return P((rows||[]).map(function(s){
        var c={}; for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)
          && GONE.indexOf(k)<0) c[k]=s[k]; }
        return c;
      }))},
    /* The real one crosses two timezones; here it is a fixed set of shared
       hours so the booking sentence has days to offer. Tue/Thu/Sun evenings,
       keyed by JS weekday like the real byDay. */
    sharedAvailability:function(){
      var ev=[17,18,19,20,21], by={0:ev,2:ev,4:ev};
      if(window.__sharedBy) by=window.__sharedBy;
      return {byDay:by,slots:[],hours:15};
    },
    /* Missing until now, which meant app-person.html threw inside render()
       and every stubbed visit to somebody's profile showed "We couldn't find
       that person" instead. The page catches its own load errors and calls
       missing(), so the gap looked like a person who was not there rather
       than like a bug — the page rendered its markup and then quietly hid it.
       Their week is drawn wider than the shared one so the two shadings can
       be told apart on screen. */
    availabilityHours:function(){
      var th=[16,17,18,19,20,21,22], by={0:th,1:th,2:th,4:th,5:th};
      if(window.__theirBy) by=window.__theirBy;
      return {byDay:by,hours:35,minutes:0};
    },
    acceptedPartners:function(){return P(window.__partners ||
      (window.__noPartner ? [] :
       window.__manyPartners ? manyPartners(window.__manyPartners) : [PARTNER]))},
    /* The real momentum() is unit-tested against real session rows in Node;
       here it is a dial so the ring can be seen in every state. */
    momentum:function(room){
      note('momentum:'+(room||'-'));
      if(window.__momentum===null) return P(null);
      var d={done:4,minutes:200,streak:4,rested:false,best:4,goal:2,thisWeek:1,
             metThisWeek:false,daysLeft:3};
      d.history=[0,2,2,0,1,2,2,2,0,2,2,1].map(function(n,i){return {start:i,count:n,met:n>=2,current:i===11}});
      var o=window.__momentum||{};
      for(var k in o) d[k]=o[k];
      /* Keep the fixture coherent: the last mark in the strip IS this week. */
      if(!(o&&o.history)){ if(!d.done){ d.history=[]; }
        else { d.history[11]={start:11,count:d.thisWeek,met:d.thisWeek>=d.goal,current:true}; } }
      if(window.__momentumSlow)
        return new Promise(function(res){setTimeout(function(){res(d)},window.__momentumSlow)});
      return P(d);
    },
    saveGoal:function(n){note('saveGoal:'+n);return P(window.__goalFail?{error:'nope'}:{saved:true})},
    badgeStats:function(){ if(window.__badgeStats) return P(window.__badgeStats);
      return P({pastSessions:4,partners:1,mostWithOnePartner:4,totalMinutes:200,
      longestWeekStreak:4,profileComplete:true,joinRank:2})},
    unlockedAchievements:function(){return P(window.__unlocked||[])},
    unlockAchievement:function(code){note('unlock:'+code);
      return P({fresh:window.__freshUnlock===undefined?true:window.__freshUnlock})},
    notifySelf:function(){note('notifySelf');return P({sent:true})},
    /* The notifications table. Default is one of each kind the app actually
       writes: a session event from the triggers, and an achievement from
       notifySelf. __notes replaces them; null stands for the migration not
       having been run, which db.js answers with an empty list. */
    notifications:function(){
      if(window.__notes===null) return P([]);
      if(window.__notes) return P(window.__notes);
      var h=function(m){return new Date(Date.now()-m*60000).toISOString()};
      return P([
        {id:'n1',kind:'session',title:'Amir Karimov accepted your time',
         body:'Friday 21 August at 19:00 · Cybersecurity. It is now on both your calendars.',
         href:'app.html',readAt:null,createdAt:h(41)},
        {id:'n2',kind:'achievement',title:'Achievement unlocked: Steady pair',
         body:'Three sessions with the same partner.',
         href:'app-badges.html',readAt:null,createdAt:h(190)},
        {id:'n3',kind:'session',title:'Dilnoza Rahimova declined that time',
         body:'Wednesday 19 August at 08:00. Propose another time whenever you are ready.',
         href:'app.html',readAt:h(1500),createdAt:h(2880)}
      ]);
    },
    markNotificationsRead:function(ids){note('markNotificationsRead:'+(ids||[]).length);
      return P({saved:true})},
    saveStage:function(i){note('saveStage:'+i);return P({saved:true})},
    savePlan:function(w){note('savePlan:'+JSON.stringify(w));
      if(window.__planFail) return P({error:window.__planFail});
      var clean=(w||[]).map(function(x){return String(x==null?'':x).trim().slice(0,120)})
        .filter(function(x){return x}).slice(0,24);
      if(!clean.length) return P({error:'A plan needs at least one week.'});
      window.__planWeeks=clean; return P({saved:true,weeks:clean})},
    resetPlan:function(){note('resetPlan');
      if(window.__planFail) return P({error:window.__planFail});
      window.__planWeeks=null; return P({saved:true})},
    proposeSession:function(){note('propose');
      if(window.__clash) return P({error:window.__clash});
      return P({saved:true})},

    /* The room. __callRefuse is any reason session_for_call can give —
       'too-early', 'not-partners', 'no-room' and the rest are listed in
       docs/VIDEO.md — so every refusal call.html has to write a sentence for
       can be looked at without a booking in the right state. Anything else
       gets a pass into a room that is not there, which is as far as the stub
       can take you: the lobby renders, and joining fails the way a real
       unreachable server does. */
    callToken:function(id){
      note('callToken:'+id);
      if(window.__callRefuse) return P({ok:false,reason:window.__callRefuse,
        startsAt:new Date(Date.now()+40*60000).toISOString()});
      /* __callMinsIn moves the clock inside the booking, so the phase pill
         can be seen at a break or in the last stretch without waiting
         twenty-five minutes for one. */
      var s=new Date(); s.setMinutes(s.getMinutes()-(window.__callMinsIn||4));
      return P({ok:true,token:'stub.token',url:'wss://example.invalid',
        room:'pf-stub',identity:'u1',display:PROFILE.name,
        partner:PARTNER.profile.name,topic:'Cybersecurity',
        goal:'Read a packet capture',
        startsAt:s.toISOString(),
        endsAt:new Date(s.getTime()+70*60000).toISOString()});
    },
    /* Answering a session used to report {saved:true} and change nothing, so
       every page that answers one looked identical before and after — and a
       reload put the proposal straight back. That is not a small
       infidelity: three of these paths end in window.location.href, and a
       fixture that cannot tell you what the page looks like AFTER the reload
       cannot test the half of the journey that matters. A decline that left
       the band still offering Accept survived to production behind exactly
       this gap.

       So an answer is recorded and fetchSessions applies it. Status changes
       rather than the row vanishing, which is what the database does: a
       declined session stays so the proposer finds out. sessionStorage,
       not a variable, because the point is surviving the reload. */
    acceptSession:function(at,room){note('acceptSession');
      if(window.__clash) return P({error:window.__clash});
      answer(at,room,'confirmed'); return P({saved:true})},
    declineSession:function(at,room){note('declineSession');
      answer(at,room,'declined'); return P({saved:true})},
    cancelBooked:function(at,room){note('cancelBooked');
      answer(at,room,'cancelled'); return P({saved:true})},
    cancelSession:function(at,room){answer(at,room,'cancelled');return P({saved:true})},
    /* The atomic half is the database's job and cannot be modelled here; what
       this has to be faithful about is the ORDER of the refusals, because
       every one of them is a state the page can reach by being a few seconds
       stale, and each has its own sentence. A failure must leave the original
       booking exactly as it was — which is what the tests check, and which is
       why nothing is written until every check has passed. */
    rescheduleSession:function(at,room,newAt,len,noteText){
      note('reschedule');
      if(window.__rescheduleMissing) return P({needsMigration:true,
        error:'Moving a session isn\u2019t switched on for this site yet.'});
      if(window.__rescheduleFail) return P({error:window.__rescheduleFail});
      var d=newAt instanceof Date?newAt:new Date(newAt);
      var rows=applyAnswers(window.__sessions||(window.__empty?[]:SESSIONS));
      var t=new Date(at).getTime();
      var old=(rows||[]).filter(function(s){
        return s.roomUrl===room && s.startsAt.getTime()===t; })[0];
      if(!old) return P({error:'That session isn\u2019t yours to move \u2014 refresh the page.'});
      if(old.status!=='confirmed') return P({error:'That session can\u2019t be moved any more \u2014 '+
        'refresh the page to see where it got to.'});
      if(old.startsAt.getTime()<=Date.now()) return P({error:'That session has already started.'});
      if(isNaN(d.getTime())||d.getTime()<=Date.now())
        return P({error:'That\u2019s in the past \u2014 pick a future time.'});
      if(d.getTime()===t) return P({error:'That is the time it is already at.'});
      if(window.__rescheduleClash) return P({error:window.__rescheduleClash});
      var room2='pf:moved'+movesList().length;
      answer(at,room,'cancelled');
      addMove({at:d.toISOString(),len:len||old.durationMin,room:room2,
        from:new Date(at).toISOString(),partnerName:old.partnerName,topic:old.topic,
        pairId:old.pairId,note:noteText||null});
      return P({saved:true,roomUrl:room2});},
    sendPartnerRequest:function(){note('sendPartnerRequest');return P({sent:true})},
    myRequests:function(){return P({incoming:(window.__incoming||[]),outgoing:[
      {id:'r1',from_user:'u1',to_user:'u2',status:'accepted',created_at:'2026-06-02T00:00:00Z',
       other:PARTNER.profile}
    ],me:'u1'})},
    /* Answers with partnerId the way the real one does — it reads it off the
       row the update returned — because the People inbox now turns that id
       into a link to book with them. A stub that answered {saved:true} alone
       would draw the partnered state with nowhere to go. */
    respondToRequest:function(id,st){note('respond:'+id+':'+st);
      if(window.__respondFail) return P({error:window.__respondFail});
      var to=(window.__incoming||[]).filter(function(x){return x.id===id})[0];
      return P({saved:true, partnerId:(to&&to.from_user)||'u2',
                notified:st==='accepted'})},
    reliabilityOf:function(ids){
      if(window.__relMissing) return P(null);
      var by={}, src=window.__rel||{};
      (ids||[]).forEach(function(i){
        /* Unscored rather than absent, because that is what the real function
           returns for somebody new — a row of zeroes and a null percentage.
           A dial that left them out entirely would hide the "New partner"
           state, which is the one this whole column has to get right. */
        by[i]=src[i]||{pct:null,counted:0,attended:0,noShows:0,
                       early:0,late:0,expected:0,firstAt:null};
      });
      return P(by)},
    /* Defers to the real assets/reliability.js when the page has loaded it,
       so the words in the stub cannot drift from the words in production —
       which is exactly what happened to the copy that used to live here. */
    reliabilityLabel:function(p,counted){
      if(window.pfReliability) return window.pfReliability.label(p,counted);
      if(p===null||p===undefined) return counted===undefined?'':'New partner';
      if(p>=95) return 'Always turns up';
      if(p>=90) return 'Very reliable';
      if(p>=80) return 'Reliable';
      if(p>=65) return 'Usually turns up';
      return 'Often misses'},

    /* ---- attendance ---- */
    settleAttendance:function(){note('settleAttendance');
      return P(window.__attendanceMissing?0:1)},
    sendReminders:function(){note('sendReminders');
      return P(window.__attendanceMissing?0:0)},
    /* Called on every load beside the two above. It answers with how many
       notes it raised, and on almost every load that is zero — the real one
       is silent about failure for the same reason these are. */
    nudgeDormant:function(){note('nudgeDormant');
      return P(window.__dormancyMissing?0:(window.__dormantRaised||0))},
    snoozeDormant:function(id){note('snoozeDormant:'+id);
      if(window.__dormancyMissing) return P({needsMigration:true,
        error:'That isn\u2019t switched on for this site yet.'});
      if(window.__snoozeFail) return P({error:window.__snoozeFail});
      /* Really stamps it, and in sessionStorage rather than on window,
         because the button reloads the page — addInitScript runs again and
         would put the dial straight back. The point of the test is what the
         band says AFTER the reload. */
      try{ sessionStorage.setItem('pf_stub_snoozed', new Date().toISOString()); }catch(e){}
      return P({saved:true})},
    partnerOutcomes:function(ids){
      if(window.__attendanceMissing) return P(null);
      var by={}, src=window.__partnerOut||{};
      (ids||[]).forEach(function(i){ if(src[i]) by[i]=src[i]; });
      return P(by)},
    sessionCheckin:function(id,showed,go){
      note('checkin:'+id+':'+(showed===null||showed===undefined?'-':showed)+':'+(go||'-'));
      if(window.__attendanceMissing) return P({needsMigration:true,
        error:'Check-ins aren’t switched on for this site yet.'});
      if(window.__checkinFail) return P({error:window.__checkinFail});
      return P({saved:true,outcome:window.__checkinOut||
        (go==='stop'?'ended':go==='continue'?'continuing':showed?'confirmed':'recorded')})},
    endPartnership:function(id){note('endPartnership:'+id);
      if(window.__attendanceMissing) return P({needsMigration:true,
        error:'That isn’t switched on for this site yet.'});
      return P({saved:true})},
    partneringStatus:function(){
      if(window.__attendanceMissing) return P(null);
      return P(window.__standingStatus||null)},
    markRequestsSeen:function(){return P({saved:true})},

    /* ---- safety: block, report, delete ---- */
    blockPerson:function(id){note('block:'+id);
      if(window.__safetyMissing) return P({needsMigration:true,
        error:'That isn\u2019t switched on for this site yet.'});
      return P(window.__blockFail?{error:window.__blockFail}:{saved:true})},
    unblockPerson:function(id){note('unblock:'+id);
      if(window.__blockFail) return P({error:window.__blockFail});
      /* Really removes it from the dial, so the list can be watched emptying
         and the card watched hiding itself — a stub that always answers
         {saved:true} would show neither. */
      if(window.__blocks) window.__blocks=window.__blocks.filter(function(b){return b.id!==id});
      return P({saved:true})},
    myBlocks:function(){return P(window.__blocks||[])},
    reportPerson:function(id,reason,detail,session,block){
      note('report:'+id+':'+reason+':'+(block!==false?'blocked':'not blocked'));
      if(window.__safetyMissing) return P({needsMigration:true,
        error:'That isn\u2019t switched on for this site yet.'});
      if(window.__reportFail) return P({error:window.__reportFail});
      window.__lastReported=id;
      if(block!==false && window.__blocks)
        window.__blocks=window.__blocks.concat([{id:id,at:new Date().toISOString(),name:null}]);
      return P({saved:true,data:'r1'})},
    reportReasons:['harassment','no_show','spam','safety','other'],
    partnerForSession:function(){return P(window.__farId===undefined?'u2':window.__farId)},
    withdrawReport:function(id,unblock){note('withdraw:'+id+':'+(unblock!==false));
      if(window.__undoTooLate) return P({tooLate:true,
        error:'That report has already been read, so it can\u2019t be taken back.'});
      if(window.__undoFail) return P({error:window.__undoFail});
      if(unblock!==false && window.__blocks)
        window.__blocks=window.__blocks.filter(function(b){return b.id!==window.__lastReported});
      return P({saved:true,data:true})},
    amendReport:function(id,detail){note('amend:'+id+':'+(detail||'').slice(0,40));
      if(window.__amendFail) return P({error:window.__amendFail});
      return P({saved:true,data:true})},
    deleteAccount:function(){note('deleteAccount');
      if(window.__deleteFail) return P({error:window.__deleteFail});
      return P({saved:true})},

    funnelCounts:function(){
      if (window.__funnel === null) return P(null);
      var base = {accounts:11, profile_complete:4, request_sent:2, partnered:2,
                  session_proposed:2, session_booked:1, session_attended:1,
                  accounts_7d:3, accounts_prev_7d:1};
      var over = window.__funnel || {}, out = {};
      Object.keys(base).forEach(function(k){
        out[k] = (over[k] === undefined ? base[k] : over[k]);
      });
      return P(out);
    },
    funnelDaily:function(){
      if (window.__funnelDays === null) return P(null);
      if (window.__funnelDays) return P(window.__funnelDays);
      /* Thirty days ending today. Mostly empty, which is honest, with one day
         that is not: a month of zeroes draws a flat row and a flat row cannot
         show whether the segments stack the right way up or whether the tallest
         day sets the scale. The busy day sits six days back rather than on the
         last column, so an off-by-one at either end of the row is visible. */
      var out = [], today = new Date();
      for (var i = 29; i >= 0; i--) {
        var d = new Date(today.getTime() - i * 86400000);
        var n = 0, done = 0;
        if (i === 6)  { n = 9; done = 3; }
        else if (i === 20) { n = 2; done = 2; }
        else if (i === 2)  { n = 1; done = 0; }
        out.push({day:d.toISOString().slice(0,10), accounts:n, profile_complete:done});
      }
      return P(out);
    },
    signOut:function(){return P()},
    trackNames:{frontend:'Frontend',backend:'Backend',cybersecurity:'Cybersecurity',
      data:'Data Science',mobile:'Mobile',devops:'DevOps & Cloud',aiml:'AI & ML',design:'UX/UI Design'}
  };
})();
