# The All-in-One Ad Production Kit (ADPK)

Everything you need to make Meta ads with Claude, Codex or any AI agent: skills and tools to go from
idea to ready-to-launch ad.

This is for people who make ads:
- Creative strategists
- copywriters
- video editors
- designers
- business owners
- etc

And can be used on your own or in collaboration.

Built on what I ([@oscarlorak](https://x.com/oscarlorak)) learned making ads for ecommerce brands:
7+ years, 2,000 ads and $20M+ in ad spend.

## What you can do with it

- **Image ads:** static ads with high product fidelity, or animated GIFs.
- **Scripts:** for creators to film, or for any video.
- **Podcast video ads:** clips of AI characters that feel taken from a long-form podcast.
- **Song video ads:** animated characters singing a relatable story while selling your product.
- **Animated video ads:** animated characters speaking or acting out your script, in Pixar,
  claymation or any animation style.
- **Slides video ads:** a narrated explainer, one illustrated slide per line.
- **Motion graphics videos:** animated shapes, characters and text drawn in code; free to revise.
- **UGC edits:** a creator's footage checked against the script, then cut into the ad.
- **Short recuts:** sub-30 s versions recombined from a finished talking-head or UGC edit.
- **Replicated ads:** share an ad you like and get the same structure for your product, made from
  your own footage.

## How it works

Everything runs through your agent: say what you want in plain words.

1. **Research:** *"Research Acme's greens powder."* The agent collects the brand's pages, reviews,
   Meta ads, what people post about it, its top 3 competitors and any files you share, then writes up
   the brand, each product, its customers (personas) and why they buy (angles), the competitors, and
   the brand's look.
2. **Concept:** *"Make an image ad for Acme"* — or a script, or a podcast, song, animated,
   slides or motion graphics video ad, or *"make one like this"* with an ad to replicate. The agent offers 3 different
   concepts (persona, angle, hook); you pick one.
3. **Write:** hooks, script and on-screen copy.
4. **Make:** the design or storyboard, then images, voices, music and video clips. You see and
   approve each step before the next.
5. **Edit:** clips, captions, music and effects are cut into the final video. You watch it in the
   studio and click on the video to leave comments; the agent applies them while you watch, then exports.
   A creator's footage is first checked against the script. A finished talking-head edit can be recut into shorter ads from the same footage.
6. **Review and upload:** *"Open the studio"* — the local web app: **Board** (review ads),
   **Media** (search the library), **Swipe** (ads to replicate), **Workflow** (each ad's progress, its brief to edit live, and its edit), **Pages** (the brand's research to read). Approved ads are uploaded to
   Google Drive, Notion, or anywhere you set up (e.g. Dropbox). *"Share Acme's ads"* gives
   one review link for the brand: every approved ad, each version and why it was made; they download them and
   comment on a spot or a moment, and their comments reach the agent like yours. Anything you or a client want
   remembered goes into the brand's memory, so the next ads follow it.

**Working solo:** with cloud storage set up (recommended), your media lives in the cloud and Studio
streams it; say *"push Acme"* when you finish. Without it, everything stays on your computer.

**Working as a team:**

Teams share brands through cloud storage:

- At the start of every session: *"Update ADPK and pull Acme"* — the latest ADPK and the
  latest brand files. Updating never touches your brand work or `.env`.
- At the end of your work: *"Push Acme"*. The sync warns before overwriting someone's newer work.
- Share each workspace's `.env` block through a password vault, and propose ADPK changes as a
  pull request.

## How to set it up

ADPK works inside your AI agent: you talk to the agent, and it uses ADPK to make your ads.

1. **Open your AI agent.**
   - Claude: the **Code** tab of the [Claude app](https://claude.ai/download).
   - ChatGPT: the **Codex** tab of the [ChatGPT app](https://openai.com/chatgpt/download).
   - For others, it's the respective agent chat.
2. **Send it this message:** *Install https://github.com/oscarlora/ad-production-kit*

   It installs ADPK in a folder in your user folder (`ad-production-kit`), or one you pick, such as
   Documents. ADPK stays in that folder for good: don't move it. Click **Allow** when it asks to run
   the install. On a Mac, if a window asks to install Apple's command line tools, click **Install**.
3. **Get your kie.ai key and paste it in the chat when the agent asks.** [kie.ai](https://kie.ai) is
   the one service ADPK needs: through a single account it runs every AI model ADPK uses to make
   images, video, voices, music and sound effects. You pay as you go, with credits.
   1. Sign up at [kie.ai](https://kie.ai).
   2. Add credits on its billing page.
   3. Open [API Keys](https://kie.ai/api-key), create a key and copy it.
4. **Set up cloud storage (recommended).** A [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/)
   bucket keeps your brand's media in the cloud: the studio streams it, your computer keeps only light
   previews, and a team can share it. The agent walks you through it; you paste the four keys into
   the `.env` file yourself. You can skip it and keep everything on your computer, but that's slower
   and fills your disk.

Then say *"Let's make an ad for &lt;your brand's website&gt;"* or whatever you want to do.

**Mac app (optional, Claude only):** Studio and a chat with the agent in one window, on your Claude
subscription. Download the `.dmg` from [Releases](https://github.com/oscarlora/ad-production-kit/releases),
drag the app into Applications and open it: it installs ADPK when it's missing, and **Sign in to Claude…** in
its menu signs you in. It isn't signed by Apple yet, so the first time macOS blocks it: open System Settings ▸
Privacy & Security and click **Open Anyway**. To build it yourself: `cd desktop && npm install && npm run build`.

*For the AI agent:* install with
`curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash`
(on Windows,
`powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.ps1 | iex"`),
then follow [`skills/set-up-adpk/SKILL.md`](skills/set-up-adpk/SKILL.md) in the downloaded folder.

**Good to know**

- **Model:** on Claude, Opus 5.5 at medium effort (ADPK sets it for you); on ChatGPT, GPT-6.1 Sol at
  medium. For any other agent, use its top model at its recommended effort.
- **What the install adds:** ADPK itself, Node (runs ADPK's tools), ffmpeg (video and audio
  processing), whisper.cpp and its model (word timings for captions, 574 MB), git, and the catalog of
  a shared library of music, sound effects and references (each file downloads when an ad uses it).
  On a Mac it all goes in your user folder, with no admin password (git comes with Apple's command
  line tools). On Windows, Node, git and ffmpeg install through winget, which may ask to allow
  changes. On Linux, setup or the tool that needs it says what to install yourself (git, ffmpeg 8, a
  C++ compiler for captions).
- **Optional:** Google Drive and Notion uploads.
- ADPK runs on macOS, Windows and Linux.

## How it's organized

- [`AGENTS.md`](AGENTS.md) — the rules every agent reads first
- `skills/` — step-by-step procedures, one folder per skill
- `tools/` — the scripts the agent runs (each has `--help`)
- `studio/` — the local web app
- `desktop/` — the Mac app: Studio and the agent chat in one window
- `workspaces/` — your brands, never committed; local, or synced to the workspace's R2 bucket

## License

Do whatever you want with this. [MIT License](LICENSE).
