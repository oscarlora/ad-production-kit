// Studio launcher: runs the built app; when the source changed, downloads its ready-made build or builds it here.
// Usage: node studio/dev.mjs [--dev | --stamp]   (--dev = `next dev` with hot reload; --stamp = print the
// source fingerprint; env PORT, STUDIO_HOST)
// Default is a production build because `next dev`'s route table drifts and some API routes start answering 404.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));

// Source fingerprint: a hash of the app's source files, the same on every computer. It decides when to rebuild and
// names the ready-made build (.github/workflows/studio-build.yml).
function sourceStamp() {
  const hash = createHash('sha256');
  // Sorted so every OS walks the same order; dot-entries (.next*, .gitignore) and node_modules skipped.
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx|css|json|mjs)$/.test(e.name)) {
        // CRLF folded: a Windows checkout may convert line endings.
        try { hash.update(`${relative(here, p).split(sep).join('/')}\0${readFileSync(p, 'utf8').replace(/\r\n/g, '\n')}\0`); } catch { /* vanished mid-walk */ }
      }
    }
  };
  walk(here);
  return hash.digest('hex').slice(0, 16);
}
if (process.argv.includes('--stamp')) {
  console.log(sourceStamp());
  process.exit(0);
}

const requestedPort = process.env.PORT || '4179';
const next = join(here, 'node_modules', 'next', 'dist', 'bin', 'next');
const devMode = process.argv.includes('--dev');
// Loopback only by default: the studio opens files and edits records. Writes still refuse non-local hosts.
const host = process.env.STUDIO_HOST || '127.0.0.1';
const shownHost = host === '127.0.0.1' ? 'localhost' : host;
const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host; // where to reach it from here

// Two launches on one port can knock each other's server down, so walk up to a free port.
function isPortFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    // Probe the exact address Next will bind.
    srv.listen(p, host);
  });
}
async function findFreePort(start, tries = 20) {
  for (let p = start; p < start + tries; p++) if (await isPortFree(p)) return p;
  throw new Error(`No free port found in ${start}-${start + tries - 1}. Set PORT to something else.`);
}
// One Studio covers every workspace and brand: if it's already running, point there instead of starting another.
const running = await fetch(`http://${probeHost}:${requestedPort}/`, { signal: AbortSignal.timeout(3000) })
  .then(async (r) => (await r.text()).includes('Ad Production Kit')).catch(() => false);
if (running) {
  console.log(`Studio is already running on http://${shownHost}:${requestedPort}`);
  process.exit(0);
}
const port = String(await findFreePort(Number(requestedPort)));
if (port !== requestedPort) console.log(`Port ${requestedPort} is taken by another app; Studio uses ${port} instead.\n`);

const env = { ...process.env };
// Next allows one server per build dir, so any non-default port gets its own dist dir.
if (port !== '4179') env.NEXT_DIST_DIR = `.next-dev-${port}`;

// Remove stale per-port dirs: nothing listening and untouched for 10 minutes (an instance may still be building).
const answers = (p) => new Promise((res) => {
  const s = net.connect(Number(p), probeHost);
  s.once('connect', () => { s.destroy(); res(true); }).once('error', () => res(false));
});
for (const name of readdirSync(here).filter((n) => /^\.next-dev-\d+$/.test(n) && n !== `.next-dev-${port}`)) {
  const dir = join(here, name);
  try { if (statSync(dir).mtimeMs > Date.now() - 600_000 || await answers(name.slice(10))) continue; } catch { continue; }
  rmSync(dir, { recursive: true, force: true });
}

// Trust the OS certificate store so next/font's download works behind TLS-intercepting proxies.
if (!/--use-system-ca/.test(env.NODE_OPTIONS || '')) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --use-system-ca`.trim();

const distDir = env.NEXT_DIST_DIR || '.next';
const stampFile = join(here, distDir, '.source-stamp');

// Unpacks the ready-made build of exactly this source into distDir. Returns why it couldn't, or '' on success.
async function download(stamp) {
  let body;
  try {
    const r = await fetch(`https://github.com/oscarlora/ad-production-kit/releases/download/studio-build/studio-${stamp}.tar.gz`,
      { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return r.status === 404 ? 'no ready-made build for this version' : `the download failed (HTTP ${r.status})`;
    body = Buffer.from(await r.arrayBuffer());
  } catch {
    return "couldn't download the ready-made build";
  }
  rmSync(join(here, distDir), { recursive: true, force: true });
  mkdirSync(join(here, distDir));
  // Relative paths: Git Bash's tar reads "C:" in a Windows path as a remote host.
  const t = spawnSync('tar', ['-xzf', '-', '-C', distDir], { cwd: here, input: body });
  return t.status === 0 ? '' : "couldn't unpack the ready-made build";
}

const run = (args, label) => {
  const r = spawnSync(process.execPath, [next, ...args], { stdio: 'inherit', cwd: here, env });
  if (r.status !== 0) {
    console.error(`\nStudio could not ${label}. The error is above.`);
    process.exit(r.status ?? 1);
  }
};

// Exit with the server; on a stop signal, give it 3 s to finish, then end it. Next otherwise waits on any open
// connection (a live page, a playing video) and an old server lingers on after Studio restarts.
function stopWith(child) {
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    });
  }
}

if (devMode) {
  console.log(`Studio starting in dev mode on http://${shownHost}:${port} (hot reload on).`);
  console.log('If an API route ever answers 404 while the page still loads, restart: dev rebuilds its route table and it can drift.');
  stopWith(spawn(process.execPath, [next, 'dev', '-H', host, '-p', port], { stdio: 'inherit', cwd: here, env }));
} else {
  const stamp = sourceStamp();
  let prior = null;
  try { prior = readFileSync(stampFile, 'utf8').trim(); } catch { /* no build yet */ }
  const built = existsSync(join(here, distDir, 'BUILD_ID'));

  if (!built || prior !== stamp) {
    const why = await download(stamp);
    if (why) {
      console.log(`Studio: ${why}, so building Studio on this computer, a few minutes. Only once per update.\n`);
      run(['build'], 'build');
    } else console.log('Studio: downloaded the ready-made build.');
    try { writeFileSync(stampFile, stamp); } catch { /* optional */ }
  }

  console.log(`\nStudio on http://${shownHost}:${port}\n`);
  stopWith(spawn(process.execPath, [next, 'start', '-H', host, '-p', port], { stdio: 'inherit', cwd: here, env }));
}
