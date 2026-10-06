# Reading Reminders & Start at Login (Settings → Notifications)

```
Notifications
├── Notification Permission
│   └── Enable Notifications            (công tắc tổng — reminder chỉ chạy khi bật)
├── Reading Reminders
│   ├── Enable Reminder
│   ├── Reminder Time                   (giờ địa phương, mặc định 20:00)
│   ├── Frequency / Limit: Maximum: 1 per day
│   └── Send test reminder              (gửi thử ngay, bỏ qua giờ / 1-lần-mỗi-ngày / đã-đọc)
└── Background / System Tray
    ├── Run in Background
    ├── System Tray
    ├── Start at Login                  (chạy ngầm khi bật máy, ẩn trong tray)
    └── Quit from Tray
```

## Ai làm chủ setting

Worker nhắc đọc chạy trong **Main** (kể cả khi cửa sổ ẩn / khởi động cùng máy), nên Main làm chủ:

| Dữ liệu | Nơi lưu | Default (nguồn duy nhất) |
|---|---|---|
| `enabled` (Enable Notifications), `reminder.enabled`, `reminder.time` | `{userData}/notification-prefs.json` | `DEFAULT_NOTIFICATION_PREFS` — `electron/notifications/notification-prefs.ts` |
| `lastSentDate` (`YYYY-MM-DD` local) — trạng thái, không phải setting | `{userData}/reading-reminder-state.json` | `null` |
| Start at Login | Danh sách login item của OS (`app.getLoginItemSettings()`) — app không tự lưu | tắt |

Trước đây `Enable Notifications` nằm trong `localStorage` (`reading-book.notifications.v1`); lần đầu mở trang, store
renderer chuyển giá trị `true` sang Main rồi xoá key cũ.

File JSON ghi atomic (file tạm + rename) qua `electron/prefs/json-prefs-file.ts`; Main **ghi trước rồi mới áp dụng** —
ghi lỗi thì trả `{ ok: false, prefs: <giá trị cũ> }`, UI báo lỗi và giữ giá trị cũ. IPC chỉ nhận đúng kiểu
(`boolean`, `HH:MM` hợp lệ — giờ sai bị bỏ qua, giữ giờ cũ).

## Reading Reminder — điều kiện gửi

`decideReminder()` (`electron/reminders/reminder-schedule.ts`, hàm thuần), đánh giá theo thứ tự, mọi mốc thời gian
theo **giờ địa phương** của máy (không bao giờ UTC):

1. Enable Notifications bật và Enable Reminder bật.
2. Giờ hiện tại ≥ Reminder Time **và** < Reminder Time + `REMINDER_GRACE_MINUTES` (60 phút). Đúng phút thì gửi; nếu
   phút đó máy đang ngủ / app chưa chạy thì vẫn nhắc bù trong 60 phút, nhưng không nhắc muộn hơn (tránh báo nửa đêm).
3. `lastSentDate !== hôm nay` (tối đa 1 lần/ngày).
4. Hôm nay **chưa đọc**: không có sách nào có `books.reading_state_json.updatedAt` ≥ 00:00 local hôm nay
   (mốc đổi sang UTC, so bằng `julianday()` nên không phụ thuộc định dạng chuỗi). `updatedAt` được ghi khi Reader
   autosave vị trí đọc và khi mở sách. Truy vấn DB chỉ chạy khi 1–3 đã qua.

Khi gửi: ghi `lastSentDate = hôm nay` **trước** khi hiện (crash không gây gửi lần 2); nếu không hiện được thì hoàn tác
để tick sau trong khung giờ thử lại. Thông báo: **"📚 Time to read"** / **"Continue reading <sách đang đọc dở>?"**
(sách `reading_status = 'reading'` đọc gần nhất; không có thì mời chọn sách). Click → `showMainWindow()` + gửi
`notifications:openBook` xuống renderer → `ReminderNavigationBridge` gọi `openBook()` mở Reader.

## Worker (`reminder-worker.ts`, `reading-reminders.ts`)

- Không dùng `setInterval`: mỗi tick tự hẹn tick sau bằng `setTimeout` tới **ngay sau đầu phút kế tiếp**, tính từ đồng
  hồ thật → không trôi giờ, không chồng tick (cờ `ticking`), luôn chỉ một timer chờ.
- Đọc prefs mới nhất ở mỗi tick (đổi setting có hiệu lực ngay, không cần restart worker).
- Máy thức dậy (`powerMonitor` `resume` / `unlock-screen`) → kiểm tra ngay.
- SQLite: chỉ câu `SELECT` có tham số trên **kết nối dùng chung duy nhất** của app (`getDatabase()`); không mở kết nối
  riêng. Worker dừng trong `will-quit` **trước** `closeDatabase()`.
- Lỗi DB / lỗi hiển thị được log, vòng lặp vẫn chạy. Notification được giữ tham chiếu đến khi click/close (tránh GC mất
  handler click).
- Windows: `app.setAppUserModelId()` — bản đóng gói dùng `APP_USER_MODEL_ID` trong `main.ts`, **phải trùng `appId` trong
  `electron-builder.json5`** (hiện vẫn là placeholder `YourAppID`); bản dev dùng đường dẫn exe.

## Start at Login (`electron/background/login-item.ts`)

- Windows: `app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: [--hidden-at-startup] })` (bản dev thêm
  đường dẫn app vào `args`, giống đăng ký protocol). Đọc lại trạng thái bằng `getLoginItemSettings({ path, args })`.
- macOS: `setLoginItemSettings({ openAtLogin })`; nhận biết khởi động cùng máy qua `wasOpenedAtLogin`.
- Linux: Electron không hỗ trợ → `supported: false`, công tắc bị khoá.
- Khởi động có `--hidden-at-startup`: tray + worker chạy, cửa sổ vẫn được tạo và tải (để flush session / mở sách hoạt
  động) nhưng **không show** — chỉ khi tray tồn tại; tray tắt/lỗi thì mở cửa sổ bình thường (tránh tiến trình chạy mà
  người dùng không thấy). Mở lại bằng tray, chạy app lần nữa, hoặc click thông báo. Một lần chạy login thứ hai khi app
  đang chạy thì bỏ qua (không bật cửa sổ).

## Reset App Settings

Nhóm Notifications gọi `notifications:resetPrefs` (Main ghi `DEFAULT_NOTIFICATION_PREFS`; `lastSentDate` giữ nguyên nên
reset không làm nhắc 2 lần trong ngày). Nhóm Background gọi `background:resetPrefs`, kèm **tắt Start at Login**.

## Kiểm thử

- `npm run spike:settings:reminders` — chạy ở múi giờ UTC+7: ngày/nửa đêm/giờ nhắc theo local, bảng điều kiện, truy vấn
  SQLite trên schema migrations thật (`node:sqlite`), worker với đồng hồ giả (canh đầu phút, chậm 3 s vẫn không trôi,
  không chồng, thử lại khi hiện lỗi, lỗi DB không dừng vòng lặp, stop), prefs (validate, atomic, file hỏng, reset).
- `npm run spike:settings:notifications` — store renderer với Main giả lập (migration localStorage, quyền, lỗi ghi,
  reminder, race, test reminder).
- `npm run spike:settings:background` — thêm Start at Login (login item + `--hidden-at-startup`).
- Thủ công trong Electron: bật Enable Notifications → Enable Reminder → đặt giờ = phút kế tiếp, chưa mở sách hôm nay →
  thông báo hiện, click mở đúng sách; "Send test reminder"; bật Start at Login → đăng xuất/đăng nhập Windows → app chạy
  ẩn trong tray.
