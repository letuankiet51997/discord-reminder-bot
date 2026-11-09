import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedMessage, findNewItems, loadFeeds, nextSeen, parseFeed } from '../src/feeds.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <title>Nghịch Thủy Hàn</title>
  <item>
    <title><![CDATA[🎉 Mừng sinh nhật 1 tuổi &amp; quà lớn]]></title>
    <link>https://www.facebook.com/nghichthuyhanofficial/posts/2</link>
    <guid>post-2</guid>
    <description><![CDATA[<p>Chi tiết</p><img src="https://cdn.example.com/2.jpg">]]></description>
  </item>
  <item>
    <title>Bảo trì định kỳ</title>
    <link>https://www.facebook.com/nghichthuyhanofficial/posts/1</link>
    <guid>post-1</guid>
    <media:content url="https://cdn.example.com/1.jpg" medium="image"/>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>a-1</id><title>Tin mới</title><link href="https://example.com/a-1"/></entry>
</feed>`;

test('parseFeed reads RSS items with CDATA, entities and images', () => {
  assert.deepEqual(parseFeed(RSS), [
    { id: 'post-2', title: '🎉 Mừng sinh nhật 1 tuổi & quà lớn', link: 'https://www.facebook.com/nghichthuyhanofficial/posts/2', image: 'https://cdn.example.com/2.jpg' },
    { id: 'post-1', title: 'Bảo trì định kỳ', link: 'https://www.facebook.com/nghichthuyhanofficial/posts/1', image: 'https://cdn.example.com/1.jpg' },
  ]);
});

test('parseFeed reads Atom entries', () => {
  assert.deepEqual(parseFeed(ATOM), [{ id: 'a-1', title: 'Tin mới', link: 'https://example.com/a-1', image: null }]);
});

test('first run posts nothing, later runs post only new items oldest first', () => {
  const items = parseFeed(RSS);
  assert.deepEqual(findNewItems(items, undefined), []);
  assert.deepEqual(findNewItems(items, ['post-1']).map((i) => i.id), ['post-2']);
  assert.deepEqual(findNewItems(items, []).map((i) => i.id), ['post-1', 'post-2']);
  assert.deepEqual(nextSeen(items, ['old']), ['post-2', 'post-1', 'old']);
});

test('loadFeeds validates names, https urls, duplicates and roles', () => {
  const { feeds, errors } = loadFeeds(
    {
      feeds: [
        { name: 'Fanpage', url: 'https://fetchrss.com/rss/abc.xml', role: 'everyone' },
        { name: 'Trùng', url: 'https://fetchrss.com/rss/abc.xml' },
        { name: 'http', url: 'http://example.com/rss' },
        { name: 'Role lạ', url: 'https://example.com/b.xml', role: 'mod' },
      ],
    },
    { dev: '123456789012345678' },
  );
  assert.deepEqual(feeds, [{ name: 'Fanpage', url: 'https://fetchrss.com/rss/abc.xml', role: 'everyone' }]);
  assert.equal(errors.length, 3);
});

test('buildFeedMessage shows the post text, link and image', () => {
  const [item] = parseFeed(RSS);
  assert.deepEqual(buildFeedMessage({ name: 'Nghịch Thủy Hàn', role: null }, item), {
    content: '📰 **Nghịch Thủy Hàn** có bài viết mới\n🎉 Mừng sinh nhật 1 tuổi & quà lớn',
    allowed_mentions: { parse: [], roles: [] },
    embeds: [
      { title: '📖 Xem bài viết', url: item.link, image: { url: 'https://cdn.example.com/2.jpg' } },
    ],
  });
});

test('feeds are checked once a day, on the first run at or after the time', async () => {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
  const { isFeedCheckDue } = await import('../src/feeds.js');
  const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
  assert.deepEqual(isFeedCheckDue('09:00', at(10, 8, 55), '2026-11-09'), { due: false, today: '2026-11-10' });
  assert.deepEqual(isFeedCheckDue('09:00', at(10, 9, 12), '2026-11-09'), { due: true, today: '2026-11-10' });
  assert.equal(isFeedCheckDue('09:00', at(10, 15, 0), '2026-11-10').due, false); // already checked today
  assert.equal(isFeedCheckDue('09:00', at(10, 15, 0), undefined).due, true); // late run still checks
  assert.equal(loadFeeds({ time: '25:00', feeds: [] }).errors.length, 1);
  assert.equal(loadFeeds({ time: '7:30', feeds: [] }).time, '07:30');
});
