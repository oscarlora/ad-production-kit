---
name: generate-voice
description: Design and generate natural voiceovers with Gemini 3.8 Flash TTS through tools/generate-voice.mjs. Use when an ad needs narration, dialogue, a voice take, a pronunciation correction, a pacing change, a designed speaker voice, or a voice isolated from music or re-voiced (ElevenLabs, or local DeepFilterNet).
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

## Isolate or re-voice (ElevenLabs, or local DeepFilterNet)

`tools/fix-voice.mjs` (`--help`) fixes a real speaker's voice. It needs `<WS>_ELEVENLABS_API_KEY`;
ask for it only when this fix comes up (they paste it into `.env`):

- **`isolate`** only when background noise gets in the way of the speech: the isolated voice with
  the original 18 dB under it, EQ'd and leveled per clip (ffmpeg's `afftdn` and RNNoise sound watery or
  miss music and other voices). With a key it uses ElevenLabs; with `--local`, or when there is no
  key, it runs **DeepFilterNet 3** on this computer (free, nothing uploaded, Mac Apple Silicon/Intel and
  Windows x64; `deep-filter` 0.5.6 downloads once into the gitignored `tools/bin/`, or run
  `install-local`). It extracts 48 kHz audio, runs `deep-filter -D` (delay-compensated, stays in sync)
  and works on a whole finished video: `isolate <final>.mp4 --out <dir> --local --remux --lufs -14`
  writes `<dir>/<name>.mp4` with the video stream copied. About 30 s for 9 min of audio. Local is
  strong on room noise, hum and hiss but **weak on music, other voices and heavy reverb**: use
  ElevenLabs for those.
- **`clone`** once per speaker, from their clearest clips in the same room; keep the voice id in the
  brand's `memory.md`.
- **`patch`** a word they mumbled or cut off (**review-ugc-footage**): isolation and Speech-to-Speech
  keep a mumble, so the clone re-says it where the mouth moves. Give the words they actually said (let
  the grammar decide, not a transcript's guess) and the words around them. The user picks the take by ear.

`POST /v1/speech-to-speech/<voice_id>` (`model_id=eleven_multilingual_sts_v2`) re-voices a whole take
with its exact delivery, when a clear guide recording exists.
