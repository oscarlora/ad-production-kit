---
name: recut-shorts
description: Recut a finished long talking-head or UGC edit into sub-30 s versions by recombining its lines — a new ad with three short cuts, each with its own job (the story short, one argument, results first). Use when an edit is approved and the footage holds more ads, or someone asks for shorter cuts, extracts, or "make more ads from this footage".
---

# Recut shorts

A long talking-head edit holds more ads. Recombine its lines into three versions under 30 s, built
in the source ad's edit language (**edit-video**).

## 1. Inventory the lines

From the source ad's approved edit (its captions' word timings), list every line: its stretch on the
edit's timeline (from clip edges where they fall), its length, what it says, and whether it points back ("all of that", "those ingredients", "their waistline"). A line that points
back only follows the line it refers to.

## 2. Plan three cuts

Give each a different job and show the plan as a numbered list before building:

1. **The story, short** — the source's own arc with the middle trimmed: problem → story → product → CTA.
2. **One argument** — one point carried end to end (say, the nutrient gap): the point → the turn →
   product → CTA.
3. **Results first** — open on the payoff, then reveal the cause: results → the problem → the answer →
   product → CTA. An answer with no problem before it doesn't follow.

Lines go in any order and can change roles (a CTA's results line as the hook, a hook line as the
close), as long as each cut reads as one logical story. Each finds a new hook in another line, never
the source's hook takes (those are its own versions): one a viewer gets in a single listen, with no
set-up. A line that needs context (who "they" are, a dense claim) works mid-story, where the lines
before it and the captions carry it; one that leans on an earlier term ("bad at converting it") needs
the line that sets the term up in the same cut, or a stranger never learns what it means. A curiosity
hook needs its payoff spoken in the body ("your body doesn't have to convert a thing"). The jump to
the product needs the line that leads into it ("nobody cooks that for dinner, so I take…"). Every
line keeps its approved wording, so a recut adds no new claim; a line may drop its first word ("But",
"And") when its new place needs it. Keep each under 30 s; drop a supporting sentence before you rush
the pace, starting with asides that hold off the product and its results (credentials, "that's why I
tell my friends").

## 3. Build

- **A new ad:** its own ID, record and folder, the cuts as `edit.json`, `edit-v2.json`,
  `edit-v3.json`, each built from the source's approved edit:
  `node tools/edit-video.mjs recut <source edit.json> --lines a-b,a-b,… --hook "…" --out <new ad>/edit.json`.
  Its clips (footage referenced in place), pacing, captions, overlays and end card carry over and the
  music runs under the whole cut, so nothing needs tightening again.
- **Seams:** where a stretch drops a word, check it by ear (`edit-video.mjs audio --from --to
  --transcribe`) and move the cut until none of the word is left. A stretch that ends on a laugh or
  reaction ends in the quiet right after it (find the dip on a loudness trace): never mid-laugh, never
  on the next breath in. A cut inside a line punches in (**edit-video**, Cuts and pacing).
- **Hook text** covers the whole first stretch, its captions off: when that stretch runs on past its
  opening line, end the hook text there and give the rest its captions back.
- **Hook framing:** each cut gets its own hook text (`--hook`), written for its new first line in the
  source hook's style (a short tease, same length and accent), since the source's was written for
  another line and reads off over this one; none when the stretch already has text (a list building)
  it would repeat. Keep the source's hook visuals: `recut` carries only what's in the stretches, so
  add them to the first stretch yourself and re-place them for its shot.
- **Dropped first word:** when a line drops its first word ("But", "Then"), make sure the next word
  survives whole; when the two run together, keep both.
- **B-roll:** `recut` keeps the source's shots, chosen for the old order, and the tails of shots that ran past a line's edge. Re-pick each cut's B-roll for what its lines now say (the library and the source footage both), and drop any shot fragment under ~0.8 s.
- **Text:** the edit-video text rules still apply. A graphic in the hook stretch that
  builds on an earlier line now coming later (blocks stacked a line before) comes out, with its sound.

Brand memory says whether a brand always gets a recut after a UGC edit.
