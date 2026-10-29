// stretch.mjs — a file's sound at another speed with its pitch kept (ffmpeg atempo), or at its own speed (a video's
// sound alone, far smaller than the video). The edit engine fetches it (`…tempo=<rate>` or `…sound=1`) from Studio's
// file route and from edit-video's export server alike, so preview and export play the same audio. Made once per file version and rate, cached outside the brand. Keeps file time: a track
// that starts after the file does is padded to its start first, so source time t sits at t / rate.
import { cachedFile, ffprobeJson, runAsync } from './catalog.mjs';

// atempo takes 0.5–2 per stage; faster or slower chains stages.
export function atempo(rate) {
  const st = [];
  while (rate > 2) { st.push(2); rate /= 2; }
  while (rate < 0.5) { st.push(0.5); rate /= 0.5; }
  return [...st, rate].map((x) => `atempo=${x}`).join(',');
}

// A query's tempo as a rate worth stretching for, else null.
export function tempoOf(q) {
  const r = Math.round(+q * 1e4) / 1e4;
  return r > 0.1 && r < 10 && r !== 1 ? r : null;
}

// The rate a request's query asks the sound at (1 for sound=1), else null: the file itself.
export const soundRate = (q) => tempoOf(q.get('tempo')) || (q.has('sound') ? 1 : null);

// Path of abs's sound at `rate` (lossless FLAC).
// -copyts keeps the file's own clock (without it, time starts at the first frame). A file with no sound (a silent
// stock clip) gets silence of its length.
export const tempoOpts = (rate) => ({ cache: 'ad-production-kit-tempo', key: `ft${rate}`, ext: 'flac', beside: true });
export const stretched = (abs, rate) => cachedFile(abs, tempoOpts(rate), (tmp) => {
  const p = ffprobeJson(abs);
  if (p.streams && !p.streams.some((s) => s.codec_type === 'audio'))
    return runAsync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String((+p.format?.duration || 1) / rate), tmp]);
  return runAsync('ffmpeg', ['-v', 'error', '-y', '-copyts', '-i', abs, '-vn', '-af', `aresample=async=1:first_pts=0,${atempo(rate)}`, tmp]);
});
