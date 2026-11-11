---
name: make-motion-graphics
description: Make a coded motion graphics video — flat animated shapes, characters, diagrams and kinetic text drawn in code by the edit engine, with no AI images or video (only its sounds may be generated). Use when someone wants motion graphics, a kinetic-type or animated-diagram explainer, an animated title, or a video that costs no generation.
---

# Make motion graphics

Every frame is drawn in code, so revisions are free and exact. Work in `outputs/<ad>/` (format `Motion`
in the **write-prompt** name): `storyboard.md`, `fx.js`, `build.mjs`, `sfx/`, `music/`, `edit.json`.
Studio's Workflow page shows Concept · Script · Sounds · Edit.

## 1. Concept

Load the brand context (AGENTS.md). `storyboard.md` opens with the **CONCEPT** section of
**make-ai-animation** step 1, Format `Motion`; Style also sets the look (flat cartoon with thick
outlines, notebook ink, bold kinetic type…), the frame size and the length.

## 2. Script and storyboard

The script goes straight into `storyboard.md`'s shot table, as in **make-ai-animation** step 2 (its
one-story rules apply). Each line shows as on-screen text, so without a voice, time each shot for the
text to be read aloud (about 2.6 words a second); with one (**generate-voice**), time shots from its
word timings, and never pad a shot with silence: the picture fits the voice's own time (only the end card
holds after the last word). A metaphor first says what it stands for (the goal behind the door, before
the keys), and an explainer teaches the real mechanism in plain words: both make the ad credible. Open on
the person with the problem, then show it on them. Get the user's yes on the words before building.

## 3. Build

- `fx.js` exports one layer, `shot`, that draws shot `c.n`; each shot is a function of its own time.
  Draw with the kit, `env.mg` (`studio/engine/mg.js`): timing (`seg`, `move`, `pop`, `beat`), motion
  presets (`bob`, `blink`, `squash`, `shake`, `swing`), outlined shapes, faces, sparkles and speed lines.
  Recurring characters are functions with pose options (`kid(ctx, x, y, s, t, { arms: 'up' })`). Only
  what is unique to the ad lives here; what a second ad needs moves into the kit.
- `build.mjs` writes `edit.json` from one list of shots (seconds, line, beats, transition):
  - **Text** track: each line as a text clip with `reveal` (words pop in) and `{word|#color}` on its key
    words, or with a voice, one `captions` clip whose words light up as spoken; in a band at the top with
    `anchor: 'top'`, so lines of any length keep their first line in place; the picture stays below it.
    For a vertical Meta ad, text, faces, product and CTA stay inside the 4:5 safe zone (y 285–1635).
  - **Picture** track: `{ type: 'custom', draw: 'shot', n, beats }` per shot. Beats
    (`{ name: [t, sound, dB?] }`) set when each motion happens (`env.mg.beat(c, name)`) and play that
    sound from `doc.sounds` at its onset, so a moved beat moves picture and sound together. A push or
    whip transition gets a swish beat just before its cut.
  - **Music** track: a bed under everything (**add-music**).
- Something on every beat moves the way the line says it (a messenger rides the road as "rides" is
  read); vary motions and transitions from shot to shot. Show the thing itself, up close (the skin
  cracking, a cross-section), not only its symbol, and hold the result long enough to read.
- Every transition is motivated: a match cut (zoom until one shot's object is the next one's), a
  slice or fold into the next view, or a clean cut. A crossfade between unrelated scenes leaves a
  ghost of the last frame; the `zoom` transition shows the frame's edge.

## 4. Sounds

One sound per kind of beat: libraries first (**search-media**), else **generate-sfx**, one file each
in `sfx/`. List them in `doc.sounds` (`{ src, volume, dur }`; `dur` cuts a long take). Studio's Sounds
step plays each take for the user to judge.

## 5. Check and review

Run `node build.mjs`, `node tools/edit-video.mjs check <ad>/edit.json`, and a `frames` sheet across
every shot (step 3's text band, nothing cut off, each beat's motion caught). Then the user watches it on
Studio's Edit step; **edit-video** owns comments, versions and export (only when asked).
