---
name: open-studio
description: Launch Ad Production Kit Studio, the local web app for every human-facing view: the ads Board (review grid), the Media library, the Swipe page (ads to replicate), and the Workflow page (each ad's progress, its storyboard, and the video edit's live preview, comments and export). One app for all workspaces and brands. Use when the human wants to review ads or a video edit, browse media or track an ad's progress, or asks to "open the studio / board / gallery / batch UI".
---

# Open studio

The human-facing web app (`studio/`). One instance covers every workspace and brand, with a brand
switcher and URLs `/<Workspace>/<Brand>/board`, `…/media`, `…/swipe` and
`/<Workspace>/<Brand>/workflow[/<ad folder>]`. Pages **update live** as records and renders land.

## Launch

```
node studio/dev.mjs        # from the repo root → http://localhost:4179, or the next free port
                           # --dev while changing Studio's code: hot reload, no rebuild per change
```

Run it as a background command and read the address it prints; if Studio is already running it
prints that address and exits, so it never starts a second one. Then open the address for the user
in the agent app's in-app browser whenever it has one, bringing the pane up if it's hidden; only
without one, `open <url>` (`start <url>` on Windows). For an ad, open its own page by ID
(`/<Workspace>/<Brand>/workflow/<ID>`, which survives a folder rename), not the list. Never wait on a
browser that doesn't answer: after one timeout, stop using it and check from the shell (`curl` the page and its API).
Deps install via `tools/setup.sh` / `setup.ps1` (or `npm install --prefix studio` once).

When you run inside Studio's chat (the Mac app, or `/app` in a browser), Studio is already open
beside you: show a page with the `open_page` tool instead of launching anything.

## Pages

- **Board** — the ad records (`outputs/json/*.json`) and batch plans (`outputs/batches/*.json`) by
  status: In Progress (plan slots and ads being made), Pending Review, Approved, plus where each was
  sent. Read-only: the user reviews and calls approvals and revisions here.
- **Media** — the catalog (`inputs/media/_catalog/`). Its sidebar shows each record's source, analysis
  and transcript, and edits the record's products, people and analysis directly.
- **Swipe** — the catalog's swipe items (**replicate-ad**), the same view, each marked "To swipe" or
  with the ads made from it.
- **Workflow** — each ad folder's step bar for its format, inferred from the folder's files and the
  record (`studio/lib/server/workflow.js`). Every ad's bar opens with **Concept**: the
  **CONCEPT** section of the ad's .md (Product, Persona with the awareness stage this ad targets,
  Angle, Format, Reference; UGC adds Message and For). Then:
  - Image: Prompt · Drafts · Final · Meta copy
  - Animation and slides: Concept · Script · Voices · Storyboard · Sheets · Frames · Clips · Edit
  - Song: Concept · Lyrics · Song · Look · Storyboard · Clips · Edit
  - Podcast: Look · Script · Clips · Music · Edit
  - UGC: Profile (only when the ad is for a known creator: `references/profile.md`) · Concept · Script
    · Storyboard · Brief · Footage · Edit
  - Voiceover: Script · Voice · B-roll · Export
  - Other video: Script · Voice · Look · Clips · Music · Edit

  UGC steps show the brief's sections: Concept its Message, For and Format lines and media blocks,
  Script the LINES TO CAMERA Scene and Line columns (with word count, spoken time and a voice
  button), Storyboard every column and the SLIDES / B-ROLL tables, Footage each scene's clip and
  checklist under a delivery and approval summary (**review-ugc-footage**). Every .md shown is a
  page of blocks, editable in place. One block carries one thing: a title is its own bold block
  (`**Message**`) over its text, and an image, audio or video is its own `![](path)` line (relative
  to the ad folder), so put a step's reference reels and stills in its .md that way; a table cell
  holding only `` `path.jpg` `` shows the image. Selecting text, and each finished edit, leaves a comment
  for the agent; changes on disk show live, so re-read a file before editing it. An ad with an edit
  document opens on its **Edit** step: live preview, timeline, the user's comments (answered by
  **edit-video**'s review loop) and Export.
