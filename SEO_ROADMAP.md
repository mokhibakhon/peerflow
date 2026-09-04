# PeerFlow SEO Roadmap

## Product positioning
PeerFlow is a peer-to-peer **study with me** platform for tech learners. It matches one learner with another based on learning path, current level/topic, and compatible weekly availability. The core session is recurring, 1-on-1, and camera-on.

## Eight first-class learning paths
1. Frontend
2. Backend
3. Cybersecurity
4. Data Science
5. Mobile Development
6. DevOps & Cloud
7. AI & Machine Learning
8. UX/UI Design

Each path has its own indexable landing page. These pages must stay meaningfully distinct and useful; do not mass-produce near-duplicate keyword pages.

## Primary search-intent clusters
- tech study partner / coding study partner / programming study buddy
- study with me online / camera-on study session / virtual study partner
- [path] study partner (frontend, backend, cybersecurity, data science, mobile, DevOps, AI/ML, UX/UI)
- topic-level intent only after Search Console proves demand (for example React study partner, Python study partner, Security+ study partner)

## Phase 1 — launch foundation (implemented)
- Crawlable homepage with accurate product positioning
- Eight distinct public path pages
- Canonicals, descriptions, Open Graph/Twitter metadata, all on the `www` host
- Connected structured data: one Organization and WebSite node that every page
  references by `@id`, plus per-page WebPage, BreadcrumbList and — on the path
  pages — FAQPage generated from the FAQ the page actually renders
- robots.txt + a sitemap generated from the pages themselves
- noindex on auth/private application pages
- internal links from homepage to every path page
- SEO regression tests covering all twelve public pages

The privacy, terms and code-of-conduct pages are part of this set. They are
indexable and linked from every footer, so they belong in the sitemap and under
the same canonical rules as the landing pages; they had been treated as if they
were not.

## What is worth what

Not everything in Phase 1 carries the same weight, and it is worth writing the
difference down so nobody spends another week on schema tags expecting a
ranking change.

**Load-bearing.** Canonical host consistency is the only item here that was
actively costing something: a canonical naming a host the site does not serve
from tells Google the real page is elsewhere. The IndexNow key had to be
correct or the whole mechanism was inert. Tests that derive the page list stop
the next page from being added and forgotten.

**Worth having, not worth expecting much from.** FAQPage markup is the clearest
case. Google restricted FAQ rich results to well-known authoritative government
and health sites in August 2023, so for a site like this one the markup will
almost certainly produce no visible change in Google results. It is kept
because it is accurate, cheap, and machine-readable for consumers other than
Google Search — not because it will move a ranking. The same goes for
`og:locale`, the Open Graph image dimensions, and the extra WebPage and
BreadcrumbList nodes: correctness and polish, not leverage.

Listing the legal pages in the sitemap is likewise optional rather than urgent.
A sitemap should carry the canonical URLs you want in search, and nobody needs
organic traffic on a terms page. Their canonicals pointing at the wrong host
mattered; their absence from the sitemap did not. They are included because the
sitemap is now generated from whatever is indexable, and carving out exceptions
would cost more than it saves.

## Confirmed outside the repository

- **`peerflow.dev` 301s to `www.peerflow.dev`.** Checked directly. Every
  canonical, the sitemap and robots.txt name the `www` host, and the apex
  redirects to it, so the site has one address.
- **IndexNow verification works.** `curl https://www.peerflow.dev/be030ef03ed94c948bb69dfcc4f0d4b1.txt`
  returned the key on 2026-09-04. It had never succeeded before: the file was
  once committed as `YOUR_NEW_KEY.txt`, a placeholder filename, so the
  mechanism was inert however correct everything around it was. The same curl
  is the cheapest proof that production is serving `main`, which is why this
  entry names the command rather than only the conclusion.

## Still to verify outside the repository

- **Search Console** should have both the `www` and apex properties, with the
  sitemap submitted for `www`.

Merging to `main` is the deploy. The Vercel Git connection was reconnected
after the repository rename, so there is no separate release step for any of
this — see the deploy entry in `CLAUDE.md`. Nothing here needs a migration, so
this particular merge carries no ordering risk.

The one thing worth a look afterwards is that production really is serving the
branch, and this change happens to make that free to check: it adds a file that
has never existed in production before.

    curl -s https://www.peerflow.dev/be030ef03ed94c948bb69dfcc4f0d4b1.txt

That returning the key means the deploy landed, and it is also the IndexNow
verification working for the first time. Both at once.

## Phase 2 — prove queries before expanding
Use Google Search Console. For 4–8 weeks, record queries, impressions, CTR and average position by landing page. Expand only around queries that earn impressions or clearly represent high product intent.

Potential next pages, only when evidence supports them:
- /coding-study-partner.html
- /programming-study-buddy.html
- /study-with-me-tech.html
- React, Python, Security+, AWS, PyTorch, Figma topic pages

## Phase 3 — content that earns links
Create useful original resources, not generic AI blog posts. Three of the five
are built and in the sitemap; the list is marked so nobody rebuilds them:

- **built** — How to run a productive 1-on-1 study-with-me session
  (`how-to-run-a-study-with-me-session.html`)
- **built** — Study-partner compatibility checklist
  (`study-partner-compatibility-checklist.html`)
- **built** — Camera-on study etiquette and safety guide
  (`camera-on-study-session-safety.html`)
- Weekly tech learning accountability template
- Anonymous aggregate insights from PeerFlow activity once enough real usage
  exists — and `app-metrics.html` is now the thing that would say when that is,
  which it could not before 2026-09-04

## Conversion loop
Every organic landing page should lead naturally to:
1. choose the path,
2. describe the current topic,
3. state level,
4. add weekly availability,
5. find a compatible peer,
6. book/show up to a camera-on session.

SEO success is not pageviews alone. Track signup rate, completed profiles, matches, first sessions, and repeat sessions by landing page.
