/* A static server for the repo, so the signed-in pages can be looked at
   without Supabase, an account or a network.

     node dev/serve.js              the real site, on http://127.0.0.1:9000
     PF_STUB=1 node dev/serve.js    the same, with dev/db-stub.js standing in
                                    for assets/db.js and the auth gate off

   PF_STUB is the whole point: app.html and friends redirect to login and then
   sit at "Loading your sessions…" without a signed-in Supabase session, so
   there is nothing to screenshot and nothing to test. With the stub they
   render fully signed-in, and the window.__ dials at the top of db-stub.js
   put them in whichever state you want to look at.

   Set the dials by loading a script before the page's own, which in Playwright
   means intercepting the stub itself:

     await page.route('**\/dev/db-stub.js', async route => {
       const body = fs.readFileSync('dev/db-stub.js', 'utf8');
       route.fulfill({ contentType:'text/javascript',
         body: 'window.__noPartner = true;\n' + body });
     });

   PORT overrides the port. No dependencies; it is deliberately dumb. */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const PORT  = Number(process.env.PORT || 9000);
const STUB  = process.env.PF_STUB === '1';

const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
               '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
               '.webp':'image/webp', '.json':'application/json',
               '.woff2':'font/woff2', '.ico':'image/x-icon' };

http.createServer(function(req, res){
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  /* /draft is a rewrite in vercel.json, so it has to be one here too or the
     preview page 404s locally and works in production. */
  if (url === '/draft') url = '/draft.html';

  if (STUB && url === '/assets/db.js') url = '/dev/db-stub.js';
  /* The gate bounces you to login before the stub gets a chance to speak. */
  if (STUB && url === '/assets/authgate.js'){
    res.writeHead(200, { 'Content-Type':'text/javascript' });
    return res.end('/* disabled by PF_STUB */');
  }

  /* Nothing here should ever leave the repo. */
  var file = path.join(ROOT, path.normalize(url));
  if (file.indexOf(ROOT) !== 0){ res.writeHead(403); return res.end('no'); }

  fs.readFile(file, function(err, body){
    /* Vercel answers any path that matches no file and no rewrite with
       404.html at the site root, under a real 404 status. Doing the same here
       is not decoration: the point of this server is that a page behaves the
       way it will in production, and a dev server that returns a bare 'not
       found' string means the one page whose entire job is being reached by a
       wrong URL cannot be reached by a wrong URL locally. dev/notfound-tests.js
       drives it through here.
       The status stays 404 — serving the page under a 200 is the soft-404 that
       404.html's own comment warns about, and getting that wrong here is how
       it would get copied into vercel.json. */
    if (err){
      var nf = null;
      try { nf = fs.readFileSync(path.join(ROOT, '404.html')); } catch (e) {}
      if (nf){
        res.writeHead(404, { 'Content-Type':'text/html', 'Cache-Control':'no-store' });
        return res.end(nf);
      }
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
}).listen(PORT, function(){
  console.log('http://127.0.0.1:' + PORT + (STUB ? '   (stubbed data layer)' : ''));
});
