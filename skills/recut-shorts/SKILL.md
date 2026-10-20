---
name: recut-shorts
description: Recut a finished long talking-head or UGC edit into sub-30 s versions by recombining its lines — a new ad with three short cuts, each with its own job (the story short, one argument, results first). Use when an edit is approved and the footage holds more ads, or someone asks for shorter cuts, extracts, or "make more ads from this footage".
---

# Recut shorts

A long talking-head edit holds more ads. Recombine its lines into three versions under 30 s, built
in the source ad's edit language (**edit-video**).

## 1. Inventory the lines

From the source ad's transcripts, list every line: its length once pauses are cut, what it says, and
whether it points back ("all of that", "those ingredients", "their waistline"). A line that points
back only follows the line it refers to.

## 2. Plan three cuts

Give each a different job and show the plan as a numbered list before building:

1. **The story, short** — the source's own arc with the middle trimmed: problem → story → product → CTA.
2. **One argument** — one point carried end to end (say, the nutrient gap): the point → the turn →
   product → CTA.
3. **Results first** — open on the payoff, then reveal the cause: results → the answer → product → CTA.

Each opens on a body line, never the source's hook takes (those are its own versions), with an
on-screen hook that matches that line. Every line keeps its approved wording, so a recut adds no
new claim. Keep each under 30 s; drop a supporting sentence before you rush the pace.

## 3. Build

- **A new ad:** its own ID, record and folder, the cuts as `edit.json`, `edit-v2.json`,
  `edit-v3.json`. Footage stays in the source ad's folder, referenced in place
  (`../<source ad>/footage/<file>`).
- **Pacing:** `node tools/edit-video.mjs tighten <edit.json> --gap 0.35 --keep 0.12`; a cut inside a
  line takes a small scale step (~1.06) so it reads as a punch, not a jump.
- **Ending:** time the product snap from the last spoken word, never from a clip's start (cutting a
  pause splits the CTA into several clips).
- **Text and captions:** regroup the captions by phrase and recolor the key words for each cut
  (**caption-video**); the edit-video text rules still apply.

Brand memory says whether a brand always gets a recut after a UGC edit.
