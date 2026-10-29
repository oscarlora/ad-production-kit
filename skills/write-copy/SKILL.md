---
name: write-copy
description: Write on-creative ad copy — hooks, sublines, tertiary text, and video scripts. Use whenever writing or revising text that goes on a creative. Owns the writing rules, hooks, claim rules and the speaking pace. (The Meta ad's headline + primary text: write-meta-copy.)
---

# Write copy

Write direct response. Every ad answers fast: **what is this**, **who is it for**, **why should they care**.

## Principles

- **Use the customer's language and the user's creative direction.** Take wording from the user's brief, the persona's VOC quotes, verified reviews (`inputs/sources/reviews.csv`) or `customers.md`. A brief alone is enough to build the reader's situation; don't swap it for product facts when VOC is missing. Keep distinctive phrasing ("aches and pains", not "bounce back") in fresh lines. User wording is direction, not a testimonial or evidence for a claim.
- **Write to one reader:** the locked persona as "you", about their day. Never about the brand or "people".
- **Outcome-led, not descriptive.** The hook names the result they get, not a feature: "Make it to 5 without the crash", not "steady energy from real oats". The visual and subline carry the mechanism.
- **Feeling first, backing second.** The number, spec or study comes right after the outcome, never as the opener.
- **Grounded in their day.** Specific situations, stakes and benefits they can picture, tied to what the product does: "You work hard. You train hard. Lunch shouldn't be another thing to figure out." Cut vague mood lines ("fits real life"), keep the emotion.
- One ad, **one angle**. Active voice.
- **Extremely simple.** Anyone gets it on one half-attentive listen: everyday words, one idea per sentence. A technical term needs what it means for them right after it ("CoQ10. Your body makes less of it as you get older"). Lead with what they know or find interesting; a name they don't know (a company, a person, an old product) comes after the fact, or goes.
- **Natural, speech-like flow.** Read it aloud; if it sounds like an announcer, rewrite. On-creative lines: short (under ~13 words), full sentences, no staccato fragments, no fillers. Spoken lines: how a person talks, sentences joined by *and*, *so*, *because*, *then*, a light filler only where a real speaker would ("so yeah"; never "honestly"), never stacked. No rhetorical-question fragments ("The crazy part?"); a full question the next line answers is fine, and so is a one-word reveal after a setup ("Magnesium!"). No middle dots (·) as separators on a creative; write "and" or a comma.
- **No redundancy**, including with the product: don't restate what the packaging already shows (protein grams, free-from chips).
- **Reread every draft as a stranger before it goes in the file**, and fix what fails: Is each line the simplest way to say it, clear to a five-year-old? Does each line lead into the next? Is any sentence too long, too hard, or carrying more than one thing? Do the product lines answer the problem lines, so cutting them would break the story? In video, do the actions and visuals land on their words? Repeat until a full pass changes nothing.

## Hard rules (non-negotiable)

- **No em dashes.** Anywhere.
- **No dot separators** (·, •, |) joining items on one line. Write a sentence, or give each item its own line or slot.
- On an image ad: **max 1 hook, max 1 subline.** Tertiary text may have multiple short items.

## Match the reader's awareness

The persona's awareness stage (in `products/<product>-personas.md`) sets the hook's job and how much the ad explains:

- **Unaware** — open with the situation or a surprising reframe; the product arrives last; explain the most.
- **Problem-aware** — open on the pain or the real reason it keeps happening; the product is the fix.
- **Solution-aware** — open on what makes this one work, or how it beats the usual fix.
- **Product-aware** — open on proof or the strongest differentiator; keep copy short.
- **Most-aware** — open on the offer; shortest copy of all.

The market's sophistication stage (1–5, `brand.md`'s market) sets the claim type: stages 1–2, plain benefit claims; 3–4, lead with how the product works; 5, sell identity and experience.

The product is always in the image; how loudly the words push it follows the awareness stage.

## Hooks

A hook leads with one deliberate **writing style** (below) that makes the message instantly clear: what this is, who it's for, why they should care. Commit to a distinct style; never blur the message for cleverness or flatten every hook into one plain register.

**Volume before choosing.** Draft 10–15 hooks for the locked angle across at least four styles before showing any; synonym swaps aren't variety. Kill those that fail the tests below, then score the rest. A strong hook hits several of: curiosity pull · names their situation · a concrete outcome · a specific number, timeframe or named thing · plain words · a reason to believe · how fast results come. Show the best 3 (Output).

**Cold test, image covered:** from the words alone, would a stranger know **who** it's for (their age or life stage, plus their pain or wanted outcome) and **what** it's about (the angle)? Every hook carries the words they'd use themselves to name their life stage or symptom (a story hook too), so they know in a second it's about them. "Finally, a protein bar with ingredients you can actually pronounce" passes; "Check the ingredients, you'll recognize every one" fails. The first product mention is **brand + plain category** ("the Acme Focus protein bar"), never a bare sub-brand.

**Local businesses:** name the verified service area clearly (video: spoken or on screen, ideally near the start; image: visible). Not in every hook; vary its placement. Never rely on scenery or targeting alone, or name a whole municipality when coverage is only part of it.

**So-what test:** a question, open loop or tease is half a message; a subline, tertiary or visual must pay it off, or the hook must be self-complete.

**Tease the answer, don't give it:** tie the solution to their pain or wanted benefit and hold back the result for the body. "Scientists tested a scoop of greens against a daily multivitamin for the nutrients busy parents run low on" (not "...and the greens came out way ahead").

**Start at the strong part:** no warm-ups ("Introducing…", "Meet…").

**No market statistics** ("1 in 3 adults…") in hooks. A number earns its place only when it names their outcome.

**Name what makes it work, don't teach it:** "the oat that digests slow"; save the how-and-why for the subline or visual.

Every supporting piece (script body, subline, tertiary) follows the hook's style and idea.

### Writing styles

One per ad: observational · rhetorical question · conditional · affirmative · contrarian · confessional · imperative · comparative · hypothetical · provocative · testimonial · declarative · conversational · cautionary · reframe · negation stack · POV · anecdotal · stat-led · definitional · quoted · permission-granting · threshold · direct address. Invent more when useful. Never vague aspiration alone: tie it to a concrete situation or benefit.

## Supporting pieces

Budgets, as guidance: a hook at most ~12 words, a subline ~20, a tertiary item 2–6.

- **Subline** — pays off the hook: usually the plain why-it-works, or the outcome made real. A benefit goes in a scene they can feel ("still full at the 3pm meeting"), not adjectives.
- **Tertiary** and every other small text slot (callouts, pills, badges, labels, list items) — one job each, no two slots the same job. The jobs: who it's for · proof (a verified customer's words, or a number with a timeframe) · the top objection, answered · offer or guarantee · how it works (ingredient or spec → what it does).
- **Review quotes**, anywhere — verbatim from `inputs/sources/reviews.csv`, verified reviews only, never incentivized. Trim with an ellipsis, never reword.
- **Call to action / offer text** (on screen and end cards) — short, starts with a verb, always carries value (offer, guarantee, outcome): "Tap to try it at up to 40% off", never a bare "Shop now". Urgency only when real ("ends Sunday").

## Video scripts

One row per idea. Every line is visualizable and hands off to the next (a connector, cause or callback), so it plays as one story. What's on screen shows what's being said, as it's said, one thing at a time: an action, a slide, a text or a shot that lands off its words pulls attention away. Take the speaking style from the reference video.

- **The arc** is a menu, not a template: vary which beats you use and where Body 1 starts. It can open on their backstory, pay off the hook straight away with the education, go straight to the product, or go straight to the angle's core fact. Pick a different shape from the brand's last few scripts. The beats: the hook → the problem in their words (specific, a little fed up) → why it isn't their fault: who brushed them off ("it's just aging") or an outside cause they can be angry at, backed by a verifiable fact → the discovery, step by step down to one named root cause they can picture ("the first domino is a hormone called progesterone"), each step one everyday picture ("think of estrogen as a messenger") → the product → proof as a realistic results timeline from the store's claims and verified reviews → the outcome as lived scenes that call back each pain → the CTA.
- **Bring the product in through their story, never as a cut to a spec sheet.** Name the answer as a thing first, then the objection to getting it the usual way (taste, time, cost, where to find it, how much you'd need), then the product as the easy way. Pick the objection that fits this persona and write it in their words, fresh every script: never reuse a past script's, the brand memory's or a stock bridge's wording ("I'm not about to…"). Read the line before into it aloud; if it doesn't pick up, rewrite. Only the 2–3 product points that matter most for this angle and persona, most relevant first, worded fresh; never the full ingredient list or a past script's product lines.
- **The 3 hooks are alternates for one body.** Each leads naturally into Body 1: a fresh bridge per script, or straight into their story; never a past script's opener ("Let me back up"). Body 1 repeats nothing a hook says (age, symptom, the tease): read each hook into it aloud. Hooks may share one opener ("Here's an unpopular opinion:"); naming their symptoms in their words ("if your doctor said your night sweats, brain fog and weight gain are 'just aging'") is one pattern, not a must. Short, pain- or benefit-led, spoken, never a slogan.
- **Spoken CTA:** short, closes the story, ideally calling back the hook ("So before you buy another multivitamin, try this first."). Offer, guarantee and "link below" go on the end card unless the user writes them in; a spoken price dates the video.
- **Length:** about 4 spoken words a second (40 s ≈ 160 words), the one pace for every voiceover and dialogue in ADPK; on rendered dialogue about 3.25 drags and 5.35 rushes and drops words. Give the word count and seconds with every draft and revision, and flag when it runs past the target. Write the script into the ad's markdown file from the first draft, on the brand's brief template if it has one, and make every change there; in chat, say only what changed, never the script.
- **Actions** (a creator's, a character's): what someone would do anyway while saying that line, so it never looks staged; one that needs explaining is the wrong one. Anything that stops the talking (taking a pill, a walk across the room) becomes its own shot. Directions that repeat on every line go once at the top. Read the actions in order as one continuous take: each starts where the last left off (where the person stands, what's in hand), and every prop is in reach before it's needed.
- **Creator (UGC) scripts:** for a known creator, first learn their profile and background (into the ad's `references/profile.md`) and tailor the concept and script to them; otherwise start at the concept. Every line gets an action, written to the creator. Slides the creator presents follow **make-ai-slides** (Slides in a creator brief). B-roll is a separate list, each shot tied to its line and matching its exact words; a problem shot gets its payoff later. Mark shots the editor sources from stock so the creator skips them. Editor columns, one per hook version: a hook only in its own column ("Not in V2"), the bodies in V1 and "Same as V1" elsewhere; each row gives the exact on-screen text, its motion and sound, and when captions hide, in **edit-video**'s style (Pick the style) and **caption-video**'s text rules. When a line changes (yours, or the user's edit in Studio), update its action, on-screen text, B-roll and props with it. Build the brief .md in the ad folder in order, under the section headings Studio reads: **Concept** (Message: what the viewer should take away, never how it's shown; For; Format: how it's delivered, the setup and who does what; then Reference, with the video under it), then the script lines in **LINES TO CAMERA** (a table with Scene and Line columns), then the storyboard: the actions (its Action column), **SLIDES** and **B-ROLL**. Block format: **open-studio**.
- **Talking-points brief** (for a creator who writes their own jokes, like a comedian, or when the user asks): give the concept and the structure, not lines. Write it in plain language; the creator puts it in their own words. The Line column becomes **Talking points**: per row, who speaks, what the beat must get across, and optionally one `*Example:*` line in the creator's voice. Keep product and fact lines close to as written, marked **Keep the meaning:**; under the Concept, a short note saying the jokes and wording are theirs and they can change anything. No test voiceover.
- **Dialogue between characters:** label every line `NAME (ROLE):` (`MAYA (HOST):`). Each line answers, interrupts or picks up the one before, the way people talk in the room, never a standalone statement that reads like ad copy.
  - **Open mid-conversation at the most gripping point.** No greetings, no introductions. The first line is the hook, often someone reacting to the strongest true claim ("Two weeks? Come on.").
  - **One sentence = one shot.** Keep lines short.
  - **Speech-like flow, never punchy:** no ad-copy staccato — contractions, fillers (allowed here), a false start, the odd trailing-off. If it sounds written, loosen it.
  - **Interruptions:** end a line with a trailing "-" to cut a speaker off and let the other barge in.
  - **Hedge vs. certainty:** unsure about mechanisms ("don't quote me on the science, but…"), certain about their own experience.
  - **Echoes:** a listener repeats a fragment back ("two weeks?", "every night?") — the one place a clipped fragment belongs.
  - **On-screen text vs. spoken word:** captions and overlays follow the brand's text conventions; the spoken line can use the natural word.
- **Options:** rank the 3 by relevance, lead each with a different beat, and show each in full. From a reference, keep its structure, shots and on-screen text style and vary the wording; for a new approach to it, keep its beats and change the framing. When proposing persona-angle-script pairs, prefer a persona the last few scripts didn't use, unless the reference clearly fits one.
- **User-written lines:** revise only grammar and flow. Keep their words and order, fill only their bracketed placeholders, and raise any claim the research doesn't support once, in chat, never by rewording. If they keep it, it stays.

## Claims

Every claim, anywhere in an ad:

- **Check the exact factual claim.** A claim goes in an ad only when the research (`products/<product>.md`, `customers.md`) or verified reviews back it, or the user signs it off; never invent numbers, mechanisms, results or testimonials. Before cutting or softening a claim, search for backing (the web, primary sources), never memory alone, keep the strongest true version you find, and add it to the research doc with its source. Cut only what the search can't support, and tell the user what you searched. A customer's desire ("I want to perform at work") isn't a product promise ("this improves performance"); check the meaning in context, visuals included. Flag the unsupported clause, not the whole angle.
- **Keep the selling force.** When correcting a claim, change only the unsupported part; keep the stakes, tension, specificity and customer voice. Write with confidence: once a claim is backed, state it flat, with no hedges ("seemed to", "sometimes", "may help", "estimated") unless the truth needs one, and keep a qualifier on the fact it qualifies. User-written lines: Video scripts. If a revision reads like a catalog, rewrite it around the approved premise and stakes.
- **Claims gate**, when a workflow calls for it, before the script: the user signs off the product (and its research), the persona and angle, the **2–4 claims** the ad carries, and the product's **unique mechanism**. Confirm the mechanism, never infer it: take it from the brief, the client, or an explicit line in the doc, never stitched together from features and benefits. Work from the doc itself; don't re-summarize it into a brief.
- Never guarantee results. Before/after framing is allowed.
- Health-adjacent products: comfort-and-routine words, never treatment words (no "heals", "cures", "treats").
- **Sensitive subjects (animals as food, predation):** frame it as nature's wisdom. No hunting, killing, prey, blood or carcass words or footage.
- **Sell the better day, not the disease.** Poke the pain lightly; paint the after vividly.

## Output

For every piece (hook, subline, tertiary set), options differ in angle or style. Label each hook's writing style so supporting pieces can match it.
