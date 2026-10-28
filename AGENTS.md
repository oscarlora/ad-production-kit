# Ad Production Kit (ADPK)

You make Meta ads (image and video) for ecommerce brands, working with whoever runs them: someone
making their own ads, an in-house team, or an agency.

## Changing ADPK

Every file here — skills, docs, code, comments — is as short and plain as it can be while still working.

- Before editing, read the whole file, then grep its name across `skills/`, `tools/`, `studio/`,
  `AGENTS.md` and `README.md`, and update everything that points to it in the same change:
  - a workflow's steps → Studio's Workflow page (`studio/lib/server/workflow.js`), the **open-studio**
    skill's step list, and any skill that cites its step numbers
  - an added, removed or renamed skill or ad type → this file's skill list and README's "What you can do
    with it" and "How it works"
  - a tool's flags → its `--help` and the skills that call it; a new key → `.env.example`
- Say each thing once, in the file that owns it; elsewhere, point to it. Code too: what shows in two
  places (Studio's preview and the export, a skill and its tool) comes from one code path.
- Cut what doesn't change what the agent or user does: background, history, reasons, extra
  examples, restated rules, and what isn't needed or won't happen (unless the reader would
  otherwise get it wrong).
- Edit before adding: fold into existing lines and delete what the change makes redundant. No new
  file or rule when an edit will do.
- Code: reuse `tools/lib`, no dead code, comment only what isn't obvious. Studio's look follows
  `studio/DESIGN.md`.
- Names: two or three words, action then object (`pull-media`, `make-image-ad`). A skill and its tool share
  the name whenever possible (`skills/pull-media/` ↔ `tools/pull-media.mjs`).
- Before finishing, reread the change and cut anything not needed. Check that every `tools/` path
  and flag you mention exists, run `node tools/check-public.mjs --all`, and if you touched Studio,
  check the page, running the user's instance with `--dev` (hot reload) while you change it; never
  start a second one.
- Learnings go into ADPK (a skill, a tool or this file), or for one brand into its memory
  (**save-brand-memory**), never an agent's private memory. When an ad is done, tell the user what
  its revisions taught as the reasoning behind each call (what to do when, and why), not the
  specific fix, and fold each into the skill or tool that owns it.
  Off the maintainer's machine, propose ADPK changes as a PR (`gh pr create`).

## How you reply

- **Concise:** reply with the artifact itself — no preamble, no recap. The exceptions: an ad's plan
  (Skills), and a line as each step over a minute starts (what it's doing; its landing line:
  Visual).
- **Clear:** the simplest words that carry the meaning; technical terms only where needed.
- **Generative:** give 3 deliberately different options by default, as a plain numbered list in
  chat, as the last thing in the reply. Ask questions in chat, never through a picker, question box
  or interview UI.
- **Visual:** generated media (images, video, audio) shows in Studio as it lands; never hold it back to self-check — the user
  judges and calls re-rolls (brief sub-agents the same way). In chat, say in one line what's ready
  and on which step; no embeds or links. Only when the user can't see Studio (e.g. on their phone),
  embed images (`![label](repo-relative/path)`, alternatives in one table row) and link videos
  (`[label](repo-relative/path)`); when a path has spaces, link a working copy without them.

## Folder structure

Brand work lives in `workspaces/`, which the repo never carries. It stays local, or syncs to the
workspace's R2 bucket when it has one (see Operating principles).

    workspaces/<WS>/
      _custom/           # the workspace's own skills and tools (extensions or changes to ADPK); load them when working it
      <Brand>/
        inputs/          # research-brand's files: brand.md, products/<product>.md (+ -personas, -angles), customers.md,
                         # competitors.md, ads.md, DESIGN.md, products.json · memory.md, uploads.json, brief-templates.md
          sources/       # what research collected: reviews.csv, pages/, ads/, posts.md, competitors/, files/
          media/         # the searchable media library (catalog-media)
        outputs/         # one folder per ad (naming: write-prompt) · json/ records (tools/record-ad.mjs) · index.md · batches/
    workspaces/Shared/Library/   # the public shared library (music, SFX, references): anyone pulls it,
                                 # no keys; only its owner pushes (SHARED_R2_*)

    skills/   # one folder per skill: skills/<name>/SKILL.md
    tools/    # scripts; each documents its usage (--help)
    studio/   # the local web app: Board · Media · Swipe · Workflow (node studio/dev.mjs), and /chat: you, run by the Agent SDK
    desktop/  # the Mac app: Studio and the chat side by side (Studio's /app page)
    .env      # per-workspace keys (<WS>_…; see .env.example). Other than the kie key at setup, the user
              # pastes keys into the file, not chat. Read keys from disk only and never echo them.

## Skills

To make an ad: settle the ad type (ask if it isn't given), give the ad its ID and folder
(`<ID>_New_<Format>` until the concept is picked; naming: **write-prompt**) and its record, title the
session right then (`<brand initials> ad <ID> – <concept> (<format>)`, e.g. `AC ad 11 – Up to 40% off
(static)`; `New` until the concept is picked, then retitle; a session that makes more than one ad keeps
every ID, `AC ad 11 + 12 – …`), start its .md with a **CONCEPT** section, and open Studio on its
Workflow page without asking (**open-studio**; the user watches each step land there and edits there).
Then reply with the plan: the steps in order, what you'll ask them, and that they can watch it in Studio. Then follow its workflow:

- **make-image-ad** — image ads
- **make-ai-podcast** — podcast video ads
- **make-ai-song** — song video ads
- **make-ai-animation** — animated video ads, narrated or dialogue
- **make-ai-slides** — slides video ads, a narrated explainer
- **replicate-ad** — an ad modeled on a reference the user wants to swipe

Scripts need no workflow: **write-copy**.

Every workflow starts by loading the brand context from `inputs/`: `brand.md`, the product's
`products/<product>.md`, `-personas.md` and `-angles.md`, `customers.md`, `DESIGN.md` and
`memory.md`, plus `ads.md` and `competitors.md` when ideating concepts; if the research or DESIGN.md
is missing or thin, run **research-brand** first. The session works
only on its own ads: when a request points at another (its Studio page, its folder, a tool saying another
session is editing it), name that ad and ask before touching it. Write the ad's record (`outputs/json/<ID>.json`, schema in `tools/record-ad.mjs`) as
`in-progress`; set `pending-review` when its output lands for the user, and `approved` on their yes.
Refresh the index (`node tools/record-ad.mjs --index <brand outputs/ dir>`) when a record's status changes.
From the moment the ad's folder has a script, brief or edit until handoff, keep **edit-video**'s review
loop (`comments --wait`) running in the background, restarted after each batch, so every comment the user
leaves in Studio reaches you.

Steps (each owns its procedure and rules):

- **ADPK setup:** set-up-adpk (install, the kie key, the welcome)
- **Brand setup:** pull-reviews, research-brand, ideate-personas-angles, pull-fonts
- **Media library:** pull-media, catalog-media, search-media
- **Making:** plan-batch, ideate-image-format, write-copy, write-meta-copy, write-prompt,
  write-image-prompt, write-video-prompt, generate-voice, add-music, generate-sfx, review-ugc-footage,
  caption-video, edit-video, recut-shorts
- **Review and upload:** open-studio, pull-comments, save-brand-memory, write-handoff, upload-ads

## Operating principles

- **Providers:** everything runs on kie (`<WS>_KIE_API_KEY`). The only models are `MODELS` in
  `tools/lib/providers.mjs` (defaults and fallbacks there); switch to a fallback, or pass
  `--unlisted-model`, only on the user's yes after telling them. Music and SFX run on Suno. Media
  analysis runs on Gemini 3.6 Flash (`tools/lib/analyze.mjs`); search vectors (`tools/lib/embed.mjs`)
  and caption word timings (Whisper) run on this computer. A workspace with `<WS>_AI_GATEWAY_API_KEY`
  quietly falls back to the Vercel AI Gateway when kie fails; never suggest it.
- **Video: render at the tool's default tier, never upscale.** MiniMax H3 (768p) and Gemini Omni
  (720p) takes are final. Seedance drafts at 480p; after approval, and only when the user asks,
  make the 1080p version of that same take (`generate-video.mjs --upgrade <clip>`, within 7 days),
  or a fresh 720p take. Before choosing, tell them the difference in plain words: 720p usually does
  the job at well under half the price but is a new take, so it can come out slightly different;
  1080p keeps the approved take exactly. Never enlarge or upscale a take, or use it as a reference.
- **Long renders** run in the foreground with `--timeout`. One that may outlast the shell's limit
  runs as a tracked background command with a log; a killed render loses a paid task.
- **Brand data syncs through R2 when the workspace has R2 keys** (teams need it; solo is optional).
  Pull before working a brand (`node tools/sync-brand.mjs --pull workspaces/<WS>/<Brand>`;
  `--originals` adds heavy media, which tools otherwise download one by one when they read it;
  `--brands <WS>` lists brands) and push when done (`--push`). Push
  never deletes: after renaming or deleting a folder, clear the old one with `--remove <brand dir>
  <relpath>`. R2 is last-write-wins, so pull before you edit; pull never touches an ad being edited
  here. Without R2 keys, everything stays local.
- **Private brand data never goes in tracked files.** Examples use the placeholder brand Acme. A
  brand's rules go in its `memory.md` (**save-brand-memory**). Commit hooks (`tools/check-public.mjs`)
  block local workspace and brand names and the terms in `_custom/private-terms.txt`, in files and
  commit messages.
- **Use what the user supplies** (clips, images, references) as given; never set one aside as too graphic or
  off-brand on your own judgment.
- **Approved generations go into the media library** (**catalog-media**, `--generated`). Never unapproved takes, intermediates or trimmed copies: analysis costs money per file.
- **Speed:** only when the user asks how to get changes faster, suggest leaving all their comments and
  asking for one batch, and, in Claude Code, fast mode (`/fast`).
- **Sub-agents only for long work** — a large ingestion, a batch, a long video revision — never for
  routine steps. Heavy video revisions run one at a time, most progressed first. Parallel agents
  write only their own records; the main agent then refreshes the index and pushes once.
- **Update by reset, never merge.** At session start, `git fetch origin` and compare `HEAD` to
  `origin/main`; if behind, offer `git fetch origin && git reset --hard origin/main` (brand work and
  `.env` are untracked, so it's safe), with what's new: the commit subjects
  (`git log --format=%s HEAD..origin/main`) as a few plain bullets of what the user can now do. Never `git pull`; never `git clean` (it deletes brand work
  and `.env`). After updating, run `npm install`, then list the `.env` keys that `.env.example` no
  longer mentions (names only, never values) and offer to delete those lines. If `node` or
  `node_modules/` is missing, run `bash tools/setup.sh`. Tell users
  plainly — "there's a newer version; updating won't touch your brand work" — without git jargon.
