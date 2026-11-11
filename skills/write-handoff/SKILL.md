---
name: write-handoff
description: Optional. Write the short, conversational message that goes with a batch of ads (image, video, or both) when you send them to someone else — a client or a teammate — with the brand's review link. Two paths — a per-ad sample list, or a high-level note for a new batch dropped into a folder they already have. Also owns the package for a video handed to an editor instead of edited here. Solo users skip it.
---

# Write handoff

Pick the path that fits:

- **Sample list** — a first look or small set; one line per ad.
- **New batch drop** — a larger batch added to a folder they already have; high-level only.

Both are friendly, conversational, and concise. No em dashes.

## Inputs

- **Recipient name** (a `[name]` placeholder if unknown).
- **Media type** — say "image ads", "video ads", or "image and video ads", never "static image ads". "Ad" if there's only one.
- **Per ad** (sample list): **format**, **product**, **persona**, **angle** — from the ad's name (**write-prompt**) or the run.
- **Folder URL** (new batch drop).

## Path 1 — Sample list (one line per ad)

```
Hey [name],

Here are [N] sample [image / video / image and video] ads we put together for you.

1. [line for ad 1]
2. [line for ad 2]
...
```

- **One numbered list.** Never split under product headers; group same-product ads together.
- **Each line** is a natural sentence: **format first**, then product, who it's for, what it does:
  > A two-photo split-screen for Acme Focus, aimed at someone fighting neck and shoulder tension, showing how it delivers pinpoint relief right where it hurts.
- Vary the connectors (aimed at · for · speaking to · built for · showing how · leaning on · driving home · back to).

## Path 2 — New batch drop (high-level, one beat per line)

**Hyperlink the folder.** Each beat on its own line; no per-ad list, no offer, no product-page link.
Personas, angles, and formats are each a "from X to Y" sweep, never a full list.

```
Hey [name],

I just added [N] new [Product] ads to the [folder](folder link).

They span [K] personas, from [one persona] to [two or three more].

Each runs the angle that lands for that persona, from [one angle] to [two or three more].

Every ad is a different format, across [a sweep of the formats and styles].

If anything needs tweaking, let me know.
```

## Review link

Each brand has one review link: every approved ad, each version, why it was made, downloads, and comments on a spot
or a moment. Put it in the message: `node tools/share-ads.mjs <brand dir>` prints it (the first time, once per
workspace: `--deploy <WS>`, then set the `<WS>_SHARE_URL` it prints). It updates itself as ads are approved
(`record-ad.mjs --index`). Comments reach each ad's review loop (**edit-video**, `comments --wait`), so keep it
running on the ads they review; `--revoke` ends the link.

## Editor handoff (video)

When a video goes to an editor instead of being edited here, upload one folder (**upload-ads**) with
the clips in order, plus whatever the workflow made of frames, sheets, voiceover, script and
storyboard, and an **edit note**: the opening hook (the exact script line it must match), the clip
order, captions, zoom-in/zoom-out moments, the end card, music direction (trending,
copyright-free), and a little added noise and highlight/shadow play to reduce the AI look. Then
send it with a message above.
