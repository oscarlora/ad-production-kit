---
name: upload-ads
description: Upload approved ads to the places the brand uses — Google Drive (the files) and a Notion Ads Board (one card per idea with its fields) built in, or any destination set up later (Dropbox, Frame.io, a shared server…). Use after the user approves ads, when they say "upload", "send to Drive/Notion", or "set up uploads to <somewhere>". Every upload is planned first and written only after the user confirms.
---

# Upload ads

Upload approved ads (images and video) to each place the brand uses. Plan first, show the plan,
write only after the user confirms. Run the tools with **node**, never `curl`/`python3`.

## The contract

Every destination tool works the same way:

```
node tools/upload-to-<dest>.mjs [--list] [--confirm] [--create] <spec.json>
```

`--list` inspects the destination; a plain run prints the plan (show it to the user); `--confirm`
writes, never duplicating, and notes the link on the ad's record (`sentTo`). Nothing creates a folder
or board unless `--create` is passed, after the user agrees (Notion never does).

## The spec

Save as `workspaces/<WS>/<Brand>/outputs/_upload_<id>.json`; the path picks the workspace and its
keys. One spec feeds every destination. Omit a field to leave it unset.

```json
{
  "brand": "Acme",
  "name": "20_Morning-Greens_Static_Busy-Parent+Gym-Goer_Problem-Aware_Energy+Social-Proof_Greens",
  "status": "Pending Client Review",
  "product": "Greens", "media": "Image", "id": "auto",
  "ratio": ["4:5"], "variations": 4,
  "headline": "Switch To Steady Energy",
  "primaryText": "Sentence one.\n\nSentence two.",
  "images": ["workspaces/<WS>/Acme/outputs/20_…/final/20_V1_….png"]
}
```

`images` lists every file to upload, video included. Placement fields: `driveSubfolder` (Drive),
`board` (full title) or `boardId` (Notion), and `propertyMap` for an oddly named Notion property
(`{ "primaryText": "Body", "adCode": "Link" }`).

## Where each brand uploads

`workspaces/<WS>/<Brand>/inputs/uploads.json` pins the brand's places:

```json
{ "drive": { "folder": "Acme Ads" }, "notion": { "board": "Acme Ads Board" } }
```

`drive.folder` is the exact brand folder inside `<WS>_DRIVE_FOLDER`; `notion.board` (title) or
`boardId` pins the board. The first time a brand uploads somewhere, confirm placement with the user
(`--list`), then save it here so later uploads don't ask. Spec fields win over it.

## Google Drive

Files land in `<WS>_DRIVE_FOLDER / <brand folder> / <group> /`, where the group is
`driveSubfolder`, else the spec's `name`. Shared Drives work.

- Inside the brand folder, ads sit in a **package folder** (e.g. `100-statics-package`), in
  **per-batch group folders**, or directly. Confirm which with the user and set `driveSubfolder`.
- A new per-ad folder is named `<ID> <descriptor>` (e.g. `41 Static - The Morning Routine Math`),
  never prefixed with `#`.
- A revision: `--archive` moves same-named files into `Archived` before uploading.
- Setup: the Drive keys in `.env.example`.

## Notion

Upserts one card on the brand's Ads Board. Each spec field maps onto the board's real properties;
the plan reports any it skips.

- **One page per idea**; variations group onto one page. The page name is the ad's folder name (no
  variation); a grouped page joins shared personas and angles with `+`, as in the spec above.
- **Page body = the filename heading + its image, per ad.** No intro text, no cover.
- **Video:** upload the files to Drive first, then set the page's **Ad link** to the Drive folder
  URL the Drive upload prints, and **Media = Video**.
- **Links are real Drive URLs**, never a local or mapped-drive path.
- **Writing to an existing card:** if two cards share an ID, match by name and status, never the
  first hit.
- **Status** as directed (e.g. `Pending Client Review`). **Headline / Primary Text** from
  **write-meta-copy**.
- **IDs** (the board is the authority: **write-prompt**): `"id": "auto"` takes the next number; a
  duplicate is refused; updates keep the page's ID.

## Add a destination

The user can just ask: "set up uploads to Dropbox". To add one:

1. Write `upload-to-<dest>.mjs` following the contract above, reusing `tools/lib`.
2. Read its keys from `.env` as `<WS>_<DEST>_…`.
3. Read its place from `inputs/uploads.json` under `"<dest>"`.
4. Name files and folders per the naming convention (**write-prompt**).

To keep it private, put it in `workspaces/<WS>/_custom/tools/`. To share it, put it in `tools/`, add its keys to `.env.example`, and open a PR.
