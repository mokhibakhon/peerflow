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
      order() { return self; },
      then(res, rej) {
        calls.push({ table: state.table, cols: state.cols });
        return Promise.resolve(answer(state)).then(res, rej);
      }
    };
    return self;
  };
  const auth = {
    getSession: () => Promise.resolve({ data: { session: { user: { id: signedInAs } } } }),
    getUser:    () => Promise.resolve({ data: { user: { id: signedInAs } } })
  };
  return { from: chain, auth, __calls: calls };
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

  console.log('\n' + '='.repeat(51));
  console.log(fails ? fails + ' failed' : 'all checks pass');
  process.exit(fails ? 1 : 0);
})();
