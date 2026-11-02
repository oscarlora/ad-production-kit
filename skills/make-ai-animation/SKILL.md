---
name: make-ai-animation
description: Make an AI animation video ad — an animated scripted scene (Pixar-like, stop-motion, claymation, anime and more), narrated (a voiceover over characters who act it out), dialogue (the characters speak), or both. Use whenever someone wants an animated, cartoon or Pixar-style ad, a skit or drama ad, a narrated animated story, or a scripted scene brought to life — even if they just hand over a script or a reference ad. Covers style, script, voice, storyboard, sheets, frames, clips, and the edit or a handoff.
---

# Make AI animation

A scripted scene, animated, on one of two paths (step 1):

- **Narrated:** a voiceover tells the story and sets every shot's timing; the characters act it out
  and never speak. Shots are grouped into multi-shot clips, each with its own sound effects.
- **Dialogue:** the characters speak their lines, one clip per shot. **Both** (a narrator too)
  follows this path and adds the narrator from the narrated one.

Every shot is approved as a still before it becomes a clip. Work in `outputs/<ad>/`: `storyboard.md`
(concept, notes and shots), `voice/`, `sheets/`, `frames/`, `prompts/`, `clips/`, `audio/`, `drafts/`,
`final/`. Keep replaced takes beside the new ones with a letter suffix (`frame-03-a.png`,
`clip-01-b.mp4`). Studio's Workflow page follows these steps (block format: **open-studio**).

## 1. Concept

Load the brand context (AGENTS.md). Persona, angle and the 2–4 claims it carries pass **write-copy**'s
claims gate, unless the brief or a reference sets them. The product's own lines carry only signed-off claims; bigger
reactions ("she can't be fifty-nine") stay in the characters' mouths, never the narrator's or the
end card's.

Lock seven fields in `storyboard.md`'s CONCEPT section, before anything else:

- **Product**, **Persona** (with the awareness stage this ad targets), **Angle**.
- **Format:** the path, narrated, dialogue or both.
- **Style**, unless the user named one, from those on the list below that suit the persona and tone,
  or matched to a style reference.
- **Cast:** each character in more than one shot, named, with look and wardrobe. Every sheet and
  frame uses it; one-shot characters are described in their shot.
- **Reference:** the reference ads as media blocks (a script reference, a style reference), or "From
  scratch".

1. **Pixar-like 3D** — warm soft light, rounded faces, big expressive eyes.
2. **DreamWorks-like 3D** — punchier, cheekier: smirks, raised brows, comic timing.
3. **Claymation** — Aardman-like plasticine, thumbprints, slightly jerky stop-motion.
4. **Puppet stop-motion** — Laika-like felt, fabric and wood, miniature sets; good for spooky.
5. **Classic Disney 2D** — hand-drawn, clean ink lines, painted backgrounds.
6. **Ghibli-like anime** — soft watercolor skies, gentle everyday detail.
7. **Spider-Verse comic 3D** — halftone dots, bold ink lines, on-twos motion.
8. **Painterly 3D** — Arcane-like brushstrokes over 3D forms.
9. **Flat 2D cartoon** — simple shapes, bold flat color, thick outlines.
10. **Storybook** — soft 3D or 2D picture-book look, pastel and cozy.

## 2. Script and storyboard

The script is written straight into the shot list, so each line shows with what we see. Locked if the
brief has one or the user writes it (**write-copy**'s user-written rule). Otherwise write it with
**write-copy**, including its pace (Length).

- **Narrated:** one voice to the viewer, one line per idea, every line something you can picture.
- **Dialogue:** **write-copy**'s dialogue rules; narrator lines `VO:`.

`storyboard.md` after the CONCEPT: a NOTES section (the device, symbols, blocking, direction), then a
STORYBOARD section whose table is the file's **first table**, columns `# | s | Line | What we see |
Camera | Into the next shot`, then any other table (clips, sound). Studio's Script step shows just
each line and what we see, for planning; the shots show as cards from Frames on.

- **One visual device carries the angle** for the whole film, and the solution breaks it: a tired mom
  juggling plates that keep multiplying sets them all down when the answer arrives. Use it only in
  the beats about it.
- **Shot length.** Narrated: cut where each line starts; until a voice take is picked (step 3), time
  it at 4 words a second. A line that
  lists things gets a shot per item, cut on each word; items that belong together share one frame,
  each emphasized on its word (three nutrients glowing in turn). Dialogue: one line = one shot, its
  seconds from the words at **write-copy**'s pace, rounded up, minimum 4; fold quick back-and-forth
  in one setup into one shot; silent action gets its own shot.
- A brief's scene directions are a starting point: give every line a picture.
- **Read the board as one story before any frame.** Each shot shows one thing, the thing its line
  says, as literally as possible. No two shots repeat a picture, heading or idea unless the repeat
  is the point (a callback). A symbol keeps one meaning and a recurring character one role. Say
  exactly who is in each shot. Name every recurring setting and prop; step 4 makes a sheet for each.
- **Block each setting once**, in the notes: where everyone stands, which way they face, and
  which side the camera stays on. Name each setting's first frame as its master.
- **Direct the motion.** One main camera move per shot, smooth like a motion-control rig. Every cut
  is motivated: the camera follows something (a thrown plate, a whip pan) out of one shot and lands
  on it in the next. One screen direction per side of the story (the problem moves right to left;
  once free, they move left to right). Fast, never frantic: the thing to watch stays near the same
  spot in frame across a cut.
- **Narrated: plan the clips** in a table under the shots: consecutive shots grouped into clips no
  longer than the model allows (**write-video-prompt**, Video models), whole lines only.
- **Sound effects** only: each shot's sounds, specific to its action and timed to it (a plate
  clattering). A recurring sound gets the same words every time. No music, voices or ambience.

## 3. Voice

- **Narrated:** generate the voiceover (**generate-voice**) into `voice/`, takes differing in voice and
  delivery. The user picks one on Studio's Voice step (saved as `voice.json`; the pick reaches you as
  a comment). Get that take's word timings (`node tools/transcribe-media.mjs --in <take> --words`) and
  retime the board: each line's start and end set its shots.
- **Dialogue:** the clips make the voices (step 6). Write a voice block per speaking character
  (**generate-voice**) in `voices.md`, each clearly different. Lock the blocks before the first clip; a later change
  breaks that character's earlier clips. Plan to
  even the voices out in the edit. **Both:** this, plus the narrator generated and picked as above and laid in
  at the edit.

## 4. Sheets

Before any frame, make a sheet for every character (the concept's Cast), setting and prop (the
storyboard's) in more than one shot. Anything in a single shot is described in that frame's prompt
instead. Studio shows each sheet as a card with its prompt and references.

1. **Hero first, alone:** the main character in the locked style (front, three-quarter, side, full
   body, a few expressions). The user approves it as the style lock before any other sheet.
2. **Then the rest, in parallel**, each with the hero sheet as style reference: one per recurring
   character (varied in age, build and skin tone when the brief asks), one per recurring setting and
   one per prop that must match. A setting sheet is its four sides as a 2×2 grid, seen from the
   middle of the space in the same light (front, right, back, left), so no frame invents a wall it
   hasn't seen; a frame prompt names the panel its shot faces. A prop sheet is a 2×2 grid of front,
   back, side and top.
3. **Props that stand for an idea carry their word** when a word reads faster than a symbol (jars
   labeled FOCUS, ENERGY, SLEEP, spelled exactly as given). Otherwise no text on sheets.
4. **The product is never generated:** crop it into `sheets/product.png` (**write-prompt**'s product
   rules). Nobody presents it to the camera: the character shows it to the people they're talking to, or holds it
   beside their face in a narrated close.

    node tools/generate-image.mjs --prompt-file <ad>/sheets/<name>.txt [--ref <ad>/sheets/hero.png] \
      --aspect 16:9 --resolution 2K --out <ad>/sheets/<name>-a.png

Generate each sheet once.

## 5. Frames

One 9:16 still per shot, its opening moment, from the sheets of everyone and everything in it. Make
each setting's master first, then the rest in parallel with the master as a reference. Prompts
follow **write-prompt**'s "How a model reads a prompt".

    R=(); R+=(--ref <ad>/sheets/hero.png); R+=(--ref <ad>/sheets/<setting>.png)
    node tools/generate-image.mjs --prompt-file <ad>/frames/frame-01.txt "${R[@]}" \
      --aspect 9:16 --resolution 1K --out <ad>/frames/frame-01.png

- **Draw the moment the clip starts from:** whoever speaks first is about to talk, a body in motion
  is caught where the motion begins, and anything the action needs is already there (the cup in their
  hand). The clip can't bring in what the frame lacks.
- **The product:** `sheets/product.png` first in the references, label to the camera
  (**write-prompt**'s product rules).
- **Each frame picks up where the previous shot ends.** A cut changes the camera, never the moment:
  poses, hands, gaze, what each person holds and who is mid-action carry straight across. Once the
  previous clip exists, pass its last frame as a reference for continuity only ("match the poses,
  hands, gaze and expressions; do not copy its framing"). The new shot changes size or angle clearly
  (a full step, or about 30°), in absolute terms ("from the collarbones up, the two heads fill most
  of the frame") plus "much closer than reference image 1". A gesture a line calls for happens in
  the clip on its word, never pre-set in the frame. If an earlier shot is regenerated, recheck the
  cut after it.
- Once a character's look is set in an approved frame, that frame outranks their sheet. Restate each
  character's defining wardrobe in every frame prompt.
- As a scene's frames land, check them against the blocking and each other (seats, screen sides,
  camera side, eyelines, wardrobe, props, light) and against step 2's one-story rules, and flag what's
  off to the user.
- No text beyond prop labels and the product.
- A grid sheet as a reference can leak its panel line into the frame: ask for "one single continuous
  picture from one camera".

## 6. Clips

Every clip prompt follows **write-prompt**'s "How a model reads a prompt", above all **animate from
the frame, not against it**. Each prompt stands alone, written like a director's notes and laid out in its model's syntax
(**write-video-prompt**):

- **TASK:** animate the frame(s) for N seconds keeping their exact style, drawing and light.
- **CAMERA:** the move, its feel and where it ends up, with timings.
- **WHO IS WHO:** each person by position and look.
- **ACTION:** a timeline of beats, each tied to a second (the word's time minus the clip's start).
  When several people act in turn, only one moves at a time. Every beat is new, and everyone is still moving at the end.
- **SOUND:** only this shot's sounds, placed in time; no music, chatter or ambience, said each
  model's way.

**Narrated:** MiniMax H3, or Seedance 2.5 for longer clips (**write-video-prompt**, Video models). One
run per planned clip: its shots' frames in order as `--image` refs, then the sheets of who's in it
(9 images at most on MiniMax). The prompt gives each shot its frame and start second, with a hard cut at each,
and SOUND carries the effects, so every clip comes back with its own sound. Name each clip after its
first shot (`clips/clip-07.mp4` covers shots 07–12). Run independent clips in parallel (long
renders: AGENTS.md).

    node tools/generate-video.mjs --model minimax-h3 --prompt-file <ad>/prompts/clip-07.txt \
      --image <ad>/frames/frame-07.png --image <ad>/frames/frame-08.png --image <ad>/sheets/<setting>.png \
      --aspect 9:16 --duration <clip seconds, rounded up> --out <ad>/clips/clip-07.mp4 --timeout 1500

**Dialogue:** one Seedance 2.5 run per shot from its frame; it makes the voices and sound too. Leave
`--aspect` off (the frame sets the shape).

    node tools/generate-video.mjs --prompt-file <ad>/prompts/clip-01.txt \
      --model seedance-2.5 --first-frame <ad>/frames/frame-01.png \
      --duration <shot seconds> --out <ad>/clips/clip-01.mp4 --timeout 900

Dialogue prompts add two sections:

- **LINES:** who speaks, the exact words, roughly when, and who stays silent (off-screen voices
  included). Direct a line meant a certain way as a whole ("slower and louder"), never word by
  word. Tag every line with the speaker's position and look
  (`LEFT, green dress:`). Introduce a very short line as speech ("she says the single word 'Stop.'").
  An off-screen voice gets lip-synced onto any visible mouth: keep every on-screen mouth closed while
  it speaks and say it comes from behind the camera. Listeners make no sound at all (a gasp makes them
  a voice, and they may get the lines); say so. Breaths written into the action come out audible.
  The speaker's face is at least as open to the camera as any listener's: put the camera on their
  listeners' side, never turn the speaker.
- **VOICES:** the step 3 blocks, word for word under the same labels, for whoever speaks.

Preview each clip mixing its own sound, the voiceover span and the music under it. When one shot
misses, fix its prompt (**write-prompt**) and regenerate **that shot
alone** from its frame (`--first-frame`, at least the model's minimum length; fix the frame first
when the frame set it up), then splice it in at the clip's real cut.

## 7. Edit

Ask whether to edit here or hand off.

**Here:** with **edit-video**: one edit document, 9:16, 1080p, 30 fps. Tracks: Hook, Captions,
Video, Voice, Music (**add-music**), SFX.

- **Narrated: place every shot on its line.** Plan each clip's shot starts in voiceover seconds, then

      node tools/edit-video.mjs place <ad>/edit.json --shots <ad>/shots.json --scene 0.15 --max-rate 1.35 --sfx audio/sfx.wav

  It finds each clip's real cuts and fits every shot to its line on the Video track (slowed, or sped
  up to 1.35×, trimmed beyond that); check its shot-count warnings by eye. `sfx.wav` (the clips' own
  sound, cut the same way) goes on the SFX track at 0 dB, after a Gemini audit for what the clips invent
  despite the prompt (a yawn, a chime melody): mute those stretches; extra effects: **generate-sfx**. When an action still lands off its word, find it (`edit-video.mjs moves`) and
  retime the still stretches between actions, never the actions.
- **Dialogue: sound design** treats the film as one place heard from different spots. First audit
  every clip's sound with Gemini (`generateJSON` in `tools/lib/analyze.mjs`, as **catalog-media**
  does): clips often bake in music and chatter despite the prompt. Find lines invented in silent
  shots with `node tools/transcribe-media.mjs --in <clip>`. Then build four stems lined up to the timeline:
  dialogue (voice-isolated where anything is baked in, **generate-voice**; invented lines muted; every shot leveled to one loudness), ambience (one
  bed per location from the same recording, filtered for distance, crossfading at location changes;
  conversations sit "far" so the lines carry), music (one diegetic track, muffled by distance,
  ducked gently under dialogue: `duck --speaker`) and SFX for transitions only (**generate-sfx**).
  Each stem gets its own track, the clips muted.
- **Hook and captions:** **caption-video**.
- Versions and export (only when the user asks): **edit-video**.

**Hand off:** **write-handoff** (Editor handoff).

Naming: **write-prompt**, format `Animation`.
