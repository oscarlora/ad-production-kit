---
name: set-up-adpk
description: Install ADPK and get it ready — the setup script, the user's workspace and kie.ai key (checked before anything else), cloud storage, then the welcome. Use when the user asks to install or set up ADPK (e.g. "Install <its GitHub link>"), to finish setting it up, or when a workspace has no kie key yet.
---

# Set up ADPK

Work only in ADPK's folder. If this session opened anywhere else (a drive root such as `C:\` or `/`,
or any folder that isn't ADPK's), create nothing there.

1. **Install,** unless ADPK is already installed. It goes in `~/ad-production-kit`: ask whether they'd
   rather keep it elsewhere (e.g. in Documents or Projects), and tell them it lives in that folder for
   good: moving it later breaks it. On macOS or Linux,
   `curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash`
   (`… | bash -s -- <folder>` for another folder). On Windows,
   `powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.ps1 | iex"`
   (for another folder, set `ADPK_DIR=<folder>` in its environment first). If it stops, it says why
   and how to fix it: apply the fix (the user does what only they can, such as clicking Install) and
   run it again.
2. **The kie key, before anything else:** ask what to call their workspace (their company, or their
   own name when solo) and create `workspaces/<WS>/`. Ask for their kie key, walking them through the
   README's kie.ai steps (How to set it up), and write it to `.env` (from `.env.example`) as
   `<WS>_KIE_API_KEY=`; they may paste it in chat, or into the file if they prefer. Go on once
   `node tools/check-keys.mjs <WS>` says it works.
3. **Cloud storage (recommended):** a Cloudflare R2 bucket for the workspace keeps its media in the
   cloud: Studio streams it, and each computer keeps only light previews. Walk them through it:
   1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up) and open **R2 Object Storage**
      (it asks for a card; the first 10 GB are free each month).
   2. **Create bucket** (e.g. `<ws>-adpk`), and copy the **Account ID** from the R2 page.
   3. **Manage API tokens** ▸ **Create API token**: Object Read & Write, on that bucket only. Copy the
      **Access Key ID** and **Secret Access Key**.
   4. They paste the four into `.env` themselves (never in chat): `<WS>_R2_ACCOUNT_ID`,
      `<WS>_R2_ACCESS_KEY_ID`, `<WS>_R2_SECRET_ACCESS_KEY`, `<WS>_R2_BUCKET`. Go on once
      `node tools/sync-brand.mjs --brands <WS>` answers without an error.

   They may keep everything on this computer instead: tell them once that it's slower and fills the disk.
4. **Welcome:** show `tools/welcome.txt` word for word. If you're not running in ADPK's folder,
   ask them to reopen the agent there so it loads AGENTS.md.

Brand footage and files live inside `workspaces/`: **pull-media** and **catalog-media** bring outside
folders in. Everything else waits until a step needs it: Drive and Notion keys, and ffmpeg 8, Pillow,
yt-dlp, the export browser and Resemble Enhance (`fix-voice.mjs enhance` sets up its own gitignored
`tools/.venv-enhance` the first time; the tool that needs one says how to get it).
