# discord-event-bot

Gửi tin nhắc nhở vào một kênh Discord theo lịch trong `events.json`.
Chạy miễn phí bằng **GitHub Actions** (mỗi 5 phút) + **Discord Webhook** —
không cần server, không cần treo máy.

> Tin nhắc có thể đến **trễ 5–15 phút** (GitHub chạy lịch không đúng giờ).
> Lần chạy trễ tối đa 90 phút vẫn gửi; trễ hơn thì bỏ qua lần đó.

## Khai báo sự kiện — `events.json`

```json
{
  "$schema": "./events.schema.json",
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

| Trường | Bắt buộc | Giá trị |
|---|---|---|
| `title` | ✅ | Tiêu đề in đậm |
| `time` | ✅ | `08:00`, `2026-11-11 20:00` hoặc `11/11/2026 20:00`. Giờ Việt Nam |
| `repeat` | | `daily` (mặc định), `weekly` hoặc `monthly` |
| `role` | | Tên ngắn khai trong `DISCORD_ROLES` (ví dụ `raider`), `everyone` hoặc `here`. Bỏ trống = không ping |
| `message` | | Nội dung thêm dưới tiêu đề |
| `type` | | `in-game` (🎮 Sự kiện in-game) hoặc `off-game` (📍 Sự kiện off-game) — hiện dưới tiêu đề |
| `until` | | Ngày cuối còn nhắc (tính cả ngày đó): `2026-11-13` hoặc `13/11/2026`. Bỏ trống = lặp mãi |
| `link` | | Link `https://` trang sự kiện → dòng **📖 Xem chi tiết sự kiện** bấm được |
| `image` | | Link `https://` ảnh → hiện to dưới tin |

- `daily`: `time` chỉ cần giờ.
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
- **`state.json`** ghi lần nhắc đã gửi để không gửi trùng; workflow tự commit file
  này. Đừng sửa tay.
- Lần chạy có lỗi (JSON sai, role trùng, sự kiện trùng…) vẫn gửi các sự kiện hợp
  lệ, nhưng hiện ❌ trong tab Actions — mở log để xem dòng `⚠️`.
- GitHub **tắt lịch chạy của repo public sau 60 ngày không có hoạt động**. Các
  commit `state.json` mỗi khi gửi tin có thể giữ repo hoạt động, nhưng nếu thấy bot
  im lặng, vào tab Actions bật lại workflow.
- Repo public nên ai cũng xem được `events.json`. Đừng ghi thông tin riêng tư.

## Chạy trên máy

```bash
npm test          # kiểm tra logic và events.json
DISCORD_ROLES="dev=123..." npm run dry-run   # in ra tin sẽ gửi lúc này, không gửi thật
DISCORD_ROLES="dev=123..." DISCORD_WEBHOOK_URL=... npm run send   # gửi thật
```

Cần Node.js 20 trở lên. Không có dependency nào.
