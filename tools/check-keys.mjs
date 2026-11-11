#!/usr/bin/env node
// check-keys.mjs — does a workspace's kie key (and sunra key, if set) work? Also lists its other keys,
// by name only.

import { die, loadEnv, parseArgs, usage } from './lib/catalog.mjs';
import { kie, sunra } from './lib/providers.mjs';

const HELP = `check-keys.mjs — check a workspace's keys (from .env)

  node tools/check-keys.mjs <WS>

Asks kie.ai for the account's credit balance with <WS>_KIE_API_KEY (free) and prints it, checks
<WS>_SUNRA_API_KEY when set (free: sunra shows no balance), then lists which other <WS>_* keys are set,
by name only. Exits 1 when the kie key is missing or a key doesn't work.`;

const args = parseArgs(process.argv.slice(2), { help: HELP });
const ws = String(args._[0] || '');
if (!ws) usage(HELP);
const W = ws.toUpperCase();
const env = loadEnv();
const key = env[`${W}_KIE_API_KEY`];
if (!key) {
  const named = Object.keys(env).filter((k) => k.endsWith('_KIE_API_KEY') && env[k]);
  die(`${W}_KIE_API_KEY isn't set in .env. ` + (named.length
    ? `Found ${named.join(', ')}: the name must start with the workspace folder's name in capitals, ${W}_KIE_API_KEY.`
    : 'Get a key at https://kie.ai/api-key and paste it after the =.'));
}

process.env.KIE_API_KEY = key;
const json = await kie('/api/v1/chat/credit').catch((e) => ({ msg: e.message }));
if (json?.code !== 200) die(`kie.ai didn't accept ${W}_KIE_API_KEY (${json?.msg || 'no answer'}): check it's pasted whole, from https://kie.ai/api-key.`);
console.log(`kie.ai key works: ${json.data} credits.`);
// Asking for a request that doesn't exist: 404 with a good key, 401 with a bad one.
if ((process.env.SUNRA_API_KEY = env[`${W}_SUNRA_API_KEY`] || '')) {
  const status = await sunra('/queue/requests/pd_adpk_key_check/status').then(() => 200, (e) => e.status || e.message);
  if (status !== 404) die(`sunra.ai didn't accept ${W}_SUNRA_API_KEY (${status === 401 ? 'invalid key' : status}): check it's pasted whole, from https://sunra.ai/dashboard/api-tokens.`);
  console.log('sunra.ai key works (its balance shows at https://sunra.ai/dashboard).');
}
const checked = [`${W}_KIE_API_KEY`, `${W}_SUNRA_API_KEY`];
const others = Object.keys(env).filter((k) => k.startsWith(`${W}_`) && !checked.includes(k) && env[k]);
console.log(others.length ? `Also set: ${others.join(', ')}` : 'No other keys yet (each step that needs one says so).');
