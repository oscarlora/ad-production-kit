---
name: set-up-adpk
description: Install ADPK and get it ready — the setup script, the user's workspace and kie.ai key (checked before anything else), then the welcome. Use when the user asks to install or set up ADPK (e.g. "Install <its GitHub link>"), to finish setting it up, or when a workspace has no kie key yet.
---

# Set up ADPK

1. **Install,** unless you already run in ADPK's folder: on macOS or Linux,
   `curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash`
   (into `~/ad-production-kit`; `… | bash -s -- <folder>` for a folder they pick). On Windows, clone
   the repo (`winget install Git.Git` if git is missing) and run
   `powershell -ExecutionPolicy Bypass -File tools\setup.ps1`. If it stops, it says why and how to fix
   it: apply the fix (the user does what only they can, such as clicking Install) and run it again.
2. **The kie key, before anything else:** ask what to call their workspace (their company, or their
   own name when solo) and create `workspaces/<WS>/`. Ask for their kie key, walking them through the
   README's kie.ai steps (How to set it up), and write it to `.env` (from `.env.example`) as
   `<WS>_KIE_API_KEY=`; they may paste it in chat, or into the file if they prefer. Go on once
   `node tools/check-keys.mjs <WS>` says it works.
3. **Welcome:** show `tools/welcome.txt` word for word. If you're not running in ADPK's folder,
   ask them to reopen the agent there so it loads AGENTS.md.

Everything else waits until a step needs it: R2 (a team needs it to share brands; solo is optional),
Drive and Notion keys, and ffmpeg 8, Pillow, yt-dlp, the export browser and Resemble Enhance (`fix-voice.mjs enhance` sets up its own gitignored `tools/.venv-enhance` the first time; the tool that needs one
says how to get it).
