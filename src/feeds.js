// RSS / Atom feeds: parse, find new posts, build Discord messages.
// No dependencies: feeds from FetchRSS / RSS.app are simple enough for regex parsing.

import { isDailyRunDue, parseClock } from './schedule.js';

const MAX_TEXT = 300;

function decode(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function stripHtml(html = '') {
  return decode(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
}

function attr(block, name, attribute) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]+)"`, 'i'));
  return m ? decode(m[1]) : '';
}

function firstHttps(...values) {
  return values.find((v) => typeof v === 'string' && v.startsWith('https://')) ?? null;
}

/** Parse RSS 2.0 <item> or Atom <entry> elements, newest first as in the feed. */
export function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block) => {
    const description = tag(block, 'description') || tag(block, 'content') || tag(block, 'summary');
    const link = tag(block, 'link') || attr(block, 'link', 'href');
    const imageInHtml = decode(description).match(/<img[^>]+src="([^"]+)"/i)?.[1];
    const text = stripHtml(tag(block, 'title')) || stripHtml(description);
    return {
      id: tag(block, 'guid') || tag(block, 'id') || link,
      title: text,
      link: firstHttps(link),
      image: firstHttps(
        attr(block, 'media:content', 'url'),
        attr(block, 'media:thumbnail', 'url'),
        attr(block, 'enclosure', 'url'),
        imageInHtml,
      ),
    };
  }).filter((item) => item.id);
}

/**
 * Posts not seen before, oldest first. On the first run of a feed (no `seen`
 * list yet) nothing is posted: the current posts are only remembered, so the
 * channel is not flooded with old posts.
 */
export function findNewItems(items, seen, max = 5) {
  if (!Array.isArray(seen)) return [];
  const known = new Set(seen);
  return items.filter((item) => !known.has(item.id)).slice(0, max).reverse();
}

/** Remember the ids currently in the feed (the feed itself is the window). */
export function nextSeen(items, seen = []) {
  return [...new Set([...items.map((i) => i.id), ...seen])].slice(0, 100);
}

/** Feeds are checked once a day, on the first run at or after `time`. */
export const isFeedCheckDue = isDailyRunDue;

/** Validate feeds.json: { "time"?: "09:00", "feeds": [ { "name", "url", "role"? } ] }. */
export function loadFeeds(raw, roles) {
  const list = Array.isArray(raw) ? raw : raw?.feeds;
  if (!Array.isArray(list)) return { feeds: [], time: '09:00', errors: ['feeds.json phải có mảng "feeds"'] };
  const feeds = [];
  const errors = [];
  let time = '09:00';
  if (raw?.time !== undefined) {
    const clock = parseClock(raw.time);
    if (clock) time = clock;
    else errors.push(`feeds.json: "time" phải có dạng HH:MM (đang là ${raw.time}), dùng 09:00`);
  }
  list.forEach((item, index) => {
    const label = `Feed ${index + 1}`;
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!name) return errors.push(`${label}: thiếu "name"`);
    if (!url.startsWith('https://')) return errors.push(`${label} "${name}": "url" phải là link https://`);
    if (feeds.some((f) => f.url === url)) return errors.push(`${label} "${name}": url bị trùng`);

    let role = null;
    if (item.role) {
      const alias = String(item.role).trim().replace(/^@/, '').toLowerCase();
      if (alias === 'everyone' || alias === 'here') role = alias;
      else if (roles?.[alias]) role = roles[alias];
      else if (roles) return errors.push(`${label} "${name}": role "${alias}" chưa có trong DISCORD_ROLES`);
      else role = alias;
    }
    feeds.push({ name, url, role });
  });
  return { feeds, time, errors };
}

/** Discord webhook body for one new post. */
export function buildFeedMessage(feed, item) {
  const everyone = feed.role === 'everyone' || feed.role === 'here';
  const mention = !feed.role ? '' : everyone ? `@${feed.role} ` : `<@&${feed.role}> `;
  const text = item.title.length > MAX_TEXT ? `${item.title.slice(0, MAX_TEXT - 1)}…` : item.title;
  const body = {
    content: `${mention}📰 **${feed.name}** có bài viết mới\n${text}`.trim(),
    allowed_mentions: everyone ? { parse: ['everyone'] } : { parse: [], roles: feed.role ? [feed.role] : [] },
  };
  if (item.link || item.image) {
    const embed = {};
    if (item.link) Object.assign(embed, { title: '📖 Xem bài viết', url: item.link });
    if (item.image) embed.image = { url: item.image };
    body.embeds = [embed];
  }
  return body;
}
