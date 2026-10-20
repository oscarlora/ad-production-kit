---
name: replicate-ad
description: Make an ad modeled on a reference — another brand's ad or post the user wants to swipe. Swipes the reference into the brand's library (Gemini breaks it down shot by shot), then rebuilds its structure for the brand's product from the brand's own footage. Use when the user shares an ad to replicate, copy, swipe or "make one like this".
---

# Replicate ad

Keep the reference's **structure** (order of beats, text style, pacing, music or not); write new
words for this brand and persona, and make it from the brand's footage.

1. **Swipe the reference:** `node tools/catalog-media.mjs --brand <brand dir> --source "<link>" --swipe`.
   Its record's `analysis` is the breakdown: each shot with its times, the on-screen text, what's
   heard. It shows on Studio's **Swipe** page.
2. **Set up the ad** (AGENTS.md, To make an ad), its format the reference's. Put the swipe item's id
   in the ad's record (`"swipe"`) and its video under Reference in the CONCEPT section
   (`![](../../inputs/media/<file>)`).
3. **Load the brand context**, then read the breakdown into the beats: what each one does (hook,
   offer, feature, proof, CTA), its on-screen words, its length, and the music.
4. **Concepts:** 3, each fitted to the reference's beats (**write-copy**); the user picks one and
   gives direction.
5. **Brief:** the CONCEPT section (the targeted awareness stage under Persona), then a beats table:
   `| # | Beat | Text | Tags | Footage |`, the footage a loose shot idea per beat. The user edits it in
   Studio.
6. **Footage:** a clip per beat from the brand's library (**search-media**), no one visibly talking.
7. **Edit** (**edit-video**): the reference's text style (**caption-video**, Boxed for Instagram's own
   text), the reference's pacing, and music only if the reference has music (**add-music**: the same
   feel). Review in Studio until approved, then export and push.
8. **Hand off** the brand's way (its `inputs/brief-templates.md`, or **write-handoff**).
