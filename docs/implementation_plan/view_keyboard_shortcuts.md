# View Keyboard Shortcuts — Zoom & Fullscreen (Settings → Keyboard Shortcuts → View)

Đưa bốn phím tắt *đã hoạt động* của nhóm View vào registry để người dùng đổi được. Không thêm chức năng, không
viết lại logic zoom / fullscreen. Nền: `keyboard_shortcuts.md` (General, Reader).

## 1. Phạm vi

| Action id | Label | Mặc định | Alias cố định | Context |
|---|---|---|---|---|
| `view.zoomIn` | Zoom In | `Ctrl/Cmd + =` | `Ctrl/Cmd + Shift + =` (Ctrl + "+") | reader |
| `view.zoomOut` | Zoom Out | `Ctrl/Cmd + -` | `Ctrl/Cmd + Shift + -` (Ctrl + "_") | reader |
| `view.resetZoom` | Reset Zoom | `Ctrl/Cmd + 0` | — | reader |
| `view.toggleFullscreen` | Toggle Fullscreen | `F11` | — | library, reader, settings |

Tên id theo convention hiện có (`<group>.<action>`, camelCase). Numpad `+` / `-` / `0` đã được chuẩn hoá về
`=` / `-` / `0` bởi `shortcutKeys.ts` nên khớp mặc định.

## 2. Kết quả inspect (trước khi code)

| Thành phần | Hiện trạng |
|---|---|
| Zoom | `useReaderZoomControls.ts`: `handleZoomStep(±1)` + `setViewZoomCentered(ZOOM_DEFAULT)` (zoom *khung nhìn* qua `ReaderZoomViewport`; Aa font-size nằm ở panel Settings). Phím do **một listener `window` keydown** trong chính hook xử lý (đọc `e.key`, bỏ qua input/textarea/contentEditable). |
| Fullscreen | `AppChannels.toggleFullscreen` (IPC) ← `appApi.toggleFullscreen` ← `ImmersiveReadingContext.toggleFullscreen` (nút footer dùng cái này). Phím **F11 do Main xử lý** trong `installFullscreenShortcuts` (`before-input-event`), cùng với `Esc` thoát fullscreen. |
| Registry / bridge | `shortcutDefinitions.ts`, `ShortcutsBridge` (capture, window + iframe EPUB trong Reader), `useShortcutAction`. |
| Persistence / reset / conflict / alias | `shortcutsStore` (localStorage `readmate.keyboardShortcuts.v1`), `resetOne`, `reset`, `findShortcutConflict` (kể cả alias). |
| macOS | `Mod` = ⌘ trên macOS, Ctrl trên Windows/Linux; không hard-code Ctrl. |
| Renderer | Chỉ EPUB là renderer Reader thật; định dạng khác dùng placeholder chapters. **Chưa có PDF viewer.** |

## 3. Thiết kế

### 3.1 Tái sử dụng handler, một dispatcher cho mỗi phím

- **Zoom**: listener `window` cũ trong `useReaderZoomControls` **bị xoá**. Thay bằng
  `useShortcutAction('view.zoomIn', () => handleZoomStep(1))`, `'view.zoomOut'` → `handleZoomStep(-1)`,
  `'view.resetZoom'` → `setViewZoomCentered(ZOOM_DEFAULT)` — đúng các hàm cũ, không logic mới.
- **Fullscreen**: nhánh F11 trong Main (`installFullscreenShortcuts`) **bị xoá** (giữ `Esc` thoát fullscreen và
  thông báo `enter/leave-full-screen`). `ImmersiveReadingProvider` đăng ký
  `useShortcutAction('view.toggleFullscreen', toggleFullscreen)` — cùng callback nút footer gọi. Nếu giữ nhánh
  Main, F11 sẽ toggle hai lần và đổi phím không có tác dụng.
- Mỗi id chỉ có **một** `useShortcutAction`; spike kiểm tra bằng cách quét source.

### 3.2 Guard

- Zoom giữ hành vi cũ "không chạy trong ô nhập": cờ mới `ignoreInTextFields` trên định nghĩa; bridge lọc theo
  cờ (kể cả khi có Ctrl/⌘).
- Phím F1–F12 không còn bị xem là "phím trần" (`isPlainShortcut`): F11 vẫn chạy khi đang gõ hoặc có modal, như
  handler Main cũ. Các phím trần thật vẫn bị chặn như trước.
- `event.repeat` bị bỏ (giữ F11 không nhấp nháy fullscreen; giữ Ctrl+= không zoom liên tục — đổi nhẹ so với
  listener cũ vốn lặp theo auto-repeat).

### 3.3 Customize UI

Không đổi giao diện: `KeyboardShortcutsSettings` render theo `SHORTCUT_GROUPS` nên nhóm **View** tự xuất hiện;
chip bấm-để-đổi, cảnh báo đỏ dịu, Reset từng dòng, Reset to Defaults, alias hiển thị chỉ-đọc (cơ chế đợt Reader).
Tooltip nút fullscreen và dòng gợi ý trong panel Aa đọc phím hiện hành (`useShortcutLabel`) thay vì chữ cố định.

## 4. Files changed

- Mới: `src/shortcuts/useShortcutLabel.ts`, `docs/implementation_plan/view_keyboard_shortcuts.md`.
- Sửa: `src/shortcuts/{shortcutDefinitions,shortcutKeys,ShortcutsBridge,index}`,
  `src/screens/Reader/logic/hooks/useReaderZoomControls.ts`, `src/chrome/ImmersiveReadingContext.tsx`,
  `electron/ipc/app.ipc.ts`, `FullscreenButton.tsx`, `AaSettingsPanel.tsx`,
  `spikes/shortcuts/run-shortcuts.mjs`, `docs/implementation_plan/keyboard_shortcuts.md`.

## 5. Test & validation (chạy thật)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | pass |
| `npm run spike:settings:shortcuts` | pass — 35 check (28 trước + 7 View) |
| `npm run spike:settings:reset` | pass — 14 check |
| `npx vite build` (renderer + Electron main/preload) | pass |
| `npx eslint --max-warnings 0` trên file đã sửa | sạch, trừ 1 warning `react-refresh/only-export-components` ở `ImmersiveReadingContext.tsx` **có sẵn ở HEAD** (export `useImmersiveReading`) |

7 check View mới (logic thuần + quét source): bốn action trong nhóm View với mặc định / context đúng; phím
vật lý cũ (`=`, Numpad±, Ctrl+Shift+=/-, `0`, Numpad0, F11) khớp đúng action và Alt/Library không khớp zoom; F-key
không bị coi là phím trần; đổi phím → phím cũ ngừng khớp; conflict theo context + alias (kể cả alias của chính
nó, Toggle Fullscreen vs Ctrl+F, F11 vs action Reader); lưu bền + nạp lại như khởi động lại + reset từng dòng /
cả trang; **một dispatcher mỗi phím** (không `addEventListener('keydown')` / `e.key ===` trong hook zoom, Main
không còn F11, mỗi `view.*` đúng một `useShortcutAction`).

### Kiểm tay (không tự động hoá được — repo không có UI test)

1. EPUB mở: `Ctrl+=`, `Ctrl+-`, `Ctrl+0` mỗi lần nhấn đổi zoom đúng một nấc / về 100%; thử cả khi focus trong
   nội dung sách (iframe) và trong ô nhập (không được zoom).
2. `F11` bật/tắt đúng một lần ở Library, Reader, Settings; nhấn giữ không nhấp nháy.
3. Settings → View: đổi từng phím → phím mới chạy, phím cũ không; thử conflict; Reset từng dòng; Reset to
   Defaults; đóng/mở lại app giữ phím đã đổi.
4. Tooltip nút fullscreen và gợi ý trong panel Aa hiển thị phím đã đổi.

## 6. Giới hạn / hành vi đổi

- **Chưa kiểm trong app thật** — chỉ spike logic + typecheck/build.
- F11 do renderer xử lý: không hoạt động ở route không có context (Splash) và khi renderer chưa tải; trước đây
  Main bắt ở mọi lúc. `Esc` thoát fullscreen vẫn ở Main, cố định, không liệt kê trong Settings.
- Khớp theo phím *vật lý* (`event.code`) thay vì ký tự (`event.key`): bàn phím nơi `+` là phím riêng (vd. QWERTZ)
  không còn khớp mặc định bằng ký tự đó — ghi phím vật lý muốn dùng ở Settings là xong.
- Khi focus nằm trong iframe EPUB, phím zoom nay đi qua bridge (listener cũ ở `window` không nhận sự kiện iframe);
  đây là khác biệt tích cực nhưng chưa kiểm trong app.
- Zoom áp dụng cho khung nhìn Reader hiện có (EPUB / placeholder). Không có hành vi PDF riêng vì chưa có PDF
  renderer; không thêm hành vi nào ngoài phạm vi.
- Chưa có nhóm Annotation (Ctrl+Z/Y, Delete highlight).
