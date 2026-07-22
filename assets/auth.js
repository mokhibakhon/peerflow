/* PeerFlow prototype auth — simulated sign-in flows for demo purposes only.
   No real Google/GitHub account is contacted and no password is ever asked. */
window.pfAuth = (function(){

  function openVeil(html){
    var veil = document.createElement('div');
    veil.className = 'modal-veil';
    veil.innerHTML = html;
    document.body.appendChild(veil);
    function close(){ if (veil.parentNode) veil.parentNode.removeChild(veil); document.removeEventListener('keydown', onKey); }
    function onKey(e){ if (e.key === 'Escape') close(); }
    veil.addEventListener('click', function(e){ if (e.target === veil) close(); });
    document.addEventListener('keydown', onKey);
    veil.close = close;
    return veil;
  }

  function busy(veil, provider, account, onDone){
    veil.querySelector('.modal').innerHTML =
      '<div class="auth-busy"><div class="spinner"></div>Signing you in with ' + provider + '…</div>';
    setTimeout(function(){
      veil.close();
      onDone(account);
    }, 750);
  }

  var gLogo = '<svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.2z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7C8 41.1 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.7 28.2a13.2 13.2 0 010-8.4v-5.7H4.4a22 22 0 000 19.8l7.3-5.7z"/><path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8 6.9 4.4 14.1l7.3 5.7c1.7-5.2 6.6-9.1 12.3-9.1z"/></svg>';

  var ghLogo = '<svg width="34" height="34" viewBox="0 0 16 16" fill="#fff" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

  function google(onDone){
    var veil = openVeil(
      '<div class="modal" role="dialog" aria-modal="true" aria-label="Sign in with Google (prototype)">' +
        '<div class="gm-head">' + gLogo +
          '<div class="gm-title">Choose an account</div>' +
          '<div class="gm-sub">to continue to <b style="color:#0b8f66">PeerFlow</b></div>' +
        '</div>' +
        '<div class="gm-list">' +
          '<button class="gm-acc" data-name="Mokhibakhon" data-email="mokhibakhon@gmail.com">' +
            '<span class="gm-av" style="background:#0b8f66">M</span>' +
            '<span><b>Mokhibakhon</b><span class="sub">mokhibakhon@gmail.com</span></span></button>' +
          '<button class="gm-acc" data-name="Demo Student" data-email="demo.student@gmail.com">' +
            '<span class="gm-av" style="background:#3d8fd1">D</span>' +
            '<span><b>Demo Student</b><span class="sub">demo.student@gmail.com</span></span></button>' +
          '<button class="gm-acc" data-other="1">' +
            '<span class="gm-av" style="background:#eef1f0;color:#5f6368">+</span>' +
            '<span><b>Use another account</b></span></button>' +
        '</div>' +
        '<div class="gm-form">' +
          '<input type="text" placeholder="Your name" data-f="name">' +
          '<input type="email" placeholder="Email" data-f="email">' +
          '<button class="btn primary" data-go="1" style="margin-top:2px">Continue</button>' +
        '</div>' +
        '<div class="gm-foot">Prototype sign-in for the PeerFlow demo — no real Google account is contacted and no password is asked.</div>' +
      '</div>');

    veil.addEventListener('click', function(e){
      var acc = e.target.closest('.gm-acc');
      if (acc) {
        if (acc.getAttribute('data-other')) {
          veil.querySelector('.gm-form').classList.add('on');
          veil.querySelector('[data-f=name]').focus();
          return;
        }
        busy(veil, 'Google', { name: acc.getAttribute('data-name'), email: acc.getAttribute('data-email'), provider: 'Google' }, onDone);
        return;
      }
      if (e.target.closest('[data-go]')) {
        var n = veil.querySelector('[data-f=name]').value.trim() || 'Student';
        var m = veil.querySelector('[data-f=email]').value.trim() || 'student@gmail.com';
        busy(veil, 'Google', { name: n, email: m, provider: 'Google' }, onDone);
      }
    });
  }

  function github(onDone){
    var veil = openVeil(
      '<div class="modal" role="dialog" aria-modal="true" aria-label="Authorize PeerFlow on GitHub (prototype)">' +
        '<div class="gh-head">' + ghLogo + '</div>' +
        '<div class="gh-body">' +
          '<h3>Authorize PeerFlow</h3>' +
          '<p>PeerFlow wants to access your <b>@mokhibakhon</b> account</p>' +
          '<div class="gh-scopes">' +
            '<div class="gh-scope"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="3" stroke="#57606a" stroke-width="1.6"/><path d="M2.5 14c.6-2.6 2.7-4 5.5-4s4.9 1.4 5.5 4" stroke="#57606a" stroke-width="1.6" stroke-linecap="round"/></svg>Read your profile information</div>' +
            '<div class="gh-scope"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="#57606a" stroke-width="1.6"/><path d="M2 4.5l6 4.5 6-4.5" stroke="#57606a" stroke-width="1.6"/></svg>Read your email address</div>' +
          '</div>' +
        '</div>' +
        '<div class="gh-actions">' +
          '<button class="btn ghost" data-cancel="1">Cancel</button>' +
          '<button class="btn gh-authorize" data-auth="1">Authorize PeerFlow</button>' +
        '</div>' +
        '<div class="gm-foot">Prototype sign-in for the PeerFlow demo — no real GitHub account is contacted.</div>' +
      '</div>');

    veil.addEventListener('click', function(e){
      if (e.target.closest('[data-cancel]')) { veil.close(); return; }
      if (e.target.closest('[data-auth]')) {
        busy(veil, 'GitHub', { name: 'Mokhibakhon', email: 'mokhibakhon@users.noreply.github.com', provider: 'GitHub' }, onDone);
      }
    });
  }

  return { google: google, github: github };
})();
