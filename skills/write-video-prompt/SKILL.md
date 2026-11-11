---
name: write-video-prompt
description: Write a video clip prompt in its model's own syntax (MiniMax H3, Gemini Omni, Seedance 2.5) and run tools/generate-video.mjs. Owns the video models, their sound, and each model's prompt layout. Use for every clip, on write-prompt's rules.
---

# Write video prompt

Lay out each clip prompt for its model, on **write-prompt**'s rules, then generate.

## Video models

`tools/generate-video.mjs`; each model's clip lengths, reference limits and fallbacks are in its
`--help`. **MiniMax H3** is the default. **Seedance 2.5** speaks the dialogue it is given and takes
the longest clips. **Gemini Omni 1.2 Flash** can rework one video it is given.

Every model adds its own sound; only Seedance takes `--no-audio`. Mute what's left in the edit.

## Writing for each model

Workflows say what a clip prompt carries (task, who is who, timeline, lines, sound); lay it out in
its model's own syntax, never another's. On every model, the timeline adds up to `--duration`, and
the last beat gets at least 2 seconds or it is dropped.

**MiniMax H3** (MiniMax's guides on Hugging Face, `MiniMaxAI/MiniMax-H3` → `docs/`). English, named
fields in this order, a blank line between them:

- **With frames:** the first line is exactly `For the target video, at 0.00 seconds into the target
  video, <Picture 1> (from [Shot 1]) is fully referenced.` With a last frame too: `How the reference
  pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of
  the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`
  (S.SS = the clip length). Then `integrated_multimodal_description:`, `overall_soundscape:`,
  `non_diegetic_music:`.
- **With references** (`--image`, `--video`, `--audio`), six fields:
  - `subject_definitions:` one line per subject or frame. `<Subject 1> is the woman in <Picture 2>,
    …`; a frame to match: `<Picture 1> is the first frame of [Shot 1]`. Pictures, videos and audio
    number in upload order, each type on its own count.
  - `summary:` one paragraph opening with the task type: `[keyframe completion]` (frames to match),
    `[reference generation]` (sheets), joined with ` + `.
  - `retention_analysis:` one line per label, e.g. `<Subject 1> (appears in [Shot 1], [Shot 3]):
    fully_preserved - …`.
  - `detailed_description:` the style in one sentence, then the shots, 350–500 words.
  - `overall_soundscape:`, `non_diegetic_music:`.
- **Shots:** `[Shot 1]` opens with the style and framing ("Stop-motion puppet animation, a medium
  shot of…"), no time; then `[Shot 2] At 00:03.500, the camera cuts to …`.
- **Camera:** a sentence inside the shot: Push In / Pull Out, Pan, Truck, Tilt, Pedestal, Zoom, Arc
  Shot, Tracking Shot, Static Shot, Shake Slightly, POV, plus "with small amplitude" or "at slow
  speed" when it matters.
- **Speech:** each speaker gets an ID, the same in every shot. Describe the voice outside the tag
  the first time: `the woman with a warm, relaxed American alto (S1) says: <d>[English] Exact
  words.</d>`. Voiceover: `says in an off-screen voiceover: <d>…</d> while her lips remain completely
  closed.` A line across a cut takes `<scenetrans>` on both sides; one cut off by the clip's end,
  `<cutoff>`. Nobody speaks: no IDs, no `<d>`.
- **Sound:** `overall_soundscape` is 1–4 sentences of room tone, action sounds and breaths, never
  dialogue. `non_diegetic_music: N/A` means no music; both `N/A` means a silent clip.
- **On-screen text** in double quotes, exactly as it reads.
- **No negatives at all**, not just as patches: say what is there instead ("the sign is blank").

**Gemini Omni** (Google's guide: `ai.google.dev/gemini-api/docs/omni`). English only.

- It cuts between several shots by default; for one, open with "In a single continuous shot, no
  scene cuts."
- References: tag each where its subject appears, counting from 0 ("the woman <IMAGE_REF_0> lifts
  the jar <IMAGE_REF_1>"), and end with "Use the given images as references for video generation;
  they are not initial frames." A frame: end with "Use this image as the starting frame."
- Timeline `[0-2s] … [2-5s] …`.
- Dialogue: who, the voice, then the line in quotes: `she says in a warm American alto: "Exact
  words."` On-screen text in quotes too, saying where it is.
- Sound in one closing `Sound design:` sentence, then plain negatives ("No other dialogue. No
  subtitles."). "No music" doesn't hold; take music out in the edit.

**Seedance 2.5** (BytePlus guide: `docs.byteplus.com/en/docs/modelark/seedance-2-5-prompt-guide`).
Under 1,000 words.

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
  misread a realistic AI-made one). Only then tell the user and offer: the same clip on MiniMax H3
  or Omni (on their yes), or a more stylized face. Don't retry the same image.
- `invalid image: heic: decode failed` means a JPG saved in an unusual way: convert it
  (`ffmpeg -i in.jpg -pix_fmt yuvj420p out.jpg`) and rerun with the copy.
