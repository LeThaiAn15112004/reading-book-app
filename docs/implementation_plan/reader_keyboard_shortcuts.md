# Reader Keyboard Shortcuts — Navigation & Search

Mở rộng Settings → Keyboard Shortcuts với hai nhóm phím tắt của Reader: **Navigation** và **Search**.
Tiếp nối `keyboard_shortcuts.md` (nhóm General, đã xong).

> Trạng thái: **kế hoạch** — chưa code. Kết luận khả thi: **có**, cần mở rộng nền shortcut trước (Phase 0).

## 1. Phạm vi

### Navigation — điều hướng khi đọc

| Phím | Action |
|---|---|
| `→` / `Page Down` | Trang hoặc bước tiếp theo |
| `←` / `Page Up` | Trang hoặc bước trước |
| `Home` / `End` | Đầu / cuối tài liệu |
| `Ctrl/Cmd + G` | Đi đến trang hoặc vị trí |
| `Ctrl/Cmd + D` | Thêm bookmark |
| `T` | Mở/đóng mục lục |

### Search — tìm kiếm trong tài liệu

| Phím | Action |
|---|---|
| `Ctrl/Cmd + F` | Mở tìm kiếm trong sách (**đã có**: `general.searchBook`) |
| `Enter` | Kết quả tiếp theo |
| `Shift + Enter` | Kết quả trước |
| `Esc` | Đóng tìm kiếm hoặc hủy thao tác đang thực hiện |

## 2. Hiện trạng

- Registry `shortcuts/shortcutDefinitions.ts`: chỉ nhóm `general` (5 action), mỗi action **một phím**, context =
  route (`library | reader | settings`).
- Hard-code còn lại của Reader:
  - `←/→`, `Esc`, `Ctrl+Z/Y`, `Delete` ở `useReaderNavigation.ts` (kèm bind keydown vào iframe EPUB bằng
    MutationObserver + poll 500ms).
  - `Enter` / `Shift+Enter` / `Esc` trong ô tìm kiếm ở `ReaderSearchPanel.tsx`.
  - Chuỗi `Esc` ở `useReaderChromeUi.ts` (đóng More/Settings/Search, rồi ẩn chrome).
- Chỉ có renderer EPUB thật; định dạng khác dùng "fake chapters" → action đi qua `nav.switchPage` /
  `goToPage` để chạy ở cả hai.

## 3. Khoảng trống hạ tầng

| # | Vấn đề | Chi tiết |
|---|---|---|
| 1 | Phím trần bị chặn | `validateShortcutKeys` bắt buộc modifier (trừ F1–F12). `T`, `Home`, `End`, `→`, `Enter`, `Esc` bị từ chối. |
| 2 | Một action chỉ một phím | `→` / `Page Down` cần hai phím cho một action. |
| 3 | Phím trong iframe EPUB không lên `window` | `ShortcutsBridge` chỉ nghe `window` → khi vừa click vào chữ, shortcut không chạy. Giải pháp bind iframe hiện nằm riêng trong `useReaderNavigation`. |
| 4 | Chưa có nhóm Navigation / Search | `SHORTCUT_GROUPS` chỉ có `general`; kiểm tra `KeyboardShortcutsSettings` có render theo group. |

## 4. Quyết định thiết kế (đề xuất — chờ xác nhận)

1. **`Enter` và `Esc` khóa** (hiển thị, không cho đổi): ý nghĩa phụ thuộc ngữ cảnh UI (popover → công cụ
   highlight → panel → chrome); rebind phím trần như vậy dễ vỡ.
2. **Phím phụ (alias) cố định, phím chính đổi được** (`→` chính, `Page Down` alias). Alias vẫn tham gia
   phát hiện conflict. Multi-key đầy đủ tốn thêm store/UI/dữ liệu localStorage — để sau nếu cần.
3. **Phím trần chỉ cho action gắn cờ `allowBare`**, kèm guard bỏ qua khi focus ở
   `input / textarea / select / contentEditable`.
4. **Không thêm sub-context `reader-search`**: nếu `Enter`/`Esc` khóa thì không cần, giữ giả định "mỗi route
   là một context".
5. **`Ctrl+D` giữ kiểu toggle** (`toggleBookmark` hiện có: bấm lần hai gỡ) — chờ xác nhận.

## 5. Từng action

| Action id (dự kiến) | Cách làm | Ghi chú |
|---|---|---|
| `navigation.nextPage` | `switchPage(true)` | PageDown chưa được xử lý ở code hiện tại. |
| `navigation.prevPage` | `switchPage(false)` | |
| `navigation.firstPage` | `goToSpineIndex(0)` / `goToPage(1)` | |
| `navigation.lastPage` | `goToLocationPage(pageTotal)` khi page count sẵn sàng, fallback `goToSpineIndex(last)` | `goToSpineIndex(last)` chỉ tới *đầu* section cuối; có thể thêm `goToEnd` vào renderer. |
| `navigation.goToPage` | `useShortcutAction` trong `ReaderFooter`: hiện chrome, focus + select ô trang | Scroll mode chỉ hiện `%` → cần fallback (toast/dialog nhỏ). |
| `navigation.addBookmark` | `bookmarks.toggleBookmark` | Đăng ký ở `ReaderScreen`. |
| `navigation.toggleToc` | `chrome.toggleSidebar` / `openSidebarTab('chapters')` | Cần `allowBare` + guard typing. |
| `search.next` / `search.previous` | Chạy khi panel mở, focus không ở ô nhập | Hiện chỉ chạy khi focus trong ô tìm kiếm. |
| `Esc` (khóa) | Giữ chuỗi ưu tiên hiện có | Chỉ hiển thị ở Settings. |

## 6. Các bước

**Phase 0 — Hạ tầng**
- `ShortcutDefinition`: thêm `allowBare`, `aliases`, cờ `locked`; cập nhật `validateShortcutKeys`,
  `findShortcutConflict` (alias tham gia), `shortcutsStore` (chỉ lưu override phím chính; bỏ qua override của
  action khóa).
- Thêm nhóm `navigation`, `search`; UI hiển thị alias và dòng khóa.
- Tách bind iframe EPUB thành helper dùng chung; `ShortcutsBridge` nghe cả iframe (sửa luôn `Ctrl+F` không
  chạy khi focus trong sách).
- Guard typing-target trong bridge cho phím trần.

**Phase 1 — Navigation**
- Đăng ký 7 action ở §5; gỡ nhánh `←/→` khỏi `useReaderNavigation` (giữ `Esc`, `Ctrl+Z/Y`, `Delete`).

**Phase 2 — Search**
- `search.next/previous` hoạt động mọi nơi trong panel; hiển thị `Enter`, `Shift+Enter`, `Esc` dạng khóa.

**Phase 3 — Hoàn thiện**
- Mở rộng `spike:settings:shortcuts`: phím trần hợp lệ/không, alias conflict, action khóa không đổi được,
  reset.
- `npm run typecheck`, `npx vite build`, ESLint trên file đã sửa.
- Cập nhật mục "Giới hạn" của `keyboard_shortcuts.md`.

## 7. Rủi ro

- `Page Down` ở scroll mode có thể tranh với cuộn tự nhiên → dùng `isAtScrollBoundary` như logic hiện có.
- `End` khi page count chưa tính xong (`pageCountReady = false`) → fallback spine.
- Phím trần (`T`, `Home`, `End`) trong note textbox / ô nhập → guard typing-target.
- `Enter` trên nút đang focus vốn là "click" → chỉ chặn khi panel tìm kiếm mở và focus trong panel/body.
- Không có UI test: phần "phím chạy sau khi đổi, kể cả khi focus trong iframe" phải kiểm tay bằng
  `npm run dev`.

## 8. Ngoài phạm vi

`Ctrl+Z/Y` (undo/redo highlight), `Delete` highlight, zoom `Ctrl +/−/0`, công cụ highlight — thuộc nhóm
Annotation / View, làm đợt sau.
