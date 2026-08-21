/* PeerFlow — reporting somebody, as one component used from two places.
 *
 *     pfReport.open({
 *       userId:     '…',
 *       name:       'Sarah',
 *       sessionId:  '…',          // optional; a call has one, a profile does not
 *       afterBlock: 'You will…',  // optional; a line the host page wants shown
 *       onDone:     function(o){} // { reported, blocked, userId, name }
 *     });
 *
 * Opened from app-person.html, where there is a whole page, and from
 * call.html, where there is live video underneath and navigating anywhere at
 * all drops the call. It is the same component in both, which is most of why
 * it is a file rather than a block on each page.
 *
 * THE SHAPE, AND WHY
 *
 * Five reasons, and pressing one is the whole action: the report is filed and
 * the person is blocked in the same breath, with no form in between. Three
 * options were drawn on /draft and this is the one chosen. The argument for it
 * is not about layout — somebody reaching for this button has just been made
 * uncomfortable, and that is not the state in which to be asked four
 * questions before anything happens.
 *
 * The argument against it is that a one-press action with real consequences
 * is easy to hit by accident, and that objection is answered rather than
 * waved away: withdraw_report() gives fifteen minutes to take the whole thing
 * back, and the button offering it is on the screen straight after. Without
 * that this flow should not be built, which is worth saying plainly in case
 * somebody later decides the undo is clutter.
 *
 * What undo genuinely cannot restore is the partnership and the sessions that
 * blocking called off — sessions do not record the status they had before, so
 * a confirmed one and a proposed one cannot be told apart afterwards, and
 * guessing would put a session nobody agreed to back on a calendar. The card
 * says so where somebody deciding whether to undo will actually read it.
 *
 * There is no dependency on app.css or call.css. The two pages that open this
 * do not share a stylesheet, so report.css defines its own buttons.
 */
window.pfReport = (function(){
  'use strict';

  /* The five the database accepts. Kept here as label and blurb rather than
     read from pf.reportReasons, which is only the codes — the wording is the
     part somebody has to understand in a hurry. */
  var REASONS = [
    ['harassment', 'Harassment',
     'Abuse, threats, or anything sexual'],
    ['safety',     'They made me feel unsafe',
     'Something else that frightened me'],
    ['no_show',    'They didn’t turn up',
     'Booked time and never appeared'],
    ['spam',       'Spam or advertising',
     'Selling something, or not here to learn'],
    ['other',      'Something else', '']
  ];

  var wrap = null;      /* the overlay, while it is open */
  var opts = null;      /* what open() was called with */
  var reportId = null;  /* set once a report exists */
  var blocked = false;  /* whether they are blocked as things stand */
  var lastFocus = null;

  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function el(html){
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  function firstName(n){
    return String(n || '').trim().split(/\s+/)[0] || 'them';
  }

  /* ---------- screen one: pick a reason ---------- */
  function screenReasons(){
    var who = esc(firstName(opts.name));
    return '' +
      '<p class="rp-h">Report ' + who + '</p>' +
      '<p class="rp-s">Pick one and it is sent. They are never told they were ' +
        'reported or blocked.</p>' +
      '<div class="rp-reasons">' +
        REASONS.map(function(r){
          return '<button type="button" class="rp-r" data-reason="' + r[0] + '">' +
                 '<b>' + esc(r[1]) + '</b>' +
                 (r[2] ? '<span>' + esc(r[2]) + '</span>' : '') +
                 '</button>';
        }).join('') +
      '</div>' +
      '<p class="rp-note" data-note></p>' +
      '<div class="rp-acts">' +
        '<button type="button" class="rp-b" data-close>Cancel</button>' +
      '</div>';
  }

  /* ---------- screen two: it is done, and here is what else you can do ---------- */
  function screenDone(){
    var who = esc(firstName(opts.name));
    return '' +
      '<p class="rp-done"><b>Report sent, and ' + who + ' is blocked.</b> ' +
        'Somebody will read it. Nothing else is needed — the rest is optional.</p>' +
      '<p class="rp-caveat">Blocking ended your partnership and took any sessions you ' +
        'had booked off both calendars. Undoing puts the block back but not those.' +
        /* Whatever the page that opened this is about to do when the card
           closes. The component cannot know it — leaving a call is call.html's
           business — but somebody about to press Close should not find out
           afterwards. */
        (opts.afterBlock ? ' ' + esc(opts.afterBlock) : '') + '</p>' +
      '<textarea class="rp-t" data-detail maxlength="2000" ' +
        'placeholder="Add what happened, if you want to (optional)"></textarea>' +
      '<label class="rp-keep"><input type="checkbox" data-keep checked>' +
        '<span>Keep ' + who + ' blocked</span></label>' +
      '<p class="rp-note" data-note></p>' +
      '<div class="rp-acts">' +
        '<button type="button" class="rp-b" data-save>Save</button>' +
        '<button type="button" class="rp-b" data-close>Close</button>' +
        '<button type="button" class="rp-b quiet" data-undo>Undo — I didn’t mean to</button>' +
      '</div>';
  }

  /* ---------- screen three: taken back ---------- */
  function screenUndone(){
    return '' +
      '<p class="rp-h">Taken back</p>' +
      '<p class="rp-s">The report is gone and ' + esc(firstName(opts.name)) +
        ' is not blocked. Nothing was sent to them at any point.</p>' +
      '<p class="rp-caveat">Sessions that came off your calendar are still off it. ' +
        'Propose a new time whenever you want to.</p>' +
      '<div class="rp-acts">' +
        '<button type="button" class="rp-b" data-close>Close</button>' +
      '</div>';
  }

  function card(){ return wrap.querySelector('.rp-card'); }
  function note(msg, kind){
    var n = card().querySelector('[data-note]');
    if (!n) return;
    n.textContent = msg || '';
    n.className = 'rp-note' + (kind ? ' ' + kind : '');
  }

  function paint(html){
    card().innerHTML = html;
    var focusable = card().querySelector('button, textarea, input');
    if (focusable) focusable.focus();
  }

  /* ---------- sending ---------- */
  function send(reason, btn){
    btn.classList.add('sending');
    card().querySelectorAll('.rp-r').forEach(function(b){ b.disabled = true; });
    note('');

    pf.reportPerson(opts.userId, reason, null, opts.sessionId || null, true)
      .then(function(res){
        if (res && res.saved) {
          reportId = res.data || null;
          blocked = true;
          paint(screenDone());
          return;
        }
        btn.classList.remove('sending');
        card().querySelectorAll('.rp-r').forEach(function(b){ b.disabled = false; });
        note((res && res.error) || 'Could not send that. Please try again.', 'bad');
      });
  }

  /* Save is two things at once on purpose: the sentence and the block are one
     decision from where the person is standing, and making them press twice
     to change both would be a form again.
     
     On success it closes. It used to write "Saved." into the card and stay
     open, which read as nothing having happened — the card sat there, the
     page behind it still showed the person as a partner, and the only way to
     find out what had actually occurred was to reload. Closing is what says
     it worked, because closing is what lets the page redraw. */
  function save(btn){
    var detail = (card().querySelector('[data-detail]') || {}).value || '';
    var keep   = (card().querySelector('[data-keep]') || {}).checked;
    btn.disabled = true;
    note('');

    var jobs = [];
    if (detail.trim()) jobs.push(pf.amendReport(reportId, detail));
    if (!keep)         jobs.push(pf.unblockPerson(opts.userId));

    if (!jobs.length) { close(); return; }

    Promise.all(jobs).then(function(rs){
      var bad = rs.filter(function(r){ return !r || !r.saved; })[0];
      if (bad) {
        btn.disabled = false;
        note(bad && bad.error ? bad.error : 'Could not save that.', 'bad');
        return;
      }
      if (!keep) blocked = false;
      close();
    });
  }

  function undo(btn){
    btn.disabled = true;
    note('');
    pf.withdrawReport(reportId, true).then(function(res){
      if (res && res.saved && res.data !== false) {
        blocked = false;
        paint(screenUndone());
        return;
      }
      btn.disabled = false;
      /* tooLate is its own answer rather than an error: the report was read
         while this card was open, which is not a fault of anybody's. */
      note((res && res.error) ||
           'Could not undo that.', 'bad');
    });
  }

  /* ---------- open and close ---------- */
  function onKey(ev){
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key !== 'Tab' || !wrap) return;
    /* Keep tabbing inside the card. An overlay you can tab out of leaves a
       keyboard somewhere it cannot see, which on a call is the page behind
       a scrim. */
    var f = card().querySelectorAll('button:not(:disabled), textarea, input');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  /* Closing is the only moment the page that opened this learns anything.
     Without it every host page shows whatever it drew before — a profile
     saying "Partners" for somebody you have just blocked and who the database
     will no longer even show you — until a reload. That was the bug: the work
     was done and nothing on screen said so. */
  function close(){
    if (!wrap) return;
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('in');

    var w = wrap, done = opts && opts.onDone;
    var outcome = { reported: !!reportId, blocked: blocked, userId: opts && opts.userId,
                    name: opts && opts.name };

    wrap = null; opts = null; reportId = null; blocked = false;
    setTimeout(function(){ if (w.parentNode) w.parentNode.removeChild(w); }, 180);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch(e){} }
    lastFocus = null;

    /* After the focus restore, so a page that navigates away is not fighting
       a focus() call on an element it is about to discard. */
    if (done) { try { done(outcome); } catch(e){ try { console.error('PeerFlow: onDone', e); } catch(e2){} } }
  }

  function open(o){
    if (!o || !o.userId) return;
    if (wrap) close();
    opts = o; reportId = null; blocked = false;
    lastFocus = document.activeElement;

    wrap = el('<div class="rp-wrap" role="dialog" aria-modal="true" ' +
              'aria-label="Report ' + esc(firstName(o.name)) + '">' +
              '<div class="rp-card"></div></div>');
    document.body.appendChild(wrap);
    paint(screenReasons());

    wrap.addEventListener('click', function(ev){
      /* A click on the scrim itself closes; a click that started inside the
         card does not, so selecting text and releasing outside is safe. */
      if (ev.target === wrap) { close(); return; }

      var b = ev.target.closest && ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-close'))  { close(); return; }
      if (b.hasAttribute('data-reason')) { send(b.getAttribute('data-reason'), b); return; }
      if (b.hasAttribute('data-save'))   { save(b); return; }
      if (b.hasAttribute('data-undo'))   { undo(b); return; }
    });

    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(function(){ if (wrap) wrap.classList.add('in'); });
  }

  return { open: open, close: close, reasons: REASONS };
})();
