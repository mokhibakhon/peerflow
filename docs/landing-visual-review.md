# PeerFlow landing page — visual and product-design review

Reviewed at commit `319d5b8`. No application file was changed in producing this
document.

This is a judgement of the page as one experience, not a list of section
verdicts. Where a number appears it was measured in the browser, not estimated.

---

## 1. Screenshots

| File | What it is |
|---|---|
| `docs/screenshots/current-landing-390-full.png` | Full page, 390px wide (4,511px tall) |
| `docs/screenshots/current-landing-768-full.png` | Full page, 768px wide (4,390px tall) |
| `docs/screenshots/current-landing-1440-full.png` | Full page, 1440px wide (3,038px tall) |
| `docs/screenshots/current-landing-390-hero.png` | First viewport, 390 × 844 |
| `docs/screenshots/current-landing-1440-hero.png` | First viewport, 1440 × 900 |

**How they were taken.** `index.html` was served unmodified over a local static
server. The data layer was replaced *in memory* by a Playwright route handler —
no file on disk was touched — returning a signed-out user and realistic
early-stage learner counts (4, 2, 6, 1, 2, 1, 3, 0 — deliberately including a
zero so the "be the first" state appears). Plus Jakarta Sans was installed
locally so the type renders in the real face; the sandbox blocks the Google
Fonts CDN. The pomodoro is frozen at 18:24 so repeat captures are comparable.

*Caveat:* the typeface is the static-instance TTF set, not the variable font the
live site loads. Letterfit may differ by a hair from production.

### Measured shape of the page

| | 390px | 768px | 1440px |
|---|---|---|---|
| Page height | 4,511px | 4,390px | 3,038px |
| Hero | 19% | 17% | 19% |
| How it works | **40%** | 25% | 23% |
| Learning paths | 29% | **44%** | **37%** |
| Founder | 8% | 10% | 15% |
| Artwork as share of a path card | 46% | 61% | 58% |
| Artwork as share of a how-it-works card | 54% | 58% | 52% |
| Links to `signup.html` | 10 | 10 | 10 |

Two numbers drive most of what follows: **learning paths is the biggest section
on the page at every desktop width**, and **artwork is more than half of every
card on the page**.

---

## 2. Five-second comprehension

Give a stranger five seconds on the desktop fold. They reliably learn:

- it is about learning IT
- it involves other people rather than doing it alone
- there is a video session with a timer
- it is free to join and beginner friendly

They do **not** learn the three things that actually distinguish PeerFlow:

1. **It is exactly one other person.** "Together" is the word a Discord server,
   a bootcamp cohort, a study group and a class all use. The strongest fact
   about this product — *one* partner, not a group — is stated only in the
   trust line at 13.5px grey, and in the session card, which is decoration
   until you've read the words.
2. **You choose.** There is no engine. The visitor has no way to know that, and
   the secondary button actively suggests the opposite ("See how matching
   works").
3. **It is a recurring commitment.** "Weekly slot — Tuesdays, 19:00" is in the
   card, but nothing in the headline or supporting sentence says the point is
   turning up again next week.

**Verdict: partial.** The page reads as credible and calm within five seconds,
but a visitor could close the tab still thinking PeerFlow is a study-group
finder. The distinguishing claim is present on the page and absent from the
part of the page people actually read.

---

## 3. Visual hierarchy

**The type scale has a hole in it.** Measured at 1440: h1 55 → h2 33 → lede 18
→ **card h3 18** → path h3 17.5 → body 14.5 → mono kickers 11.5–12.

A card title is the same size as the hero's supporting sentence, and the drop
from section heading (33) to card heading (18) has nothing between it. The
result is that at card level everything reads as one flat tier — kicker, title
and description differ by weight and colour but barely by size.

**Six corner radii are in use**: 0, 9, 10, 12, 16, 18. Cards are 16 except the
session card at 18; buttons are 10 except path CTAs at 9. Nobody consciously
notices this; everybody feels it.

**Contrast fails in one place.** The how-it-works cards are white on the white
full-bleed band, separated only by a `#DEDDE6` hairline. In the 1440 full-page
capture the four cards nearly dissolve into the band — the pictures read, the
cards don't.

**Colour discipline breaks in one place.** The page is otherwise disciplined:
dark green, warm neutral, one accent green. Then the paths grid introduces eight
fully saturated illustration backgrounds — indigo, emerald, rust, blue,
magenta, slate, violet, ochre — each occupying ~58% of its card. It is the only
part of the page that looks like it came from a different product.

---

## 4. Section by section

### Navigation

- **Is the main action obvious?** Visually yes — one filled dark button against
  three plain links. Structurally it is the only thing competing with the hero
  CTA, and it uses *the same four words*, 600px apart.
- **Is mobile navigation usable?** No. Below 760px "How it works" and "Learning
  paths" are hidden; below 520px "Log in" goes too. There is no menu behind
  them. A phone visitor cannot navigate the page at all — the nav is a logo and
  a signup button.
- **Are important links hidden?** Yes, the two above.
- **Does the CTA wording match the product?** No. See §5.

### Hero

The hero is the best-composed part of the page and the headline wraps cleanly —
two lines breaking at the comma at every width down to ~345px, one line between
600 and 900. That problem is solved.

- **One obvious primary CTA?** Yes, visually. Undermined by the nav duplicate.
- **Does the session preview support or compete?** Supports, clearly. It is the
  single most valuable asset on the page: it shows one-to-one, cameras on, a
  named field, and a standing weekly time. It says what the headline doesn't.
- **Is the card too busy?** No. Four blocks, well spaced, nothing fighting.
- **Does the pomodoro add value?** Marginally. It is the one element in the card
  that isn't part of the sentence the hero is making. A visitor who doesn't
  already practise pomodoro learns nothing from it; a visitor who does gets a
  small nod. It is correctly sized at 15–18% of card height, so it costs
  little — but it is the first thing to cut if the card ever needs room.
- **Mobile hero: premium or cramped?** Premium, but **entirely text**. The
  session card doesn't begin until ~515px down; the whole first screen is a
  wordmark, a button, a headline, a sentence, two buttons and a grey line. The
  best asset is below the fold on the device most people arrive on.
- Two stacked mobile CTAs are **different widths** (they hug their labels), which
  reads as untidy rather than deliberate.

### How it works

- **Is four the right amount?** No — three. Steps 1–3 are things the user does;
  step 4, "Build something real", is an *outcome*, and it is the one card whose
  promise the product cannot keep. Four cards also force a 2×2 at 768 and a
  1,782px stack at 390 (40% of the mobile page) for content that is four short
  sentences.
- **Do the four visuals feel like one system?** No, and this is the most visible
  inconsistency on the page. Cards 1, 2 and 4 share the green PeerFlow bar over
  a white body. Card 3 is a photograph under a *white* bar with dark type. In
  the 1440 full-page view the row reads as three of one thing and one of
  another.
- **Too tall or text-heavy?** On mobile, yes — 397px per card, four of them.
- **Does the sequence describe the real product?** Steps 2 and 3 now do, exactly.
  Step 1 still says "over the next four weeks" and its illustration still reads
  "Your goal · four weeks" — the last four-week language on a page whose product
  has no four-week system. Step 4 implies a project outcome the product does not
  provide.

### Learning paths

- **Is the grid easy to scan?** No. To read eight words you look past eight
  posters. The information — the path name — is the smallest, quietest element
  in each card.
- **Do illustrations dominate the names?** Yes, measurably: 58–61% of card area
  at desktop.
- **Are two columns at 390 readable and attractive?** Readable, yes — the names,
  counts and buttons all sit on one line each, and all eight paths fit in about
  700px. Attractive, adequately. **This was the right call and should stay.**
- **Are the cards too tall?** Yes at 768, where 361px cards over four rows make
  the section 44% of the page.
- **Are the buttons repetitive?** Severely. Eight identical "Find my partner"
  buttons; ten links to `signup.html` on one page. The button is also doing no
  work a whole-card link wouldn't do better.
- **Do live counts help or add noise?** They **help**, a lot. They are the only
  real data on the page, and "be the first" on an empty path is a genuinely
  charming, honest touch that most startups would have faked. Keep them; make
  them quieter and put them next to the name rather than above it.
- **Mobile: which layout?** Keep two compact columns. Make them *more* compact
  by shrinking the artwork, not by changing the column count.

### Founder section and footer

- **Does the founder story strengthen trust?** It is the strongest copy on the
  page. "I needed someone who'd show up on Tuesday because I was expecting them"
  is the only sentence that makes the product feel necessary rather than nice.
- **Is it positioned right?** Near the end is right. **Last is not.**
- **Is there a strong next action at the bottom?** No. The page's most
  persuasive moment is followed by the footer. A visitor who reads all the way
  down — the most motivated visitor there is — is handed nothing to do.
- **Does the footer feel complete without fake links?** Yes. Two real links, a
  real email, no invented About/Careers/Press. For a startup at this stage that
  restraint reads as honest, not thin. Leave it alone.
- One weakness: the attribution is the word **"Founder"**. An anonymous personal
  story is a trust leak — the more personal the text, the more its anonymity is
  noticed.

---

## 5. Whole-page rhythm

**What is working.** Section padding is consistent (110px). The full-bleed band
alternation — warm grey, white, warm grey, dark green — gives the page four
clear movements and closes it properly. Everything is left-aligned except the
founder pull-quote, which is centred on purpose and earns it. Desktop length is
3,038px: short, focused, no filler sections.

**Where it feels empty.** The white how-it-works band at 1440: 702px of band
around a 379px row of cards. Airy in a way that reads as unfinished rather than
generous, because the cards themselves have so little contrast against it.

**Where it feels overcrowded.** The paths grid at 768 — eight saturated
illustrations stacked four rows deep, 44% of the page.

**Where it feels repetitive.** Ten signup links; eight identical buttons; two
different CTA vocabularies ("Join the next cycle" / "Find my partner") for the
same destination.

**Where it feels inconsistent.** The four how-it-works visuals; six card radii;
a section head with a kicker and a subtitle (paths) next to one with neither
(how it works).

**Where it feels too playful.** Only the path illustrations, and only because
they are large and saturated on a page that is otherwise restrained.

**Where it feels too corporate.** Nowhere. The founder note and the honest
"be the first" counts keep it human.

**Where it feels like a template.** The paths grid. Colourful illustrated tile,
title underneath, button under that, repeated eight times, is the single most
generic pattern in startup landing pages. Everything else on this page looks
specific to PeerFlow; this looks bought.

---

## 6. Mobile assessment (390px)

Good: the headline wraps beautifully; the two-up paths grid is a real
improvement; nothing overflows; the session card is legible; type sizes hold up.

Problems, in order:

1. **No navigation exists.** Logo and one button. Two section links are hidden
   with no replacement.
2. **The first screen is all text.** No image until ~515px down.
3. **How it works is 40% of the page** — 1,782px for four short sentences.
4. **Unequal stacked CTA widths** in the hero.
5. The trust line wraps with "group" orphaned on line two.

---

## 7. Desktop assessment (1440px)

Good: the hero is well balanced; the session card is genuinely good; the page is
short; the band rhythm reads clearly; the founder close is strong.

Problems, in order:

1. **The paths grid outweighs everything** — 37% of the page, and the loudest
   colour on it.
2. **How-it-works cards have too little contrast** against the white band.
3. **The fourth step breaks the visual system** and makes a claim the product
   can't keep.
4. **Nothing follows the founder note.**
5. Hierarchy flattens at card level (h3 = lede = 18px).

---

## 8. Messaging

### Critique of what is there now

**"Learn IT together, not alone."**
Clean, well set, easy to read — and it says one thing twice. "Together" and
"not alone" are the same claim; the second half adds rhythm but no information.
Nothing in it is specific to PeerFlow: a bootcamp, a Discord, a class and a
study group could all use this line unchanged. It omits the product's only
genuinely distinguishing noun — **one** person.

**"Choose your learning path and find someone at a similar level with a
compatible schedule."**
The most honest and most useful sentence in the hero. Accurate to the product,
no invented mechanism. Slightly clinical — "compatible schedule" is the
language of a form field — and it stops one beat short: it never says what
happens after you find them.

**"Join the next cycle"**
The weakest copy on the page, and the last untrue thing on it.
- There is no cycle. No four-week system exists.
- "The next" implies cohort timing and a queue. Signup is open and immediate.
- That implication is manufactured urgency, which the product should not be
  doing at all, let alone about a feature that doesn't exist.
- It also splits the page's CTA vocabulary in two, against eight buttons that
  say something else entirely.

### Recommended

> ## Learn IT with one person who shows up.
>
> Pick your field, see who else is learning it, and choose the person you'll
> meet each week.
>
> **[ Find my partner ]**

**Why the headline.** It carries the one fact nothing else on the page carries
in words — *one person* — and it borrows the founder's own language. "Someone
who'd show up on Tuesday" is the most memorable phrase on the page; putting
"shows up" in the headline makes the founder note feel like the proof of the
promise rather than an afterthought. It is concrete, seven words, no hype
vocabulary, and it is true today.

**Why the supporting sentence.** It names the three real steps in order — pick,
see, choose — and "the person you'll choose" quietly kills the matching-engine
assumption before anyone forms it. "Each week" sets the cadence the product
actually runs on. No four weeks, no plan, no algorithm.

**Why the CTA.** It is honest about what the product does, it removes the
invented cycle, and — used everywhere — it collapses two CTA vocabularies into
one. Eight buttons already say it.

**Secondary CTA:** "See how matching works" → **"See how it works"**. It points
at `#how`, and there is no matching to see.

*Implementation note for whoever does this:* `assets/home.js` finds the two auth
links by `href`, never by text, and rewrites the signup link's `textContent` to
"Open app" when someone is signed in. Changing the button wording is safe;
changing its `href` is not.

---

## 9. One design direction

**Quiet product, loud proof.**

The page should feel like a small team that built something specific and is
describing it plainly — calm, editorial, confident enough not to decorate. The
brand's dark green and warm neutral carry it; the product's own green is the
only accent; photography of real people is the only saturated colour. Every
section earns its height, and nothing is repeated eight times.

**Visual personality.** Restrained, warm, honest. Editorial rather than
promotional. The current hero already has this; the paths grid does not.

**Hero composition.** Unchanged in structure — copy left, session card right,
stacking on mobile. New headline and sentence. One primary CTA, one text-weight
secondary. On mobile, bring something visual above the fold: either lift the
session card above the buttons or crop it so its top third is visible at 844px.
Make the two mobile buttons equal width.

**Session card complexity.** Leave it. Four blocks is right, the spacing is
right, and it is the clearest explanation of the product on the page. The
pomodoro stays at its current small size; it is the block to sacrifice if
anything ever needs room.

**How it works structure.** Three steps, one row at desktop, one column on
mobile: *Pick your path* → *Choose who you learn with* → *Meet every week*.
All three visuals in the same drawn shell (green bar, white body, 1280:841).
Drop the fourth step and its four-week language entirely. Give the cards a
slightly stronger border or a faint tint so they hold against the white band.

**Learning-path card structure.** Invert the current ratio. A small icon
(48–56px, the existing illustration reduced to a mark, or a duotone in the path's
colour) sits beside the **path name as the primary element**, with the live
count as a quiet line underneath. No button — the whole card is the link. Card
height drops by roughly half, the eight names become scannable in a couple of
seconds, and eight repeated buttons disappear from the page.

**Mobile path layout.** Two compact columns, as now. The gain comes from
shrinking the artwork, not from changing the column count.

**Section order.** Hero → How it works → Learning paths → Founder note →
**closing CTA** → Footer. The only structural addition on the whole page is the
closing CTA. Keep how-it-works before paths: the model (one person, not a
course) is unusual enough that it has to be explained before a list of subjects
means anything.

**CTA wording.** One phrase, everywhere: **Find my partner**. Nav, hero, path
cards, closing band.

**Repeated visual patterns** — the vocabulary the page should reuse and nothing
else: the full-bleed band alternation (grey / white / grey / dark green); the
16px card with a hairline border; the green PeerFlow bar over a white body for
every explanatory picture; the mono uppercase kicker; the filled dark button for
primary and the outlined white one for secondary.

**Remove:** the fourth how-it-works step; all remaining four-week language; the
eight repeated path buttons; "cycle" and "matching" from every CTA; three of the
six corner radii.

**Keep:** the eight paths, their names, their order; the live learner counts and
the "be the first" state; the session card; the founder quote; the honest
two-link footer; the two-up mobile path grid; the band rhythm; the palette and
the typeface.

---

## 10. Recommended page structure

```
Nav ......... logo · How it works · Learning paths · Log in · [Find my partner]
              (section links must survive mobile)

Hero ........ Learn IT with one person who shows up.
              Pick your field, see who else is learning it, and choose the
              person you'll meet each week.
              [Find my partner]  [See how it works]
              Free to join · Beginner friendly · One partner, not a group
              → session card

How it works  Three cards, one visual system
              01 Pick your path
              02 Choose who you learn with
              03 Meet every week

Paths ....... Eight compact cards: icon · name · live count
              Whole card is the link. No buttons.

Founder ..... the quote, attributed to a named person

Closing ..... one line + [Find my partner]        ← new, on the dark band

Footer ...... unchanged
```

---

## 11. Prioritized changes

### Must fix

| # | User problem | Design solution | Files | Kind | Risk |
|---|---|---|---|---|---|
| 1 | "Join the next cycle" promises a four-week cycle that does not exist and implies a cohort queue that does not exist | One CTA phrase everywhere: **Find my partner**. Secondary becomes "See how it works" | `index.html` | Copy | **Low** — `home.js` matches by `href`, not text |
| 2 | Step one still claims "over the next four weeks", and its illustration reads "Your goal · four weeks" | Remove both. Step one is choosing a field, nothing more | `index.html` | Copy | **Low** |
| 3 | A phone visitor has no navigation at all — two section links vanish below 760px with nothing behind them | Restore both links on mobile at a smaller size, or an inline scrollable row. A hamburger is not required to fix this | `index.html`, `assets/home.css` | Layout | **Medium** — nav is width-critical; needs measuring at 320–420 |
| 4 | The headline doesn't say what the product is; a visitor can leave thinking it's a group | New headline and supporting sentence (§8) | `index.html` | Copy | **Low** |

### Should improve

| # | User problem | Design solution | Files | Kind | Risk |
|---|---|---|---|---|---|
| 5 | Eight names hidden behind eight posters; eight identical buttons; the section is 37–44% of the page | Rebuild the path card: small icon, name primary, quiet count, whole card clickable, no button | `index.html`, `assets/home.css` | Layout + interaction | **Medium-high** — touches all eight cards and their inline SVGs; must preserve `.waiting[data-track]` and the `?path=` links |
| 6 | Four steps where the product has three; the fourth makes a promise it can't keep | Cut to three steps; redistribute the copy | `index.html`, `assets/home.css` | Copy + layout | **Medium** — grid breakpoints were tuned for four |
| 7 | The four step visuals are three of one kind and one of another | Bring all three into the drawn green-bar shell; give the photograph a better job (hero proof, or a band above the founder note) | `index.html`, `assets/home.css` | Layout | **Medium** |
| 8 | The most persuasive moment on the page leads to the footer | One line and one button on the dark band after the founder note | `index.html`, `assets/home.css` | Copy + layout | **Low** |
| 9 | An anonymous personal story undercuts its own credibility | Attribute the quote to a named person; a small photograph if there is one | `index.html` | Copy | **Low** — needs the founder's decision, not a designer's |
| 10 | Card titles are the same size as the hero's supporting sentence; six corner radii | Insert a step in the scale (h2 33 → h3 20 → lede 17 → body 15); collapse radii to three values | `assets/home.css` | Layout | **Low** |
| 11 | How-it-works cards nearly dissolve into the white band | Stronger border or a faint warm tint on the card | `assets/home.css` | Layout | **Low** |
| 12 | Mobile's first screen is entirely text | Bring the session card, or its top third, above 844px; equalise the two stacked button widths | `assets/home.css` | Layout | **Medium** |

### Keep as it is

- The eight paths — names, order, and the live counts including "be the first"
- Two-up path grid on mobile
- The hero session card: four blocks, current spacing, pomodoro at current size
- The full-bleed band alternation and the 110px section rhythm
- The founder quote text and its centred treatment
- The footer — two real links and an email, nothing invented
- Plus Jakarta Sans, the dark green, the warm neutral
- Left alignment everywhere except the founder band
- The headline's wrapping behaviour, which is now correct at every width ≥345px

### Do later

- Real photography of actual pairs, once there are pairs to photograph
- A proper mobile menu (only worth it once there are more than four nav items)
- A "what a session actually looks like" section — the product's best story and
  the one thing no competitor can copy
- Social proof, when it can be real. Not before.
- Revisiting whether paths should come *before* how-it-works, once there is
  analytics to answer it rather than opinion

---

## 12. Exact proposed copy

**Headline**

```
Learn IT with one person who shows up.
```

**Supporting sentence**

```
Pick your field, see who else is learning it, and choose the person you'll meet each week.
```

**Primary CTA** — in the nav, the hero, every path card and the closing band

```
Find my partner
```

**Secondary CTA**

```
See how it works
```
