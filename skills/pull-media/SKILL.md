---
name: pull-media
description: Fetch a brand's media into a local cache for cataloging — from a Google Drive folder, a local folder/upload, an Air.inc board, a Frame.io share, or a URL (direct file or a YouTube/social link). The first step of catalog-media; also usable on its own to gather reference assets. Never fabricate — only pull what the source serves.
---

# Pull media

Fetch media into a local cache for **catalog-media**. Sources:

- **Local / upload** — a folder or file on disk. Non-media and `_catalog/` are skipped.
- **Google Drive** — a folder (subfolders included) or file link/id. Uses the workspace's Drive creds
  (share the client folder with that account); without them, the public link works when shared
  "anyone with the link" (Google Docs/Vids skipped). With `--brand`, a folder pull downloads only
  files new or changed since the last one (the brand's `drive-sources.json`).
- **Air.inc** — a board share link (`app.air.inc/a/<id>`, or `…/b/<board>`), no key; sub-boards included.
- **Frame.io** — a share link (`f.io/<code>` or `next.frame.io/share/<id>`), no key; folders included (files named by
  their folder path), every version of a version stack. The share needs downloads on.
- **URL** — a direct media file, or a YouTube/social link via `yt-dlp`.
- **New service** (Dropbox, WeTransfer…) — the first time one is used, wire it: open the
  link in the in-app browser, find in its network requests how it lists files and serves originals,
  and add a `pull<Service>` to `tools/pull-media.mjs` on `pullAir`'s pattern (no key for a public
  share link, originals not previews, subfolders, `--dry-run`), route its links, add it to this list,
  and test it on that link. Then every later link from it just works. Off the maintainer's machine, the change is a PR (AGENTS.md).

```
node tools/pull-media.mjs --source "<link|path>" --out <cache dir>
```

Flags: `--help`. `catalog-media.mjs` calls this for links on its own; run it by hand only to gather reference assets
without cataloging them. Only pull what the source serves.
