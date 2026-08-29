# Launch directory copy

One place for the fields every directory asks for, so PeerFlow reads the same
way on all of them. Copy the field you need; don't rewrite per site.

Everything here is drawn from the landing page rather than invented, so the copy
and the site agree. If the positioning changes, change it here too.

**Tone**: the same as the product. Plain, unexcited, no exclamation marks, no
claims about scale. It is early and saying so is more credible than not.

---

## The fields

**Name**
```
PeerFlow
```

**URL**
```
https://www.peerflow.dev
```

**Tagline** — Product Hunt caps this at 60 characters.
```
Find one tech study partner and meet on camera each week
```
(56 characters.)

Alternates, if a site wants something shorter or the first reads oddly in context:
```
One study partner, same level, same hours, every week      (53)
Not a study community. One partner who expects you.        (51)
```

**Short description** — 100–160 characters. Fits AlternativeTo, SaaSHub, BetaList.
```
PeerFlow matches you with one learner on the same path and level for recurring
1-on-1 camera-on study sessions.
```

**Long description** — for Product Hunt, Indie Hackers, BetaList.
```
Most people learning to code don't quit because the material is too hard. They
quit because nobody notices when they stop.

PeerFlow matches you with one other learner — same path, same level, overlapping
hours — and you meet on camera each week. Not a Discord server with four thousand
members. Not a group where showing up is optional. One person who is expecting
you on Tuesday.

You pick a path (frontend, backend, data, mobile, DevOps, AI/ML, cybersecurity,
UX/UI), your level, and the hours you can actually make. It matches on all three,
because a partner in the wrong timezone is not a partner. Sessions are booked in
advance, the room is created when you book, and the two of you build a streak.

It is deliberately small. One partner, not a feed. Recurring, not one-off. The
whole design assumes the hard part was never finding a tutorial.
```

**Categories / topics**

| Site | What to pick |
|---|---|
| Product Hunt | Education, Productivity, Remote Work |
| Indie Hackers | Education |
| AlternativeTo | Education, Online Services, Web |
| SaaSHub | Education, Productivity, Video Conferencing |
| BetaList | Education, Community |

**Alternative to** — for AlternativeTo and SaaSHub, which ask directly. These are
honest comparisons, not keyword stuffing.
```
Focusmate           — closest analogue, but generic co-working; PeerFlow matches
                      on what you are actually learning and your level
Study Together      — a large Discord community; PeerFlow is one matched partner
r/ProgrammingBuddies— the manual version of what this automates
Discord study servers
```

**Platform**: Web. **Pricing**: Free.

---

## Product Hunt maker's first comment

Post this as the first comment the moment it goes live. It is the highest-read
thing on a PH launch and the one place the founder story belongs — it is the
strongest thing on the landing page and it is true.

```
I grew up in a small town. I didn't need another course — I had more courses than
I could finish. I needed someone who'd show up on Tuesday because I was expecting
them.

That's the whole idea. PeerFlow matches you with one other learner on the same
path and level, with hours that actually overlap, and you meet on camera each
week. Not a community. Not a feed. One person.

It's early — a handful of people so far, and not yet on every path — so the thing
I most want to know is whether the matching gets it right. If you sign up and the
partner you get is wrong for you, I'd genuinely rather hear that than not.
```

Do not edit this to sound bigger than it is. "It's early" reads as honest on
Product Hunt and reads as a lie in reverse if someone signs up and finds six
people.

---

## Assets

| Need | Have | Where |
|---|---|---|
| Logo, square | yes, 180×180 | `apple-touch-icon.png` — for anything larger, `icon.svg` scales |
| Social / OG card, 1200×630 | yes | `assets/social.png`, already the og:image |
| Gallery images, 1270×760 (PH) | yes, 4 | `docs/launch/` |

The four in `docs/launch/`, in the order they should be uploaded:

1. `1-landing.png` — the hero, with the in-session card
2. `2-people.png` — the match, showing what it matches on: same path, hours you
   are both free, stage, timezone
3. `3-sessions.png` — a partnership with four sessions behind it
4. `4-progress.png` — the streak and the twelve-week plan

Shot at 2540×1520, which is 1270×760 at 2×. Product Hunt scales down, and a
1270-wide upload looks soft next to everyone else's.

**They are stub data, not real users.** `PF_STUB=1 node dev/serve.js` renders the
app fully signed in with the fixtures from `dev/db-stub.js`, which is the only way
to photograph a signed-in page — a signed-out capture is the "Loading your
sessions…" state. Demo data in a product screenshot is ordinary and nobody expects
a gallery image to be a live database.

One thing to decide rather than not notice: `2-people.png` shows two named people
who do not exist, and the page copy in that same shot reads "Nobody here is made
up." That sentence is true of the real page and false of the screenshot. It is a
judgement call, not a rule — if it sits badly, use the other three and drop that
one. To regenerate any of them:

    PF_STUB=1 PORT=9000 node dev/serve.js
    # then screenshot at 1270x760, deviceScaleFactor 2

---

## Order and pacing

Do not do these all in one day. Spread them out; a burst of identical submissions
across five sites in an hour looks like what it looks like.

1. **Indie Hackers** — lowest stakes, real audience, no launch mechanics. Start here.
2. **AlternativeTo** and **SaaSHub** — directory listings, permanent links, no timing pressure.
3. **BetaList** — has a queue, so submit early and it surfaces when it surfaces.
4. **Product Hunt** — last, and only once the gallery images exist. A PH launch
   without screenshots wastes the one day of attention it gives you.

A note on what these are worth: the links are real and permanent, which is the
point, but none of these is a traffic event on its own. The article and the
directories are the same bet — give Google reasons to trust the domain — and
that bet pays over weeks.
