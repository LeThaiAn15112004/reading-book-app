# Keyboard Shortcuts (Settings → Keyboard Shortcuts)

Phím tắt nhóm **General**, cho phép người dùng đổi phím. Phát hiện trùng phím theo **ngữ cảnh (màn hình)**.

> Shortcut conflict is context-aware. Duplicate key combinations are allowed across mutually exclusive
> contexts, but are rejected when two actions can be active simultaneously in the same context.

## 1. Vấn đề

- Trang Keyboard Shortcuts chỉ hiển thị, chưa có phím tắt thật và chưa đổi được.
- Phím rải rác, hard-code trong từng hook (`Ctrl/Cmd+F` ở Reader, mũi tên lật trang, `Esc`…).
- Cần đổi phím mà không để hai action cùng bắn trên một lần nhấn, nhưng vẫn cho phép cùng một phím ở hai màn
  không bao giờ đồng thời (Library và Reader đều dùng `Ctrl+F`).

## 2. Kiến trúc hiện có (trước thay đổi)

- App preferences nằm ở zustand + localStorage, mỗi store một key; Reset App Settings gọi `reset()` của từng
  store qua `APP_SETTINGS_RESETTERS` (`reset_app_settings.md`).
- Không có bộ bắt phím chung; không có khái niệm scope; `isMac` chỉ có cục bộ.
- Repo không có test runner; kiểm tra bằng các script `spike:*`.

## 3. Hành vi UX

- Mỗi dòng: tên action bên trái, **chip phím** bên phải. Không có nút Edit riêng — bấm chip để sửa.
- Hover / focus chip: viền và nền dùng accent của app (`lib-accent`, `lib-accent-soft`).
- Đang ghi: chip hiện **Press a shortcut…**. `Esc` hoặc rời focus (click ra ngoài) huỷ, giữ phím cũ.
- Trùng phím (hoặc phím không hợp lệ): chip đỏ dịu (`red-400/40`, như các lỗi khác trong Settings) hiện phím
  vừa nhấn, dòng cảnh báo ngay dưới: `⚠ Already assigned to <Action>.` Không modal, không alert. Dòng vẫn
  lắng nghe để nhấn phím khác; phím cũ không đổi.
- Phím hợp lệ: lưu ngay, chip về trạng thái thường.
- Nút **Reset** nhỏ cạnh chip chỉ hiện khi dòng đó đã đổi; **Reset to Defaults** ở đầu trang (disabled khi
  chưa đổi gì).

## 4. Luồng ghi phím

`KeyboardShortcutsSettings.tsx` (`ShortcutRow`): bấm chip → `shortcutsStore.setRecording(id)` → listener
`keydown` (capture, `preventDefault` + `stopPropagation`) trên `window`:

1. `Escape` → huỷ, không ghi.
2. Chỉ modifier → bỏ qua, chờ phím chính.
3. Ngược lại → `tryAssign(id, keys)`; thành công thì thoát chế độ ghi, thất bại thì hiện cảnh báo.

Trong lúc ghi, `ShortcutsBridge` tạm dừng toàn bộ phím tắt (`recordingId` khác null).

## 5. Chuẩn hoá phím (`shortcuts/shortcutKeys.ts`)

- Lưu dạng trung lập: `Mod` (Ctrl trên Windows/Linux, ⌘ trên macOS), `Alt` (⌥), `Shift`, rồi phím chính; thứ
  tự cố định `Mod, Alt, Shift, key`. Chữ cái viết hoa.
- Phím chính lấy từ `event.code` (phím vật lý) nên `⌥+O` không thành "ø".
- Hỗ trợ: chữ, số, `F1–F12`, mũi tên, `PageUp/PageDown`, `Home/End`, `Enter`, `Space`, `Tab`, `Insert`,
  `Delete`, `Backspace` và dấu câu thường dùng.
- `shortcutKeysId` là chuỗi so sánh ổn định; thứ tự modifier và hoa/thường không tạo ra phím khác nhau.
- Hợp lệ (`validateShortcutKeys`): không chỉ gồm modifier; phải có modifier trừ phím F; không phải Shift +
  phím đơn; không thuộc danh sách hệ thống: `Mod+C/V/X/A/Z/Y`, `Mod+Shift+Z`, `Mod+Q`, `Mod+W`, `Alt+F4`.

## 6. Mô hình context

Mỗi action khai báo `contexts: ('library' | 'reader' | 'settings')[]` trong `shortcutDefinitions.ts`. Đây là
các route nên chỉ một cái hiện hành tại một thời điểm.

| Action | contexts | Mặc định |
|---|---|---|
| Open Book | library, reader, settings | `Mod+O` |
| Search Library | library | `Mod+F` |
| Search in Book | reader | `Mod+F` |
| Open Settings | library, reader | `Mod+,` |
| Back to Library | reader, settings | `Alt+←` |

## 7. Quy tắc phát hiện conflict (`shortcuts/shortcutConflicts.ts`)

`findShortcutConflict(id, keys, current)`: trả về action khác có **cùng phím đã chuẩn hoá** và **contexts giao
nhau** với `id`; không có thì `null`. Đây là nơi duy nhất chứa logic này — UI và `ShortcutsBridge` không tự
so sánh.

- Search Library và Search in Book cùng `Mod+F`: không conflict (library ∩ reader = ∅).
- Gán `Mod+F` cho Open Book: conflict (Open Book hoạt động ở mọi màn).
- Khi nhiều action trùng phím mà không qua Settings (không xảy ra do store chặn), bridge chỉ chạy action đầu
  tiên khớp context hiện tại.

## 8. Cảnh báo conflict

`tryAssign` trả `{ ok: false, reason: 'conflict', conflictWith }`; UI chỉ hiển thị "Already assigned to
<label>". Store không ghi gì: không ghi đè, không hoán đổi, không xoá phím của action khác, không lưu.

## 9. Lưu trữ

`shortcuts/shortcutsStore.ts` (zustand, theo quy ước app): localStorage key `readmate.keyboardShortcuts.v1`,
chỉ lưu các phím đã đổi (`{ [id]: keys }`); không có override thì xoá key. Khi load, giá trị sai định dạng,
action không tồn tại, không hợp lệ hoặc conflict sẽ bị bỏ. Không đụng SQLite hay IPC.

## 10. Reset

- Từng dòng: `resetOne(id)`. Gán lại đúng phím mặc định cũng xoá override.
- Cả trang: `reset()` (Reset to Defaults).
- Advanced → Reset App Settings: thêm resetter `keyboard-shortcuts` vào `APP_SETTINGS_RESETTERS`, gọi cùng
  `reset()`.

## 11. Gắn handler

- `ShortcutsBridge` (mount trong `App.tsx`): một listener `keydown` capture ở `window`; xác định context theo
  route (`/library`, `/reader`, `/settings`; Splash và spike bị bỏ qua) và chạy action khớp phím + context.
- `Open Settings` / `Back to Library`: bridge điều hướng (flush phiên đọc trước khi rời Reader).
- `Open Book`: chạy `handleFromDevice` do `LibraryScreen` đăng ký; ở Reader/Settings thì xếp hàng rồi về
  Library, màn Library mount xong sẽ mở hộp thoại chọn file.
- `Search Library`: `LibrarySearchBox` focus và chọn nội dung ô tìm kiếm.
- `Search in Book`: thay handler `Ctrl/Cmd+F` hard-code trong `useReaderChromeUi` (vẫn bỏ qua khi immersive).
- Màn đăng ký handler bằng `useShortcutAction(id, fn)` (`shortcuts/shortcutActions.ts`).

## 12. Test

`npm run spike:settings:shortcuts` (`spikes/shortcuts/run-shortcuts.mjs`, logic thuần, 17 check): chuẩn hoá
Ctrl/⌘ → `Mod`; thứ tự modifier/hoa thường; modifier-only; phím không hợp lệ/hệ thống; chấp nhận phím tự do và
lưu; cùng phím + cùng context = conflict; context loại trừ nhau = không conflict; conflict không ghi đè/không
lưu; reset từng dòng/toàn bộ; Reset App Settings có group; lọc dữ liệu lưu sai khi load; logic conflict chỉ ở
một nơi. `spike:settings:reset` cập nhật danh sách group (thêm `keyboard-shortcuts`).

Không có tự động: `Esc` huỷ ghi phím, kiểu hover/lỗi, và việc handler vẫn chạy sau khi đổi phím — cần chạy app
thật (repo chưa có test UI).

## 13. Validation

`npm run typecheck`, `spike:settings:shortcuts`, `spike:settings:reset`, `npx vite build` đều qua; ESLint sạch
trên các file đã sửa. `npm run lint` toàn repo vẫn có 24 vấn đề (7 lỗi) có sẵn từ trước, không thuộc thay đổi này.

## 14. Files changed

- Mới: `src/shortcuts/{shortcutDefinitions,shortcutKeys,shortcutConflicts,shortcutsStore,shortcutActions,index}.ts`,
  `src/shortcuts/ShortcutsBridge.tsx`, `spikes/shortcuts/run-shortcuts.mjs`.
- Sửa: `KeyboardShortcutsSettings.tsx`, `resetAppSettings.ts`, `App.tsx`, `LibraryScreen.tsx`,
  `LibrarySearchBox.tsx`, `useReaderChromeUi.ts`, `package.json` (script spike),
  `spikes/reset-app-settings/run-reset-app-settings.mjs`, `docs/implementation_plan/reset_app_settings.md`.

## 15. Giới hạn / hướng mở rộng

- Mỗi action một phím. Chưa có nhiều phím thay thế (`→` / `Page Down`).
- Chỉ nhóm General. Reading và Annotation (lật trang, zoom, highlight…) vẫn hard-code trong hook riêng;
  khi chuyển sang đây cần thêm context (vd. vùng chọn text) và gỡ handler cũ.
- Phím tắt không bắt được khi focus nằm trong iframe của EPUB (sự kiện không lên `window`), giống `Ctrl+F` cũ.
- Phím tắt hệ thống chỉ chặn một danh sách ngắn; phím khác do hệ điều hành chiếm (vd. `Win+…`) không thể
  phát hiện.
- Trên macOS chỉ `⌘` là `Mod`; `Ctrl` đơn lẻ không được ghi nhận là modifier.
