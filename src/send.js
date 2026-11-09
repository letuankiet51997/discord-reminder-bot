// One run: send the reminders that are due, then record them in state.json.
// Run by GitHub Actions every 5 minutes. DRY_RUN=1 prints instead of sending.
process.env.TZ ||= 'Asia/Ho_Chi_Minh';

import { readFile, writeFile } from 'node:fs/promises';
import { REPEATS, buildMessage, findDue, loadEventDefinitions, nextOccurrence, parseRoleMap } from './schedule.js';

const EVENTS_FILE = new URL('../events.json', import.meta.url);
const STATE_FILE = new URL('../state.json', import.meta.url);
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DRY_RUN = process.env.DRY_RUN === '1';

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

if (!WEBHOOK_URL && !DRY_RUN) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
}

const now = Date.now();
const { roles, errors: roleErrors } = parseRoleMap(process.env.DISCORD_ROLES);
const { definitions, errors: eventErrors } = loadEventDefinitions(await readJson(EVENTS_FILE, { events: [] }), roles);
const errors = [...roleErrors, ...eventErrors];
const state = await readJson(STATE_FILE, {});
const fmt = (ms) => new Date(ms).toLocaleString('vi-VN');

console.log(`Now ${fmt(now)} — ${definitions.length} event(s)`);
for (const def of definitions) {
  const next = nextOccurrence(def, now);
  console.log(`  • ${def.title} · ${REPEATS[def.repeat]} · next ${next ? fmt(next) : '-'}`);
}
for (const e of errors) console.error(`  ⚠️ ${e}`);

let failed = errors.length > 0;
for (const { def, occurrence } of findDue(definitions, now, state)) {
  const body = buildMessage(def);
  if (DRY_RUN) {
    console.log(`[dry-run] ${JSON.stringify(body)}`);
  } else {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Failed to send "${def.title}": ${res.status} ${await res.text()}`);
      failed = true;
      continue;
    }
  }
  state[def.key] = occurrence;
  console.log(`Sent "${def.title}" for ${fmt(occurrence)}`);
}

// Drop state of events that are no longer in events.json.
const keys = new Set(definitions.map((d) => d.key));
const nextState = Object.fromEntries(Object.entries(state).filter(([k]) => keys.has(k)));
await writeFile(STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`);

process.exit(failed ? 1 : 0);
