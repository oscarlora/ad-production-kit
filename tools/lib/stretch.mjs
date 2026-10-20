// stretch.mjs — a file's sound at another speed with its pitch kept (ffmpeg atempo). The edit engine fetches it
// (`…tempo=<rate>`) from Studio's file route and from edit-video's export server alike, so preview and export
// play the same audio. Made once per file version and rate, cached outside the brand. Keeps file time: a track
// that starts after the file does is padded to its start first, so source time t sits at t / rate.
import { cachedFile, runAsync } from './catalog.mjs';

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

// Path of abs's sound at `rate` (lossless FLAC).
// -copyts keeps the file's own clock (without it, time starts at the first frame).
export const stretched = (abs, rate) => cachedFile(abs, { cache: 'ad-production-kit-tempo', key: `ft${rate}`, ext: 'flac' },
  (tmp) => runAsync('ffmpeg', ['-v', 'error', '-y', '-copyts', '-i', abs, '-vn', '-af', `aresample=async=1:first_pts=0,${atempo(rate)}`, tmp]));
