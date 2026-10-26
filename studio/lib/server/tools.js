// Loads the repo's tools (outside this app) via runtime file:// imports so the bundler never traces them.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './root.js';

const cache = new Map();

function load(rel) {
  if (!cache.has(rel)) {
    const href = pathToFileURL(join(repoRoot(), rel)).href;
    cache.set(rel, import(/* webpackIgnore: true */ /* turbopackIgnore: true */ href));
  }
  return cache.get(rel);
}

export const catalogLib = () => load(join('tools', 'lib', 'catalog.mjs'));
export const recordMediaTool = () => load(join('tools', 'record-media.mjs'));
export const stretchLib = () => load(join('tools', 'lib', 'stretch.mjs'));
export const hdrLib = () => load(join('tools', 'lib', 'hdr.mjs'));
const r2Lib = () => load(join('tools', 'lib', 'r2.mjs'));

// R2 client for a workspace (read-only for a public bucket without creds), or null.
export async function r2For(workspace) {
  const [{ loadEnv }, { r2FromEnv, r2Public }] = await Promise.all([catalogLib(), r2Lib()]);
  const env = loadEnv();
  return r2FromEnv(env, workspace) || r2Public(env, workspace);
}
