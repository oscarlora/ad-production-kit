---
name: write-video-prompt
description: Write a video clip prompt in Seedance 2.5's own syntax and run tools/generate-video.mjs. Owns the video model, its sound and its prompt layout. Use for every clip, on write-prompt's rules.
---

# Write video prompt

Lay out each clip prompt for Seedance 2.5, on **write-prompt**'s rules, then generate.

## Video model

Every clip runs on **Seedance 2.5** (`tools/generate-video.mjs`; clip lengths and reference limits in
its `--help`). It speaks the dialogue it is given and adds its own sound unless `--no-audio`; mute
what's left in the edit.

## Writing the prompt

Workflows say what a clip prompt carries (task, who is who, timeline, lines, sound); lay it out in
Seedance's syntax (BytePlus guide: `docs.byteplus.com/en/docs/modelark/seedance-2-5-prompt-guide`),
under 1,000 words. The timeline adds up to `--duration`, and the last beat gets at least 2 seconds or
it is dropped.

- **Order:** what each file is (`Image 1 is the first frame.`, or `Image 1 is the host, Image 2 the
  guest.`, uploaded in order of first appearance); the audio policy; one sentence of who, where,
  style and camera; the timeline; what holds throughout (camera, place, sound).
- **Timeline** in whole seconds, no gaps: `0-2s: … 2-5s: …`; `Hard cut.` between shots.
- **Dialogue:** `The host's line (dry, amused): {Exact words.}`; before a non-English line, name the
  language (`says in Spanish {…}`). Direct the whole line: a note on one word, or repeating its words,
  prints subtitles.
- **On-screen text** in `【…】`; spell a word that must be exact letter by letter.
- **Audio policy**, first and again at the end: "Only the spoken lines and the sounds below. No
  music, BGM, score, instrumental, melody, soundtrack, synth, ambient pad, drone, crescendo or
  stinger at any moment. No subtitles." Otherwise write positively.
- **Two known faults:** duplicates ("Do not generate duplicate avatars or a twin effect; keep only a
  single corresponding character in the same frame.") and glowing eyes from strong emotion words
  ("shocked", "fanatical"): use calmer ones.
- An error naming `PrivacyInformation` means it read a reference as a real person's face (it can
  misread a realistic AI-made one). Only then tell the user and offer a more stylized face (on their
  yes). Don't retry the same image.
- `invalid image: heic: decode failed` means a JPG saved in an unusual way: convert it
  (`ffmpeg -i in.jpg -pix_fmt yuvj420p out.jpg`) and rerun with the copy.
