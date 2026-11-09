process.env.TZ = 'Asia/Ho_Chi_Minh';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage,
  findDue,
  loadEventDefinitions,
  nextOccurrence,
  parseDateTime,
  parseRepeat,
  parseRoleMap,
  previousOccurrence,
} from '../src/schedule.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MIN = 60_000;
const ROLE = '123456789012345678';

test('parseRepeat accepts only daily, weekly and monthly', () => {
  assert.equal(parseRepeat('daily'), 'daily');
  assert.equal(parseRepeat('Weekly'), 'weekly');
  assert.equal(parseRepeat(' monthly '), 'monthly');
  assert.equal(parseRepeat('once'), null);
  assert.equal(parseRepeat('hằng ngày'), null);
});

test('parseDateTime reads ISO, Vietnamese and time-only formats', () => {
  assert.equal(parseDateTime('2026-11-10 09:00'), at(2026, 11, 10, 9));
  assert.equal(parseDateTime('10/11/2026 09:00'), at(2026, 11, 10, 9));
  assert.equal(parseDateTime('08:30'), at(2000, 1, 1, 8, 30));
  assert.equal(parseDateTime('31/02/2026 09:00'), null);
  assert.equal(parseDateTime('25:00'), null);
});

test('parseRoleMap reads aliases separated by commas or new lines', () => {
  const { roles, errors } = parseRoleMap(`Dev=${ROLE}\nraider = 234567890123456789`);
  assert.deepEqual(roles, { dev: ROLE, raider: '234567890123456789' });
  assert.deepEqual(errors, []);
  assert.deepEqual(parseRoleMap(undefined), { roles: {}, errors: [] });
});

test('parseRoleMap rejects duplicate aliases, duplicate ids and bad entries', () => {
  const { roles, errors } = parseRoleMap(
    [`dev=${ROLE}`, 'DEV=234567890123456789', `mod=${ROLE}`, 'bad', 'x=123', 'everyone=345678901234567890'].join(','),
  );
  assert.deepEqual(roles, { dev: ROLE });
  assert.equal(errors.length, 5);
  assert.match(errors[0], /tên "dev" bị trùng/);
  assert.match(errors[1], /id 123456789012345678 bị trùng/);
});

test('daily: previous and next occurrence around the clock time', () => {
  const daily = { startAt: parseDateTime('08:00'), repeat: 'daily' };
  assert.equal(previousOccurrence(daily, at(2026, 11, 9, 8, 3)), at(2026, 11, 9, 8));
  assert.equal(previousOccurrence(daily, at(2026, 11, 9, 7, 59)), at(2026, 11, 8, 8));
  assert.equal(nextOccurrence(daily, at(2026, 11, 9, 8, 3)), at(2026, 11, 10, 8));
});

test('weekly keeps the weekday of the date', () => {
  const weekly = { startAt: at(2026, 11, 11, 20), repeat: 'weekly' }; // Wednesday
  assert.equal(previousOccurrence(weekly, at(2026, 11, 20, 12)), at(2026, 11, 18, 20));
  assert.equal(nextOccurrence(weekly, at(2026, 11, 12)), at(2026, 11, 18, 20));
});

test('weekly and monthly do not fire before their start date', () => {
  const weekly = { startAt: at(2026, 11, 11, 20), repeat: 'weekly' };
  assert.equal(previousOccurrence(weekly, at(2026, 11, 10)), null);
});

test('monthly clamps to the last day of short months', () => {
  const monthly = { startAt: at(2026, 1, 31, 8), repeat: 'monthly' };
  assert.equal(previousOccurrence(monthly, at(2026, 2, 28, 9)), at(2026, 2, 28, 8));
  assert.equal(nextOccurrence(monthly, at(2026, 2, 1)), at(2026, 2, 28, 8));
});

test('findDue sends once per occurrence and tolerates late runs', () => {
  const def = { key: 'k', startAt: parseDateTime('08:00'), repeat: 'daily' };
  const occ = at(2026, 11, 9, 8);

  assert.equal(findDue([def], occ - MIN, {}).length, 0); // not yet
  assert.deepEqual(findDue([def], occ + 40 * MIN, {}).map((d) => d.occurrence), [occ]); // late run
  assert.equal(findDue([def], occ + 40 * MIN, { k: occ }).length, 0); // already sent
  assert.equal(findDue([def], occ + 3 * 60 * MIN, {}).length, 0); // too late
});

test('loadEventDefinitions validates every field and resolves role aliases', () => {
  const { definitions, errors } = loadEventDefinitions(
    {
      events: [
        { title: 'Điểm danh', time: '08:00', role: '@everyone', message: 'Nhớ điểm danh!' },
        { title: 'Raid', time: '2026-11-11 20:00', repeat: 'weekly', role: 'Dev' },
        { title: 'Tổng kết', time: '15/11/2026 14:00', repeat: 'monthly' },
        { title: 'Sai giờ', time: 'abc' },
        { title: 'Sai lặp', time: '09:00', repeat: 'once' },
        { title: 'Thiếu ngày', time: '20:00', repeat: 'weekly' },
        { title: 'Id trần', time: '09:00', role: `<@&${ROLE}>` },
        { title: 'Chưa khai', time: '09:00', role: 'mod' },
        { title: 'Điểm danh', time: '08:00', role: 'here' },
        { time: '09:00' },
      ],
    },
    { dev: ROLE },
  );
  assert.deepEqual(
    definitions.map((d) => [d.title, d.repeat, d.role, d.message]),
    [
      ['Điểm danh', 'daily', 'everyone', 'Nhớ điểm danh!'],
      ['Raid', 'weekly', ROLE, ''],
      ['Tổng kết', 'monthly', null, ''],
    ],
  );
  assert.equal(definitions[0].key, 'Điểm danh|08:00|daily');
  assert.equal(errors.length, 7);
  assert.ok(errors.some((e) => /role "mod" chưa có/.test(e)));
  assert.ok(errors.some((e) => /trùng với một sự kiện khác/.test(e)));
});

test('loadEventDefinitions without a role map only checks the alias format', () => {
  const { definitions, errors } = loadEventDefinitions([{ title: 'A', time: '09:00', role: 'dev' }]);
  assert.deepEqual(errors, []);
  assert.equal(definitions[0].role, 'dev');
});

test('buildMessage only allows the intended mention', () => {
  assert.deepEqual(buildMessage({ title: 'A', role: 'everyone', message: 'x' }), {
    content: '@everyone 🔔 **A**\nx',
    allowed_mentions: { parse: ['everyone'] },
  });
  assert.deepEqual(buildMessage({ title: 'B', role: ROLE, message: '' }), {
    content: `<@&${ROLE}> 🔔 **B**`,
    allowed_mentions: { parse: [], roles: [ROLE] },
  });
  assert.deepEqual(buildMessage({ title: 'C', role: null, message: '' }).allowed_mentions, {
    parse: [],
    roles: [],
  });
});

test('image must be an https link and becomes an embed', () => {
  const { definitions, errors } = loadEventDefinitions([
    { title: 'Có ảnh', time: '09:00', image: 'https://example.com/banner.png' },
    { title: 'http', time: '09:00', image: 'http://example.com/a.png' },
    { title: 'Không phải link', time: '10:00', image: 'banner.png' },
  ]);
  assert.equal(definitions.length, 1);
  assert.equal(errors.length, 2);
  assert.deepEqual(buildMessage(definitions[0]).embeds, [{ image: { url: 'https://example.com/banner.png' } }]);
  assert.equal(buildMessage({ title: 'A', role: null, message: '', image: null }).embeds, undefined);
});

test('until stops reminders after that day', () => {
  const { definitions, errors } = loadEventDefinitions([
    { title: 'Điểm danh', time: '20:00', until: '2026-11-13' },
    { title: 'Sai until', time: '20:00', until: '13-11-2026' },
    { title: 'Until trước', time: '2026-11-20 20:00', repeat: 'weekly', until: '2026-11-13' },
  ]);
  assert.equal(errors.length, 2);
  const [def] = definitions;
  assert.equal(findDue([def], at(2026, 11, 13, 20, 5), {}).length, 1); // last day
  assert.equal(findDue([def], at(2026, 11, 14, 20, 5), {}).length, 0); // ended
  assert.equal(nextOccurrence(def, at(2026, 11, 13, 21)), null);
});

test('link becomes a clickable embed title, with the image below', () => {
  const [def] = loadEventDefinitions([
    { title: 'A', time: '09:00', link: 'https://example.com/event', image: 'https://example.com/a.webp' },
  ]).definitions;
  assert.deepEqual(buildMessage(def).embeds, [
    { title: '📖 Xem chi tiết sự kiện', url: 'https://example.com/event', image: { url: 'https://example.com/a.webp' } },
  ]);
  assert.equal(loadEventDefinitions([{ title: 'B', time: '09:00', link: 'không phải link' }]).errors.length, 1);
});

test('type adds an in-game or off-game line under the title', () => {
  const { definitions, errors } = loadEventDefinitions([
    { title: 'A', time: '09:00', type: 'off-game', message: 'Đăng ký trước' },
    { title: 'B', time: '09:00', type: 'In-Game' },
    { title: 'C', time: '09:00', type: 'online' },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(buildMessage(definitions[0]).content, '🔔 **A**\n📍 Sự kiện off-game\nĐăng ký trước');
  assert.equal(buildMessage(definitions[1]).content, '🔔 **B**\n🎮 Sự kiện in-game');
});
