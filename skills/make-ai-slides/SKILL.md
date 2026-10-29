---
name: make-ai-slides
description: Make an AI slides video ad — a narrated explainer where each voiceover line becomes a simple illustrated slide (vintage textbook, flat cartoon and more) that lights up each thing as it is said, on a black 9:16 canvas with the hook above and captions below. Use when someone wants a slides, explainer or "visualize what they're saying" ad, or wants a script or a past winner's audio turned into illustrated slides.
---

# Make AI slides

One narrator, one 16:9 slide per line, each thing on the slide highlighted on its word. Work in
`outputs/<ad>/` (format `Slides` in the **write-prompt** name): `script.md`, `voice/`,
`storyboard.md`, `sheets/`, `frames/`, `prompts/`, `clips/`, `music/`.

## 1. Concept

Load the brand context (AGENTS.md). Persona, angle and claims pass **write-copy**'s claims gate.
Then the slide style, unless one is named (a 1950s school textbook, a flat cartoon explainer, an
old anatomy plate…).

## 2. Script

Write it with **write-copy**, or reuse a winner word for word: transcribe it
(`node tools/transcribe-media.mjs --in <ref>.mp4`), fix mishearings and brand names, and get the
user's yes on the exact text before voicing it.

## 3. Voiceover and timestamps

Generate takes with **generate-voice** (which also re-voices a reference with its exact delivery).

Then take the chosen take's word timestamps (`node tools/transcribe-media.mjs --in <take>.mp3 --words`).
All later timing comes from them.

## 4. Storyboard

Split the script into phrases that each carry one picture. Write `storyboard.md` as one table and
nothing else, `| # | Start | End | s | Line | What we see | What moves | What we hear | Camera | Transition |`,
with each phrase's span from the timestamps; the shots tile the voiceover with no gaps. Name recurring
characters (and one recurring stage, such as a side view of a pore) the same way in every row.

Each column takes the simplest answer that reinforces the line:

- **What we see:** one idea per slide: a short heading, the picture, a few labels. Show one thing
  at a time; a second idea gets its own slide. Literal means
  literal: "bloating, gone" is a belly deflating. Apply **make-ai-animation**
  step 2's one-story rules across the whole board before any frame.
- **What moves:** the thing being said, on its word, in a way that fits it (a process bounces each
  step as it's named). No motion for its own sake. Only things already
  drawn move; text never moves, appears or changes; nothing turns into something else; nothing new
  enters.
- **What we hear:** the motion's most literal sound (pills rattle). Repeats within one line
  share a sound; a motion with no real sound (a smile, a glance) gets "—".
- **Camera:** **Locked**.
- **Transition:** a hard cut by default. A richer ad gives each cut its own natural move into the next
  frame (push into an object that opens the next slide, a match on shape, a whip), never one move
  repeated.

Then read the board top to bottom and vary the motions, sounds and transitions from slide to slide
wherever the line allows; the examples above aren't defaults.

## 5. Frames

Frame 1 first; the chosen take locks the look. Make a sheet for any recurring
character (**make-ai-animation** step 4), then generate the rest in parallel, each with frame 1 as
reference 1, plus the sheet or the real product (`sheets/product.png`, per **write-prompt**'s product
rules):

    node tools/generate-image.mjs --prompt-file <ad>/prompts/frame-02.txt --ref <ad>/frames/frame-01.png \
      --aspect 16:9 --resolution 2K --out <ad>/frames/frame-02.png

Each prompt gives the heading, what is drawn, its labels and a `Fig. N` caption, then one shared style
paragraph ending "only the elements listed, all text spelled exactly as written". Describe bodies as
a person in plain clothes ("body outline" trips the content filter). Pass a character sheet only to
frames that use its characters, and tell the model to use only the ones the frame names.

For a full-bleed 9:16 frame instead of a slide, generate at 4:5 with the bottom subject running off
the lower edge (Meta's feed crops 9:16 to 4:5, and prompted safe rows don't hold). Only once the user
approves it (each extension is paid), extend it to 9:16, art pixel-identical:
`node tools/extend-to-story.mjs --in <frame>-4x5.png --out <frame>.png --above "<background>" --below
"<what runs off the bottom>" --paste`.

Once all frames land, check them side by side (an ffmpeg `xstack` contact sheet) against step 4 and
flag what's off to the user.

## 6. Clips

MiniMax H3 (**write-video-prompt**, Video models), 3–6 minutes a clip. Group whole shots into chunks of
up to 15 s (never split a shot), pass their frames in order, and run every chunk at once (long renders:
AGENTS.md):

    node tools/generate-video.mjs --model minimax-h3 --prompt-file <ad>/prompts/chunk-01.txt \
      --image <ad>/frames/frame-01.png --image <ad>/frames/frame-02.png --image <ad>/frames/frame-03.png \
      --aspect 16:9 --duration <chunk seconds, rounded up> --out <ad>/clips/chunk-01.mp4 --timeout 1500

The prompt, in MiniMax's layout (**write-video-prompt**), says:

- Images 1…N are the slides, reproduced exactly, each filling the 16:9 frame edge to edge (no bars),
  shown in order with hard cuts at the given seconds; the last runs to the end.
- Static camera; the only words on screen are the slides' own, exactly as printed.
- Sound: when the sound effects go on in the edit (**generate-sfx**), both sound fields `N/A`. When
  the clip carries them: each beat's **What we hear** sound at its time, next to its motion, and
  music `N/A`.
- Lively: something always moving (blinks, breathing, bobbing icons).
- Per slide, a timeline in chunk seconds of its **What moves** beats, each at its word's time. Seconds
  only; quoted narration gets written onto the slide.

A one-shot clip, such as a hook variant, uses `--first-frame` instead of `--image`.

## 7. Edit

With **edit-video**: one edit document, 9:16, 1080p, 30 fps, black `background`.

1. Tracks, top down: the captions and the hook; the Video track; the voiceover; the sound effects
   (**generate-sfx**); a music bed (**add-music**).
2. Place the slides on their spans (the model's cuts drift up to half a second): write each chunk's
   shot starts from the storyboard into `shots.json`, then

       node tools/edit-video.mjs place <ad>/edit.json --shots <ad>/shots.json --scene 0.06 --max-rate 1.35

   and set `fit: "contain"` on every clip it writes (they fit full width, centered). When the clips
   carry the sound effects, add `--sfx sfx/clips.wav` and put that file on the sound-effects track.
3. Text, white Montserrat Bold about 60 px: the hook above the slide (`y` ≈ 520) through shot 1, then
   captions just under it (`y` ≈ 1350, below **edit-video**'s Reels line, since the slide fills the
   middle), built with **caption-video** from the word timestamps.
4. Hook variants: versions (**edit-video**) that swap only shot 1's clip.
5. Export only when asked (**edit-video**).

## Slides in a creator brief

For a UGC brief where the creator presents slides on a TV beside them (no clips or edit here): list
them in the brief's SLIDES table (Slide · Title · Drawing) and cite one per line.

- Step 4's What we see rules hold; each thing they'll point at is drawn big and apart.
- Lock the style on slide 0 (try two or three), then make the rest with it as `--ref`. Generate the
  art without text and set the titles yourself in the brand font, so spelling and placement hold.
- Save each slide to `slides/` as it's done (source art elsewhere, so Studio shows only the deck),
  check them on a contact sheet against the script and flag what's off, then make a PDF they can cast.
- Do's: stand beside the TV and frame the whole screen; click to the next slide as each line starts
  (the editor cuts the clicks).
