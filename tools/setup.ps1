# setup.ps1 — Windows twin of setup.sh, idempotent, no keys: downloads ADPK when run outside it, installs
# git, Node LTS and ffmpeg via winget when missing, the npm deps, whisper.cpp and its model, the shared
# library's catalog and the git hooks, then the next step (the kie key). Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Usage: powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.ps1 | iex"
#        $env:ADPK_DIR = '<folder>'   first, to install somewhere other than ~\ad-production-kit
#        powershell -ExecutionPolicy Bypass -File tools\setup.ps1   inside ADPK
#        $env:ADPK_BRANCH = '<branch>'   first, to install that branch (to test it before merging)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072   # TLS 1.2 on PowerShell 5.1
$ProgressPreference = 'SilentlyContinue'

function Ok($msg)   { Write-Host '  ' -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green  -NoNewline; Write-Host " $msg" }
function Warn($msg) { Write-Host '  ' -NoNewline; Write-Host ([char]0x2022) -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
# Bad <problem> [details]: print, then stop.
function Bad($msg, $details = @()) {
  Write-Host '  ' -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red -NoNewline; Write-Host " $msg"
  $details | ForEach-Object { Write-Host "      $_" }
  Write-Host "`nSetup stopped. Once that's fixed, run it again."; exit 1
}
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
# winget's installs reach only new terminals: add the saved PATH to this one too.
function Update-Path { $env:Path = "$env:Path;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Install-Winget($id, $what) {
  if (-not (Has 'winget')) { return }
  Write-Host "  Installing $what with winget..."
  winget install -e --id $id --source winget --accept-source-agreements --accept-package-agreements | Out-Null
  Update-Path
}

Write-Host 'Ad Production Kit setup'
Update-Path   # picks up installs this terminal hasn't seen yet

# ── git (downloads ADPK and its updates) ──────────────────────────────────
if (-not (Has 'git')) {
  Install-Winget 'Git.Git' 'git'
  if (Has 'git') { Ok 'Installed git' } else { Bad "git is missing (it downloads ADPK and its updates)." @('Install it from https://git-scm.com/download/win') }
}

# ── ADPK itself: this checkout, or a clone into the chosen folder ─────────
$isKit = { param($d) Select-String -Path (Join-Path $d 'package.json') -Pattern '"name": "ad-production-kit-tools"' -Quiet -ErrorAction SilentlyContinue }
if ($PSScriptRoot -and (& $isKit (Split-Path -Parent $PSScriptRoot))) {
  Set-Location (Split-Path -Parent $PSScriptRoot)
} else {
  $dir = if ($env:ADPK_DIR) { $env:ADPK_DIR } else { Join-Path $HOME 'ad-production-kit' }
  if (& $isKit $dir) {
    Ok "ADPK is in $dir"
  } elseif (Test-Path $dir) {
    Bad "$dir already exists and isn't ADPK." @("Pick another folder: `$env:ADPK_DIR = '<another folder>', then run the same command again.")
  } else {
    $branch = if ($env:ADPK_BRANCH) { $env:ADPK_BRANCH } else { 'main' }
    $log = git clone -q -b $branch https://github.com/oscarlora/ad-production-kit $dir 2>&1
    if ($LASTEXITCODE -ne 0) { Bad "Couldn't download ADPK: check your internet connection." ($log | Select-Object -Last 8) }
    Ok "Downloaded ADPK to $dir"
  }
  Set-Location $dir
}

# ── Node (>= 22.15; installs the LTS via winget when missing or older) ───────
function Test-NodeOk {
  if (-not (Has 'node')) { return $false }
  try { $v = & node -v 2>$null; if ("$v" -match '^v(\d+)\.(\d+)') { return ([int]$Matches[1] -gt 22) -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 15) } } catch { }
  return $false
}
if (Test-NodeOk) {
  Ok "Node $(& node -v) ready"
} else {
  Install-Winget 'OpenJS.NodeJS.LTS' 'Node LTS'
  if (Test-NodeOk) { Ok "Installed Node $(& node -v)" } else { Bad 'Node install failed: install Node 22.15+ from https://nodejs.org' }
}

# ── ffmpeg 8+ (video and audio) ───────────────────────────────────────────
function Get-FfmpegMajor { if ((Has 'ffmpeg') -and ("$(& ffmpeg -version 2>$null | Select-Object -First 1)" -match 'version n?(\d+)')) { return [int]$Matches[1] }; return 0 }
if ((Get-FfmpegMajor) -lt 8) { Install-Winget 'Gyan.FFmpeg' 'ffmpeg 8 (video and audio)' }
if ((Get-FfmpegMajor) -ge 8) { Ok 'ffmpeg ready' } else { Warn "ffmpeg 8 didn't install (video and audio tools need it): run this setup again later to retry." }

# ── npm deps (media search embeddings, Vercel AI Gateway, the video export) — again whenever package.json changed ──
$fresh = { param($dir) (Test-Path "$dir\node_modules\.package-lock.json") -and ((Get-Item "$dir\node_modules\.package-lock.json").LastWriteTime -gt (Get-Item "$dir\package.json").LastWriteTime) }
foreach ($d in @(@('.', "ADPK's tools", "ADPK's tools"), @('studio', 'the studio app', 'Studio app'))) {
  if (-not (& $fresh $d[0])) {
    Write-Host "  Installing $($d[1])..."
    $log = npm ci --prefix $d[0] --no-fund --no-audit 2>&1
    if ($LASTEXITCODE -ne 0) { Bad "Couldn't install $($d[1]): check your internet connection." ($log | Select-Object -Last 8) }
  }
  Ok "$($d[2]) ready"
}

node tools/sync-brand.mjs --pull workspaces/Shared/Library 2>&1 | Out-Null   # catalog only; files download when used
if ($LASTEXITCODE -eq 0) { Ok 'Shared library ready (music, sound effects, references; each file downloads when used)' }
else { Warn "Couldn't reach the shared library (music, sound effects): run this setup again later to retry." }

# ── git hooks: block commits that mention a client workspace or brand (the repo is public) ──
git config core.hooksPath .githooks 2>&1 | Out-Null

# ── whisper.cpp (word timings for captions): the CPU build from its GitHub releases into ~\.local\bin,
# where the tools look; then its model (574 MB), so captions never wait on it (a cut-off download resumes).
$localBin = Join-Path $HOME '.local\bin'
$hasWhisper = { (Has 'whisper-cli') -or (Test-Path (Join-Path $localBin 'whisper-cli.exe')) }
if (-not (& $hasWhisper)) {
  $asset = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'whisper-bin-win-cpu-arm64.zip' } else { 'whisper-bin-x64.zip' }
  Write-Host '  Installing whisper.cpp to ~\.local\bin...'
  try {
    $releases = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20' -Headers @{ 'User-Agent' = 'adpk-setup' }
    $url = ($releases | ForEach-Object { $_.assets } | Where-Object { $_.name -eq $asset } | Select-Object -First 1).browser_download_url
    $tmp = Join-Path $env:TEMP 'adpk-whisper'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp, $localBin | Out-Null
    Invoke-WebRequest $url -OutFile "$tmp\whisper.zip" -UseBasicParsing
    Expand-Archive "$tmp\whisper.zip" $tmp -Force
    Get-ChildItem $tmp -Recurse -Include 'whisper-cli.exe', 'whisper.dll', 'ggml*.dll' | Copy-Item -Destination $localBin -Force
    Remove-Item $tmp -Recurse -Force
  } catch { }
  if (& $hasWhisper) { Ok 'whisper.cpp ready (captions)' } else { Warn "whisper.cpp didn't install (captions need it): run this setup again later to retry." }
}
if (& $hasWhisper) {
  node -e "import('./tools/lib/transcribe.mjs').then((m) => m.whisperModel())"
  if ($LASTEXITCODE -eq 0) { Ok 'Whisper model ready (captions)' } else { Warn "The Whisper model didn't finish downloading: run this setup again later to carry on." }
}

$here = (Get-Location).Path
Write-Host "`nADPK lives in $here for good: don't move or rename that folder."
if (Select-String -Path '.env' -Pattern '^[A-Za-z0-9_]+_KIE_API_KEY=.+' -Quiet -ErrorAction SilentlyContinue) {
  Ok 'ADPK is ready.'
} else {
  Write-Host 'One step left: open your AI agent in that folder and say "Finish setting up ADPK".'
  Write-Host 'It helps you add your kie.ai key, the one key you need to start.'
}
