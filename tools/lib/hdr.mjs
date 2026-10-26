// HDR sources (iPhone Dolby Vision / HLG, or PQ) tone-mapped to SDR BT.709 once per file version, so the edit
// engine (Studio's preview and the export, which decode frames with the browser's WebCodecs and draw them to an
// sRGB canvas with no tone mapping) sees what the phone shows instead of washed-out HDR. SDR files pass through
// untouched. The best tone mapper this ffmpeg has: libplacebo (needs Vulkan; tried for real once), else
// zscale + tonemap (hable), else a plain BT.2020 -> BT.709 colorspace conversion. Works with the macOS
// (martin-riedl) and Windows (gyan.dev) ffmpeg builds setup installs.
import { renameSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import { ffprobeJson, findBin, run, cachedFile, typeOf } from './catalog.mjs';

// HDR when the transfer is HLG or PQ, or the primaries are BT.2020. → 'hlg' | 'pq' | 'bt2020' | null
export function hdrKind(file) {
  if (typeOf(file) !== 'video') return null;
  const v = (ffprobeJson(file).streams || []).find((s) => s.codec_type === 'video');
  if (!v) return null;
  if (v.color_transfer === 'arib-std-b67') return 'hlg';
  if (v.color_transfer === 'smpte2084') return 'pq';
  if (v.color_primaries === 'bt2020') return 'bt2020';
  return null;
}
const kinds = new Map(); // file|mtime -> kind (an ffprobe per request would be slow)
const kindOf = (file) => {
  const st = statSync(file), key = `${file}|${st.mtimeMs}|${st.size}`;
  if (!kinds.has(key)) kinds.set(key, hdrKind(file));
  return kinds.get(key);
};

let method;
// 'libplacebo' | 'zscale' | 'colorspace', probed once.
export function toneMethod() {
  if (method) return method;
  const filters = run('ffmpeg', ['-hide_banner', '-filters'], { allowFail: true }).stdout || '';
  const works = (vf) => run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=0.1,format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc',
    '-vf', vf, '-frames:v', '1', '-f', 'null', '-'], { allowFail: true }).status === 0;
  if (/\slibplacebo\s/.test(filters) && works(toneFilter('hlg', 'libplacebo'))) method = 'libplacebo';
  else if (/\szscale\s/.test(filters) && /\stonemap\s/.test(filters) && works(toneFilter('hlg', 'zscale'))) method = 'zscale';
  else method = 'colorspace';
  return method;
}

// The -vf that turns an HDR source of this kind into 8-bit SDR BT.709 (limited range).
export function toneFilter(kind, how = toneMethod()) {
  if (how === 'libplacebo') return 'libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p';
  if (how === 'zscale') {
    // npl: the SDR white HDR maps to. 180 for HLG matches the iPhone/macOS SDR rendering closely (checked by eye
    // and mean colour against AVFoundation's own conversion); 100 for PQ, its reference white.
    const npl = kind === 'pq' ? 100 : 180;
    return `zscale=t=linear:npl=${npl},format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`;
  }
  return `colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:format=yuv420p`; // no tone mapping: highlights clip, colours roughly right
}

// Light on a laptop: decode and encode on the Mac's media engine (VideoToolbox) when there is one, else libx264
// on 4 threads; the tone-map filters on 2; the whole job at the lowest CPU priority (makeSdr).
let vt;
const videoToolbox = () => (vt ??= process.platform === 'darwin' && /h264_videotoolbox/.test(run('ffmpeg', ['-hide_banner', '-encoders'], { allowFail: true }).stdout || ''));
export const sdrCmd = (file, out, kind = kindOf(file)) => ['ffmpeg', ['-y', '-v', 'error', ...(videoToolbox() ? ['-hwaccel', 'videotoolbox'] : ['-threads', '4']),
  '-filter_threads', '2', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-vf', toneFilter(kind),
  ...(videoToolbox() ? ['-c:v', 'h264_videotoolbox', '-q:v', '70'] : ['-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '16']),
  '-g', '30', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
  '-c:a', 'copy', '-movflags', '+faststart', out]];

// Run sdrCmd at the lowest priority (nice 19 / Windows idle class), so editing stays usable while it encodes.
function makeSdr(file, out, kind) {
  const [bin, args] = sdrCmd(file, out, kind);
  return new Promise((res, rej) => {
    const p = spawn(findBin(bin) || bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    try { setPriority(p.pid, 19); } catch {}
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg (SDR copy) failed: ${err}`))));
  });
}

// The file to decode frames from: an HDR video's SDR copy (made once, cached in <OS temp>), else the file itself.
// Concurrent requests share one encode.
const making = new Map();
export async function sdrSource(file) {
  let kind;
  try { kind = kindOf(file); } catch { return file; }
  if (!kind) return file;
  if (!making.has(file)) {
    const t0 = Date.now();
    const job = cachedFile(file, { cache: 'ad-production-kit-sdr', key: `${toneMethod()}-v2`, ext: 'mp4' }, async (tmp) => {
      console.error(`HDR (${kind}) source: making its SDR copy with ${toneMethod()} (once per file): ${file}`);
      await makeSdr(file, tmp, kind);
      console.error(`  SDR copy ready in ${Math.round((Date.now() - t0) / 1000)}s`);
    });
    making.set(file, job);
    job.catch(() => making.delete(file));
  }
  return making.get(file);
}

// Retag an H.264 MP4 the engine wrote (WebCodecs tags the sRGB canvas as transfer iec61966-2-1) as plain BT.709,
// in place, streams copied. False when ffmpeg failed (the file is left as it was).
export function tagBt709(file) {
  const tmp = file.replace(/(\.\w+)?$/, '.tagging$1');
  const r = run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy',
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', tmp], { allowFail: true });
  if (r.status !== 0) { rmSync(tmp, { force: true }); return false; }
  renameSync(tmp, file);
  return true;
}
