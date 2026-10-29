---
name: write-prompt
description: The rules every generation prompt follows (image, video, voice) — the product-reference rules, revisions, how a model reads a prompt (with the troubleshooting every generation uses), photography direction, and the ad naming convention (IDs, folders, files). Load it with write-image-prompt or write-video-prompt, and whenever naming an ad.
---

# Write prompt

Rules for every prompt; **write-image-prompt** and **write-video-prompt** lay one out and generate it.
Decide everything; never leave a choice to the model (no "water or can").

## Core rules

- **Scene effects wrap around the product, never onto it.** Whenever a render adds lighting or atmosphere near the product, state: *"nothing printed on the product — no text, no graphic, no signature — may be altered, replaced, or redrawn to match the lighting; the product's surface is pixel-identical to its reference, only the light falling on it and the space around it changes."*
- **Never describe how the product looks**, anywhere in the prompt: no size, shape, proportions, label colors, artwork or typography; describing invites a redraw. Name it, point to the image, add the negative rule: *"The Acme serum bottle. Use the referenced product image(s). Do not regenerate, redraw, or modify the product or its packaging text — place it as-is."* Scene, layout and overlay text are free to describe. For per-flavor positions, name the flavor, never its look.
- **A product whose label must read goes first in the references and fills about a third of the
  frame height**; small, or listed after the people, it gets its label redrawn. Keep fingers off
  the label. In a stylized world (stop-motion, 3D), the real product photo still sets the label: ask
  only for the scene's light and material on it. A generated product sheet is never a reference: the
  video workflows crop the real product from a store photo into the ad's `sheets/product.png`.
- **A product held in a hand needs an in-hand reference.** Add a photo of it held in a hand (**search-media**), cropped to the hand and product (a face in it takes over the character), and tell the model to match that product-to-hand size; the packshot alone gets the scale wrong.
- **Each generation is stateless.** Describe the final image, never an edit of a previous attempt (no "don't do X" caveats about a prior output). Hard requirements (element counts, "natural undistorted proportions", single image) go in the prompt's constraints. To fix an ad, rebuild the whole prompt fresh; never add product-appearance or dimension language to force a fix.
- **Revisions regenerate — never edit a previous render.** For any revision (ad, frame, clip), fold the change into the prompt that made it (an ad's is in its record) and generate fresh with the original refs. No image-to-image edit pass on a prior render, and don't ask edit-vs-regenerate (image edits stay fine for preparing base photos, or when the user asks). When recasting real footage, the base is always **the original source frame**, with a short prompt naming only the change. To keep a person across shots, add a **face-only crop** (head and hair) from their approved frame and say "use image 2 only for the face and hair, nothing else". Never feed a whole generated frame back as a reference: each pass gets crisper until it reads fake.
- **References:** the tool hosts local files itself (signed R2 URLs, or kie's file hosting without R2); there is nothing to upload or delete. Pass an existing HTTPS URL directly when the reference isn't a cataloged brand asset.

## How a model reads a prompt (every generator: image, video, voice)

- **Every word is an instruction, and the model may take it literally.** A word with a second meaning
  can turn into it: "marigold dress" grew a flower. Use words with one meaning, and state speed,
  size and timing outright instead of implying them.
- **Traits leak.** The model fills whatever the prompt leaves open from everything else it sees.
  State every trait that matters (age, tone, speed; an accent as in **generate-voice**) first and
  outright, describe the rest in plain, neutral words, and leave out what the model doesn't need,
  such as a name nobody says in the shot.
- **The reference image is an instruction too.** Its pose, expression and composition decide what
  happens first: the person who looks mid-speech gets the first line. Make the starting image set
  up the action you want.
- **Name each subject one way, everywhere.** With several people or objects in a shot, identify each
  by position and look, in the same words every time. A label must fit only its subject: calling an
  off-screen speaker "GREEN" while a dancer in green is in frame points at the dancer.
- **Name each reference by number, in the order attached, and say who is in frame.** The prompt
  introduces image 1 first, then 2, and so on ("Linda from reference image 1, the reception from
  reference image 2"); the product goes first in both. List exactly who is in the shot; otherwise the model fills it
  with people from the sheets.
- **No mirrors.** The model duplicates people and the reflection doesn't match.
- **Keep bodies neutral for content filters.** Anatomy and pose words ("from the chest up", "leaning
  far forward") get frames blocked. Frame by waist, shoulders or collarbones, and use neutral poses
  ("sitting on the edge of the seat").
- **One main motion per moment.** Stacked movements (a camera orbit around a spin) blur together and
  slow down; give one main motion and its tempo.
- **Animate from the frame, not against it.** A clip's action works with what its start frame
  already shows. Asking for something the frame contradicts (jars standing in a row, prompted to
  slide over one at a time) or lacks (a friend handing over a cup in a frame they aren't in) breaks
  the physics. Keep each motion simple (point, pick up, lift, turn, light up), but keep plenty of
  it: one clear beat after another, each on its word.

**Pass references as a bash array** (`R=(); R+=(--ref a.png)`, then `"${R[@]}"`).

**When an output surprises you,** the cause is in the prompt, the references or the parameters.
Find what could explain the result, rewrite it, and regenerate only that item.
Never patch with a negative ("no yellow flower"): naming the thing plants it. Then fold the cause
into this section as a general rule.

## Photography direction (when photography is needed)

Default to a realistic, handheld, casually composed iPhone photo, not a styled brand shot: imperfect and grainy, noisy shadows, no glare, no extreme softness on skin, no specular polish. Always write the exact phrase **"amateur, user generated iPhone photo"** (for video, **"amateur, user generated iPhone video"**) in any prompt meant to read as real (UGC scenes, start frames, backgrounds behind faux UI, lifestyle shots) unless the user asks otherwise.

## Filename convention (canonical — every other skill points here)

Every ad gets its own folder in `outputs/`. A render lands in `drafts/`; on approval, move it to
`final/` and update the path in the record. Other working files (prompts, plans) get their own subfolders.

- **Folder:** `[ID]_[Concept]_[Format]_[Persona]_[Angle]_[Product]`
- **Approved file:** `[ID]_[Variation]_[Concept]_[Format]_[Persona]_[Angle]_[Product]` — the same
  name with the variation added. `File name:` is this.

- **ID** — next integer. **If the brand reviews on a Notion Ads Board, the board is the ID
  authority**: at the start of a batch, peek with `node tools/upload-to-notion.mjs next-id <WS>
  "<Brand>"` and number from there.
  Otherwise take the highest of the brand's `outputs/` leading numbers and its batch plans' slot IDs
  (**plan-batch**), and add 1.
- **Variation** — `V1`, `V2`, … versions of the same concept. Files only, never folders. A new
  concept is a new ad with its own ID.
- **Concept** — 2–4 words naming the angle's core message (`Greens-Beat-Pills`), not a line lifted
  from the script.
- **Format** — e.g. `Static`, `UGC`, `Voiceover-Mashup`, `Voiceoverless-Mashup`, `Podcast`, `Animation`, `Slides`, `Song`.
- Underscores between parts, hyphens inside a part (`Disappearing-Woman`).

Example: folder `3_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens`, approved file
`3_V1_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens.mp4` (the render's own
extension: `.png` for an image, `.mp4` for a video). To rename an ad, rename its folder and files and
update the paths in its edit documents.

An ad's record is its source of truth; the words on the image live in its prompt.
