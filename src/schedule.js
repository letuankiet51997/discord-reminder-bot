// Pure logic: parse events.json and decide which reminders are due.
// All dates use the process time zone (TZ=Asia/Ho_Chi_Minh).

export const REPEATS = {
  daily: 'Hằng ngày',
  weekly: 'Hằng tuần',
  monthly: 'Hằng tháng',
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

/** Latest occurrence of the event at or before `now`, or null if none yet. */
export function previousOccurrence({ startAt, repeat }, now) {
  if (now < startAt) return null;
  const start = new Date(startAt);
  const today = new Date(now);

  if (repeat === 'monthly') {
    for (let i = 0; i < 3; i += 1) {
      const occ = monthlyOn(today.getFullYear(), today.getMonth() - i, start);
      if (occ <= now && occ >= startAt) return occ;
    }
    return null;
  }

  for (let i = 0; i < 8; i += 1) {
    const day = atTimeOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), start);
    const matches = repeat === 'daily' || day.getDay() === start.getDay();
    if (matches && day.getTime() <= now && day.getTime() >= startAt) return day.getTime();
  }
  return null;
}

/** First occurrence of the event after `now`. Used for logs. */
export function nextOccurrence({ startAt, repeat }, now) {
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

/**
 * Reminders to send now. A reminder is due when its latest occurrence is not
 * older than `maxLateMs` and was not sent yet (`state[key]` is the occurrence
 * last sent). GitHub Actions runs late, so the window is generous.
 */
export function findDue(definitions, now, state, maxLateMs = 90 * 60_000) {
  const due = [];
  for (const def of definitions) {
    const occurrence = previousOccurrence(def, now);
    if (occurrence === null || now - occurrence > maxLateMs) continue;
    if ((state[def.key] ?? 0) >= occurrence) continue;
    due.push({ def, occurrence });
  }
  return due;
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
      message: typeof item.message === 'string' ? item.message.trim() : '',
    });
  });
  return { definitions, errors };
}

/** Discord webhook body for one reminder. */
export function buildMessage({ title, role, message }) {
  const everyone = role === 'everyone' || role === 'here';
  const mention = !role ? '' : everyone ? `@${role} ` : `<@&${role}> `;
  return {
    content: `${mention}🔔 **${title}**${message ? `\n${message}` : ''}`,
    allowed_mentions: everyone ? { parse: ['everyone'] } : { parse: [], roles: role ? [role] : [] },
  };
}
