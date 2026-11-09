// One run: send due reminders (events.json) and new feed posts (feeds.json).
// Run by GitHub Actions every 5 minutes. DRY_RUN=1 prints instead of sending.
process.env.TZ ||= 'Asia/Ho_Chi_Minh';

import { readFile, writeFile } from 'node:fs/promises';
import { REPEATS, buildMessage, findDue, loadEventDefinitions, nextOccurrence, parseRoleMap } from './schedule.js';
import { buildFeedMessage, findNewItems, isFeedCheckDue, loadFeeds, nextSeen, parseFeed } from './feeds.js';

const EVENTS_FILE = new URL('../events.json', import.meta.url);
const STATE_FILE = new URL('../state.json', import.meta.url);
const FEEDS_FILE = new URL('../feeds.json', import.meta.url);
const FEEDS_STATE_FILE = new URL('../feeds-state.json', import.meta.url);
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

// TEST_MESSAGE=1: post one test message to check the webhook, then stop.
if (process.env.TEST_MESSAGE === '1') {
  const body = {
    content: `✅ **Bot nhắc nhở hoạt động** — tin thử lúc ${new Date().toLocaleString('vi-VN')}`,
    allowed_mentions: { parse: [] },
  };
  if (DRY_RUN) {
    console.log(`[dry-run] ${JSON.stringify(body)}`);
    process.exit(0);
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Test message failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log('Test message sent');
  process.exit(0);
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
  console.log(`  • ${def.title} · ${REPEATS[def.repeat]} · next ${next ? fmt(next) : 'đã kết thúc'}`);
}
for (const e of errors) console.error(`  ⚠️ ${e}`);

/** Post one message; returns true on success. */
async function post(label, body) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${JSON.stringify(body)}`);
    return true;
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Failed to send "${label}": ${res.status} ${await res.text()}`);
  return res.ok;
}

let failed = errors.length > 0;
for (const { def, occurrence } of findDue(definitions, now, state)) {
  if (!(await post(def.title, buildMessage(def)))) {
    failed = true;
    continue;
  }
  state[def.key] = occurrence;
  console.log(`Sent "${def.title}" for ${fmt(occurrence)}`);
}

// Drop state of events that are no longer in events.json.
const keys = new Set(definitions.map((d) => d.key));
const nextState = Object.fromEntries(Object.entries(state).filter(([k]) => keys.has(k)));
await writeFile(STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`);

// RSS feeds (feeds.json): once a day at feeds.json "time" (default 09:00), post
// new posts and remember seen ids in feeds-state.json.
const { feeds, time: feedTime, errors: feedErrors } = loadFeeds(await readJson(FEEDS_FILE, { feeds: [] }), roles);
const feedState = await readJson(FEEDS_STATE_FILE, {});
for (const e of feedErrors) console.error(`  ⚠️ ${e}`);
failed ||= feedErrors.length > 0;

const LAST_CHECK = '__lastCheck';
const { due: feedsDue, today } = isFeedCheckDue(feedTime, now, feedState[LAST_CHECK]);
if (feeds.length && !feedsDue) {
  console.log(`Feeds: kiểm tra mỗi ngày lúc ${feedTime}; lần gần nhất ${feedState[LAST_CHECK] ?? 'chưa có'}`);
}

for (const feed of feedsDue ? feeds : []) {
  let items;
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'discord-reminder-bot' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = parseFeed(await res.text());
  } catch (err) {
    console.error(`  ⚠️ Feed "${feed.name}": không đọc được (${err.message})`);
    failed = true;
    continue;
  }

  const seen = feedState[feed.url];
  const fresh = findNewItems(items, seen);
  console.log(`Feed "${feed.name}": ${items.length} bài, ${seen ? `${fresh.length} bài mới` : 'lần đầu — chỉ ghi nhớ, không gửi'}`);

  const sent = [];
  for (const item of fresh) {
    if (await post(item.title, buildFeedMessage(feed, item))) sent.push(item.id);
    else failed = true;
  }
  // Only remember what was sent, so a failed post is retried next run.
  const unsent = new Set(fresh.map((i) => i.id).filter((id) => !sent.includes(id)));
  feedState[feed.url] = nextSeen(items.filter((i) => !unsent.has(i.id)), seen ?? []);
}

const feedUrls = new Set(feeds.map((f) => f.url));
const nextFeedState = Object.fromEntries(Object.entries(feedState).filter(([url]) => feedUrls.has(url)));
if (feedsDue && feeds.length) nextFeedState[LAST_CHECK] = today;
else if (feedState[LAST_CHECK]) nextFeedState[LAST_CHECK] = feedState[LAST_CHECK];
await writeFile(FEEDS_STATE_FILE, `${JSON.stringify(nextFeedState, null, 2)}\n`);

process.exit(failed ? 1 : 0);
