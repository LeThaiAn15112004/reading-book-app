# Reader Keyboard Shortcuts — Navigation & Search

Mở rộng Settings → Keyboard Shortcuts với hai nhóm phím tắt của Reader: **Navigation** và **Search**.
Tiếp nối `keyboard_shortcuts.md` (nhóm General, đã xong). Kết quả thực tế + giới hạn: xem mục "Reader shortcuts"
cuối `keyboard_shortcuts.md`.

> Revision 2 — đã xử lý 5 điểm review (§4) và tách *định nghĩa shortcut* khỏi *khả năng của renderer* (§5).
> Phạm vi giữ nguyên: không mở sang Annotation / View.

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
| `Ctrl/Cmd + F` | Mở tìm kiếm trong sách (`general.searchBook`, chuyển sang nhóm Search; id giữ nguyên) |
| `Enter` | Gửi truy vấn hiện tại / kết quả tiếp theo |
| `Shift + Enter` | Kết quả trước |
| `Esc` | Đóng tìm kiếm hoặc hủy thao tác đang thực hiện |

## 2. Hiện trạng (trước thay đổi)

- Registry `shortcuts/shortcutDefinitions.ts`: chỉ nhóm `general`, mỗi action một phím, context = route.
- Hard-code: `←/→`, `Esc`, `Ctrl+Z/Y`, `Delete` ở `useReaderNavigation.ts` (kèm bind iframe EPUB bằng
  MutationObserver + poll); `Enter` / `Shift+Enter` / `Esc` trong ô tìm kiếm ở `ReaderSearchPanel.tsx`; chuỗi
  `Esc` ở `useReaderChromeUi.ts`.
- Renderer thật chỉ có EPUB. Định dạng khác dùng *placeholder chapters* (`FAKE_CHAPTERS`) — không phải renderer
  định dạng thật.
- EPUB có lớp *synthetic cover* (`EpubRenderer.tsx`) làm lệch chỉ số spine đi 1; mọi nav phải đi qua
  `EpubRendererApi`, không gọi thẳng `EpubjsHandle`.

## 3. Khoảng trống hạ tầng

| # | Vấn đề | Giải pháp |
|---|---|---|
| 1 | Phím trần bị chặn | Cờ `allowBare` trên definition; `validateShortcutKeys(keys, mac, { allowBare })`. |
| 2 | Một action = một phím | `aliases` cố định (không đổi được), hiển thị + **đăng ký runtime + conflict**. |
| 3 | Phím trong iframe EPUB không lên `window` | Helper `listenKeydownInIframes` dùng chung; bridge bind khi ở route reader. |
| 4 | Chưa có nhóm Navigation / Search | Thêm vào `SHORTCUT_GROUPS` (UI đã render theo group). |
| 5 | Handler không báo "đã xử lý hay chưa" | `Handler` trả `false` = *không xử lý* → bridge không `preventDefault`, phím rơi về hành vi native. |

## 4. Xử lý 5 điểm review

### 4.1 `Enter` không được nhảy kết quả khi đáng ra phải *submit* truy vấn

Hành vi hiện có trong ô nhập: Enter → `form.onSubmit` → `requestReaderSearch` → `useBookSearchStore.submit()`:
cùng truy vấn + có kết quả ⇒ `next()`, ngược lại ⇒ **search truy vấn mới**. Giữ nguyên:

- Bridge **bỏ qua phím trần/Shift khi target là `INPUT/TEXTAREA/SELECT/contentEditable`** ⇒ Enter trong ô
  tìm kiếm không đi qua registry, ô nhập tự xử lý như cũ.
- Khi focus **ngoài** ô nhập (panel đang mở), action `search.nextResult` gọi đúng `store.submit()` (không gọi
  `next()` trực tiếp) ⇒ ô nhập đã sửa mà chưa gửi vẫn được *gửi* thay vì nhảy kết quả cũ; ô nhập rỗng ⇒ không xử lý.
- `Shift+Enter` → `store.previous()` (giống handler của ô nhập), chỉ khi có kết quả.
- Phím `Enter`/`Space` khi target là phần tử tương tác (`button`, `a`, `[role=button|option|menuitem|tab]`,
  `summary`) **không bị chiếm** — Enter trên nút vẫn là "click".

### 4.2 Alias phải vào runtime registration và conflict detection

- `ShortcutDefinition.aliases?: readonly ShortcutKeys[]` (cố định, không lưu override).
- Bridge so khớp `[phím hiệu lực, ...aliases]` của mỗi action; chạy mọi action khớp theo thứ tự cho tới khi
  một cái xử lý được.
- `findShortcutConflict`: so phím ứng viên với **phím chính và alias** của action khác (context giao nhau); phím
  trùng alias của chính action đó cũng bị từ chối. `loadOverrides` dùng cùng hàm nên override cũ trùng alias bị bỏ.
- Settings hiển thị alias thành chip chỉ-đọc cạnh phím chính.

### 4.3 Giữ route-based context; rà guard focus + trạng thái panel

Không thêm sub-context. Thay vào đó mỗi handler có `enabled` (trạng thái UI) và bridge có guard focus:

| Guard | Nơi | Hiệu lực |
|---|---|---|
| IME đang compose | bridge | bỏ qua |
| Typing target (`INPUT/TEXTAREA/SELECT/contentEditable`, cả trong iframe) | bridge | bỏ qua phím *không có Mod/Alt* (phím có Mod vẫn chạy, như `Ctrl+F`) |
| Modal DOM (`[aria-modal="true"]`) | bridge | bỏ qua phím không có Mod/Alt |
| Dialog Reader không có `aria-modal` (Book Info, Sign, Trash) | `ReaderScreen` → `enabled=false` | tắt toàn bộ nav/search/bookmark |
| `contentStatus !== 'ready'` | `ReaderScreen` | tắt (giống handler cũ) |
| Panel tìm kiếm đóng | `enabled = searchOpen` | `Enter`/`Shift+Enter` rơi về native |
| Immersive fullscreen | `enabled=false` cho Go to page / TOC / search | chrome đang ẩn |
| Recording phím trong Settings | `recordingId` | bridge tạm dừng (có sẵn) |
| `event.repeat` | bridge | bỏ qua, trừ `allowRepeat` (chỉ next/previous page — giữ hành vi giữ phím lật trang) |

### 4.4 `navigation.lastPage` phải thật sự tới cuối tài liệu

`goToSpineIndex(last)` chỉ tới **đầu** section cuối ⇒ **không dùng**. Thêm `goToEnd()` vào `EpubjsHandle` →
`EpubRendererApi` (qua lớp cover) trả `Promise<boolean>`:

1. `display(lastSpine)` rồi chờ resource của section.
2. *Paginated*: lấy `displayed.total`, `moveTo((total-1) * delta)`, `reportLocation()`; kiểm tra
   `displayed.page >= displayed.total`, thử lại tối đa 3 lần (page count có thể đổi sau reflow).
3. *Scroll*: đặt `scrollTop = scrollHeight` của container, kiểm tra `isAtVerticalScrollBoundary('down')`.
4. Trả `true` chỉ khi **thực sự** ở trang/đáy cuối. `false` ⇒ toast "Couldn't reach the end of the book."

`firstPage` = `api.goToSpineIndex(0)` (đã cover-aware: hiện cover nếu có, ngược lại đầu section 0).
Không phụ thuộc `pageTotal` nên chạy cả khi page count chưa tính xong.

### 4.5 `navigation.addBookmark` dùng lại toggle đúng một lần mỗi lần nhấn

- Handler chỉ gọi `bookmarks.toggleBookmark()` (hàm sẵn có, không nhân bản logic add/remove).
- Một listener keydown duy nhất cho mỗi tài liệu (window + từng iframe); `event.repeat` bị bỏ ⇒ giữ phím không
  bật/tắt liên tục; bridge `stopPropagation` sau khi xử lý.
- `useShortcutAction` luôn gọi *handler mới nhất* (ref), không đăng ký trùng khi re-render; chỉ một nơi đăng ký id này.
- Spike kiểm tra: chỉ một `useShortcutAction('navigation.addBookmark')` trong source, và `runShortcutAction`
  gọi handler đúng một lần.
- Hành vi toggle (bấm lần hai gỡ) giữ nguyên theo xác nhận.

## 5. Định nghĩa shortcut ≠ khả năng renderer

*Definition* nói "phím này nên làm gì". *Capability* là việc handler có làm được trên bề mặt đang mở. Bridge/Settings
**không** khẳng định format nào hỗ trợ — chỉ handler đã đăng ký (và trả `true`) mới là "được hỗ trợ".

| Action | EPUB paginated | EPUB scroll | Placeholder chapters (non-EPUB) |
|---|---|---|---|
| `nextPage` / `previousPage` | `api.nextPage/prevPage` | cùng API (cuộn theo viewport) | đổi chapter |
| `firstPage` | `api.goToSpineIndex(0)` | cùng | chapter 1 |
| `lastPage` | `api.goToEnd()` (§4.4) | `api.goToEnd()` (đáy section cuối) | chapter cuối |
| `goToPage` | focus ô số trang | **không hỗ trợ** (chỉ có %): toast, không focus | focus ô số trang |
| `addBookmark` | `toggleBookmark` | cùng | `toggleBookmark` (chapter) |
| `toggleToc` | sidebar tab chapters | cùng | sidebar chapters (placeholder) |
| `search.nextResult/previousResult` | store | store | `status = unsupported` → không có kết quả ⇒ không xử lý |
| `Esc` | hard-code hiện có (display-only) | cùng | cùng |

Ghi chú: "placeholder chapters" là nội dung demo, không phải hỗ trợ định dạng PDF/TXT… thật.

## 6. Mô hình dữ liệu

```ts
type ShortcutDefinition = {
  id; group; label; contexts; defaultKeys
  aliases?: readonly ShortcutKeys[]   // phím phụ cố định
  allowBare?: boolean                 // cho phép phím chính không modifier
  locked?: boolean                    // không đổi được (Enter, Shift+Enter, Esc)
  displayOnly?: boolean               // do handler hard-code xử lý, bridge không so khớp (Esc)
  allowRepeat?: boolean               // cho phép giữ phím (lật trang)
}
```

Phím trần cho phép khi đổi phím (`allowBare`): chữ, số, mũi tên, `Home/End/PageUp/PageDown`, F1–F12. Không cho
`Enter/Space/Tab/Backspace/Delete` trần. `Shift + phím đơn` vẫn bị từ chối.

| Id | Group | Contexts | Mặc định | Alias | Cờ |
|---|---|---|---|---|---|
| `navigation.nextPage` | navigation | reader | `→` | `Page Down` | bare, repeat |
| `navigation.previousPage` | navigation | reader | `←` | `Page Up` | bare, repeat |
| `navigation.firstPage` | navigation | reader | `Home` | — | bare |
| `navigation.lastPage` | navigation | reader | `End` | — | bare |
| `navigation.goToPage` | navigation | reader | `Mod+G` | — | |
| `navigation.addBookmark` | navigation | reader | `Mod+D` | — | |
| `navigation.toggleToc` | navigation | reader | `T` | — | bare |
| `general.searchBook` | search | reader | `Mod+F` | — | |
| `search.nextResult` | search | reader | `Enter` | — | locked |
| `search.previousResult` | search | reader | `Shift+Enter` | — | locked |
| `search.close` | search | reader | `Esc` | — | locked, displayOnly |

## 7. Các bước

**Phase 0 — Hạ tầng**
- `shortcutDefinitions` (kiểu + cờ + id), `shortcutKeys` (`allowBare`, nhãn Esc/Enter/Home/End), `shortcutConflicts`
  (alias + chính action), `shortcutsStore` (`locked` không đổi/không load, `allowBare` khi validate),
  `shortcutActions` (handler trả `false`), `iframeKeydown.ts`, `ShortcutsBridge` (guard + alias + nhiều khớp),
  `KeyboardShortcutsSettings` (alias chip, dòng khóa).

**Phase 1 — Navigation**
- `goToEnd` ở `openEpubjs.ts` + `EpubRenderer.tsx`; `useReaderNavigation` (`goToStart/goToEnd`, bind iframe qua
  helper, **gỡ nhánh ←/→**, giữ `Esc`, `Ctrl+Z/Y`, `Delete`); `useReaderShortcuts` (đăng ký handler);
  `ReaderFooter` (`goToPage`); `ReaderScreen` (nối + `modalOpen`).

**Phase 2 — Search**
- `search.nextResult/previousResult` trong `useReaderShortcuts` (§4.1). `Esc` hiển thị khóa.

**Phase 3 — Hoàn thiện**
- Mở rộng `spike:settings:shortcuts`; chạy `typecheck`, `spike:settings:shortcuts`, `spike:settings:reset`,
  `npx vite build`, ESLint các file đã sửa; ghi kết quả thật + giới hạn vào `keyboard_shortcuts.md`.
- **Không commit / push** trong đợt này theo yêu cầu.

## 8. Ngoài phạm vi

`Ctrl+Z/Y` (undo/redo highlight), `Delete` highlight, zoom `Ctrl +/−/0`, công cụ highlight — thuộc nhóm
Annotation / View. Multi-key rebinding đầy đủ (đổi cả alias) cũng để sau.
