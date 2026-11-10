process.env.TZ = 'Asia/Ho_Chi_Minh';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDigest,
  eventsOnDay,
  isDailyRunDue,
  loadDailyAt,
  loadEventDefinitions,
  nextOccurrence,
  parseDateTime,
  parseRepeat,
  parseRoleMap,
} from '../src/schedule.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
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

test('daily: next occurrence around the clock time', () => {
  const daily = { startAt: parseDateTime('08:00'), repeat: 'daily' };
  assert.equal(nextOccurrence(daily, at(2026, 11, 9, 7, 59)), at(2026, 11, 9, 8));
  assert.equal(nextOccurrence(daily, at(2026, 11, 9, 8, 3)), at(2026, 11, 10, 8));
});

test('weekly keeps the weekday of the date', () => {
  const weekly = { startAt: at(2026, 11, 11, 20), repeat: 'weekly' }; // Wednesday
  assert.equal(nextOccurrence(weekly, at(2026, 11, 12)), at(2026, 11, 18, 20));
});

test('weekly and monthly do not fire before their start date', () => {
  const weekly = { startAt: at(2026, 11, 11, 20), repeat: 'weekly' };
  assert.equal(nextOccurrence(weekly, at(2026, 11, 1)), at(2026, 11, 11, 20));
});

test('monthly clamps to the last day of short months', () => {
  const monthly = { startAt: at(2026, 1, 31, 8), repeat: 'monthly' };
  assert.equal(nextOccurrence(monthly, at(2026, 3, 1)), at(2026, 3, 31, 8));
  assert.equal(nextOccurrence(monthly, at(2026, 2, 1)), at(2026, 2, 28, 8));
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

test('image must be an https link', () => {
  const { definitions, errors } = loadEventDefinitions([
    { title: 'Có ảnh', time: '09:00', image: 'https://example.com/banner.png' },
    { title: 'http', time: '09:00', image: 'http://example.com/a.png' },
    { title: 'Không phải link', time: '10:00', image: 'banner.png' },
  ]);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].image, 'https://example.com/banner.png');
  assert.equal(errors.length, 2);
});

test('the digest runs once a day, on the first run at or after dailyAt', () => {
  assert.deepEqual(isDailyRunDue('08:00', at(2026, 11, 10, 7, 55), '2026-11-09'), { due: false, today: '2026-11-10' });
  assert.equal(isDailyRunDue('08:00', at(2026, 11, 10, 8, 7), '2026-11-09').due, true);
  assert.equal(isDailyRunDue('08:00', at(2026, 11, 10, 22, 7), undefined).due, true); // late run still sends
  assert.equal(isDailyRunDue('08:00', at(2026, 11, 10, 22, 7), '2026-11-10').due, false); // already sent
  assert.deepEqual(loadDailyAt({}), { time: '08:00', errors: [] });
  assert.equal(loadDailyAt({ dailyAt: '7:30' }).time, '07:30');
  assert.equal(loadDailyAt({ dailyAt: '25:00' }).errors.length, 1);
});

const { definitions: DAY } = loadEventDefinitions(
  [
    { title: 'Tối', time: '20:00', role: 'everyone', type: 'in-game', message: 'Vào game', until: '2026-11-10' },
    { title: 'Sáng thứ Ba', time: '2026-11-03 09:00', repeat: 'weekly', role: 'dev', link: 'https://e.com/a', image: 'https://e.com/a.webp' },
    { title: 'Thứ Tư', time: '2026-11-11 12:00', repeat: 'weekly' },
    { title: 'Ngày 10', time: '2026-10-10 10:00', repeat: 'monthly' },
    { title: 'Đã hết', time: '08:00', until: '2026-11-09' },
  ],
  { dev: ROLE },
);

test("eventsOnDay lists today's events by time and skips ended ones", () => {
  const items = eventsOnDay(DAY, at(2026, 11, 10, 8, 7)); // Tuesday 10/11
  assert.deepEqual(
    items.map(({ def, occurrence }) => [def.title, occurrence]),
    [
      ['Sáng thứ Ba', at(2026, 11, 10, 9)],
      ['Ngày 10', at(2026, 11, 10, 10)],
      ['Tối', at(2026, 11, 10, 20)],
    ],
  );
  // Same list late in the day, also for events already past.
  assert.equal(eventsOnDay(DAY, at(2026, 11, 10, 23, 7)).length, 3);
  assert.deepEqual(eventsOnDay(DAY, at(2026, 11, 11, 8)).map(({ def }) => def.title), ['Thứ Tư']);
});

test('buildDigest makes one message with one embed per event and only the intended mentions', () => {
  const now = at(2026, 11, 10, 8, 7);
  const [body, ...rest] = buildDigest(eventsOnDay(DAY, now), now);
  assert.equal(rest.length, 0);
  assert.equal(body.content, `@everyone <@&${ROLE}> 📅 **Sự kiện hôm nay — Thứ Ba, 10/11/2026**`);
  assert.deepEqual(body.allowed_mentions, { parse: ['everyone'], roles: [ROLE] });
  assert.deepEqual(body.embeds, [
    { title: '🔔 09:00 · Sáng thứ Ba', description: '[📖 Xem chi tiết sự kiện](https://e.com/a)', image: { url: 'https://e.com/a.webp' } },
    { title: '🔔 10:00 · Ngày 10' },
    { title: '🔔 20:00 · Tối', description: '🎮 Sự kiện in-game\nVào game\n⏳ Hôm nay là ngày cuối' },
  ]);
  assert.deepEqual(buildDigest([], now), []);
});

test('buildDigest splits more than 10 events and pings nobody without roles', () => {
  const { definitions } = loadEventDefinitions(
    Array.from({ length: 12 }, (_, i) => ({ title: `S${i}`, time: `${String(i + 8).padStart(2, '0')}:00` })),
  );
  const now = at(2026, 11, 10, 8);
  const bodies = buildDigest(eventsOnDay(definitions, now), now);
  assert.deepEqual(bodies.map((b) => b.embeds.length), [10, 2]);
  assert.deepEqual(bodies[0].allowed_mentions, { parse: [], roles: [] });
  assert.match(bodies[1].content, /\(tiếp\)$/);
});
