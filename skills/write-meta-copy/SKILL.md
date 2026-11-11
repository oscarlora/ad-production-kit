---
name: write-meta-copy
description: Write the Meta ad's in-platform text — the headline and primary text that run in Ads Manager, not on the creative. Optional. Use when preparing an ad for Meta (make-image-ad's last step, or before upload-ads). Follows the writing rules in the write-copy skill.
---

# Write Meta copy

The text that runs in Meta Ads Manager, not on the creative. Writing rules and claims follow
**write-copy**; this owns the Meta formats. Pull wording from `customers.md`.

## Headline

A call to action, 3 to 6 words. Start with a verb and carry a concrete benefit, offer, or number —
"Switch To Steady Energy". No curiosity bait the ad or page doesn't pay off.

## Primary text

- **The first ~125 characters must work on their own** (all Meta shows before "See more"). Front-load
  the hook; never open with the brand name or warm-up words.
- **Format**: one sentence per line, blank line between (`\n\n`).
- **Deliver all three lengths** and recommend one by the persona's awareness stage
  (`products/<product>-personas.md`): product- and most-aware → short; unaware and problem-aware → long.

**Short (~50 words)** — hook → one proof line → the offer → a call to action.

**Medium (~150 words)** — the short structure, plus the why-it-works in one plain sentence and the
persona's top objection answered.

**Long (~300 words)** — a very short article: hook → the problem in the customer's words → what
they've tried and why it fell short → what actually works, said plainly → one or two benefits set in
scenes the persona can feel → a customer quote with a number or timeframe → a soft call to action.
For colder personas, keep the product out of the first third.

The locked copy goes in the ad folder's `meta.md`: `**Headline**` over its text, then `**Primary text**` over its
text. Studio's Meta copy step edits it in place, and the index refresh copies it into the record's `meta`.
