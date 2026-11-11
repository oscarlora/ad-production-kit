#!/usr/bin/env node
// generate-voice.mjs — generate voiceovers on kie.ai (models: tools/lib/providers.mjs MODELS).
// Each saved file gets a <stem>.gen.json sidecar.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { die, parseArgs, usage } from './lib/catalog.mjs';
import {
  blocked, envHelp, errorText, fetchResult, gatewayClient, kieJob, logGatewayWarnings, pickModel, runHelp, runOpts, runProviders, saveResults,
  sunraJob, times, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

const HELP = `generate-voice.mjs — voiceover generator (kie.ai)

  node tools/generate-voice.mjs --script-file <vo.txt> --voice-name Kore --out <vo-A.mp3>

Required:
  --script-file <path>     One "LABEL: text" line per spoken line, in order; blank lines and
                           #-comments are skipped
  --out <path>             Output audio path

Optional:
  --model <name>           gemini-3.8-flash-tts (default; the only one): 1-2 speakers
  --voice-name <v[,v]>     A prebuilt voice per speaker, in order of first line (default Kore, then
                           Puck; 70 voices, e.g. Kore, Puck, Charon, Zephyr, Leda). A voices-file voice wins
  --voices-file <path>     Each character once (format below)
  --format <ext>           mp3 (default) | wav
${runHelp(600, { providers: 'sunra: 30 of the voices, 5,000 characters. Gateway: one speaker' })}

Lines may carry Gemini tone tags in angle brackets (<laugh>, <sigh>, <short pause>, <whispers>, ...).

Voices file: one block per character:
  [HOST]
  description: A 50-year-old American woman, warm and slightly husky, unhurried.
  voice_name: Kore
  The description is sent as the style of each of that speaker's lines.

${envHelp()}`;

const KEYS = { description: 'description', voice_name: 'voiceName' };
// The voices sunra's Gemini TTS takes.
const SUNRA_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima',
  'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

function parseVoicesFile(text) {
  const profiles = {};
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^:\]]+)\]$/);
    if (header) { current = header[1].trim().toUpperCase(); profiles[current] = {}; continue; }
    if (!current) die(`voices-file line outside any [LABEL] block: ${line}`);
    const kv = line.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    const key = kv && KEYS[kv[1].toLowerCase()];
    if (!key) die(`voices-file line is not "[LABEL]" or ${Object.keys(KEYS).join(' / ')}: value: ${line}`);
    profiles[current][key] = kv[2].trim();
  }
  if (!Object.keys(profiles).length) die('voices-file produced no [LABEL] profiles');
  return profiles;
}

function parseScript(text) {
  const turns = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const turn = line.match(/^([^:[\]]+):\s*(.+)$/);
    if (!turn) die(`script line is not "LABEL: text": ${line}`);
    turns.push({ label: turn[1].trim().toUpperCase(), text: turn[2].trim() });
  }
  if (!turns.length) die('the script has no spoken lines');
  return turns;
}

// Models return their own format (Gemini TTS: 24 kHz mono WAV), so convert to --format here.
function transcode(audio, want) {
  const have = audio.format === 'mpeg' ? 'mp3' : audio.format;
  if (!have || have === want) return { bytes: audio.bytes, ext: have || 'mp3' };
  const args = ['-v', 'error', '-i', 'pipe:0', ...(want === 'mp3' ? ['-b:a', '192k'] : []), '-f', want, 'pipe:1'];
  const r = spawnSync('ffmpeg', args, { input: Buffer.from(audio.bytes), maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) {
    console.error(`WARN: could not convert ${have} to ${want} (${r.error?.message || r.stderr?.toString().trim()}) — saving ${have}.`);
    return { bytes: audio.bytes, ext: have };
  }
  return { bytes: r.stdout, ext: want };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { help: HELP });
  if (!args['script-file']) usage(HELP);
  if (!args.out) die('--out is required');
  const { W } = workspaceKeys(args.out);

  const entry = pickModel(args, 'speech', 'gemini-3.8-flash-tts');
  const characters = args['voices-file'] ? parseVoicesFile(await readFile(resolve(String(args['voices-file'])), 'utf8')) : {};
  const scriptText = await readFile(resolve(String(args['script-file'])), 'utf8');
  const turns = parseScript(scriptText);
  const speakers = [...new Set(turns.map((t) => t.label))];
  const format = String(args.format || 'mp3').toLowerCase();
  if (!['mp3', 'wav'].includes(format)) die(`--format must be mp3 | wav (got "${format}")`);
  const { num, timeout } = runOpts(args, 600);
  const voiceNames = String(args['voice-name'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const fetchAudio = async (url) => { const { bytes, ext } = await fetchResult(url); return transcode({ bytes, format: ext || 'wav' }, format); };

  if (speakers.length > 2) die(`${entry.name} takes at most 2 speakers (got ${speakers.length}: ${speakers.join(', ')}).`);
  const voiceOf = (label) => { const i = speakers.indexOf(label); return characters[label]?.voiceName || voiceNames[i] || ['Kore', 'Puck'][i]; };
  if (speakers.length === 2 && voiceOf(speakers[0]) === voiceOf(speakers[1])) die(`both speakers resolve to voice ${voiceOf(speakers[0])} — give each a different voice.`);
  const id = (label) => `Speaker ${speakers.indexOf(label) + 1}`;
  const input = {
    speakers: speakers.map((l) => ({ speaker_id: id(l), voice_name: voiceOf(l) })),
    dialogue_turns: turns.map((t) => ({ speaker_id: id(t.label), text: t.text, ...(characters[t.label]?.description ? { style: characters[t.label].description } : {}) })),
  };
  const runKie = async () => {
    console.error(`kie       ${entry.kie}  voices=${input.speakers.map((s) => s.voice_name).join(',')}  turns=${turns.length}`);
    return Promise.all((await times(num, () => kieJob(entry.kie, input, timeout))).map(fetchAudio));
  };
  // One speaker: text-to-speech; two: text-to-dialogue, a turn per line.
  const runSunra = async () => {
    const odd = speakers.map(voiceOf).filter((v) => !SUNRA_VOICES.includes(v));
    if (odd.length) throw blocked(`sunra has no voice ${odd.join(', ')}.`);
    if (turns.reduce((n, t) => n + t.text.length, 0) > 5000) throw blocked('sunra takes up to 5,000 characters of script.');
    const style = (label) => characters[label]?.description || undefined;
    const [op, body] = speakers.length === 1
      ? ['text-to-speech', { text: turns.map((t) => t.text).join('\n'), voice: voiceOf(speakers[0]), style: style(speakers[0]) }]
      : ['text-to-dialogue', { inputs: turns.map((t) => ({ text: t.text, voice: voiceOf(t.label), style: style(t.label) })) }];
    console.error(`sunra     ${entry.sunra}/${op}  voices=${speakers.map(voiceOf).join(',')}  turns=${turns.length}`);
    return Promise.all((await times(num, () => sunraJob(`${entry.sunra}/${op}`, body, timeout))).map((o) => fetchAudio(o.audio.url)));
  };
  // The Gateway's speech call takes one voice.
  const runGateway = async () => {
    if (speakers.length > 1) throw userError('the AI Gateway speech call takes one speaker.');
    const direction = characters[speakers[0]]?.description;
    const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
    console.error(`gateway   ${entry.gateway}  voice=${voiceOf(speakers[0])}`);
    return times(num, async () => {
      const r = await ai.generateSpeech({
        model: gw.speechModel(entry.gateway), text: turns.map((t) => t.text).join('\n'), voice: voiceOf(speakers[0]),
        ...(direction ? { instructions: `Voice and delivery: ${direction}` } : {}),
        maxRetries: 0,
      });
      logGatewayWarnings(r.warnings);
      return transcode({ bytes: r.audio.uint8Array, format: r.audio.format }, format);
    });
  };
  const { results, provider } = await runProviders({ entry, provider: args.provider, ws: W, kie: runKie, sunra: runSunra, gateway: runGateway });
  const saved = await saveResults(results, args.out, { fallbackExt: format });
  await writeSidecars(saved, {
    tool: 'generate-voice', model: entry.name, provider, prompt: scriptText.trim(),
    params: { format, 'voice-name': args['voice-name'] },
    refs: args['voices-file'] ? [{ role: 'voices', path: args['voices-file'] }] : [],
  });
}

main().catch((e) => die(errorText(e)));
