#!/usr/bin/env node
// check-keys.mjs — does a workspace's kie key work? Also lists its other keys, by name only.

import { die, loadEnv, parseArgs, usage } from './lib/catalog.mjs';
import { kie } from './lib/providers.mjs';

const HELP = `check-keys.mjs — check a workspace's keys (from .env)

  node tools/check-keys.mjs <WS>

Asks kie.ai for the account's credit balance with <WS>_KIE_API_KEY (free) and prints it, then lists
which other <WS>_* keys are set, by name only. Exits 1 when the kie key is missing or doesn't work.`;

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
const others = Object.keys(env).filter((k) => k.startsWith(`${W}_`) && k !== `${W}_KIE_API_KEY` && env[k]);
console.log(others.length ? `Also set: ${others.join(', ')}` : 'No other keys yet (each step that needs one says so).');
