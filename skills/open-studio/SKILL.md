---
name: open-studio
description: Launch Ad Production Kit Studio, the local web app for every human-facing view: the ads Board (review grid), the Media library, the Swipe page (ads to replicate), the Workflow page (each ad's progress, its storyboard, and the video edit's live preview, comments and export), and Pages (the brand's research, read as pages). One app for all workspaces and brands. Use when the human wants to review ads or a video edit, browse media, track an ad's progress or read the brand's research, or asks to "open the studio / board / gallery / batch UI".
---

# Open studio

The human-facing web app (`studio/`). One instance covers every workspace and brand, with a brand
switcher and URLs `/<Workspace>/<Brand>/board`, `…/media`, `…/swipe`,
`/<Workspace>/<Brand>/workflow[/<ad folder>]` and `/<Workspace>/<Brand>/pages[/<path under inputs/, no .md>]`. Pages **update live** as records and renders land.

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
- **Pages** — every .md under `inputs/` (`studio/lib/server/pages.js`; not `media/` or `sources/files/`): an index
  grouped as Research, Products and Sources; opening one keeps them all in a sidebar beside it and edits it in blocks,
  as a brief is in Workflow (below). Its comments land in `inputs/comments/`: while the user works there, run
  **edit-video**'s review loop on `inputs` (`comments <brand>/inputs --wait`). To show research, open its page, e.g.
  `…/pages/products/<product>-angles`.
- **Workflow** — each ad folder's step bar for its format, inferred from the folder's files and the
  record (`studio/lib/server/workflow.js`). Every ad's bar opens with **Concept**: the
  **CONCEPT** section of the ad's .md (Concept: the idea in a line; Product; Persona with the awareness stage this ad
  targets; Angle; Format; Reference; UGC adds Message and For, animation Style and Cast), each a labeled block
  (`**Persona:** …`). Persona, Angle and Format are each followed by their reason, `**Why this persona:**`,
  `**Why this angle:**`, `**Why this format:**`, and when the user gave his own reasoning, `**User's notes:**` holds
  it in his words, quoted (never yours). The review link (**write-handoff**) shows them beside the ad. Then:
  - Image: Prompt · Drafts · Final · Meta copy (`meta.md`). Each render's Approve moves it to `final/` as the next V (finals stay
    V1, V2, … with no gaps) and Unapprove back to `drafts/`, repointing the record (approved while `final/` has one) and the index.
  - Animation: Concept · Script · Voice · Sheets · Frames · Clips · Edit
  - Slides: Concept · Script · Voices · Storyboard · Sheets · Frames · Clips · Edit
  - Motion: Concept · Script · Sounds · Edit
  - Song: Concept · Lyrics · Song · Look · Storyboard · Clips · Edit
  - Podcast: Look · Script · Clips · Music · Edit
  - UGC: Profile (only when the ad is for a known creator: `references/profile.md`) · Concept · Script
    · Storyboard · Brief · Footage · Edit
  - Voiceover: Script · Voice · B-roll · Export
  - Other video: Script · Voice · Look · Clips · Music · Edit

  Animation's Concept shows `storyboard.md`'s CONCEPT section; Script the shot table's #, Line and What we see columns, editable, with word count and a voice button (the shots show as cards from Frames on); Voice each take with a pick button (`voice.json`); Sheets each sheet as a card with its prompt. UGC steps show the brief's sections: Concept its Message, For, Format and Reference lines and the media under them,
  Script the LINES TO CAMERA (or VOICE OVER) Scene and Line (or Talking points) columns (with word count, spoken time and a voice
  button), Storyboard every column and the SLIDES / B-ROLL / EDITOR CLIPS tables, Footage each scene's clip and
  checklist under a delivery and approval summary (**review-ugc-footage**). Every .md shown is a
  page of blocks, editable in place. One block carries one thing: a title is its own bold block
  (`**Message**`) over its text, and an image, audio or video is its own `![](path)` line (relative
  to the ad folder), so put a step's reference reels and stills in its .md that way; a table cell
  holding only `` `path.jpg` `` shows the image. Selecting text, and each finished edit, leaves a comment
  for the agent; changes on disk show live, so re-read a file before editing it. An ad with an edit
  document opens on its **Edit** step: live preview, a timeline the user edits by hand too, their comments (answered by
  **edit-video**'s review loop) and Export.
