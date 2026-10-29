// A script's voice preview. Body: { ad, lines: [text], hook?, check? } voices the lines (tools/generate-voice.mjs) into
// the ad's voice/ and returns { p, v }. With hook, the first line is voiced on its own and joined to the rest, a short
// pause between, so switching hooks only voices the new hook. Each take is kept by its words, so only a change costs a
// run. check: only say whether that preview exists ({} if not).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adDir } from '../../../../../lib/server/edit.js';
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';
import { repoRoot } from '../../../../../lib/server/root.js';
import { catalogLib } from '../../../../../lib/server/tools.js';

// The creator from the brief's "Role" line (e.g. "A woman 47–52"), else a generic one; a man gets a male voice.
function voiceOf(dir) {
  const md = readdirSync(dir).filter((f) => /\.md$/i.test(f)).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const who = (md.match(/\*\*Role[^*]*\*\*:?\s*([^,.\n]+)/i)?.[1] || 'A creator').trim();
  return `[CREATOR]
description: ${who}, talking to a friend across the table about something they just figured out: warm, a little fired up. Talks fast and keeps moving, about 4 words a second, like an energetic social video: short breaths only, no long pauses between sentences, never like an announcer.
voice_name: ${/\b(man|male|guy|father|dad)\b/i.test(who) ? 'Puck' : 'Kore'}

[FRIEND]
description: Their friend across the table, relaxed and casual, reacting naturally.
voice_name: Aoede
`;
}

// A line may hold dialogue labels ("FRIEND (OFF CAMERA): …"); each starts its own turn and is never spoken.
// YOU / CREATOR labels and unlabeled text are the creator; any other label is the friend.
const LABEL = /\b([A-Z]{2,}(?: [A-Z]{2,})*)(?: \([^)]*\))?:\s*/g;
function turnsOf(line) {
  const parts = line.split(LABEL), out = [];
  if (parts[0].trim()) out.push(`CREATOR: ${parts[0].trim()}`);
  for (let i = 1; i < parts.length; i += 2) {
    const text = parts[i + 1].trim();
    if (text) out.push(`${/^(YOU|CREATOR)$/.test(parts[i]) ? 'CREATOR' : 'FRIEND'}: ${text}`);
  }
  return out;
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
// Fails with the last line the command wrote to stderr.
const run = async (cmd, args) => {
  const r = await (await catalogLib()).runAsync(cmd, args, { cwd: repoRoot(), allowFail: true });
  if (r.status !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `exit ${r.status}`);
};

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const ad = String(body.ad || ''), lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dir = adDir(ctx.dir, ad);
  if (!dir) return jsonRes({ error: 'no such ad folder' }, 404);
  if (!lines.length) return jsonRes({ error: 'nothing to voice' }, 400);
  const vdir = join(dir, 'voice'), VOICE = voiceOf(dir);
  const scripts = (body.hook && lines.length > 1 ? [lines.slice(0, 1), lines.slice(1)] : [lines]).map((ls) => ls.flatMap(turnsOf).join('\n') + '\n');
  const takes = scripts.map((sc) => `voice-${hash(VOICE + sc)}`);
  const name = takes.length > 1 ? `preview-${hash(takes.join('+'))}` : takes[0], out = join(vdir, `${name}.mp3`);
  const res = () => jsonRes({ p: `outputs/${ad}/voice/${name}.mp3`, v: Math.round(statSync(out).mtimeMs) });
  if (body.check) return existsSync(out) ? res() : jsonRes({});
  try {
    mkdirSync(vdir, { recursive: true });
    for (const [i, take] of takes.entries()) {
      if (existsSync(join(vdir, `${take}.mp3`))) continue;
      writeFileSync(join(vdir, 'preview-voice.txt'), VOICE);
      writeFileSync(join(vdir, `${take}.txt`), scripts[i]);
      await run(process.execPath, [join('tools', 'generate-voice.mjs'), '--script-file', join(vdir, `${take}.txt`), '--voices-file', join(vdir, 'preview-voice.txt'), '--out', join(vdir, `${take}.mp3`), '--timeout', '300']);
    }
    if (takes.length > 1 && !existsSync(out)) {
      const fmt = (k) => `[${k}:a]aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono[a${k}]`;
      await run('ffmpeg', ['-y', '-v', 'error', '-i', join(vdir, `${takes[0]}.mp3`), '-f', 'lavfi', '-t', '0.35', '-i', 'anullsrc=r=24000:cl=mono', '-i', join(vdir, `${takes[1]}.mp3`),
        '-filter_complex', `${fmt(0)};${fmt(1)};${fmt(2)};[a0][a1][a2]concat=n=3:v=0:a=1`, out]);
    }
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 502);
  }
  return res();
});
