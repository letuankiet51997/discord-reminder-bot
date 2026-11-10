// Pure logic: parse events.json and build the daily digest of today's events.
// All dates use the process time zone (TZ=Asia/Ho_Chi_Minh).

export const REPEATS = {
  daily: 'Hằng ngày',
  weekly: 'Hằng tuần',
  monthly: 'Hằng tháng',
};

/** Optional "type" of an event, shown as a line under the title. */
export const EVENT_TYPES = {
  'in-game': '🎮 Sự kiện in-game',
  'off-game': '📍 Sự kiện off-game',
};

/** Accept "daily", "weekly" or "monthly" (any case). Returns null otherwise. */
export function parseRepeat(text = '') {
  const key = text.trim().toLowerCase();
  return Object.hasOwn(REPEATS, key) ? key : null;
}

/**
 * Parse "2026-11-10 09:00", "10/11/2026 09:00" or "09:00". A time without a
 * date has no start date, so it is anchored on 2000-01-01. Returns epoch ms or null.
 */
export function parseDateTime(text) {
  const value = text.trim();
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (m) return build(+m[1], +m[2], +m[3], +m[4], +m[5]);

  m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/);
  if (m) return build(+m[3], +m[2], +m[1], +m[4], +m[5]);

  m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return build(2000, 1, 1, +m[1], +m[2]);
  return null;
}

function build(year, month, day, hour, minute) {
  if (hour > 23 || minute > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Reject overflow such as 31/02.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

function atTimeOf(date, start) {
  const d = new Date(date);
  d.setHours(start.getHours(), start.getMinutes(), 0, 0);
  return d;
}

function monthlyOn(year, month, start) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return atTimeOf(new Date(year, month, Math.min(start.getDate(), lastDay)), start).getTime();
}

/** First occurrence of the event after `now` (null once past `until`). Used for logs. */
export function nextOccurrence(def, now) {
  const occ = rawNextOccurrence(def, now);
  return occ !== null && def.until != null && occ > def.until ? null : occ;
}

function rawNextOccurrence({ startAt, repeat }, now) {
  const start = new Date(startAt);
  const from = new Date(Math.max(now, startAt));

  if (repeat === 'monthly') {
    for (let i = 0; i < 3; i += 1) {
      const occ = monthlyOn(from.getFullYear(), from.getMonth() + i, start);
      if (occ > now && occ >= startAt) return occ;
    }
    return null;
  }

  for (let i = 0; i < 8; i += 1) {
    const day = atTimeOf(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i), start);
    const matches = repeat === 'daily' || day.getDay() === start.getDay();
    if (matches && day.getTime() > now && day.getTime() >= startAt) return day.getTime();
  }
  return null;
}

const ALIAS = /^[a-z0-9_-]{1,32}$/;
const ROLE_ID = /^\d{17,20}$/;
const SPECIAL_ROLES = ['everyone', 'here'];

/**
 * Parse DISCORD_ROLES: "dev=123...,raider=456..." (commas or new lines).
 * Aliases are case-insensitive. An alias or an id may appear only once.
 */
export function parseRoleMap(text = '') {
  const roles = {};
  const errors = [];
  const aliasOf = {};
  for (const entry of text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
    const [rawAlias = '', rawId = '', extra] = entry.split('=').map((s) => s.trim());
    const alias = rawAlias.toLowerCase();
    if (extra !== undefined || !ALIAS.test(alias) || !ROLE_ID.test(rawId)) {
      errors.push(`DISCORD_ROLES: "${entry}" phải có dạng ten=id (id 17–20 chữ số)`);
    } else if (SPECIAL_ROLES.includes(alias)) {
      errors.push(`DISCORD_ROLES: "${alias}" là tên dành riêng, không khai báo được`);
    } else if (roles[alias]) {
      errors.push(`DISCORD_ROLES: tên "${alias}" bị trùng`);
    } else if (aliasOf[rawId]) {
      errors.push(`DISCORD_ROLES: id ${rawId} bị trùng ở "${aliasOf[rawId]}" và "${alias}"`);
    } else {
      roles[alias] = rawId;
      aliasOf[rawId] = alias;
    }
  }
  return { roles, errors };
}

/**
 * Validate the content of events.json:
 *   { "events": [ { "title", "time", "repeat"?, "role"?, "message"? } ] }
 * `repeat` defaults to daily. `role` is an alias from DISCORD_ROLES, "everyone"
 * or "here". Pass `roles` (alias → id) to resolve aliases; without it only the
 * alias format is checked. Each definition gets a stable `key` for state.json.
 */
export function loadEventDefinitions(raw, roles) {
  const list = Array.isArray(raw) ? raw : raw?.events;
  if (!Array.isArray(list)) return { definitions: [], errors: ['events.json phải có mảng "events"'] };

  const definitions = [];
  const errors = [];
  list.forEach((item, index) => {
    const label = `Sự kiện ${index + 1}`;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const time = typeof item?.time === 'string' ? item.time.trim() : '';
    if (!title) return errors.push(`${label}: thiếu "title"`);

    const startAt = parseDateTime(time);
    if (startAt === null) return errors.push(`${label} "${title}": "time" không hợp lệ (${time || 'trống'})`);

    const repeat = item.repeat === undefined ? 'daily' : parseRepeat(String(item.repeat));
    if (!repeat) {
      return errors.push(`${label} "${title}": "repeat" phải là daily, weekly hoặc monthly (đang là ${item.repeat})`);
    }
    if (repeat !== 'daily' && /^\d{1,2}:\d{2}$/.test(time)) {
      return errors.push(`${label} "${title}": ${repeat} cần ngày đầy đủ trong "time", VD 2026-11-11 20:00`);
    }

    let role = null;
    if (item.role !== undefined && item.role !== '') {
      const alias = typeof item.role === 'string' ? item.role.trim().replace(/^@/, '').toLowerCase() : '';
      if (SPECIAL_ROLES.includes(alias)) {
        role = alias;
      } else if (!ALIAS.test(alias)) {
        return errors.push(
          `${label} "${title}": "role" phải là tên trong DISCORD_ROLES, everyone hoặc here (đang là ${item.role})`,
        );
      } else if (roles) {
        role = roles[alias];
        if (!role) return errors.push(`${label} "${title}": role "${alias}" chưa có trong DISCORD_ROLES`);
      } else {
        role = alias;
      }
    }

    let image = null;
    if (item.image !== undefined && item.image !== '') {
      image = parseImageUrl(item.image);
      if (!image) return errors.push(`${label} "${title}": "image" phải là link https:// (đang là ${item.image})`);
    }

    let link = null;
    if (item.link !== undefined && item.link !== '') {
      link = parseImageUrl(item.link);
      if (!link) return errors.push(`${label} "${title}": "link" phải là link https:// (đang là ${item.link})`);
    }

    let until = null;
    if (item.until !== undefined && item.until !== '') {
      until = typeof item.until === 'string' ? parseEndOfDay(item.until) : null;
      if (until === null) {
        return errors.push(`${label} "${title}": "until" phải là ngày YYYY-MM-DD hoặc DD/MM/YYYY (đang là ${item.until})`);
      }
      if (until < startAt) return errors.push(`${label} "${title}": "until" trước ngày trong "time"`);
    }

    let type = null;
    if (item.type !== undefined && item.type !== '') {
      type = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
      if (!Object.hasOwn(EVENT_TYPES, type)) {
        return errors.push(`${label} "${title}": "type" phải là in-game hoặc off-game (đang là ${item.type})`);
      }
    }

    const key = `${title}|${time}|${repeat}`;
    if (definitions.some((d) => d.key === key)) {
      return errors.push(`${label} "${title}": trùng với một sự kiện khác (cùng title, time, repeat)`);
    }

    definitions.push({
      key,
      title,
      startAt,
      repeat,
      role,
      type,
      message: typeof item.message === 'string' ? item.message.trim() : '',
      image,
      link,
      until,
    });
  });
  return { definitions, errors };
}

/** "2026-11-13" or "13/11/2026" → 23:59:59.999 of that day, or null. */
export function parseEndOfDay(text) {
  const value = text.trim();
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [y, mo, d] = value.includes('/') ? [+m[3], +m[2], +m[1]] : [+m[1], +m[2], +m[3]];
  const day = build(y, mo, d, 0, 0);
  return day === null ? null : day + 24 * 60 * 60_000 - 1;
}

/** An absolute https:// URL, or null. */
export function parseImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Daily digest: one message a day that lists today's events.

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const MAX_EMBEDS = 10; // Discord limit per message
const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of `ms` in the process time zone. */
export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "9:00" / "09:00" → "09:00", or null. */
export function parseClock(text) {
  const m = String(text).trim().match(/^(\d{1,2}):(\d{2})$/);
  return m && +m[1] <= 23 && +m[2] <= 59 ? `${pad(m[1])}:${m[2]}` : null;
}

/**
 * Something done once a day: due on the first run at or after `time` (HH:MM)
 * of a day not done yet (`lastDay`). Returns { due, today }.
 */
export function isDailyRunDue(time, now, lastDay) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  const today = localDay(now);
  return { due: lastDay !== today && d.getHours() * 60 + d.getMinutes() >= h * 60 + m, today };
}

/** events.json "dailyAt": time of the daily digest, default 08:00. */
export function loadDailyAt(raw) {
  if (raw?.dailyAt === undefined) return { time: '08:00', errors: [] };
  const time = parseClock(raw.dailyAt);
  return time
    ? { time, errors: [] }
    : { time: '08:00', errors: [`events.json: "dailyAt" phải có dạng HH:MM (đang là ${raw.dailyAt}), dùng 08:00`] };
}

/** Events that happen on the local day of `now`, sorted by time: [{ def, occurrence }]. */
export function eventsOnDay(definitions, now) {
  const d = new Date(now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return definitions
    .map((def) => ({ def, occurrence: nextOccurrence(def, dayStart - 1) }))
    .filter(({ occurrence }) => occurrence !== null && occurrence < dayEnd)
    .sort((a, b) => a.occurrence - b.occurrence);
}

/**
 * Discord webhook bodies for the digest of one day (one embed per event, at
 * most 10 per message). Links go in the description: embeds that share a url
 * would be merged into one by Discord.
 */
export function buildDigest(items, now) {
  if (!items.length) return [];
  const roles = new Set(items.map(({ def }) => def.role).filter(Boolean));
  const everyone = roles.has('everyone') ? 'everyone' : roles.has('here') ? 'here' : null;
  const roleIds = [...roles].filter((r) => r !== 'everyone' && r !== 'here');
  const mentions = [everyone && `@${everyone}`, ...roleIds.map((id) => `<@&${id}>`)].filter(Boolean).join(' ');

  const d = new Date(now);
  const header = `📅 **Sự kiện hôm nay — ${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}**`;
  const embeds = items.map(({ def, occurrence }) => {
    const t = new Date(occurrence);
    const lines = [];
    if (def.type) lines.push(EVENT_TYPES[def.type]);
    if (def.message) lines.push(def.message);
    if (def.until != null && localDay(def.until) === localDay(now)) lines.push('⏳ Hôm nay là ngày cuối');
    if (def.link) lines.push(`[📖 Xem chi tiết sự kiện](${def.link})`);
    const embed = { title: `🔔 ${pad(t.getHours())}:${pad(t.getMinutes())} · ${def.title}` };
    if (lines.length) embed.description = lines.join('\n');
    if (def.image) embed.image = { url: def.image };
    return embed;
  });

  const bodies = [];
  for (let i = 0; i < embeds.length; i += MAX_EMBEDS) {
    bodies.push({
      content: i === 0 ? `${mentions ? `${mentions} ` : ''}${header}` : `${header} (tiếp)`,
      allowed_mentions: i === 0 ? { parse: everyone ? ['everyone'] : [], roles: roleIds } : { parse: [] },
      embeds: embeds.slice(i, i + MAX_EMBEDS),
    });
  }
  return bodies;
}
