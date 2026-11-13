---
name: make-ai-song
description: Make an AI song video ad — a sung song (Suno) is the whole audio, animated clips act out each line, and word-by-word captions let people sing along. Use whenever someone wants an AI song ad, a singing ad, a jingle-style or music-video ad, or says "make a song ad". Covers concept, lyrics, the song and its word timings, sheets, storyboard, Seedance clips, the edit, captions, versions, and delivery.
---

# Make AI song

The song carries the whole pitch; the clips act it out. Nobody lip-syncs. Every cut lands where a
sung line starts. Use the user's swipe file of song ads, if they have one. Every sheet, storyboard
and clip prompt follows **write-prompt**'s "How a model reads a prompt". Work in `outputs/<ad>/`:
`music/` (lyrics, takes, the final song and its timings), `sheets/`, `storyboards/`, `prompts/`,
`clips/`, `final/`.

## 1. Concept

Load the brand context (AGENTS.md). Pick the persona and angle first; default to the brand's most
emotional persona (grief, identity loss) unless told otherwise. Each concept steals one move from
the swipe file: a specific age in the first line, a named villain, a story told backwards, small
concrete scenes (a 3am clock). Write it to the ad folder's `concept.md`.

## 2. Lyrics

Follow **write-copy** for voice and claims. Song rules:

- **Length:** about 110–130 sung words gives a 2-minute mid-tempo song. Suno ignores "short" or a
  BPM in the prompt: change the word count, or set a target with `--duration` (10–360 s).
- **One line = one shot**, every line easy to picture.
- **The first line is the hook:** a person, an age, a moment ("I found a photo of me at thirty-nine").
- **The product enters in someone's words** (a friend, a grandma), named once as brand + category.
- Show the full lyrics after every change. Never generate until they're approved.

## 3. Song

    node tools/generate-music.mjs --lyrics <ad>/music/lyrics.txt --title "<Title>" \
      --prompt "heartfelt mid-tempo pop ballad, 100 BPM, intimate warm female alto vocal, piano and soft drums, strings lift at the final chorus, vocal on the first beat" \
      --out <ad>/music/song-suno.mp3

Each run gives two takes and Suno's timing for every word. Cut the chosen one to the sung
part and write the timings:

    python3 tools/edit-song.py timing --take <ad>/music/song-suno.mp3 --lyrics <ad>/music/lyrics.txt --out <ad>/music/song-final.mp3

Always use Suno's timings: transcribing singing mishears lines.

## 4. Look

1. **Hero sheet:** the main character, three angles on one sheet, plus any other age the story needs.
   Styles: **make-ai-animation** step 1's list.
2. **Cast sheet:** everyone else on one sheet, with the hero sheet as the style reference.
3. **Product:** never generated; crop it into `sheets/product.png` (**write-prompt**'s product rules).

## 5. Storyboard

Group the lines into clips no longer than the model allows (**write-video-prompt**, Video model), cutting
only where a line starts. Split any line longer than about 6 s into two shots. One storyboard sheet
per clip in `storyboards/`, its shots as vertical 9:16 panels: three in a 16:9 row, four as a 2×2 grid in 9:16, two
side by side in 1:1. No text in the pictures.

## 6. Clips

One run per clip, with the storyboard sheet and the character sheets as references
(**write-video-prompt**, Video model).

    node tools/generate-video.mjs --prompt-file <ad>/prompts/clip-01.txt --image <sheet> --image <hero> \
      [--image <cast>] [--image <product>] --aspect 9:16 --duration <clip length, rounded up> --no-audio \
      --out <ad>/clips/clip-01.mp4 --timeout 1500

The prompt, in Seedance's layout (**write-video-prompt**), times each shot in its timeline and keeps
the rules: match each panel, hard cuts, each panel fills the frame edge to edge, every surface plain,
nobody speaks.
To fix one bad shot, make a new still for it and animate it alone (`--first-frame <still>
--duration 6`), not the whole clip.

## 7. Edit

With **edit-video**: one edit document, 9:16, 1080p, 30 fps; the song on its own track is the only
sound.

1. Place the shots: write a plan (`{"clips":[{"file","starts":[song seconds of each shot],"end"}]}`), then

       node tools/edit-video.mjs place <ad>/edit.json --shots <ad>/shots.json

   Let the last shot run to the end of the outro, slowed if needed. `check` the document for gaps
   and look at a `frames` sheet.
2. Captions (rules in **caption-video**), timed from Suno's words:

       node tools/edit-video.mjs captions <ad>/edit.json --words <ad>/music/song-final.mp3.timing.json --max 4

   Never across two sung lines. The look: Permanent Marker, white with a black outline, centered,
   the sung word yellow and bigger (`active`: `#FFE100`, scale 1.25).

## 8. Versions and export

With **edit-video** (versions, Export), format `Song`.
