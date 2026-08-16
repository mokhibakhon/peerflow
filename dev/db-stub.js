/* Stand-in for assets/db.js. Local screenshots and Playwright checks only —
   never served in production; dev/serve.js swaps it in behind PF_STUB=1.

   Same function names and return shapes as the real db.js, with fixed sample
   rows instead of Supabase, so every page renders signed-in with no network
   and no account. Each state the pages can be in is a window.__ dial, set
   before this file loads:

     __partners    array of {requestId, roomUrl, standing, profile}
     __sessions    array of session rows (startsAt must be a real Date)
     __noPartner   true for the no-partner-yet state
     __empty       true for no sessions at all
     __momentum    object merged over the streak fixture, or null for none
     __unread      unread message count
     __goalCol     weekly goal, or null to act as though the column is missing
     __planWeeks   the twelve-week plan as stored on the profile
     __standing    {minutes, agreed, mine} for a standing slot
     __sharedBy    shared hours by JS weekday, overriding the default

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
  function past(d,st,att){var x=new Date();x.setDate(x.getDate()-d);x.setHours(19,0,0,0);
    return {id:'p'+d,partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:x,durationMin:50,
      roomUrl:'https://meet.jit.si/PeerFlow-demo',status:st,proposedBy:'me',note:null,mine:true,
      cancelledByMe:false,confirmedAt:x,goal:'Read a packet capture',goalDone:true,attended:att,
      completedAt:x,cancelledAt:null};}

  var SESSIONS=[
    {id:'s1',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:soon,durationMin:50,
     roomUrl:'https://meet.jit.si/PeerFlow-demo',status:'confirmed',proposedBy:'them',note:null,
     mine:false,cancelledByMe:false,confirmedAt:null,goal:'Wireshark TCP practice',goalDone:null,
     attended:null,completedAt:null,cancelledAt:null},
    {id:'s2',partnerName:'Amir Karimov',topic:'Cybersecurity',startsAt:prop,durationMin:50,
     roomUrl:'https://meet.jit.si/PeerFlow-demo2',status:'proposed',proposedBy:'them',note:null,
     mine:false,cancelledByMe:false,confirmedAt:null,goal:null,goalDone:null,attended:null,
     completedAt:null,cancelledAt:null},
    past(7,'completed',true), past(14,'completed',true), past(21,'completed',true),
    past(28,'completed',false)
  ];

  function standingOf(){
    var s=window.__standing; if(!s) return null;
    var a=new Date(); a.setHours(19,0,0,0);
    a.setDate(a.getDate()+((4-a.getDay()+7)%7||7));
    return {anchor:a,minutes:s.minutes||50,agreed:!!s.agreed,mine:!!s.mine};
  }

  var PARTNER={requestId:'r1',roomUrl:'https://meet.jit.si/PeerFlow-demo',
    get standing(){return standingOf();},
    profile:{id:'u2',name:'Amir Karimov',track_id:'cybersecurity',topic:'Cybersecurity',
      level:'tutorials',timezone:'Asia/Tashkent',availability:THEIR_AVAIL}};

  var PROFILE={id:'u1',name:'Mohibaxon Omonhonova',track_id:'cybersecurity',topic:'Cybersecurity',
    level:'tutorials',timezone:'Asia/Tashkent',availability:MY_AVAIL,stage_index:3,pref_minutes:50,
    created_at:'2026-06-01T00:00:00Z',
    get sessions_per_week(){ return window.__goalCol===null?undefined:(window.__goalCol||3); },
    get plan_weeks(){ return window.__planWeeks||null; }};

  var P=function(v){return Promise.resolve(v)};
  function note(k){ try{ var a=JSON.parse(sessionStorage.getItem('__calls')||'[]');
    a.push(k); sessionStorage.setItem('__calls',JSON.stringify(a)); }catch(e){} }
  return {
    ready:function(){return true},
    currentUser:function(){return P({id:'u1'})},
    getProfile:function(){return P(PROFILE)},
    saveProfile:function(){note('saveProfile');return P({saved:true})},
    fetchPeers:function(){return P([
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
    fetchSessions:function(){return P(window.__sessions||(window.__empty?[]:SESSIONS))},
    /* The room. __joinFail makes join_session refuse, the way the real one
       does outside the window or on somebody else's session. */
    sessionAt:function(at,room){
      var want=new Date(at).getTime();
      var list=window.__sessions||(window.__empty?[]:SESSIONS);
      for(var i=0;i<list.length;i++){
        if(list[i].roomUrl===room && list[i].startsAt.getTime()===want) return P(list[i]);
      }
      return P(null);
    },
    joinSession:function(at,room){ note('join:'+room);
      if(window.__joinFail) return P({recorded:false});
      return P({recorded:true,at:new Date()}); },
    settleSessions:function(){ note('settle'); return P({settled:window.__settled||0}); },
    /* The real one crosses two timezones; here it is a fixed set of shared
       hours so the booking sentence has days to offer. Tue/Thu/Sun evenings,
       keyed by JS weekday like the real byDay. */
    sharedAvailability:function(){
      var ev=[17,18,19,20,21], by={0:ev,2:ev,4:ev};
      if(window.__sharedBy) by=window.__sharedBy;
      return {byDay:by,slots:[]};
    },
    primaryPartner:function(){return P(PARTNER)},
    acceptedPartners:function(){return P(window.__partners||(window.__noPartner?[]:[PARTNER]))},
    reliability:function(){return P({attended:3,noShow:1,early:1,late:0,counted:4,pct:75})},
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
    weekStart:function(d){var x=new Date(d);x.setHours(0,0,0,0);
      x.setDate(x.getDate()-((x.getDay()+6)%7));return x.getTime();},
    partnerState:function(){return P({confirmed:true,attended:false,hasGoal:true})},
    rankedMatches:function(){return P([
      {id:'m1',name:'Amir Karimov',trackId:'cybersecurity',trackName:'Cybersecurity',topic:'SOC analyst',
       level:'tutorials',timezone:'Asia/Tashkent',shared:['tue-evening','thu-evening','sun-evening'],
       why:['Same path','Same stage','Same timezone','3 shared study windows'],score:95,match:95},
      {id:'m2',name:'Dilnoza Rahimova',trackId:'cybersecurity',trackName:'Cybersecurity',topic:'Pentesting',
       level:'tutorials',timezone:'Asia/Tashkent',shared:['thu-evening'],
       why:['Same path','Same stage','1 shared study window'],score:75,match:75},
      {id:'m3',name:'Bekzod Yusupov',trackId:'cybersecurity',trackName:'Cybersecurity',topic:'CTFs',
       level:'new',timezone:'Europe/London',shared:[],why:['Same path','Close stage'],score:50,match:50}
    ])},
    badgeStats:function(){ if(window.__badgeStats) return P(window.__badgeStats);
      return P({pastSessions:4,partners:1,mostWithOnePartner:4,totalMinutes:200,
      longestWeekStreak:4,profileComplete:true,joinRank:2})},
    unlockedAchievements:function(){return P(window.__unlocked||[])},
    unlockAchievement:function(code){note('unlock:'+code);
      return P({fresh:window.__freshUnlock===undefined?true:window.__freshUnlock})},
    notifySelf:function(){note('notifySelf');return P({sent:true})},
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
    confirmAttendance:function(){return P({saved:true})},
    setSessionGoal:function(){return P({saved:true})},
    finishSession:function(){return P({saved:true})},
    proposeSession:function(){note('propose');return P({saved:true})},
    acceptSession:function(){note('acceptSession');return P({saved:true})},
    declineSession:function(){note('declineSession');return P({saved:true})},
    cancelBooked:function(){note('cancelBooked');return P({saved:true})},
    cancelSession:function(){return P({saved:true})},
    sendPartnerRequest:function(){note('sendPartnerRequest');return P({sent:true})},
    notifyPartner:function(){return P({sent:true})},
    notifyRequest:function(){return P({sent:true})},
    endPartnership:function(){return P({saved:true})},
    /* Consistent with acceptedPartners(): u2 is an accepted partner, so the
       request row that made them one has to exist. */
    myRequests:function(){return P({incoming:(window.__incoming||[]),outgoing:[
      {id:'r1',from_user:'u1',to_user:'u2',status:'accepted',created_at:'2026-06-02T00:00:00Z',
       other:PARTNER.profile}
    ],me:'u1'})},
    respondToRequest:function(id,st){note('respond:'+id+':'+st);
      if(window.__respondFail) return P({error:window.__respondFail});
      return P({saved:true})},
    reliabilityOf:function(ids){
      if(window.__relMissing) return P(null);
      var by={}, src=window.__rel||{};
      (ids||[]).forEach(function(i){
        by[i]=src[i]||{pct:null,counted:0,attended:0,noShows:0};
      });
      return P(by)},
    reliabilityLabel:function(p){
      if(p===null||p===undefined) return '';
      if(p>=95) return 'Always turns up';
      if(p>=90) return 'Very reliable';
      if(p>=80) return 'Reliable';
      if(p>=65) return 'Usually turns up';
      return 'Often misses'},
    fetchNotifications:function(){return P([])},
    markNotificationsRead:function(){return P({saved:true})},
    markRequestsSeen:function(){return P({saved:true})},
    signOut:function(){return P()},
    sharedSlots:sharedSlots,slotLabel:slotLabel,slotHours:slotHours,nextDateFor:nextDateFor,
    dayOrder:DAY_ORDER,dayLabel:DAY_LABEL,bandHours:BAND_HOURS,
    trackNames:{frontend:'Frontend',backend:'Backend',cybersecurity:'Cybersecurity',
      data:'Data & Analytics',mobile:'Mobile',devops:'DevOps & Cloud',aiml:'AI & ML',design:'UX/UI Design'}
  };
})();
