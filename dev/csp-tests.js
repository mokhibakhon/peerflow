const ROOT = require('path').resolve(__dirname, '..');
/* The Content-Security-Policy in vercel.json, checked against every page.
 *
 *     node dev/csp-tests.js
 *
 * A policy is only ever wrong in production, where a missing origin means a
 * stylesheet that does not load or a request that never leaves — and where
 * nobody sees the console. So this serves the real files with the real header
 * block read out of vercel.json, opens every page, and fails on any refusal.
 *
 * Reading the policy out of vercel.json rather than restating it here is the
 * point: edit the header and this follows, so the test cannot pass against a
 * policy the site does not ship.
 *
 * Worth knowing why an offline container can still check this: CSP is applied
 * when the request is made, before the network is touched. A forbidden origin
 * logs "Refused to ..." whether or not it would have loaded, so a blocked
 * jsdelivr and an allowed jsdelivr look different here even with no route to
 * either.
 *
 * What it does NOT cover is connect-src at runtime — the stub stands in for
 * db.js, so no Supabase call is made, and the LiveKit socket needs a URL that
 * only exists in deployment. Those two are checked on the preview deploy.
 */
const http=require('http'), fs=require('fs'), path=require('path');
const { chromium }=require('/opt/node22/lib/node_modules/playwright');

const vc=JSON.parse(fs.readFileSync(ROOT + '/vercel.json','utf8'));
const hdrs=vc.headers.find(h=>h.source==='/(.*)').headers;
const cspKey=hdrs.some(h=>h.key==='Content-Security-Policy')
  ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
console.log('policy under test: '+cspKey+'\n');
const TYPES={'.html':'text/html','.css':'text/css','.js':'application/javascript',
             '.json':'application/json','.xml':'application/xml','.txt':'text/plain'};

const srv=http.createServer((req,res)=>{
  let p=req.url.split('?')[0]; if(p==='/')p='/index.html';
  const f=path.join(ROOT + '', p);
  /* the stub swap the dev server does, so pages reach a signed-in state */
  const real = (p==='/assets/db.js') ? ROOT + '/dev/db-stub.js' : f;
  fs.readFile(real,(e,b)=>{
    if(e){res.writeHead(404);res.end('nope');return;}
    const h={'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'};
    hdrs.forEach(x=>h[x.key]=x.value);
    res.writeHead(200,h); res.end(b);
  });
});

const PAGES=['index.html','login.html','signup.html','reset.html','app.html','app-people.html',
             'app-person.html','app-sessions.html','app-progress.html','app-profile.html',
             'app-chat.html','app-settings.html','app-badges.html','call.html','draft.html'];

srv.listen(9111, async ()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  let refusals=0;
  for(const pg of PAGES){
    const p=await b.newPage({viewport:{width:1280,height:900}});
    const refused=[];
    p.on('console',m=>{ const t=m.text(); if(/Refused to |violates the following Content Security Policy/i.test(t)) refused.push(t.slice(0,150)); });
    await p.goto('http://127.0.0.1:9111/'+pg,{waitUntil:'networkidle'}).catch(()=>{});
    await p.waitForTimeout(900);
    if(refused.length){ refusals+=refused.length; console.log('CSP REFUSALS on '+pg+':'); refused.forEach(r=>console.log('    '+r)); }
    else console.log('ok  '+pg);
    await p.close();
  }
  console.log('\ntotal CSP refusals:', refusals);
  await b.close(); srv.close();
  if (refusals) { console.log('the shipped policy blocks something the pages ask for'); process.exit(1); }
  console.log('all checks pass');
});
