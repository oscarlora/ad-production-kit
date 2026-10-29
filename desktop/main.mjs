// The Mac app: one window with Studio and the agent chat side by side (Studio's /app page), served by this computer's
// ADPK folder. It starts Studio (studio/dev.mjs) unless one is already running, and stops what it started on quit.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';

const PORT = 4179; // Studio's own default
const SPARE_PORT = 4189; // when a Studio without the chat (an older ADPK) holds the default
const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash';
const config = join(app.getPath('userData'), 'config.json');

let studio = null; // the Studio process this app started
let win = null;
let adpk = null;

// Run a command in a new Terminal window, brought to the front.
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const terminal = (cmd) => execFileSync('osascript', ['-e', 'on run argv', '-e', 'tell application "Terminal" to do script item 1 of argv',
  '-e', 'tell application "Terminal" to activate', '-e', 'end run', cmd]);

// Claude Code's sign-in, with the copy the chat runs (studio's Agent SDK), so it needn't be installed separately.
function signIn() {
  const bin = adpk && join(adpk, 'studio', 'node_modules', '@anthropic-ai', `claude-agent-sdk-darwin-${process.arch}`, 'claude');
  if (!bin || !existsSync(bin)) return dialog.showErrorBox('Studio isn’t set up yet', 'Open the app again once Ad Production Kit is installed.');
  terminal(`cd ${q(adpk)} && ${q(bin)}`);
  dialog.showMessageBox({ message: 'Sign in to Claude in Terminal', detail: 'Follow Claude Code’s steps there to sign in with your Claude account (type /login if it doesn’t ask). Then close Terminal and send your message again.' });
}

const isAdpk = (dir) => !!dir && existsSync(join(dir, 'studio', 'app', 'app', 'page.js'));

// The ADPK folder: the last one used, the one this app sits in (a build inside the repo), or the install defaults.
function findAdpk() {
  let saved = null;
  try { saved = JSON.parse(readFileSync(config, 'utf8')).adpk; } catch {}
  const around = [];
  for (let d = dirname(app.getAppPath()); d !== dirname(d); d = dirname(d)) around.push(d);
  return [saved, ...around, join(homedir(), 'ad-production-kit'), join(homedir(), 'Projects', 'ad-production-kit')].find(isAdpk);
}

// Asked in the app's window, so it can't hide behind other apps' windows.
async function chooseAdpk() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'Where is Ad Production Kit?',
    detail: 'Pick its folder. If it isn’t on this Mac yet, install it first: Install opens Terminal with the install command. Open this app again once it finishes.',
    buttons: ['Choose folder…', 'Install', 'Quit'],
  });
  if (response === 1) {
    terminal(INSTALL);
    return null;
  }
  if (response !== 0) return null;
  const { filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (isAdpk(filePaths[0])) return filePaths[0];
  if (filePaths[0]) dialog.showErrorBox('Not an Ad Production Kit folder', 'That folder has no Studio with the chat. Pick the ad-production-kit folder, updated to the latest version.');
  return null;
}

// Apps opened from the Dock don't get the terminal's PATH; take it from the login shell, so node, ffmpeg and the rest
// are found as they are in Terminal.
function shellPath() {
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "\n@PATH@%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
    return out.split('@PATH@').pop().trim(); // past anything the shell's startup files print
  } catch {
    return [join(homedir(), '.local/node/bin'), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':');
  }
}

const answers = (url) => fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
const isStudio = (port) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
  .then(async (r) => (await r.text()).includes('Ad Production Kit')).catch(() => false);

// Studio's address: a running Studio that has the chat, or a new one.
async function startStudio(adpk, onLine) {
  if (await answers(`http://127.0.0.1:${PORT}/app`)) return `http://localhost:${PORT}`;
  const port = (await isStudio(PORT)) ? SPARE_PORT : PORT;
  if (await answers(`http://127.0.0.1:${port}/app`)) return `http://localhost:${port}`;
  const env = { ...process.env, PATH: shellPath(), PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  const node = env.PATH.split(':').map((d) => join(d, 'node')).find(existsSync);
  if (!node) throw new Error('Node.js is missing. Run ADPK’s setup in Terminal: bash tools/setup.sh');
  studio = spawn(node, ['studio/dev.mjs'], { cwd: adpk, env });
  return new Promise((resolve, reject) => {
    let log = '';
    const read = (chunk) => {
      log += chunk;
      for (const line of String(chunk).split('\n')) if (line.trim()) onLine(line.trim());
      const m = /Studio (?:on|is already running on) (http:\/\/\S+)/.exec(log);
      if (m) resolve(m[1]);
    };
    studio.stdout.on('data', read);
    studio.stderr.on('data', read);
    studio.on('exit', (code) => { studio = null; reject(new Error(`Studio stopped (code ${code}).\n\n${log.slice(-1500)}`)); });
  });
}

const loading = (text) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>Ad Production Kit</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:14px -apple-system,system-ui,sans-serif;color:#74716c;background:#fafaf9">
<p id="t">${text}</p></body>`)}`;

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Sign in to Claude…', click: signIn },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Show or Hide Chat', accelerator: 'CmdOrCtrl+J', click: () => win?.webContents.executeJavaScript('window.toggleChat?.()') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

async function open() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Ad Production Kit', backgroundColor: '#fafaf9' });
  // Links that leave Studio open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
  // Downloads go straight to Downloads (a save dialog per file would stop a multi-file download at the first).
  win.webContents.session.on('will-download', (_, item) => {
    const name = item.getFilename(), ext = extname(name), base = name.slice(0, name.length - ext.length);
    let path = join(app.getPath('downloads'), name);
    for (let n = 2; existsSync(path); n++) path = join(app.getPath('downloads'), `${base} (${n})${ext}`);
    item.setSavePath(path);
  });
  await win.loadURL(loading('Starting Studio…'));
  app.focus({ steal: true });

  adpk = findAdpk() || await chooseAdpk();
  if (!adpk) return app.quit();
  writeFileSync(config, JSON.stringify({ adpk }));

  try {
    const url = await startStudio(adpk, (line) => {
      if (/building|rebuilding|takes a minute/i.test(line)) win?.webContents.executeJavaScript(`document.getElementById('t').textContent = ${JSON.stringify('Getting Studio ready (about a minute, only after an update)…')}`).catch(() => {});
    });
    // dev.mjs prints the address just before the server listens.
    for (let i = 0; i < 120 && !(await answers(`${url}/app`)); i++) await new Promise((r) => setTimeout(r, 500));
    await win?.loadURL(`${url}/app`);
  } catch (e) {
    dialog.showErrorBox('Studio could not start', String(e.message || e));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { menu(); open(); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => studio?.kill('SIGTERM'));
