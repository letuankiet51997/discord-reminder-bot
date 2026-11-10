# discord-event-bot

Mỗi ngày gửi **một tin tổng hợp** vào một kênh Discord, liệt kê các sự kiện diễn
ra hôm nay (giờ, loại, nội dung, ảnh, link) theo lịch trong `events.json`.
Chạy miễn phí bằng **GitHub Actions** (mỗi giờ) + **Discord Webhook** — không cần
server, không cần treo máy.

> Tin gửi ở lần chạy đầu tiên từ `dailyAt` (mặc định `08:00`) trở đi. GitHub hay
> bỏ hoặc trễ lịch chạy, nên tin có thể đến muộn vài giờ; trong ngày chỉ cần một
> lần chạy thành công là đủ. Hôm nào không có sự kiện thì không gửi gì.

## Khai báo sự kiện — `events.json`

```json
{
  "$schema": "./events.schema.json",
  "dailyAt": "08:00",
  "events": [
    {
      "title": "Điểm danh buổi sáng",
      "time": "08:00",
      "repeat": "daily",
      "role": "everyone",
      "message": "Chào buổi sáng mọi người, nhớ điểm danh nhé!"
    },
    {
      "title": "Raid guild",
      "time": "2026-11-11 20:00",
      "repeat": "weekly",
      "role": "raider"
    }
  ]
}
```

`dailyAt` (không bắt buộc): giờ gửi tin tổng hợp mỗi ngày, mặc định `08:00`.

Mỗi sự kiện diễn ra hôm nay là một khung trong tin, xếp theo giờ:
**🔔 20:00 · Tiêu đề**, rồi loại, nội dung, link **📖 Xem chi tiết sự kiện** và ảnh.

| Trường | Bắt buộc | Giá trị |
|---|---|---|
| `title` | ✅ | Tiêu đề khung |
| `time` | ✅ | `08:00`, `2026-11-11 20:00` hoặc `11/11/2026 20:00`. Giờ Việt Nam, hiện cạnh tiêu đề |
| `repeat` | | `daily` (mặc định), `weekly` hoặc `monthly` |
| `role` | | Ai được ping khi hôm nay có sự kiện này: tên khai trong `DISCORD_ROLES` (ví dụ `raider`), `everyone` hoặc `here`. Bỏ trống = không ping. Tin tổng hợp ping gộp các role của sự kiện hôm nay |
| `message` | | Nội dung thêm dưới tiêu đề |
| `type` | | `in-game` (🎮 Sự kiện in-game) hoặc `off-game` (📍 Sự kiện off-game) |
| `until` | | Ngày cuối còn liệt kê (tính cả ngày đó, có dòng ⏳ Hôm nay là ngày cuối): `2026-11-13` hoặc `13/11/2026`. Bỏ trống = lặp mãi |
| `link` | | Link `https://` trang sự kiện → dòng **📖 Xem chi tiết sự kiện** bấm được |
| `image` | | Link `https://` ảnh → hiện to trong khung |

- `daily`: `time` chỉ cần giờ → có trong tin mỗi ngày.
- `weekly`: `time` phải có ngày → lặp vào **thứ** của ngày đó.
- `monthly`: `time` phải có ngày → lặp vào **ngày trong tháng** đó (tháng ngắn
  hơn thì vào ngày cuối tháng).
- Không được có hai sự kiện cùng `title` + `time` + `repeat`.

## Role — biến môi trường `DISCORD_ROLES`

Id role **không** ghi trong `events.json` (repo public). Khai trong biến môi
trường `DISCORD_ROLES` dạng `ten=id`, cách nhau bởi dấu phẩy hoặc xuống dòng:

```
dev=123456789012345678
raider=234567890123456789
```

- Lấy id role: bật **Developer Mode** (Settings → Advanced), vào Server Settings →
  Roles → chuột phải role → **Copy Role ID**.
- Tên: chữ, số, `-`, `_`; không phân biệt hoa thường; không dùng `everyone`/`here`.
- **Không được trùng**: một tên chỉ khai một lần, một id chỉ gắn với một tên.
  Trùng thì bot báo lỗi và bỏ dòng trùng.
- Sự kiện dùng tên chưa khai → bỏ qua sự kiện đó và báo lỗi.

Ví dụ đủ mọi trường hợp: [`events.example.json`](events.example.json).
Định dạng chính xác: [`events.schema.json`](events.schema.json).
Hướng dẫn cho AI sửa lịch: [`AGENTS.md`](AGENTS.md).

## Bài viết mới từ Facebook / RSS — `feeds.json`

Facebook không có RSS, nên dùng dịch vụ chuyển fanpage thành link RSS, ví dụ
[FetchRSS](https://fetchrss.com/) hoặc [RSS.app](https://rss.app/rss-feed/create-facebook-rss-feed)
(cần đăng ký; gói miễn phí giới hạn số feed và tần suất cập nhật). Dán link fanpage
(ví dụ `https://www.facebook.com/nghichthuyhanofficial/`) → lấy link RSS `.xml`.

```json
{
  "time": "09:00",
  "feeds": [
    {
      "name": "Nghịch Thủy Hàn",
      "url": "https://fetchrss.com/rss/xxxxxxxx.xml",
      "role": "everyone"
    }
  ]
}
```

| Trường | Bắt buộc | Giá trị |
|---|---|---|
| `time` | | Giờ kiểm tra mỗi ngày, mặc định `09:00` |
| `name` | ✅ | Tên hiện trong tin: "📰 **Nghịch Thủy Hàn** có bài viết mới" |
| `url` | ✅ | Link RSS/Atom `https://`. Không trùng nhau |
| `role` | | Như sự kiện: tên trong `DISCORD_ROLES`, `everyone`, `here` |

- Bot kiểm tra **mỗi ngày một lần**, ở lần chạy đầu tiên từ `time` trở đi (GitHub
  có thể trễ vài phút). Bài mới được gửi kèm link **📖 Xem bài viết** và ảnh.
- **Lần kiểm tra đầu tiên của một feed không gửi gì**: bot chỉ ghi nhớ các bài đang
  có để không xả bài cũ vào kênh. Từ hôm sau mới gửi bài mới. Tối đa 5 bài/feed/lần.
- `feeds-state.json` lưu bài đã gửi — đừng sửa tay.

## Cài đặt (một lần, ~10 phút)

1. **Tạo webhook**: trong Discord, chuột phải bot channel → **Edit Channel** →
   **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**.
2. **Tạo repo GitHub public** và đẩy thư mục này lên:

   ```bash
   git add . && git commit -m "feat: reminder bot"
   git remote add origin https://github.com/<ban>/discord-event-bot.git
   git push -u origin main
   ```

3. **Thêm secret**: repo → **Settings** → **Secrets and variables** → **Actions**
   → **New repository secret**, tạo hai secret:
   - `DISCORD_WEBHOOK_URL`: URL webhook.
   - `DISCORD_ROLES`: danh sách `ten=id` ở trên. Thêm role mới → sửa secret này.
4. **Bật Actions**: tab **Actions** → bật workflow nếu GitHub hỏi. Bấm
   **remind → Run workflow** để chạy thử ngay.

Sửa lịch: sửa `events.json` (trên GitHub hoặc nhờ AI), commit — lần chạy kế tiếp
sẽ dùng lịch mới.

## Lưu ý

- **Không để lộ webhook URL**: ai có URL đều gửi được tin vào kênh. Chỉ lưu trong
  GitHub Secret, không ghi vào file nào.
- **`state.json`** ghi ngày đã gửi tin tổng hợp (`lastDigest`) để không gửi trùng;
  workflow tự commit file này. Đừng sửa tay. Muốn gửi lại tin hôm nay: xoá dòng
  `lastDigest` rồi commit.
- Lần chạy có lỗi (JSON sai, role trùng, sự kiện trùng…) vẫn gửi tin với các sự
  kiện hợp lệ, nhưng hiện ❌ trong tab Actions — mở log để xem dòng `⚠️`.
- GitHub **tắt lịch chạy của repo public sau 60 ngày không có hoạt động**. Commit
  `state.json` mỗi ngày có thể giữ repo hoạt động, nhưng nếu thấy bot
  im lặng, vào tab Actions bật lại workflow.
- Repo public nên ai cũng xem được `events.json`. Đừng ghi thông tin riêng tư.

## Chạy trên máy

```bash
npm test          # kiểm tra logic và events.json
DISCORD_ROLES="dev=123..." FORCE_DIGEST=1 npm run dry-run   # in ra tin hôm nay, không gửi thật
DISCORD_ROLES="dev=123..." DISCORD_WEBHOOK_URL=... npm run send   # gửi thật
```

Cần Node.js 20 trở lên. Không có dependency nào.
