#!/usr/bin/env node
// generate-sfx.mjs — isolated sound effects with Suno Sounds on kie.ai, or ElevenLabs on sunra.ai
// (two takes per run).

import { die, parseArgs, usage } from './lib/catalog.mjs';
import { blocked, envHelp, errorText, runHelp, runOpts, sunraJob, times, writeSidecars } from './lib/providers.mjs';
import { runSuno, SUNO_MODELS } from './generate-music.mjs';

const KEYS = ['Any', ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].flatMap((k) => [k, `${k}m`])];
const ISOLATE = 'Isolated sound effect only: no music, no speech.';

const HELP = `generate-sfx.mjs — sound effects with Suno Sounds (kie.ai); each run gives two takes

  node tools/generate-sfx.mjs --prompt "<sound>" --out <sfx.mp3>

Required:
  --prompt "<text>"        The literal sound: source, action, texture, space and length. Suno sets the
                           length from it (2–8 s seen). Max ${500 - ISOLATE.length - 1} chars (the tool adds a no-music note)
  --out <path>             Output audio path under workspaces/<Workspace>/...

Optional:
  --model <name>           V6 (default) | V6_MINI | V6_WILD (bolder); same price
  --loop                   Loops seamlessly (ambience, room tone)
  --tempo <bpm>            1–300 (default automatic)
  --key <key>              Any (default) | C | Cm | C# | C#m … B | Bm
${runHelp(600, { num: 'Runs (default 1); each gives two takes (<out>, <out>_2)', unlisted: false,
  providers: 'sunra: ElevenLabs (max 450 chars; no --loop, --tempo, --key). No Gateway' })}

${envHelp()}`;

const args = parseArgs(process.argv.slice(2), { flags: ['loop'], help: HELP });
if (!args.prompt) usage(HELP);
if (!args.out) die('--out is required');
const prompt = `${String(args.prompt).trim()} ${ISOLATE}`;
if (prompt.length > 500) die(`prompt is ${prompt.length - ISOLATE.length - 1} chars; the limit is ${500 - ISOLATE.length - 1}`);
const model = String(args.model || 'V6').toUpperCase();
if (!SUNO_MODELS.includes(model)) die(`--model must be one of ${SUNO_MODELS.join(', ')}, got: ${args.model}`);
const tempo = args.tempo ? Number(args.tempo) : undefined;
if (tempo !== undefined && !(Number.isInteger(tempo) && tempo >= 1 && tempo <= 300)) die(`--tempo must be a whole BPM from 1 to 300, got: ${args.tempo}`);
const key = args.key ? KEYS.find((k) => k.toLowerCase() === String(args.key).toLowerCase()) : undefined;
if (args.key && !key) die(`--key must be one of ${KEYS.join(', ')}, got: ${args.key}`);

const input = { prompt, model, sound_loop: !!args.loop, sound_tempo: tempo, sound_key: key };
const { num, timeout } = runOpts(args, 600);
// sunra has no Suno Sounds: ElevenLabs, one take per call.
const text = String(args.prompt).trim();
const sunra = async () => {
  if (args.loop || tempo || key) throw blocked('ElevenLabs on sunra takes no --loop, --tempo or --key.');
  if (text.length > 450) throw blocked('ElevenLabs on sunra takes prompts up to 450 characters.');
  return times(num * 2, async () => [{ url: (await sunraJob('elevenlabs/sound-effects/text-to-sound-effects', { text }, timeout)).audio.url }]);
};
try {
  const { takes, provider } = await runSuno({ name: `suno-sounds-${model}`, kie: ['ai-music-api/sounds', input], sunra, provider: args.provider, num, timeout, out: args.out });
  await writeSidecars(takes.map((t) => t.file), {
    tool: 'generate-sfx', model: provider === 'sunra' ? 'elevenlabs-sound-effects' : `suno-sounds-${model}`, provider, prompt: args.prompt,
    params: { loop: args.loop || null, tempo, key },
  });
} catch (e) { die(errorText(e)); }
