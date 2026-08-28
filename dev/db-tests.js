/* assets/db.js itself, against a fake PostgREST.
 *
 *     node dev/db-tests.js
 *
 * Every other browser suite swaps db.js for dev/db-stub.js, which is the
 * right trade for testing pages — it makes states reachable that a real
 * database could not be talked into. But it means the data layer's own logic
 * has never been executed by anything. The whole of db.js, the column
 * ladders included, was covered by nothing.
 *
 * That is not hypothetical. myRequests() cached which rung of the ladder had
 * answered, and the cached path returned the raw PostgREST response instead
 * of the {incoming, outgoing} shape the first call returned — so the first
 * call on a page was right and every later one was not. It reached
 * production and surfaced as an uncaught TypeError in the notification bell,
 * because the bell is the thing that calls it twice.
 *
 * So this loads the real file with a fake client underneath it and asserts on
 * what it hands back. No browser, no network, no stub.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let fails = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  PASS ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/* A PostgREST double: every builder method returns the same object, and it
   resolves as a thenable so `await`/.then() on the chain works the way the
   real client does. `answer` decides what each call comes back with, which is
   how a missing column is simulated. */
function fakeClient(answer, signedInAs) {
  const calls = [];
  const chain = (table) => {
    const state = { table, cols: null };
    const self = {
      select(cols) { state.cols = cols; return self; },
      or() { return self; },
      in() { return self; },
      eq() { return self; },
      is() { return self; },
      /* trackCounts()'s fallback filters with .not('track_id','is',null), and
         a builder method this double is missing does not read as missing: the
         TypeError lands in db.js's own catch and comes back as null, which is
         a legitimate answer from that function. So the test failed looking
         exactly like a database refusing. */
      not() { return self; },
      gte() { return self; },
      lte() { return self; },
      limit() { return self; },
      order() { return self; },
      /* getProfile() ends its chain on maybeSingle(), and saveProfile() on
         upsert(). Neither existed here, so both fell over as "not a function"
         — which is why a suite written to cover this file's own logic was
         still not exercising the two calls every page makes first. */
      maybeSingle() { state.one = true; return self; },
      single() { state.one = true; return self; },
      upsert(row) { state.write = 'upsert'; state.row = row; return self; },
      update(row) { state.write = 'update'; state.row = row; return self; },
      insert(row) { state.write = 'insert'; state.row = row; return self; },
      then(res, rej) {
        calls.push({ table: state.table, cols: state.cols, write: state.write || null });
        return Promise.resolve(answer(state)).then(res, rej);
      }
    };
    return self;
  };
  const auth = {
    getSession: () => Promise.resolve({ data: { session: { user: { id: signedInAs } } } }),
    getUser:    () => Promise.resolve({ data: { user: { id: signedInAs } } })
  };
  /* An RPC reaches `answer` the same way a table read does, tagged so a test
     can tell the two apart — which is the whole point for trackCounts(), whose
     job is to call the function and fall back to the table when the function
     is not there yet. */
  const rpc = (fn, args) => {
    calls.push({ rpc: fn, args: args || null });
    return Promise.resolve(answer({ rpc: fn, args: args || null }));
  };
  return { from: chain, auth, rpc, __calls: calls };
}

/* Load assets/db.js in a context that looks enough like a browser. */
function loadDb(client) {
  const root = path.resolve(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'assets', 'db.js'), 'utf8');
  const store = {};
  const win = {
    PF_SUPABASE: { enabled: true, url: 'https://x.supabase.co', key: 'k' },
    supabase: { createClient: () => client },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    location: { href: 'https://www.peerflow.dev/app.html', search: '', origin: 'https://www.peerflow.dev' },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    console
  };
  win.window = win;
  const ctx = vm.createContext(win);
  ctx.document = { addEventListener() {}, querySelector: () => null };
  new vm.Script(src).runInContext(ctx);
  return ctx.window.pf;
}

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';

(async () => {
  console.log('\n==> myRequests answers the same shape every time it is asked');
  {
    /* A database with every column, so the first rung answers and gets
       cached — which is the state the bug needed. */
    const client = fakeClient(state => {
      if (state.table === 'partner_requests') {
        return { data: [{ id: 'r1', from_user: THEM, to_user: ME, status: 'pending',
                          created_at: '2026-08-01T00:00:00Z' }], error: null };
      }
      return { data: [{ id: THEM, name: 'Amir Karimov' }], error: null };
    }, ME);
    const pf = loadDb(client);

    const first  = await pf.myRequests();
    const second = await pf.myRequests();
    const third  = await pf.myRequests();

    ok('the first call returns incoming and outgoing',
       !!first && Array.isArray(first.incoming) && Array.isArray(first.outgoing),
       'got ' + JSON.stringify(first && Object.keys(first)));
    ok('  and so does the second, once a rung has been cached',
       !!second && Array.isArray(second.incoming) && Array.isArray(second.outgoing),
       'got ' + JSON.stringify(second && Object.keys(second)));
    ok('  and the third',
       !!third && Array.isArray(third.incoming) && Array.isArray(third.outgoing),
       'got ' + JSON.stringify(third && Object.keys(third)));
    ok('  the row lands on the side the recipient sees it from',
       !!second && second.incoming.length === 1 && second.outgoing.length === 0,
       'in=' + (second && second.incoming.length) + ' out=' + (second && second.outgoing.length));
    ok('  and never hands back a raw PostgREST response',
       !!second && !('data' in second) && !('error' in second),
       'keys: ' + JSON.stringify(second && Object.keys(second)));
  }

  console.log('\n==> and when the newest columns are missing');
  {
    /* First rung 400s the way PostgREST does for an unknown column, so the
       ladder has to step down — and the shape must survive that too. */
    let asked = 0;
    const client = fakeClient(state => {
      if (state.table !== 'partner_requests') return { data: [], error: null };
      asked++;
      if (String(state.cols).indexOf('dormant_nudged_at') >= 0) {
        return { data: null, error: { code: '42703',
                 message: 'column partner_requests.dormant_nudged_at does not exist' } };
      }
      return { data: [], error: null };
    }, ME);
    const pf = loadDb(client);

    const a = await pf.myRequests();
    const b = await pf.myRequests();
    ok('it steps down a rung and still returns the shape',
       !!a && Array.isArray(a.incoming), 'got ' + JSON.stringify(a && Object.keys(a)));
    ok('  and the call after it does too',
       !!b && Array.isArray(b.incoming), 'got ' + JSON.stringify(b && Object.keys(b)));
    ok('  without re-asking for the column it already knows is missing',
       asked <= 3, 'partner_requests reads: ' + asked);
  }


  console.log('\n==> the readers a page asks for from several places at once');
  /* The measurement this was written from: on app-sessions.html the network
     panel showed profiles?select=*&id=eq.<me> four times — 412ms, 787ms,
     1.19s, 1.59s — because appshell.js, usermenu.js, the page itself and
     db.js internals each asked independently and the four queued behind each
     other. Nothing in this file deduplicated anything, so every caller paid a
     full round trip for an answer another caller already had in flight.

     Counting is the only way to see it. A test that awaits getProfile() and
     checks the value passes identically whether one request was made or four,
     which is exactly why this went unnoticed for so long. */
  {
    const client = fakeClient(state => {
      if (state.table === 'profiles') {
        return { data: { id: ME, name: 'Mohibaxon Omonhonova' }, error: null };
      }
      return { data: [], error: null };
    }, ME);
    const pf = loadDb(client);
    const reads = t => client.__calls.filter(c => c.table === t && !c.write).length;

    /* Concurrently, the way a page does it — not awaited one after another. */
    const all = await Promise.all([
      pf.getProfile(), pf.getProfile(), pf.getProfile(), pf.getProfile(),
    ]);
    ok('four concurrent getProfile() callers make one request → ' + reads('profiles'),
       reads('profiles') === 1, 'each caller paid its own round trip');
    ok('  and every one of them still gets the profile',
       all.every(p => p && p.id === ME), 'got ' + JSON.stringify(all));

    /* fetchSessions() showed the same four in the panel, from the page twice
       and notify.js once with db.js calling it again internally. */
    const sessionsClient = fakeClient(() => ({ data: [], error: null }), ME);
    const pf2 = loadDb(sessionsClient);
    await Promise.all([
      pf2.fetchSessions(), pf2.fetchSessions(), pf2.fetchSessions(), pf2.fetchSessions(),
    ]);
    const sessionReads = sessionsClient.__calls.filter(c => c.table === 'sessions' && !c.write).length;
    ok('four concurrent fetchSessions() callers make one request → ' + sessionReads,
       sessionReads === 1, 'each caller paid its own round trip');

    /* And what is deliberately NOT cached. A caller arriving after the burst
       has settled gets a fresh read, because the cache holds a promise only
       while it is in flight. That is the whole safety argument: a settled
       value is never handed out, so no write anywhere in this file can leave
       this reader serving a stale row — at the cost of a later read still
       paying for itself, which is what it cost before anyway. */
    const later = await pf.getProfile();
    ok('  but a caller after they settle reads again → ' + reads('profiles'),
       reads('profiles') === 2 && later && later.id === ME,
       'the cache outlived the burst, which is how stale rows get served');
  }

  console.log('\n==> and nothing survives long enough to go stale');
  /* The half that makes memoising safe rather than a new bug. A result cache
     would need every writer in db.js — saveProfile, saveGoal, the two that
     write plan_weeks, and the rest — to remember to drop it, and the one that
     forgot would serve the row from before the save. Holding the promise only
     while it is in flight means there is no such writer to forget. */
  {
    let name = 'Before';
    const client = fakeClient(state => {
      if (state.table === 'profiles') return { data: { id: ME, name: name }, error: null };
      return { data: [], error: null };
    }, ME);
    const pf = loadDb(client);

    const before = await pf.getProfile();
    ok('the first read sees the row as it is', before && before.name === 'Before');

    name = 'After';
    /* No write at all, and the next read still sees the change: there is no
       settled value anywhere to serve instead. */
    const next = await pf.getProfile();
    ok('  the next read sees a row that changed underneath it → ' + JSON.stringify(next && next.name),
       next && next.name === 'After',
       'a settled value was served, so a stale row is now reachable');

    await pf.saveProfile({ name: 'Third' });
    name = 'Third';
    const after = await pf.getProfile();
    ok('  and a read after saveProfile() sees the new row → ' + JSON.stringify(after && after.name),
       after && after.name === 'Third');
  }

  console.log('\n==> trackCounts counts, whichever end answers');
  {
    /* The database has had migration-profiles-private.sql run, so the function
       is there and profiles is not readable without a session. One row per
       track, with a total — and PostgREST is entitled to send that bigint as a
       string, which an earlier draft of this scored as one apiece. */
    const client = fakeClient(state => {
      if (state.rpc === 'track_counts') {
        return { data: [{ track_id: 'frontend', learners: 3 },
                        { track_id: 'backend',  learners: '12' }], error: null };
      }
      return { data: [], error: null };
    }, null);
    const pf = loadDb(client);
    const counts = await pf.trackCounts();

    ok('the function\'s totals are used as totals, not as one row each',
       counts && counts.frontend === 3, 'frontend=' + (counts && counts.frontend));
    ok('  including a bigint that arrived as a string',
       counts && counts.backend === 12, 'backend=' + (counts && counts.backend));
    ok('  and a track nobody is on reads zero, not undefined',
       counts && counts.mobile === 0, 'mobile=' + (counts && counts.mobile));
    ok('  the table itself is never asked',
       client.__calls.every(c => c.table !== 'profiles'),
       JSON.stringify(client.__calls));
  }

  console.log('\n==> and when the migration has not been pasted in yet');
  {
    /* PostgREST answers PGRST202 for a function it cannot find. The landing
       page predates the function by a long way, so it has to keep working
       against a database that still has the old open policy — one row per
       person, no learners column, worth one apiece. */
    const client = fakeClient(state => {
      if (state.rpc === 'track_counts') {
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      }
      return { data: [{ track_id: 'frontend' }, { track_id: 'frontend' },
                      { track_id: 'design' }], error: null };
    }, null);
    const pf = loadDb(client);
    const counts = await pf.trackCounts();

    ok('it steps down to the table and still gets the numbers',
       counts && counts.frontend === 2 && counts.design === 1,
       JSON.stringify(counts));
    ok('  having tried the function first',
       client.__calls.some(c => c.rpc === 'track_counts'),
       JSON.stringify(client.__calls));
  }

  console.log('\n==> but a refusal is not a count of zero');
  {
    /* Any other error means the answer is unknown, and null is how this file
       says so. home.js draws nothing at all for null; zero would draw "be the
       first" on eight paths that may be full. */
    const client = fakeClient(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }), null);
    const pf = loadDb(client);
    const counts = await pf.trackCounts();
    ok('a database that refuses says nothing, rather than saying nobody',
       counts === null, 'got ' + JSON.stringify(counts));
  }

  console.log('\n' + '='.repeat(51));
  console.log(fails ? fails + ' failed' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
