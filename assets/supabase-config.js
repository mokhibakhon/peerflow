/* PeerFlow — Supabase connection.
   These values are safe to publish: the publishable key is designed to be
   shipped to browsers, and Row Level Security governs what it can do. */
window.PF_SUPABASE = {
  url: 'https://ooolpkdqrfhnmcmdqhau.supabase.co',
  key: 'sb_publishable_J6dkpaoxLvLIhAEHldN-Sw_BXrYjv54',
  enabled: true,
  /* Flip to true once Google/GitHub providers are configured in
     Supabase → Authentication → Providers (SETUP_GUIDE.md steps 5–6).
     Until then those buttons use the simulated demo sign-in. */
  realOAuth: false
};
