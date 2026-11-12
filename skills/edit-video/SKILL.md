---
name: edit-video
description: Assemble and revise a video ad in ADPK's own editor — an edit document (outputs/<ad>/edit.json) that Studio previews live and tools/edit-video.mjs exports to MP4 with the same engine. Use when cutting rendered clips into a finished video, adding the hook, captions, music, sound effects, transitions, zooms, color or an end card, applying the user's review comments from Studio, or exporting ("tighten the pacing", "fade between these", "grade them to match", "duck the music", "export it").
---

# Edit video

An ad's edit is one JSON document, `outputs/<ad>/edit.json`. A version that changes only the hook
(`edit-v2.json`, `edit-v3.json`…) holds just its hook on top of `"base": "edit.json"`, so body changes
happen once, in `edit.json` (a music bed that opens the base opens each version too, and so does any audio
from 0 that runs past 5 s: split a voiceover or sound stem at the body's start); one that differs more (a reframe, **recut-shorts**) is a full copy.
Editing marks the ad as yours until you push (sync-brand). Studio's Workflow page shows it live in
the ad's **Edit** step: preview, timeline, review comments and an Export button. Change the document
(or replace a media file it uses) and the preview follows within a second. Schema, flags and every subcommand: `node tools/edit-video.mjs --help`.

## Build

1. **Gather:** clips in `clips/` (a creator's footage in `footage/`, checked by **review-ugc-footage**), voiceover, music (**add-music**), sound effects (**generate-sfx**),
   product graphics (**search-media**). The preview loads a file the moment the document names it: finish new media
   (write it under a temp name, then rename it) before pointing the document at it.
2. **Write the document:** tracks top to bottom (hook and text, captions, video, voice, music, SFX),
   every time on the timeline clock, one clip at a time per track (what overlaps in time goes on its own track; Studio shows it that way and saves it so on the user's first edit). Clips trim with `in`, play at `rate` and get `transition`s. Studio labels a media clip by its file name; give it a `name` only to link a take's picture and voice. A speaker's
   take goes in whole: `tighten` finds where its speech starts and ends (a transcript's word ends run early).
   Anything that changes over time (zoom, volume, saturation…) takes keyframes.
3. **Captions:** `captions --words <transcript or song timing>` writes word-timed lines (**caption-video**).
4. **Check:** `check` (it also flags a cut into speech, which listening misses, and starts in the background
   whatever Studio's preview would otherwise make on first play, so playback never stalls), and `frames --at …`
   when you need to see a moment. Run it after every change that adds or retimes a clip.

## Revise: live review

The user also edits by hand in Studio (moves, trims, splits, deletes and duplicates clips, edits text and captions,
sets volume, speed and position, mutes tracks), which writes straight into the document: re-read it before each
change, change it in place from then on, and never rebuild it from a script over their edits.

The user leaves comments on the preview (a moment, optionally a box on the frame, or a stretch: `t` to `to`). Work through them as
they come:

1. `node tools/edit-video.mjs comments outputs/<ad> --wait` as a tracked background command with no
   time limit: it exits with the open comments the moment there is one, with a contact sheet of their
   moments (the rest, and `--take`: `--help`).
2. Look at the sheet: the box says which word, face or object the comment means. Make each change on
   what it's about: a clip's look on the clip (it then starts and ends with it), keyframes only for
   change over time, timed to cuts or word times, never by ear.
3. When a change moves or retimes something (a cut, a keyframe, a position), check one `frames`
   sheet for the whole batch at the first and last frame of each change and just outside it. A
   change of wording, color or volume needs no sheet. A change to what's heard: `audio --from --to
   --transcribe` on the changed stretch, never an export.
4. `comments outputs/<ad> --done <id> --reply "<what changed, in a few words>" --span <from>-<to>`
   (the changed stretch, which Studio's Watch change button plays), as soon as its change lands, even
   when it was settled in chat; until then Studio shows it as being worked on. The user watches it and approves
   it, which archives it, or sends it back: it comes back open with what's still off, the earlier
   rounds in its `history`.
5. Start the wait again.

Comments are one file each in `outputs/<ad>/comments/`, in the language the user writes in; reply in it.
A comment on a brief (.md) or `footage.json` has `file` and `quote` (the text it's about) instead of a
moment; its `--done` takes no `--span` (and on a brief, a `--reply` only when you changed something).
One left on a review link (**write-handoff**) also has `by`, who wrote it; on an image it has `file` and
`box` instead of a moment, and its `--done` takes a `--reply` and no `--span`. The reply shows on the link.
One from the user's own edit in Studio carries `edit: { where, from, to }` (plus `deleted: true`
when it deleted rows, a column or blocks; `from` is what went): bring what depends on it in step.

## Pick the style

For talking-head or UGC footage, settle this first:

- **Retention** (the default for UGC talking heads) — footage that isn't engaging on its own. Every
  edit has to earn watch time: stacked lists, slapped words, a tracked highlighter on the label,
  zooms and sound effects. No music unless asked.
- **Plain ("yapper")** — the person or footage already holds attention. Hook text and captions only;
  no music (the clip runs continuous, often with its own native sound). A zoom only where it helps,
  never where it breaks the raw, organic feel.

## What to reach for

Work in this order, since each step shifts the timing of the ones after it: clips and fixes,
`tighten`, speed (UGC speech plays at 1.2×, every time on the timeline rescaled with it), overlays
and zooms, sound effects. A hook version (`edit-v2.json`…) owns its hook clips: copy V1's opening
settings into it (the push-out, the whoosh's trim, the hook text's position) and recheck after each
change to V1's. A version spliced from stretches (`recut`, or a line inserted from a raw take) gets its
zoom keyframes set again per stretch, every keyframed track moved with its clips, and a `frames` sheet
across each join.

- **Cuts and pacing** — shots on the voiceover's lines (`place`); `cut` removes a stretch (a pause,
  a line) from every track and closes the gap, captions and keyframes included. For a real speaker
  (UGC, talking head), `tighten` takes out every breath, lead-in and pause by waveform, guarded by the
  words; run it once the takes are placed, and again after any retake. Then find the pauses it left (breaths
  it took for speech: `silencedetect` on the `audio` mix, over 0.3 s, at ~24 dB under its speech level, never a
  fixed level: the mix is loudness-normalized) and `cut` each to ~0.12 s. A soft last sound (the "ss" of "moodiness", the "n" of "iron") can fall outside a line's end: check every cut's tail, high-passed (~3 kHz) for an s and full band for an n or m, and extend to keep it. To drop a word mid-line, cut from
  the quiet after the word before it to the closed mouth just before the next word's release (10 ms loudness
  steps show both), never inside sounds that run together, and from a take where the word stands apart if
  one has it; keep both sides in the same take, check by ear, and punch in ~1.2× at the cut, since a smaller
  step reads as a jump.
- **B-roll** — never a flash of the talking head under ~0.7 s between two B-roll shots (extend the
  B-roll instead), and a B-roll shot or photo ends exactly on the cut it meets, never a frame early, no jump cut inside a B-roll shot under ~0.8 s, and no one in it visibly talking
  for long (a beat of product in use is fine). Slow a shot down to use only the moment that fits. A take starts on its action, never on the lead-in (an empty frame before she walks in, a blank look, eyes off camera): pick each shot's `in` from a sheet across the whole clip, never a guessed offset, and check its first second on a sheet. A shot
  goes where its action happens in the story (her bag of bottles as she reaches into it). Stock that
  illustrates a line can take the top half (`w` 1080, `h` 960) while the speaker's clip moves down to the
  bottom half (`y` keyframed, held), for that line only. A static stretch (the product held up to the
  camera through the CTA) gets product-in-use B-roll, one shot per phrase, nothing already shown, keeping
  the speaker for the last line and the end card. Check every product shot for a mirrored label
  (**review-ugc-footage**) as you place it.
- **Transitions** — UGC: hard cuts, anything else only on request. Otherwise `transition` on the
  incoming clip: fade for a mood shift, slide, push or wipe for a jump in place or time.
- **Zooms** — plan them all before keyframing any: list the sentences and key phrases with their times, then give
  each sentence one move, set on the track's `transform` so a cut inside the sentence keeps it running
  (a move never changes mid-sentence). Alternate type and depth (1.1–1.3) from sentence to sentence:
  still, a hard punch (a set scale from the sentence's first frame), a slow push-in (~1.06–1.1 across
  the sentence; suits a question that builds tension), or a fast hit (in ~0.1 s) on the
  start of a key *phrase* of 2–5 words, held to the sentence's end. Pick each move from what the line
  means (a calm line gets a slow push or none; a shock or a punchline gets the hit), and let moves flow:
  a slow push carries straight on from a fast hit (a stop, then a start, reads as a bug), never more than
  one change of move in ~1.5 s, and a line that recurs (the same excuse, the same joke) gets the same move
  each time. A hit needs about a second before the cut,
  else it snaps back and reads as a glitch; a zoom-out happens on a cut, or mid-shot only as a fast
  pull-out on a punchline. A
  phrase that names a motion ("up and down") can take a literal camera move: frame that shot a little
  tighter from its first frame so the move has room without a visible zoom. Keyframe `scale` with an
  `origin` on the subject. None during an
  on-screen list; text never rides a zoom.
- **Tracking** — a zoom or overlay on something that moves (a label, a jar, a hand) follows it
  frame by frame: `track --clip <name> --at <t> --box x,y,w,h`, with `--follow` for the overlays and
  `--zoom` to zoom the clip onto it.
- **Hiding** — a competitor's name on screen (a label, a logo) gets a `hide` clip per object (soft
  pixelation, so it still reads as a bottle; `style: "blur"` when asked), on a track above the footage
  and below the text, following the object with `track --follow`. Where the tracker loses it (a hand
  over it), keyframe the box by hand; check every shot it's in on a `frames` sheet, hooks included.
- **Open and close on a move** — open on a fast push-out (1.2 → 1.0 in ~0.2 s, `ease`), its fastest
  moment on the whoosh's peak; close on a fast zoom (~3×, `track --zoom`) onto the product after the
  last word, centered and above the badge, the offer coming in once the zoom clears the face.
- **Color** — `match` grades every clip toward the median look (`--ref` toward one clip); `grade`
  takes exposure, contrast, saturation, temperature, grain, vignette, each keyframable.
- **Sound** — you choose it: music (**add-music**) and effects (**generate-sfx**); reference a shared
  library file in place (`../../../../Shared/Library/inputs/media/<file>`). An effect earns its place by marking something (a
  move, a reveal, a list item) on a line that is a joke or a hit, never as decoration or on a calm line, and goes when what it marks goes or moves (`check` flags one left
  marking nothing). Time each effect from its peak (**generate-sfx**, Place). The music sits at one
  flat level (**add-music**); `moves` lists where the picture moves, for effects on actions.
  A noisy or mumbled voice: **generate-voice** (`isolate`, `patch`).
- **Text** — hook, lists and end card as `text` / `rect` / `image` clips. Text overlays cut in, no entrance animation, unless the user asks. Everything sits where both
  feeds show it: inside the 4:5 crop (y 285–1635 on 1920) and above the Reels UI, which covers the
  bottom ~35% (so no text below y ~1250), with room to spare — about 90 px inside the zone on every
  side (no text above y ~375), text blocks at most ~880 px wide (a hook may run a little wider, ~960 px, to stay at 3 lines without shrinking) — and clear of the face and the product. When it won't all fit, the
  safe zone wins, then the face and product, and size gives way: shrink a graphic before moving it
  out (`check` flags anything outside the zone). Never zoom or shift a shot to make room for text;
  move the text (over the legs, low in the zone) instead. No text repeats what other text on screen already
  says, and each reads on its own (not a lone "ORGANS": "ORGANS = B12 + IRON"). Text that replaces the
  captions sits in their spot (a list stacking up from it), so the eye never moves; only the hook sits
  higher. Captions stay centered
  in one spot; while the product is held they may shift only up or down, inside the safe zone, and
  overlap it when it can't be cleared. Other on-screen text replaces the captions for its whole
  sentence (**caption-video**, Hook); when that text is shortened or moved, the captions come back for what it no longer covers. Break text into lines by hand (`\n`) on its spoken beats, one phrase
  per line ("Spent more on supplements / than your car insurance? / You need to hear this" is three), the lines of
  similar length and never one word alone on a line. When the speaker lists things, stack them: one line per item with an
  emoji (a person in it matches the viewer: a woman for a women's ad), in on its word with a soft ding, held to the cut. Small print
  (a results disclaimer: small white text, no outline, opacity 0.7, a light shadow) sits at the very bottom edge, the one thing allowed outside the safe zone, and shows only beside the claim it covers, never in the hook, and none in a
  first-person story. Text marks facts, lists and proof; the speaker's own experience ("my skin hasn't
  looked this calm") stays in the captions, since a graphic over it reads as an ad. Cards and
  stickers (a review, benefit pills) look like the platform's native stickers: flat, no shadow, one
  corner radius and fill for all of them, each thing in its own box (benefits apart from the review).
  The hook text names the problem as the viewer pictures it ("breaking out like you're 14 again"),
  not a summary of it.
- **Short cuts** — more ads from the same footage, under 30 s: **recut-shorts**.
- **Other placements** — `reframe --size 1080x1350` (4:5) or `1080x1080` into a new version, then
  check its text on a `frames` sheet.
- **Motion graphics and anything else** — the ad's own `fx.js` (custom layers, transitions, animations;
  the contract is in `studio/engine/draw.js`; a whole coded video: **make-motion-graphics**), one file with
  no imports (Studio loads it alone). A layer draws with `env.mg` (`studio/engine/mg.js`) and animates with
  `env.motion`: `timeline(c, t, build)` for a GSAP timeline, `three(ctx, c, t, env, setup)` for
  a Three.js scene in the clip's box. Both are posed for the exact frame, so the preview follows a save
  within a second and the export matches; check moments with `frames`. Something a second ad needs moves
  into the engine.

## Export

The Studio preview is the live edit, so review and revisions never need an export. Export only when the user
asks or approves the cut; with several versions, only once every one is approved, then all together. An approval
also means push to R2 right after the export (and again after each later approval). `node tools/edit-video.mjs export outputs/<ad>/edit.json` (or the user's Export button): H.264 + AAC at
−14 LUFS into `final/<id>_<initials>_V<n>_…mp4`, about 20 s for 80 s of 1080p; `--out` names it per the brand's
brief template if it has one. Several versions go in one command (`export edit.json edit-v2.json …`), all at once (one by one on a light computer). `--scale 0.5` makes a quick draft,
`--from`/`--to` a section. Never grade your own render; hand over the path.

HDR phone footage (iPhone HLG / Dolby Vision, PQ, BT.2020) is tone-mapped to SDR BT.709 automatically
(tools/lib/hdr.mjs: libplacebo, else zscale + hable, else a plain colorspace conversion), so preview and export
match what the phone shows instead of looking washed out. The SDR copy is made once per file (cached in the OS
temp folder; the first preview or export of a long clip waits for it, roughly 0.75x real time). SDR files pass
through untouched, and exports are tagged BT.709. Or shoot SDR: iPhone Settings > Camera > Record Video > HDR Video off.

With R2, final cuts are heavy files a plain push skips: push with
`node tools/sync-brand.mjs --push workspaces/<WS>/<Brand> --originals`.
