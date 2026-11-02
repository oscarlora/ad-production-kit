---
name: generate-sfx
description: Generate and add sound effects for video ads with Suno Sounds through tools/generate-sfx.mjs. Use when a scene needs clicks, impacts, whooshes, ambience, product sounds, interface sounds, or other timed audio cues.
---

# Generate SFX

Look in the libraries first (**search-media**); otherwise generate with **Suno Sounds** via
`tools/generate-sfx.mjs`.

## Plan the cue

One job per effect. Specify the source, action, texture, intensity, environment, length, and
ending — the literal sound, not its emotional label. The length comes from the prompt (no flag);
takes run 2 s or longer, so trim them in the edit.

Good: `One soft laptop-key click, close-miked, dry office room, no reverb, 0.3 seconds.`

Weak: `A satisfying work sound.`

Generate effects separately when their timing will be edited independently. Keep them isolated: no
speech, no music, no extra ambience unless the scene needs it.

## Generate

```bash
node tools/generate-sfx.mjs \
  --prompt "A small wooden cap clicks onto a glass bottle, close-miked, clean and gentle" \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/sfx/cap-click-a.mp3
```

Loops, tempo and key: `--help`. Listen for invented layers, excess reverb, an unclear transient, and an ending that can't be cut cleanly. Approved reusable sounds go into the brand's
media library (**catalog-media**, `--generated`); one-off cues stay in the ad's folder.

## Place

Pick a library sound by its shape, not its name or description (both can be wrong): from the same RMS
envelope, a pop or click is one transient under ~0.15 s with no build-up; a whoosh rises over 0.2 s or
more. When the user names the sound they want, offer the matching candidates before generating one.

Each effect is an audio clip on the edit document's SFX track (**edit-video**), timed from its
waveform: find where it peaks (an RMS envelope in 25 ms steps) and land that peak on the action's
fastest moment (an `ease` move peaks mid-way); trim its silent lead with `in`. `node tools/edit-video.mjs moves <edit.json> --from <s> --to <s>` lists where the
picture moves most, to find the actions; check them on a `frames` sheet.
