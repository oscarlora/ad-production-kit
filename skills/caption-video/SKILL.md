---
name: caption-video
description: Build the captions and hook text of a video edit — transcribe the cut to word timestamps, group them into caption lines with tools/edit-video.mjs captions, and style them (plain, karaoke, lyric, word by word). Use when a video ad needs captions or subtitles, someone asks for CapCut-style, karaoke, lyric or word-by-word captions, or burned-in text timed to speech, or when edit-video needs its captions.
---

# Caption video

Captions are a `captions` clip in the ad's edit document (**edit-video**): word-timed lines plus a
style. Time from the rendered audio, not the script.

## 1. Transcribe

`node tools/transcribe-media.mjs --in <voiceover or cut> --words` → word timestamps (flags in `--help`).
A song uses its Suno timing file (`<out>.timing.json` from `tools/edit-song.py`, e.g.
`music/song-final.mp3.timing.json`; **make-ai-song**).

- Words run on the **timeline clock**: a voiceover placed at 0 already is; otherwise transcribe an
  export of the cut.
- Words and their times come from local Whisper (`whisper-cli`, installed by setup); they replace
  Gemini's transcript text. **No kie key** for the
  transcript (the tool exits with a SKIP)? Use line-level timing: find the speech bounds
  with `ffmpeg`'s `silencedetect`, spread the script's lines across them as caption lines without
  word times, and tell the user the timings are approximate.

## 2. Group into lines

`node tools/edit-video.mjs captions <edit.json> --words <transcript> [--max 3] [--from <hook end>]`
breaks at punctuation, pauses and the word limit, and writes the lines into the Captions track.
Then fix by hand:

- **One idea per line.** Group by phrase, not count; the limit is a maximum, and a line never carries
  a word from the next idea ("steady energy" | "deeper sleep"). Split a long phrase where it still
  reads ("from" | "the root cause").
- **Text from the brand, timing from the transcript.** On-screen text follows **write-copy** and the
  brand's spellings and product names even when the spoken line differs: fix transcript errors and
  casing, keep the times. A transcript can mishear: check a doubtful word against the audio
  (re-transcribe that stretch), never against the script, since speakers go off-script.
- `--max 1` makes word-by-word captions.

## 3. Style

Two styles, lower-center (center `y` about 1150 on 1920); deviate only with a reason. Any Google font by
name (`Archivo Black` for a heavier look).
- **Outlined** (the default): Inter 700, white, black `stroke` with `strokeWidth` 5, a soft shadow.
- **Boxed** (Instagram's own text style): Inter 700 at 50, `#111111` on
  `background: { color: "#FFFFFF", padX: 28, padY: 16, radius: 18 }`; each line gets its own box, joined
  with rounded inner corners. A key phrase gets a yellow (`#FFD60A`) box of its own laid over it.
- **Karaoke / lyric:** `active` styles the word being said (`color`, `scale` 1.2–1.3), `upcoming`
  the words still to come (`opacity` 0.5; 0 reveals them word by word); `enter: "pop"` per line.
- **Hook** (the opening on-screen line): a `text` clip in the caption style, no entrance animation,
  at most 2 lines (smaller text, or trimmed wording, before a third), `{braces}` around the whole phrase
  that carries the message in the accent color ("{my belly just keeps growing}", not just its tail; a
  list as one span, commas and "and" included), ideally its own line. It sits above the
  speaker's head when there's room inside the safe area (**edit-video**, Text), else just under the
  chin — always clear of the face, the product and the scene's key object in every shot it spans
  (check a frame from each) and stays put through zooms. Captions start only after the hook
  ends; the two never show at once. The same holds for any other on-screen text (a stat, a list,
  slapped words, a badge): no captions under it, and it covers the whole sentence it belongs to
  ("Heavy periods hit 1 in 4 women over 41", not just "1 in 4"), so no words go missing around it.
  It sits where the captions sit unless that covers the face, the product or the shot's key object.
- **Key words:** the few words that carry the ad take the accent color in the captions (a fourth
  `color` element on the word), first mention only.
- A workflow may set its own font and placement (song, slides); these rules still apply.
- **Brand font** (from `inputs/DESIGN.md`) only when a licensed font file exists in `inputs/media/brand/`: map it in the
  document's `fonts`. Never hunt the web for a brand's commercial font.
