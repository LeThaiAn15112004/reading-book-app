# Story: Rebuild Bookmark trên bảng `notes` hợp nhất

Trạng thái: Đã triển khai (BM-1 → BM-7) — chờ nghiệm thu thủ công (mục 7).
Phạm vi: `reading-book-desktop`, chỉ Bookmark (không đụng highlight/typewriter/freehand — các
loại đó vẫn đang ở trạng thái "đã gỡ, chờ rebuild riêng").
Tài liệu liên quan: [`docs/software/SRS.md`](../software/SRS.md) FR-11/UC-05 (yêu cầu gốc),
[`docs/ke-hoach-trien-khai/06_Giai_doan_5_Highlight_Note_Bookmark.md`](../ke-hoach-trien-khai/06_Giai_doan_5_Highlight_Note_Bookmark.md)
T5.5/T5.7a (đã đánh dấu **in đậm** = làm rồi ở bản cũ, nay phải làm lại), [`docs/error/jump-to-location.md`](../error/jump-to-location.md) §4
(hành vi jump bookmark cũ, vẫn đúng — chỉ đổi nguồn dữ liệu).

---

## 1. Bối cảnh & vấn đề

Bookmark từng chạy tốt trên một bảng SQLite riêng (`bookmarks`), đủ đầy đủ: toggle tại vị trí
đang đọc, list trong sidebar, jump bằng CFI, xóa từng cái. Khi dọn dẹp để chuyển toàn bộ hệ
annotation sang mô hình hợp nhất kiểu Thorium Reader (một bảng `notes` chung, phân biệt bằng
`note_json.type`/`note_json.group`), **toàn bộ code tầng ứng dụng của Bookmark đã bị xóa theo**
(port, IPC, bridge, hook, UI ribbon + sidebar tab) — chỉ còn lại migration SQL đã chạy sẵn.

Kết quả: `bookmarks` (bảng cũ) đã bị `DROP`, dữ liệu cũ đã được migrate đúng vào `notes`
(`migration 019`), nhưng **hiện tại không có bất kỳ cách nào trong app để tạo, xem, hay xóa
bookmark**. Đây là một tính năng P0/MVP (FR-11) đang bị hổng hoàn toàn, không phải cải tiến —
cần vá lại trước khi có thể coi giai đoạn 5 là hoàn thành.

## 2. User Story

- **Story:** As a User, tôi muốn đánh dấu (bookmark) trang/vị trí đang đọc để quay lại nhanh
  sau này, mà không cần nhớ số trang hay cuộn tìm lại bằng tay.
- **Acceptance:**
  - Given đang đọc 1 sách trong Reader, When bấm nút bookmark trên footer, Then một bookmark
    được tạo tại đúng vị trí đang đọc (CFI với EPUB) và lưu local; nút chuyển trạng thái active
    và icon tab Bookmark trên rail cũng sáng lên.
  - Given đang đứng đúng tại một vị trí đã có bookmark, When bấm lại nút đó, Then bookmark bị
    xóa (toggle off) — không tạo bookmark trùng tại cùng một vị trí.
  - Given sách có ≥ 1 bookmark, When mở tab "Bookmark" trong sidebar, Then thấy danh sách đầy đủ
    các bookmark của **đúng cuốn sách đang mở** (không lẫn bookmark của sách khác).
  - Given danh sách bookmark trong sidebar, When bấm vào 1 item, Then Reader nhảy đúng tới vị trí
    đó (CFI chính xác với EPUB; nhảy theo chương với các định dạng chưa có renderer thật).
  - Given danh sách bookmark trong sidebar, When bấm nút xóa trên 1 item, Then bookmark đó bị xóa
    khỏi danh sách và khỏi DB; nếu đang đứng đúng vị trí đó, ribbon hết active.
  - Given sách không có bookmark nào, When mở tab "Bookmark", Then hiện trạng thái rỗng "No
    bookmarks yet" thay vì danh sách trống trơn không giải thích.
  - Given danh sách bookmark, When xem từng item, Then thấy một badge % thể hiện vị trí tương
    đối trong sách (làm tròn 2 chữ số thập phân, vd "6.67%"), để không phải đoán bookmark nằm ở
    đâu trong tổng thể cuốn sách chỉ qua tên chương.
  - Given đóng app hoặc mở lại sách sau, When mở lại đúng sách đó, Then toàn bộ bookmark trước đó
    vẫn còn nguyên (persist qua SQLite, không mất khi tắt app).
  - Given xóa hẳn 1 sách khỏi Library (**BR-06**), When thao tác hoàn tất, Then mọi bookmark của
    sách đó cũng bị xóa theo (cascade), không để lại row mồ côi trong DB.
- **Priority / Phase:** Must / Giai đoạn 5 (đã có trong scope trước đây, nay là **khôi phục**,
  không phải tính năng mới về sản phẩm).

**Non-goals** (ngoài phạm vi story này):
- Không có màn hình bookmark toàn cục xuyên thư viện — bookmark luôn scoped theo sách đang mở
  (đúng quyết định sản phẩm đã chốt: bỏ SCR-04).
- Không rebuild highlight/typewriter/freehand — đó là story riêng, độc lập.
- Không xây `jumpToLocation()` pipeline hợp nhất cho mọi loại annotation (xem
  `docs/spec/jump-to-location-unified.md`) — bookmark tự gọi thẳng cơ chế jump CFI hiện có
  (`EpubRendererApi.goToLocation`), như cách nó đã hoạt động trước đây.

## 3. Quyết định kiến trúc

1. **Không tạo port/store mới** — mở rộng `OverlayStore` hiện có
   (`source/packages/domain/ports/overlay-store.ts`) và class `SqliteOverlayStore`
   (`source/apps/reading-book-desktop/electron/persistence/sqlite-overlay-store.ts`). Channel
   `overlay:*` + singleton store đã tồn tại; một port riêng cho bookmark sẽ phải nhân đôi wiring
   và phải hợp nhất lại khi phần annotation (cùng dùng bảng `notes`) được rebuild sau.
2. **Domain shape là interface dữ liệu thuần** `BookmarkRecord`, không phải class có method —
   class `Bookmark` cũ (`rename()`/`moveTo()`/`hasLabel()`) không có nơi gọi thực tế trong code
   đã chạy production, nên không cần viết lại phần đó.
3. **Không có `bookmark-service.ts` riêng trong `packages/shared/services`** — đúng pattern thực
   tế hiện tại của repo (`electron/ipc/*.ipc.ts` gọi thẳng `sqlite-*-store.ts`, không qua tầng
   use-case cho CRUD đơn giản). Logic thuần túy (so khớp vị trí, sinh label) đặt trong
   `packages/shared/models/bookmark-location.ts` (pure function) và trong hook renderer mới
   `useReaderBookmarks.ts`.
4. **So khớp "đã có bookmark tại vị trí X chưa" (phục vụ toggle) làm ở tầng renderer bằng
   `Location.equals()`**, không làm trong SQL — `note_json` là JSON blob, so sánh SQL không đáng
   làm cho quy mô 1 sách; `listBookmarks` trả toàn bộ danh sách, lọc trong JS.
5. Cascade xóa bookmark khi xóa sách: đã có sẵn qua
   `FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE` trên bảng `notes` +
   `db.pragma('foreign_keys = ON')` — không cần code thêm.

## 4. Data model (đã có sẵn — không sửa migration)

Bảng `notes(id, book_id, note_json, created_at, updated_at)` — 1 bookmark = 1 row với:
```json
{
  "schemaVersion": 1,
  "type": "bookmark",
  "group": "bookmark",
  "locatorExtended": { "locator": { "kind": "cfi", "cfi": "...", "chapterIndex": 3 } },
  "label": "Chương 3",
  "textualValue": "đoạn trích mở đầu tại vị trí bookmark...",
  "created": "2026-09-05T..."
}
```
Filter theo group tận dụng index sẵn có `idx_notes_group` trên
`json_extract(note_json,'$.group')`.

## 5. Kiến trúc thi công (tóm tắt theo layer)

| Layer | File chính | Việc cần làm |
|---|---|---|
| Domain | `domain/models/annotation/bookmark.ts` (mới), `domain/ports/overlay-store.ts` | `BookmarkRecord`, thêm `listBookmarks`/`saveBookmark`/`deleteBookmark` vào `OverlayStore` |
| Persistence | `electron/persistence/sqlite-overlay-store.ts` | SQL trên bảng `notes`, filter `group='bookmark'`, build/parse `note_json` |
| IPC | `electron/ipc/channels.ts`, `api-types.ts`, `overlay.ipc.ts`, `preload.ts` | Thêm 3 channel vào `OverlayChannels`, DTO `BookmarkDto`/`SaveBookmarkInput`/`DeleteBookmarkInput`, handler validate bằng `Location.parse` |
| Bridge | `src/bridge/overlay.ts` | 3 hàm gọi `window.api.overlay.*` |
| Shared pure logic | `packages/shared/models/bookmark-location.ts` (mới) | Pack/parse locator, so khớp vị trí bằng `Location.equals()`, resolve vị trí hiện tại (EPUB CFI / fake-chapter `TextOffsetLocation`) |
| UI | `components/chrome/ReaderFooter.tsx`, `components/sidebar/{TocSidebar.tsx,sidebarTabs.ts,SidebarEdgeRail.tsx}`, `logic/hooks/useReaderBookmarks.ts` (mới), `ReaderScreen.tsx` | Nút toggle trên footer, gợi ý sáng trên icon tab Bookmark ở rail, tab "Bookmark" trong sidebar (toggle/list/search/jump/xóa/empty-state), hook quản lý state |

> Ghi chú khi triển khai: bản HEAD cũ có file `components/bookmark/BookmarkEdgeButton.tsx` (ribbon
> mép trái) nhưng **không nơi nào render nó** — UX thật đang chạy là nút bookmark trên
> `ReaderFooter` + gợi ý trên `SidebarEdgeRail` + panel trong `TocSidebar`. Bản rebuild bám theo
> UX thật đó, không khôi phục lại component ribbon chết.

Chi tiết SQL/DTO/hook signature: xem plan kỹ thuật đã duyệt (phiên làm việc lập plan trước khi
viết story này) — không lặp lại toàn bộ ở đây để tránh 2 nguồn sự thật lệch nhau khi code thay
đổi; file này giữ vai trò "why + what + acceptance", còn "how" chi tiết nằm ở PR/commit hiện
thực hóa story.

## 6. Task breakdown

| Task | Chi tiết | Kiểm tra xong việc |
|---|---|---|
| **BM-1** | Domain: `BookmarkRecord` + mở rộng `OverlayStore` | `npm run typecheck` báo lỗi đúng ở `SqliteOverlayStore` (chưa implement) |
| **BM-2** | Persistence: implement `listBookmarks`/`saveBookmark`/`deleteBookmark` trên bảng `notes` | `npm run typecheck` sạch `electron/persistence/**` |
| **BM-3** | IPC: channel + DTO + handler + preload | `npm run typecheck` sạch `electron/**` |
| **BM-4** | Bridge: `src/bridge/overlay.ts` | `npm run typecheck` sạch `src/bridge/**` |
| **BM-5** | Shared: `bookmark-location.ts` pure logic | `npm run typecheck` sạch `packages/shared/**` |
| **BM-6** | UI hook `useReaderBookmarks.ts` | Toggle/jump/delete hoạt động qua console/log thử trước khi wire UI |
| **BM-7** | UI: ribbon + sidebar tab + wiring `ReaderScreen.tsx` | `npm run typecheck` + `npm run lint` sạch toàn repo |

Thứ tự: BM-1 → BM-2 → BM-3 → BM-4 → BM-5 → BM-6 → BM-7 (bottom-up, mỗi bước tự kiểm tra bằng
`npm run typecheck` trước khi sang bước kế — repo không có test runner, đây là cách kiểm tra
duy nhất trước bước verify thủ công cuối).

## 7. Nghiệm thu (Definition of Done)

Đã tự động kiểm chứng: SQL trên bảng `notes` (insert/update/list/delete, lọc đúng
`group='bookmark'`, chặn ghi đè nhầm row annotation, cascade khi xóa sách, query dùng đúng
`idx_notes_group`) chạy qua `node:sqlite` — cùng cách các script trong `spikes/` đang làm;
`npm run typecheck` và `npm run lint` không phát sinh lỗi/cảnh báo mới; renderer + main +
preload build sạch; app khởi động không lỗi.

Còn lại là nghiệm thu thủ công trong app:

- [ ] Bấm nút bookmark trên footer tại 1 vị trí EPUB → bookmark được tạo, nút active, tab Bookmark hiện đúng 1 item.
- [ ] Bấm lại nút đó ở đúng vị trí → bookmark bị xóa (toggle-off qua `Location.equals()`).
- [ ] Tạo bookmark ở nhiều vị trí khác nhau, nhảy chương khác, bấm từng item trong sidebar → nhảy
      đúng CFI, không chỉ đúng chương.
- [ ] Xóa 1 bookmark bằng nút xóa trong sidebar → item biến mất; nút footer hết active nếu đang
      ở đúng vị trí đó.
- [ ] Đóng/mở lại app, mở đúng sách đó → tab Bookmark còn nguyên danh sách (persist qua `notes`).
- [ ] Mở sách khác → tab Bookmark rỗng, hiện "No bookmarks yet" — không rò rỉ bookmark sách khác.
- [ ] Xóa hẳn sách khỏi Library → không còn row `notes` mồ côi (cascade FK hoạt động).
- [ ] Bề mặt non-EPUB ("fake chapter" demo) → toggle/jump bằng `TextOffsetLocation` hoạt động độc
      lập với đường EPUB.
- [ ] `npm run typecheck` và `npm run lint` sạch trên toàn bộ `reading-book-desktop`.

## 8. Quyết định khi triển khai / theo dõi sau khi ra mắt

- **Excerpt đã được bổ sung.** `EpubjsHandle` có thêm `getCurrentExcerpt()`
  (`openEpubjs.ts`), tái dùng đúng hàm `extractExcerpt()` mà `spineExcerptCache.ts` đã dùng cho
  preview TOC/chương khác — chỉ khác là chạy trên section **đang hiển thị** thay vì load off-DOM.
  Expose qua `EpubRendererApi.getCurrentExcerpt` (`EpubRenderer.tsx`, trả `undefined` khi đang ở
  trang bìa tổng hợp). `useReaderBookmarks.toggleBookmark` gọi hàm này khi tạo bookmark mới và
  lưu vào `note_json.textualValue`; sidebar hiển thị đoạn trích này thay cho ngày tạo khi có.
  Lưu ý: excerpt lấy từ **đầu section hiện tại**, không phải chính xác tại vị trí cuộn/CFI đã
  bookmark — bấm chấp nhận được cho preview, nhưng nếu người dùng bookmark ở cuối 1 chương dài,
  đoạn trích hiển thị vẫn là đầu chương đó chứ không phải câu tại vị trí bookmark. Định dạng
  chưa có renderer thật (fake-chapter) vẫn không có excerpt — sidebar fallback về ngày tạo.
- **Badge % vị trí trong sách đã được bổ sung.** `TocSidebar.tsx` tính
  `bookmarkProgressLabel(chapterIndex, sectionCount)` = `chapterIndex / sectionCount * 100`, dùng
  đúng `pageTotal` đã có sẵn trong props (bằng `spineLength` cho EPUB, `FAKE_CHAPTERS.length` cho
  bề mặt fake) — không cần thêm prop hay đổi `ReaderScreen.tsx`. Đây là **% theo chương/section**,
  không phải % theo vị trí cuộn/CFI chính xác trong chương (không có per-bookmark page metric nào
  được lưu), nên 2 bookmark cùng chương sẽ hiện cùng một %. Badge ẩn khi `sectionCount` chưa sẵn
  sàng (sách vừa mở, `epubNav` còn null).
- **"You are here" dùng so khớp vị trí chính xác + fallback ngắn sau khi jump.** Bản cũ dùng
  `epubApiRef.isCfiWithinCurrentView()` (kiểm tra hình học theo viewport) — API này cũng đã bị gỡ
  khỏi renderer. Bản mới so khớp bằng `Location.equals()` (cùng nguồn sự thật với nút toggle),
  kèm giữ lại `justJumpedId` trong 2s sau mỗi lần jump để badge "Here" không nhấp nháy khi
  epub.js còn đang chỉnh vị trí cuộn ở chế độ scroll liên tục.
- Theo dõi: nếu ở chế độ scroll liên tục, badge "Here" biến mất sau 2s dù người đọc vẫn đứng
  nguyên chỗ (do CFI epub.js báo về lệch so với CFI đã lưu), thì cần dựng lại một dạng kiểm tra
  theo viewport thay cho so khớp chính xác.
