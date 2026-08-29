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
across five sites in an hour looks like what it looks like. Roughly one a day, in
this order, easiest first.

### Before you start, once

    git pull origin main

That brings down `docs/launch/` — the four gallery images — so they are on the
machine you are uploading from. Keep this file open beside the forms.

Every site below wants some subset of the same six things, and they are all
above: name, URL, tagline, short description, long description, categories.
Nothing here needs writing from scratch.

### Day 1 — Indie Hackers

The lowest-stakes one, which is why it is first: no launch mechanics, no timing,
and a real audience of people building the same kind of thing.

1. indiehackers.com, sign up (GitHub or email).
2. Find **Products** in the nav, then the button to add one. It asks for a name,
   a URL, a tagline and a description.
3. Name, URL and **tagline** from above; **long description** in the description
   box.
4. Fill in your own profile before you leave — a product attached to an empty
   profile reads as a drive-by.

Optional and worth more than the listing itself: post in a relevant group about
something you actually learned building it. The RLS article is exactly that, and
linking it there is not self-promotion, it is the thing the group is for.

### Day 2 — AlternativeTo

A permanent directory link, and the one place the "alternative to" list matters.

1. alternativeto.net, create an account.
2. Look for **Add application** (it may be under a menu rather than a button).
3. Name, URL, **short description**.
4. Platform: **Online / Web**. Licence: **Free**.
5. Categories: Education, Online Services.
6. Then add the alternatives from the list above — Focusmate is the one that
   matters, because it is the closest real comparison and people search it.

### Day 3 — SaaSHub

Same shape, ten minutes.

1. saashub.com, create an account, find **Submit a product**.
2. Name, URL, **tagline**, **short description**.
3. Categories: Education, Productivity, Video Conferencing.
4. Alternatives: Focusmate, Study Together.

### Day 4 — BetaList

1. betalist.com, find the submit page.
2. Name, URL, **tagline**, **long description**, one screenshot —
   `docs/launch/1-landing.png`.

Be aware of what you are agreeing to: BetaList has a free queue and a paid
fast-track. The free queue is slow and does not guarantee publication at all. Do
not pay for it. Submit, forget about it, and treat anything that comes of it as a
bonus.

### Day 5 or later — Product Hunt

Last on purpose. It gives you one day of attention and you cannot have it twice,
so it goes after the gallery images exist and after your account is not brand
new.

1. **Create the account a few days before you launch.** Follow some people,
   upvote things you actually like, comment once or twice. A launch from an
   account registered that morning gets less distribution.
2. When ready: **Submit a product**. Fill in name, URL, **tagline** (this is the
   60-character one), and the **long description**.
3. Topics: Education, Productivity, Remote Work.
4. Gallery: upload all four from `docs/launch/`, in numbered order. The first is
   the one most people see.
5. **Schedule it rather than launching immediately.** Launches go live at 12:01am
   Pacific and run 24 hours. That is **noon in Tashkent**, which is unusually
   convenient — you can be awake and answering comments for your whole launch
   day, which matters more than the listing.
6. The moment it is live, post the **maker's first comment** from above as the
   first comment.
7. Then stay near your phone. Answering every comment quickly is most of what
   separates a launch that goes somewhere from one that does not. Do not ask
   people to upvote you — Product Hunt detects vote solicitation and penalises
   it.

### What to expect

The links are real and permanent, which is the point. But none of these is a
traffic event on its own, and Product Hunt in particular has a long tail of
people who launch, get forty upvotes and no users. That is the normal outcome and
it is not a failure — the listing and the link keep working afterwards.

The article and the directories are the same bet: give Google reasons to trust a
domain that currently has none. That bet pays over weeks, not on launch day.
