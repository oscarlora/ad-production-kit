---
name: write-image-prompt
description: Write an image prompt and run tools/generate-image.mjs — the final step of making an image ad, and how every still is made (start frames, sheets, base images). Turns the locked concept into a structured prompt under write-prompt's rules, with the image-only layout rules and defaults.
---

# Write image prompt

Turn the locked concept into one structured, easy-to-read prompt under **200 words**, on
**write-prompt**'s rules, then generate.

## Image rules

- **Multi-unit rows: zone-filling beats true proportions.** N products in a row must fit the canvas width at true proportions, or the model stretches them. Let height follow proportions and declare the empty space intentional: *"the row spans the canvas with small gaps; can height follows true proportions, leaving open background above inside the zone; do not scale the product to fill the zone."*
- **A single pre-composited reference needs an exact width-and-height pair**, never a width-only target or a zone. Compute both from the reference's ratio (3.63:1 in a 1002px slot = 1002×276px) and state them as fixed: *"renders at exactly 1002px wide by 276px tall — not a suggestion or an upper bound. There will be visible empty background around it since this is smaller than the zone — that is correct and expected, do not enlarge it to fill more."* Drop any "hero / prominent" framing on the product; it nudges oversizing.
- **An illustrated or redrawn product keeps its real proportions:** state them ("short and wide, about as wide as tall"), or the model draws a generic tall bottle.
- **A real-looking person's sheet** is an amateur iPhone photo grid, two rows of four: head close-ups
  (front, left, right, back) over the full body from the same four sides. A transformation gets a
  before and an after sheet of the same person, each showing only the change (the before: extra
  weight with a neutral face, no eye bags or messy hair; the after: healthy, not thin).
- **Versions of one layout share a pixel grid.** Give each band its top and bottom in px, the gaps between them,
  the side margin and each text size; words like "below" or "generous" come out different every time.
  A line placed away from the headline gets "appears exactly once, only in <its zone>", or it is also set under the headline.
- **A before/after split of one body part** runs its line through the middle of that part (between two fingers,
  down the neck) and says it is one subject, not a mirror image; a split along an edge comes back mirrored (two thumbs).
- **Defaults for image ads:** 1 generation, GPT Image 2.6 Flare (its fast variant), 4:5, 1K tier (every aspect it takes: `--help`). Never change aspect, resize or upscale on your own.
- **Animated GIF ads:** `--format gif` (`--frames`, `--frame-ms`). It takes no reference images, so
  describe the product exactly (shape, colors, label text) and expect lower fidelity than a static.
  Say in the Task what moves, frame by frame, and keep the copy still across frames.

## Prompt structure (image ads)

Write these sections in order:

1. **Task** — "Create [1/2/3] [1K/2K/4K], [aspect ratio] static image ad(s)" (or "animated GIF ad(s)")
2. **Composition** — layers and their positions (**ideate-image-format**'s bands or anchor points, never percentages), background, layout
3. **Text** — the copy, with case; end with a short note that typography references follow
4. **Design** — per text type: font, color, alignment, and any legibility treatment (weight, background, shadow, stroke, gradient)
5. **Photography direction** — only if applicable (**write-prompt**)
6. **Constraints** — single image, no logos, no URLs
7. **`File name:`** — always last, exactly once (**write-prompt**, Filename convention)

## Generate

Delegation and long renders: AGENTS.md (operating principles).

1. **Update the record** (concept, prompt, params).
2. **Generate.** Pass the prompt (in a throwaway temp file, to avoid shell-escaping), the refs —
   product/scene photos found with **search-media** plus the brand's type sheet (**pull-fonts**) —
   and any non-default params:
   ```bash
   node tools/generate-image.mjs --prompt-file /tmp/<id>_prompt.txt --timeout 600 \
     --ref "workspaces/<WS>/Acme/inputs/media/00042_bottle.png" \
     --ref "workspaces/<WS>/Acme/inputs/media/brand/type_sheet.png" \
     --out "workspaces/<WS>/Acme/outputs/3_Calm-Mornings_Static_Sarah_Problem-Aware_Stress-Relief_Acme/drafts/3_V1_Calm-Mornings_Static_Sarah_Problem-Aware_Stress-Relief_Acme.png"
   ```
3. **When it lands**, set `generation.output` to the printed `Saved:` path (it must match the
   prompt's `File name:` line) and remove the temp prompt file. Index refresh and R2 push: AGENTS.md.

To **re-generate** from an existing record, `generate-image.mjs --record <record.json>` reads the
prompt, refs and params and stamps the result back. All flags: `--help`.
