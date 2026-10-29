---
name: add-music
description: Put a music bed under a video edit — source a track (user-supplied, copyright-free, or generated with tools/generate-music.mjs), choose the vibe against the brand voice, and set its levels (gain under dialogue, ducking, fades) in the edit document. Use when a video ad needs background music, someone asks to add or generate music, put a track under it, or gives music direction ("something upbeat"), or when edit-video wants a music bed.
---

# Add music

Put the track on the edit document's Music track (**edit-video**); the export sets the final
loudness. This skill owns the track and the taste.

## Sourcing

- **You pick it**: libraries first (**search-media**), generate when nothing fits.
- **User-supplied, copyright-free, or generated only.** Never rip a commercial or trending track.
  If the user names one, ask for their licensed file or offer alternatives in the same vibe.
- **Store it findable.** A track the brand will reuse goes into the brand's media library
  (**catalog-media**). A one-off can sit in `outputs/<ad-name>/`.
- **No track? Ship without** and say so — never block an edit on music.

## Generating

`tools/generate-music.mjs` (flags: `--help`) renders an instrumental bed at the length you set. A
sung song ad: **make-ai-song**.

- **Trend research first.** Browse TikTok Creative Center's trending sounds or a licensed library's
  viral charts, then translate the sound's anatomy (tempo, drum palette, bounce, vocal treatment)
  into the prompt. Never name artists or songs.
- **Prompt like a producer.** Micro-genre + BPM + production markers ("jersey club, 140bpm,
  sidechained 808s, pitched-up chops"), always ending "hook-first, loopable, no intro".
  Instrumental under dialogue: vocal chops fine, sung lyrics never.
- **Rights** follow the provider's terms; confirm them when the client asks or the stakes are high.

## Choosing

Match the vibe to the brand's feel (Overview in `inputs/DESIGN.md`); with no direction, options
vary the vibe. Under dialogue, prefer instrumental or vocal-light.

## Levels

- **A bed, not a lead** — one flat `volume` on the Music track, about -18 dB under dialogue (lower if the
  user asks); no ducking, and never lifted into the pauses.
- **Fades** — `fadeIn` ~0.5 s and `fadeOut` ~1–2 s ending with the video, so the end doesn't sound
  like a cut.
- **Shape it to the story** — never drop to silence: for a pause on a turn, crossfade (~0.1 s) to a
  low-passed copy of the same track, in sync on its own track, and back to clear on the answer.
  Land the track's strong moments (accents, re-entries; find them on an onset envelope) on the
  turns and the product shot, moving the music only by whole beats at a cut that hides the jump.
