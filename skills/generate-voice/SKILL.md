---
name: generate-voice
description: Design and generate natural voiceovers with Gemini 3.8 Flash TTS through tools/generate-voice.mjs. Use when an ad needs narration, dialogue, a voice take, a pronunciation correction, a pacing change, a designed speaker voice, or a voice isolated from music or re-voiced (ElevenLabs), or restored to a pro-mic sound (local Resemble Enhance).
---

# Generate voice

`tools/generate-voice.mjs` sends a `--script-file` with one or two speakers to **Gemini 3.8 Flash
TTS** on kie. Three or more speakers: generate each pair or voice separately and join them in the edit.

## Design the voice

Pick a prebuilt voice per speaker (`--help`), then describe it:

- where the speaker grew up and their accent, first and outright, with two or three concrete
  features of that accent (otherwise the model guesses from the name, face or setting);
- age and speaker persona;
- register and timbre;
- pace and rhythm;
- intonation and sentence endings;
- energy;
- one or two natural quirks (light vocal fry, small breaths). When the same description is pasted
  into many generations, keep only what must sound the same every time (accent, pitch, timbre, pace,
  energy); write a one-off sound (a gasp, a laugh) into the one line that needs it.

Describe natural human behavior, not vague labels like "conversational": speaks like a friend
explaining something across a table; takes small breaths at thought breaks; never sounds like an
announcer.

Prompt structure (for `generate-voice.mjs`, voice and delivery go in the `description`, the script
in the `--script-file`):

```text
voice:
A woman in her mid-30s with a low, warm alto voice and a General American accent.

delivery:
Natural and connected, with calm confidence, falling sentence endings, small breaths at thought
breaks, and no announcer cadence. About 4 words per second.

script:
The exact spoken copy goes here.
```

The script is verbatim; never cut or paraphrase the spoken copy. A one-off sound goes in the line as a
Gemini tone tag (`<laugh>`, `<sigh>`, `<short pause>`).

## Pronunciation

Write difficult words phonetically in the script itself (`tee-ong`, `ex-tah`), not only in a note.
Regenerate when it comes out wrong.

## Generate

```bash
node tools/generate-voice.mjs \
  --script-file workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-script.txt \
  --voice-name Kore \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-a.mp3
```

Labeled dialogue (`--voices-file`) and every other flag: `--help`. Keep earlier takes with `-a`, `-b`, `-c` suffixes.

Check every take before it reaches the user: its length against the planned pace (a calm, soothing
delivery comes out about 20% slower than the words per second asked; ask faster, then trim pauses over
0.5 s), and one voice throughout (a take can drift into another timbre mid-file: compare pitch across it).

## Isolate, enhance or re-voice (ElevenLabs, or local Resemble Enhance)

`tools/fix-voice.mjs` (`--help`) fixes a real speaker's voice. `isolate`, `clone` and `patch` need `<WS>_ELEVENLABS_API_KEY`;
ask for it only when this fix comes up (they paste it into `.env`):

- **`isolate`** only when background noise gets in the way of the speech: the isolated voice with
  the original 18 dB under it, EQ'd and leveled per clip (ffmpeg's `afftdn` and RNNoise sound watery or
  miss music and other voices). Works on a whole finished video too: `isolate <final>.mp4 --out <dir> --remux --lufs -14` writes
  `<dir>/<name>.mp4` with the video stream copied. No key: use `enhance`.
- **`enhance`** for a "pro mic" sound, and the no-key path: **Resemble Enhance** runs on this
  computer (free, nothing uploaded, Mac and Windows, Python 3.10/3.11), denoises, removes room tone and
  rebuilds a full-band voice, leveled to `--lufs` (-14 default). `enhance <final>.mp4 --out <dir> --remux`
  writes `<dir>/<name>.mp4` with the video stream copied. Heavy (~2x real time on 8 CPU cores): run it
  when the computer is idle or on a spare machine. The first run creates the gitignored
  `tools/.venv-enhance` and downloads the model (~1 GB).
- **`clone`** once per speaker, from their clearest clips in the same room; keep the voice id in the
  brand's `memory.md`.
- **`patch`** a word they mumbled or cut off (**review-ugc-footage**): isolation and Speech-to-Speech
  keep a mumble, so the clone re-says it where the mouth moves. Give the words they actually said (let
  the grammar decide, not a transcript's guess) and the words around them. The user picks the take by ear.

`POST /v1/speech-to-speech/<voice_id>` (`model_id=eleven_multilingual_sts_v2`) re-voices a whole take
with its exact delivery, when a clear guide recording exists.
