# Cơ chế render EPUB & jump-to-location hiện tại (đọc trực tiếp code ngày 2026-09-12)

> Nguồn: `source/apps/reading-book-desktop/src/reader/renderers/epub/openEpubjs.ts` (goToLocation,
> displayCfiSafely, canDisplayCfi, withRenditionLock, resizeAnchorToken, applyHighlight,
> epubAnnotationTypeFor, flashHighlight) và `EpubRenderer.tsx`. Đối chiếu với tài liệu cũ
> `docs/error/jump-to-location.md`, `docs/note/jump-to-location-bugfix-plan.md`,
> `docs/spec/jump-to-location-unified.md` — các tài liệu này mô tả một kiến trúc **cũ hơn**, một phần
> đã lỗi thời so với code hiện hành (xem mục 4).

## 1. Cơ chế render hiện tại

- Engine là `epub.js` nguyên bản (không fork), mỗi section được `rendition.display()` gắn vào 1
  `<iframe>` riêng trong host DOM. `Rendition` (ViewManager) quản lý danh sách view, đo cột/trang
  (pagination) dựa trên kích thước host.
- **Highlight/underline/strikethrough/textbox không còn được vẽ bằng cách bọc `<mark>` thủ công qua
  CSS overlay** (cách mà `docs/error/jump-to-location.md` mô tả) — chúng dùng thẳng API gốc của
  epub.js: `activeRendition.annotations.add(type, cfiRange, data, cb, className, styleAttrs)`.
  - epub.js/marks-pane chỉ biết 3 loại: `highlight`, `underline`, `mark`. `epubAnnotationTypeFor()`
    ánh xạ: `highlight→highlight`, `underline→underline`, **`strikethrough→underline`** (dùng lại
    hình học rect+line của underline rồi `repositionStrikethroughLines()` kéo `<line>` xuống giữa
    dòng), `textbox→mark` (icon 📝 định vị, không vẽ đè lên text).
  - Mỗi mark là 1 SVG `<rect>`/`<line>` do marks-pane tự vẽ lại **mỗi khi có sự kiện `rendered`** dựa
    trên `view.locationOf(cfiRange)` — nghĩa là vị trí mark phụ thuộc hoàn toàn vào layout đã settle
    tại thời điểm `rendered` bắn ra.
- `flashHighlight(cfiRange, styleKind)` không dò DOM/iframe mù như thiết kế cũ
  (`findAnnotationMarkElement` poll `querySelector` qua từng iframe) — nó tra thẳng
  `view.highlights/underlines/marks[cfiRange].element` mà epub.js đã lưu nội bộ, nên luôn trúng đúng
  1 element, kể cả khi nằm trong iframe khác document.

## 2. Cơ chế cũ (theo tài liệu, đã lỗi thời một phần)

Theo `docs/error/jump-to-location.md` §3.6 và `docs/note/jump-to-location-bugfix-plan.md`, bản trước
xử lý bằng:

- `overlayPainter.suspend()` + `overlayPainter.clear()` **trước** mỗi `display()` để tránh việc vẽ
  lại `<mark>` giữa chừng làm sai offset con-node mà `locationOf()` cần đọc → gây `IndexSizeError`.
- Gọi `display()` **2 lần thủ công** trong `goToLocation`, không có hàng đợi hoá với resize.
- 4 hàm jump riêng biệt (`jumpToHighlight`, `jumpToBookmark`, `jumpToTypewriterNote`,
  `jumpToFreehandStroke`) tự quyết định logic khác nhau; **CFI đã bị gỡ khỏi
  `jumpToHighlight`/`jumpToTypewriterNote`** (chỉ nhảy thô theo chương) vì từng gây `IndexSizeError`/
  nhảy sai — chỉ `jumpToBookmark` còn giữ CFI.
- `docs/spec/jump-to-location-unified.md` (draft) đề xuất gộp 4 hàm thành 1 pipeline
  `jumpToLocation()` + abstraction `JumpTarget`, phục hồi CFI cho mọi loại annotation. **Spec này
  không được implement theo đúng kiến trúc đề xuất** — không có file `jump-target.ts` hay
  `useReaderJump.ts` trong code hiện hành.

## 3. Vì sao vẫn hết lỗi mà không cần `JumpTarget` — hướng đi thật đã chọn

Thay vì generalize ở tầng orchestration (theo spec draft), việc sửa lỗi được dồn xuống **tầng thấp
nhất** — chính `goToLocation()`/`displayCfiSafely()` trong `openEpubjs.ts` — nên **mọi loại**
annotation/bookmark đi qua đây (highlight, underline, strikethrough, note, bookmark) đều tự động
được hưởng lợi mà không cần một abstraction `JumpTarget` riêng. Cụ thể:

| Vấn đề gốc | Cơ chế mới xử lý bằng gì |
|---|---|
| CFI hỏng/offset vượt quá text node → `IndexSizeError` ném từ callback async, làm **kẹt cứng cả display queue** của epub.js (mọi `display()` sau đó, kể cả CFI hợp lệ, đều treo) | `canDisplayCfi()` **pre-resolve** CFI trên chính section document (dùng `book.spine.get()` + `section.load()` + `resolveCfiRange()`) trước khi gọi `rendition.display()`. Lỗi ném ra ở đây rơi vào try/catch đồng bộ của *chúng ta*, degrade an toàn về `display(spineIndex)` thay vì làm epub.js tự treo. |
| "Nhảy vào annotation luôn về đầu chương" | epub.js tính offset-trên-trang của CFI **ngay khi** section vừa gắn DOM, trước khi trình duyệt reflow xong font/ảnh. `goToLocation()` ép `display(targetIndex)` (full reload spine) trước — để tránh epub.js dùng "already shown" fast path với cache cột/trang cũ — rồi `displayCfiSafely()` lần 1, `waitForSectionResources()` (chờ ảnh load, tối đa 1200ms) + `waitForFrames(2)`, rồi `displayCfiSafely()` **lần 2 cùng CFI** — lần này epub.js đi "already shown" fast path nhưng tính lại offset trên layout đã ổn định. Đây chính là bản tự động hoá của "trick bấm lại lần 2" từng được quan sát thủ công. |
| Resize (ẩn/hiện toolbar, mở sidebar) đua với `goToLocation()` đang chạy → view list bị nát (cột/trang cũ) | `withRenditionLock()` — hàng đợi Promise nối tiếp, mọi `display()`/`resize()` chạy tuần tự, không còn concurrent mutate ViewManager. |
| Resize tự khôi phục vị trí (`resize()` đọc `rendition.location.start.cfi`) đua với 1 cú jump/TOC-nav vừa xảy ra → kéo người dùng ngược lại chỗ cũ | `resizeAnchorToken` — mỗi lần `cancelResizeAnchor()` tăng token; `settleResizeAnchor()` tự kiểm tra token của chính nó trước khi áp lại vị trí, nên một điều hướng mới hơn luôn thắng, không bị "kéo ngược". |
| Highlight/underline vẽ đè làm lệch offset con-node mà `locationOf()` cần đọc | Không còn cần `overlayPainter.suspend()/clear()` vì mark giờ dùng API `rendition.annotations` gốc của epub.js — bản thân epub.js tự đồng bộ vẽ lại mark với `rendered`, không phải DOM mutation tay của app can thiệp vào text node. |

## 4. Tài liệu cũ nào đã lỗi thời

- `docs/error/jump-to-location.md` — mô tả `overlayPainter.suspend/clear`, cơ chế "2 lần display" thủ
  công trong `goToLocation`, và bảng "hàm nào có CFI/không có CFi" cho `jumpToHighlight`/
  `jumpToTypewriterNote` (nói highlight/typewriter jump **không có CFI**). **Không còn đúng**:
  `openEpubjs.ts` hiện không có `overlayPainter` nào cả (đã bị thay hoàn toàn bởi
  `withRenditionLock`/`resizeAnchorToken`/`canDisplayCfi`), và UI đã có `underline` là tool thật
  (`interactionTool === 'underline'`, `cursor-underline-tool`) — không còn là "chỉ tồn tại ở tầng
  schema" như `docs/spec/jump-to-location-unified.md` §1 mục 3 mô tả.
- `docs/spec/jump-to-location-unified.md` — draft `JumpTarget`/`useReaderJump()` **chưa được áp
  dụng**; không có nghĩa là vấn đề chưa được giải quyết — nó được giải quyết theo hướng khác (tầng
  `openEpubjs.ts`, không phải tầng orchestration `useReaderAnnotations.ts` — file này thực ra cũng
  không còn tồn tại, logic đã tách vào `useReaderHighlights.ts`/`useReaderNavigation.ts`/
  `useReaderBookmarks.ts`).
- Bản thân `jump-to-location-unified.md` mục 9 đã tự ghi chú "`docs/error/jump-to-location.md` cần
  được viết lại toàn bộ sau khi spec này triển khai xong" — nay nên viết lại theo đúng cơ chế ở mục
  3 phía trên, không theo spec `JumpTarget` (vì spec đó không phải hướng đã chọn).

## 5. Kết luận cho câu hỏi "ảnh hưởng thế nào tới highlight/underline"

Ở **tầng engine** (`EpubRendererApi` expose đúng 1 cửa: `goToLocation(CfiLocation)` +
`flashHighlight(cfiRange, styleKind)` tra thẳng mark đã đăng ký trong epub.js), highlight/underline/
strikethrough giờ dùng chung một pipeline `goToLocation` đã được làm cứng (pre-validate CFI qua
`canDisplayCfi`, ép full reload spine trước khi display chính xác, hàng đợi hoá với resize qua
`withRenditionLock`). Đây là khác biệt cốt lõi so với kiến trúc cũ: cũ có 4 hàm jump tự viết tay,
mỗi hàm tự quyết định có dùng CFI hay không (và `jumpToHighlight` từng bị gỡ CFI, rơi về "nhảy thô
theo chương" chỉ vì đường CFI riêng của nó từng lỗi) — còn giờ chỉ có **một** con đường CFI ở tầng
thấp, nên bất kỳ annotation nào gọi tới nó đều được hưởng cùng mức an toàn.

**Giới hạn của phần điều tra này**: mình xác nhận được điều trên ở tầng `openEpubjs.ts`/
`EpubRenderer.tsx` (đã đọc trực tiếp), nhưng **chưa đọc được** `useReaderHighlights.ts`/
`useReaderNavigation.ts` (nơi thật sự gọi `apiRef.goToLocation` khi người dùng bấm "Jump" trên 1
highlight/underline cụ thể) — công cụ truy cập máy của bạn giới hạn độ sâu thư mục khi stage file,
và 2 file này nằm sâu hơn mức cho phép từ folder gốc đã kết nối. Nhiều khả năng cao là chúng đã gọi
đúng `goToLocation` (khớp với việc `flashHighlight` được expose sẵn cho đúng mục đích này), nhưng
nếu bạn muốn mình xác nhận 100% ở đúng call site, cách nhanh nhất là kết nối trực tiếp folder
`source/apps/reading-book-desktop/src/screens/Reader/logic/hooks` (hoặc cả `src/screens`) qua nút
"Add folder" trong Claude desktop app — mình sẽ đọc và cập nhật lại phần này ngay.
