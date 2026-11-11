---
name: review-ugc-footage
description: Review a creator's delivered UGC footage against the script before editing — download and catalog it, check every scene is there, says the scripted message, fits the safe zones and shows the product right, lay it out on the ad's Footage step in Studio with an approve-or-reshoot verdict, then on approval go straight to the edit. Use when a creator sends their footage (an Air, Drive or folder link) or the user asks whether a delivery is good to approve.
---

# Review UGC footage

## 1. Download and catalog

```
node tools/pull-media.mjs --source "<delivery link>" --out workspaces/<WS>/<Brand>/outputs/<ad>/footage
node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> --source workspaces/<WS>/<Brand>/outputs/<ad>/footage
```

Straight from the link (Air short links work); no dry run. Files keep the creator's names (`Body 3.mov`).
The catalog's one Gemini pass (**catalog-media**) gives each clip the analysis and word-timed
transcript the review reads, and puts it in the media library for later ads.
A reshot take replaces the old one: delete the old file, then catalog the folder again.

## 2. Check against the script

Per clip, all clips at once: its library record (`inputs/media/_catalog/json/<id>.json`, the one whose
`file.original` is the clip's name) for what is said and shown, a sheet of its start, middle and end
frames (ffmpeg) with the 4:5 crop and the Reels UI zone drawn (zones in **edit-video**, Text), and its
levels (`ffmpeg -af volumedetect`). Then read the brief (`outputs/<ad>/<ID>_<initials>_V1_….md`): every hook, body line, CTA and
B-roll needs a clip, except scenes marked “(Optional)” (EDITOR CLIPS are the editor's, and Studio leaves them out). Run every clip through the checklist, the same one Studio shows:

1. **line** — says the scripted line, or the same message in the creator's words. Fails on a changed
   meaning, a missing or added claim, a product fact said wrong ("chicken broth" for "bone broth"), a
   line cut off at the start, or one said twice across clips.
2. **action** — does the scripted action, or one that reads the same.
3. **framing** — face and product inside the 4:5 crop, above the Reels buttons; the label reads the
   right way round (front cameras mirror it) and in focus.
4. **audio** — clear and easy to understand: every word transcribed and none swallowed (a word ~6 dB
   under the rest of its line, like a mumbled "already", fails: pick a clearer take or patch it), no
   clipping (max under 0 dB), no noise over the voice.
5. **file name** — named after the scene, as the brief asks. Studio checks this one.

## 3. Verdict

Write `outputs/<ad>/footage.json`; Studio shows it on the ad's **Footage** step:

```json
{
  "clips": {
    "Hook 1": {
      "file": "footage/Hook 1.mov",
      "id": "00042",
      "checks": {
        "line": { "ok": false, "note": "Said “most women”, which overclaims. Reshoot.", "reshoot": true },
        "action": { "ok": true }, "framing": { "ok": true }, "audio": { "ok": true }
      }
    }
  }
}
```

Keys are the brief's Scene names (`Hook 1`, `Body 3`, `B-roll 2`); paths are relative to the ad
folder; `id` is the clip's library record. A note is the check's short verdict, naming every difference, not repeating what was asked:

- A failed check gets a note; add `reshoot: true` when the edit can't fix it.
- A passed check that differs gets a note ending "Still works." One that matches needs none.

In chat: good to approve, or which scenes need a reshoot.

The user comments on each check (a comment's `quote` is the scene, `check` the point), ticks or
unticks it, Approves a scene (ticks all) or calls a Reshoot (a scene comment reading `Approved` or
`Reshoot: <what to change>`), all through **edit-video**'s review loop. Act on each comment (e.g. keep
a line in the edit), set that check's tick in `ticks` when the comment settles it ("this is ok" →
`true`), and reply; leave the check's note as it is. List the reshoots for the creator, with any file to rename.
Don't edit before every scene is approved, or the user says yes in chat.

Fixes the edit can make, so they need no reshoot:

- **The reach for the phone** at each clip's start and end, and phone taps: each clip starts on its
  first word and ends on its last; wordless sound is dropped.
- **Repeats and filler openers** ("Let me explain" twice, a stray "Okay"): cut.
- **A missing, clipped or mumbled word:** the creator's cloned voice re-says it (`tools/fix-voice.mjs patch`,
  **generate-voice**) over B-roll, or over their own face when it's only a word or two.
- **A mirrored label:** flip **every** clip of that camera in place (`ffmpeg -vf hflip` into a temp
  file, then replace the clip), so the creator never jumps sides between cuts.

## 4. Edit

Then build the edit in **edit-video** straight away: one document per hook (`edit.json` with Hook 1, hook versions on it for the
others), from the files in `footage.json` (`tighten` reuses their library transcripts), with the fixes above,
what the user's comments asked for, and the brief's storyboard (style: **edit-video**, Pick the style).
