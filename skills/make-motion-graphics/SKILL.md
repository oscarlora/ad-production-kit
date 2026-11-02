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
word timings. Get the user's yes on the words before building.

## 3. Build

- `fx.js` exports one layer, `shot`, that draws shot `c.n`; each shot is a function of its own time.
  Draw with the kit, `env.mg` (`studio/engine/mg.js`): timing (`seg`, `move`, `pop`, `beat`), motion
  presets (`bob`, `blink`, `squash`, `shake`, `swing`), outlined shapes, faces, sparkles and speed lines.
  Recurring characters are functions with pose options (`kid(ctx, x, y, s, t, { arms: 'up' })`). Only
  what is unique to the ad lives here; what a second ad needs moves into the kit.
- `build.mjs` writes `edit.json` from one list of shots (seconds, line, beats, transition):
  - **Text** track: each line as a text clip with `reveal` (words pop in) and `{word|#color}` on its key
    words, in a band at the top; the picture stays below it.
  - **Picture** track: `{ type: 'custom', draw: 'shot', n, beats }` per shot. Beats
    (`{ name: [t, sound, dB?] }`) set when each motion happens (`env.mg.beat(c, name)`) and play that
    sound from `doc.sounds` at its onset, so a moved beat moves picture and sound together. A push or
    whip transition gets a swish beat just before its cut.
  - **Music** track: a bed under everything (**add-music**).
- Something on every beat moves the way the line says it (a messenger rides the road as "rides" is
  read); vary motions and transitions from shot to shot.

## 4. Sounds

One sound per kind of beat: libraries first (**search-media**), else **generate-sfx**, one file each
in `sfx/`. List them in `doc.sounds` (`{ src, volume, dur }`; `dur` cuts a long take). Studio's Sounds
step plays each take for the user to judge.

## 5. Check and review

Run `node build.mjs`, `node tools/edit-video.mjs check <ad>/edit.json`, and a `frames` sheet across
every shot (step 3's text band, nothing cut off, each beat's motion caught). Then the user watches it on
Studio's Edit step; **edit-video** owns comments, versions and export (only when asked).
