---
name: make-image-ad
description: The end-to-end image ad workflow — run this to make an image ad from scratch. An interview: at each step offer options, lock one, and append it to a growing parameter table, then assemble the prompt and generate. Use when the user asks to make or start an image ad.
---

# Make image ad

Make one image ad as an **interview**: each step ideates one variable, the user locks one option,
and it appends to a growing **parameter table**. Skip any step the starting point already locked.

The **format decides the text slots**: `hook` is always present, and every other text element the
format places gets its own identifiably-named column. Example — hook on top, two sublines, three
pills bottom-right:

| product | persona | angle | format | hook | subline-top | subline-bottom | pill-1 | pill-2 | pill-3 |

The table lives in the **conversation**.

## Before starting

Load the brand context (AGENTS.md). **Never repeat** a persona/angle/format already in the brand's
ads (check `outputs/index.md` or the records) unless asked.

For **more than one** ad, plan the set first with **plan-batch**, then run this workflow once per ad,
from the next open slot.

## Starting point

Pick how to begin; it sets the order of the concept steps:

- **Angle first** — angle, then format.
- **Format first** — format, then angle.
- **Reference photo first** — a library photo found with **search-media** → photo-centric.
- **Reference ad first** — replicate an ad's format; the reference decides photo- vs graphic-centric.

## Steps

The **concept** is product + persona + angle + format. Then copy, then design.

1. **Product** — ask which **product** the ad is for, by name (offer the brand's products if there are several). Call it the "product," not the "subject."
2. **Persona** — pick or ideate one (**ideate-personas-angles**).
3. **Angle** — pick or ideate one (**ideate-personas-angles**).
4. **Format** — image type + layer layout (**ideate-image-format**), and static or animated GIF
   (**write-image-prompt**).
5. **Copy** — hook, plus subline and tertiary if the format uses them (**write-copy**).
6. **Design** — colors, fonts, hierarchy, legibility (**ideate-image-format**, Design).
7. **Prompt** — compose the structured prompt in the chat, not in a file (**write-image-prompt**).
8. **Show, then generate** — show the full ad as a **table in the chat**, every parameter **including the prompt**. Then render (**write-image-prompt**).
9. **Approve** — on the user's yes, or their Approve in Studio, the render moves to `final/` as the next final
   version (**write-prompt**, filename convention).
10. **Story version** — every static (not a GIF) is made 4:5 first; once a 4:5 is approved, make its 9:16 Story
    version by AI extension, never a new layout: `node tools/extend-to-story.mjs --in <approved 4:5>
    --out drafts/<the 4:5's name>_Story.png --above "<what continues above>" --below "<what continues below>" --paste`,
    so the ad's text and product stay pixel-identical. A flat background that code can extend without hurting the
    design is extended by code: that bar takes `plain` as its text, and when both do, `--smear` instead (no
    generation); only a bar that must continue part of the design (a photo, an illustration, a texture) goes to AI. Continue only what the 4:5 already shows (background, the rest of
    a head it shows); a body part it crops out (the face above a neck) gets invented and comes out wrong, and one
    that fades into the background at the edge (an arm into black) stays faded: that bar is `plain`. On approval it
    goes to `final/` keeping the 4:5's V.
11. **Meta copy** — when the ad runs on Meta, its headline and primary text (**write-meta-copy**),
    before upload (**upload-ads**).
