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

## Still to verify outside the repository

These cannot be checked from the codebase and are worth confirming once:

- **`peerflow.dev` must 301 to `www.peerflow.dev`.** Every canonical, the
  sitemap and robots.txt name the `www` host. If the apex also serves the site
  with a 200 instead of redirecting, the whole site exists at two addresses and
  the canonical tag is the only thing preventing a split. This is a Vercel
  domain setting, not something `vercel.json` controls.
- **Search Console** should have both the `www` and apex properties, with the
  sitemap submitted for `www`.
- **IndexNow** verification: the key file is served at
  `/be030ef03ed94c948bb69dfcc4f0d4b1.txt` and contains exactly that key. It was
  previously committed as `YOUR_NEW_KEY.txt`, a placeholder filename, which
  meant verification could never have succeeded.
- **The production deploy actually carries these changes.** Pushing to `main`
  does not deploy; see the deploy note in `CLAUDE.md`.

## Phase 2 — prove queries before expanding
Use Google Search Console. For 4–8 weeks, record queries, impressions, CTR and average position by landing page. Expand only around queries that earn impressions or clearly represent high product intent.

Potential next pages, only when evidence supports them:
- /coding-study-partner.html
- /programming-study-buddy.html
- /study-with-me-tech.html
- React, Python, Security+, AWS, PyTorch, Figma topic pages

## Phase 3 — content that earns links
Create useful original resources, not generic AI blog posts:
- How to run a productive 1-on-1 study-with-me session
- Study-partner compatibility checklist
- Weekly tech learning accountability template
- Camera-on study etiquette and safety guide
- Anonymous aggregate insights from PeerFlow activity once enough real usage exists

## Conversion loop
Every organic landing page should lead naturally to:
1. choose the path,
2. describe the current topic,
3. state level,
4. add weekly availability,
5. find a compatible peer,
6. book/show up to a camera-on session.

SEO success is not pageviews alone. Track signup rate, completed profiles, matches, first sessions, and repeat sessions by landing page.
