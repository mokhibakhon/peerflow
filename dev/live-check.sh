#!/usr/bin/env bash
# Does production match the repository?
#
#     dev/live-check.sh                      against https://www.peerflow.dev
#     dev/live-check.sh http://127.0.0.1:9000   against a local dev/serve.js
#
# SEO_ROADMAP.md has a section called "Still to verify outside the repository",
# and the trouble with a section like that is that it stays unverified: three
# separate things to remember, each a different URL, none of them checked since
# the day they were written. This is that section as one command.
#
# It is deliberately curl and nothing else. It has to run on the owner's laptop,
# because the agent container cannot reach www.peerflow.dev — the proxy refuses
# it on CONNECT and returns an empty body, and an empty body is not evidence
# that a site is down. Anything that needed node, a token or a login would go
# unrun for the same reason the roadmap section did.
#
# The origin argument is not decoration either: pointing it at dev/serve.js is
# how the script itself gets tested, since the one machine that can run it
# against production is not the one that writes it.
set -u
ORIGIN="${1:-https://www.peerflow.dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
pass () { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail () { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }
code () { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$ORIGIN$1"; }
dest () { curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "$ORIGIN$1"; }

echo
echo "── $ORIGIN"
echo

# 1. IndexNow. This has never been confirmed working: the key was committed for
#    a while under the placeholder name YOUR_NEW_KEY.txt, so verification could
#    not have succeeded, and nobody has checked since it was fixed. The file has
#    to return exactly its own filename.
echo "IndexNow"
key=$(ls "$ROOT" | grep -E '^[a-f0-9]{8,128}\.txt$' | head -1)
if [ -z "$key" ]; then
  fail "no key file in the repository"
else
  got=$(curl -s --max-time 15 "$ORIGIN/$key" | tr -d '[:space:]')
  want="${key%.txt}"
  [ "$got" = "$want" ] && pass "/$key returns its own key" \
                       || fail "/$key returned '${got:-nothing}', expected '$want'"
fi

# 2. The build marker. This is the whole point of PF_BUILD: "is it deployed?"
#    answered by reading rather than arguing.
echo
echo "Build marker"
want=$(grep -m1 -o "PF_BUILD = '[^']*'" "$ROOT/assets/db.js" | sed "s/.*'\(.*\)'/\1/")
got=$(curl -s --max-time 15 "$ORIGIN/assets/db.js" | grep -m1 -o "PF_BUILD = '[^']*'" | sed "s/.*'\(.*\)'/\1/")
[ "$got" = "$want" ] && pass "serving $got, which is what this checkout says" \
                     || fail "serving '${got:-nothing}', checkout says '$want' — deploy has not landed, or you are behind main"

# 3. The .html addresses still answer 200. This is the one that matters most:
#    every canonical, every sitemap entry and every internal link names the
#    .html form, so if one of these ever redirects, the redirects have been
#    pointed the wrong way and the site is telling search engines to index URLs
#    that bounce.
echo
echo "Canonical addresses answer directly"
for p in / /privacy.html /terms.html /conduct.html /frontend-study-partner.html; do
  c=$(code "$p")
  [ "$c" = "200" ] && pass "$p → 200" || fail "$p → $c (must be 200, never a redirect)"
done

# 4. Every URL the sitemap advertises. A sitemap listing a URL that redirects is
#    a self-inflicted crawl error, and it is the failure this whole redirect
#    direction was chosen to avoid.
echo
echo "Every URL in sitemap.xml"
# The locs are absolute and name the canonical host, which is correct in the
# file and wrong to fetch verbatim: run against anything but production — a
# preview deployment, dev/serve.js — and this would quietly check production
# instead and report on the wrong site. The path is what is being tested, so
# the host is swapped for the origin under test. That the locs name the right
# host in the first place is dev/seo-tests.js's job, not this one's.
locs=$(curl -s --max-time 15 "$ORIGIN/sitemap.xml" | grep -o '<loc>[^<]*</loc>' \
  | sed 's/<[^>]*>//g' | sed 's|^https\{0,1\}://[^/]*||')
if [ -z "$locs" ]; then
  fail "sitemap.xml returned nothing"
else
  n=0; bad=0
  while IFS= read -r u; do
    n=$((n + 1))
    c=$(code "$u")
    [ "$c" = "200" ] || { fail "$u → $c"; bad=$((bad + 1)); }
  done <<< "$locs"
  [ "$bad" = "0" ] && pass "all $n answer 200"
fi

# 5. The addresses people type.
echo
echo "Typed addresses"
for pair in "/privacy /privacy.html" "/login /login.html" "/frontend /frontend-study-partner.html"; do
  set -- $pair
  c=$(code "$1"); d=$(dest "$1")
  { [ "$c" = "308" ] || [ "$c" = "301" ]; } && [ "${d%$2}" != "$d" ] \
    && pass "$1 → $c $2" || fail "$1 → $c ${d:-no redirect}, expected a redirect to $2"
done

# 6. A missing page is a 404 and says so with its status, not just its words.
#    A soft 404 — the page under a 200 — is indexable, and every mistyped URL
#    becomes a duplicate of it.
echo
echo "Missing pages"
c=$(code /random)
[ "$c" = "404" ] && pass "/random → 404" || fail "/random → $c (a 200 here is a soft 404)"
c=$(code /404)
[ "$c" = "404" ] && pass "/404 → 404, so the page has no address of its own" \
                 || fail "/404 → $c (it must never answer 200 anywhere)"
c=$(code /draft)
[ "$c" = "200" ] && pass "/draft → 200, still a rewrite" || fail "/draft → $c"

echo
if [ "$fails" -gt 0 ]; then echo "$fails check(s) failed."; exit 1; fi
echo "Production matches the repository."
