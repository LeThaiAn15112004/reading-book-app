# Background / System Tray (Settings → Notifications)

Nằm trong trang **Notifications**, card thứ hai sau *Notification Permission*:

```
Notifications
├── Notification Permission
│   └── Enable Notifications
└── Background / System Tray
    ├── Run in Background
    ├── System Tray
    └── Quit from Tray
```

## Chức năng

| Tuỳ chọn | Ý nghĩa | Default |
|---|---|---|
| System Tray (`showTray`) | Icon Readmate ở khay hệ thống (macOS: menu bar). Menu: **Open Readmate**, **Quit Readmate**. Windows/Linux: click trái mở cửa sổ. | bật |
| Run in Background (`runInBackground`) | Bấm [X] thì **ẩn** cửa sổ (`hide()`), app vẫn chạy. Chỉ có hiệu lực khi tray bật — tắt tray thì Main tự tắt luôn tuỳ chọn này. | tắt |
| Quit from Tray | Mục **Quit Readmate** trong menu tray thoát hẳn app (kể cả khi đang chạy ngầm). Dòng này trong Settings giải thích điều đó và có nút **Quit Readmate** làm cùng việc. | — |

Hiện chưa có tác vụ nền nào (ví dụ nhắc đọc sách); chế độ này giữ tiến trình sống để các tác vụ đó gắn vào sau.

## Vì sao setting nằm ở Main (khác các app preference khác)

App preferences thường ở `localStorage` của renderer. Riêng nhóm này Main phải biết **trước khi renderer chạy** (tạo
tray lúc khởi động) và **đồng bộ trong `close` event** của cửa sổ. Vì vậy Main làm chủ:
`{userData}/background-prefs.json` (ghi atomic: file tạm + rename), default duy nhất là
`DEFAULT_BACKGROUND_PREFS` trong `electron/background/background-prefs.ts`. Renderer chỉ đọc/ghi qua IPC.

## Kiến trúc

```
Settings UI (NotificationsSettings → BackgroundTrayCard) → useBackgroundStore → bridge/background → preload
  → background:getPrefs | setPrefs | resetPrefs | quit      (electron/ipc/background.ipc.ts)
  → electron/background/background-mode.ts  (prefs trong bộ nhớ, Tray, cờ isQuitting, quitApp)
  → electron/background/background-prefs.ts (validate + file JSON)
main.ts: close handler → decideWindowClose() (electron/background/close-decision.ts, hàm thuần)
```

- `setPrefs` chỉ nhận đúng hai boolean; Main validate, **ghi file trước rồi mới áp dụng**. Ghi lỗi → trả
  `{ ok: false, prefs: <giá trị cũ> }`, không đổi gì; UI hiện lỗi và giữ giá trị cũ.
- Reset App Settings gọi `background:resetPrefs` (Main ghi default của chính nó); vì vậy `resetAppSettings()` là async
  và nút Reset có trạng thái "Resetting…".

## Close / quit — cờ `isQuitting`

`isQuitting` (trong `background-mode.ts`) phân biệt **đóng cửa sổ** với **thoát app**. Nó được bật bởi:

- `before-quit` — mọi đường thoát: Cmd+Q, Quit của tray, nút Quit trong Settings (`quitApp()` bật cờ rồi `app.quit()`),
  bất kỳ `app.quit()` nào;
- Windows tắt máy / restart / log off: `query-session-end` (đến trước `close`) và `session-end` của cửa sổ;
- macOS / Linux tắt máy: `powerMonitor` `shutdown`.

Quyết định khi cửa sổ nhận `close` (`decideWindowClose`):

| Đang flush | Session đã flush | `shouldHideOnClose()` | Hành động |
|---|---|---|---|
| có | — | — | đóng ngay (không chặn lần close thứ hai) |
| không | — | có | chặn → flush reading session → `hide()` |
| không | có | không | đóng |
| không | không | không | chặn → flush → đóng lại (T4.2), nếu đang thoát thì `app.quit()` lại |

`shouldHideOnClose()` = tray bật **và** Run in Background bật **và** không đang thoát **và** tray thực sự tạo được.
Sau flush của nhánh ẩn, nếu trong lúc đó bắt đầu thoát (`afterHideFlush`) thì đóng hẳn và gọi lại `app.quit()` — lệnh
thoát không bị nuốt. Vì vậy không có đường nào khiến app "không tắt được".

Mở lại cửa sổ đã ẩn: menu/click tray, mở app lần nữa (`second-instance`), deep link, click Dock (macOS `activate`) —
tất cả qua `showMainWindow()`.

## Safety boundaries

- Ẩn cửa sổ vẫn **lưu reading session trước** (cùng handshake flush như khi đóng).
- Không ẩn khi không có tray (kể cả khi tạo tray lỗi) — tránh cửa sổ ẩn không có đường quay lại.
- Thoát luôn thắng ẩn; tắt máy được coi là thoát.
- Renderer không có quyền gì mới ngoài 4 channel trên; không truyền đường dẫn file.

## Icon

`public/tray/tray.png` (+ `@2x`, màu amber, Windows/Linux) và `trayTemplate.png` (+ `@2x`, đen + alpha, template image
cho macOS). Sinh lại bằng `node scripts/generate-tray-icons.mjs`.

## Kiểm thử

- `npm run spike:settings:background` — module Main thật với `electron` giả lập: default/validate, file atomic, tray
  tạo/huỷ + menu + icon tồn tại, bảng quyết định close, mô phỏng ẩn → Quit từ tray → cửa sổ đóng, ghi file lỗi, tạo tray
  lỗi, reset.
- `npm run spike:settings:reset` — nhóm Background trong Reset App Settings (IPC giả lập, cả nhánh Main ghi lỗi).
- Thủ công trong Electron: bật cả hai → [X] ẩn cửa sổ, icon tray còn; click tray / Open mở lại; Quit Readmate thoát
  hẳn (tiến trình biến mất); tắt tray → [X] thoát như cũ; mở app lần hai khi đang ẩn → cửa sổ hiện lại.
