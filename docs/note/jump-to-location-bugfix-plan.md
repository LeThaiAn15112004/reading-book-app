# Kế hoạch sửa lỗi: Jump to Location — màn che chậm (continuous) & Panel/layout vỡ (paginated)

Tài liệu này ghi lại 2 lỗi người dùng báo cáo qua việc dùng thực tế (ảnh chụp màn hình + mô tả,
2026-09-01), kết quả điều tra trong code, và kế hoạch sửa. Đi kèm
[`jump-to-location.md`](../error/jump-to-location.md) (mô tả cơ chế hiện có) — tài liệu đó là nền,
tài liệu này là phần vá thêm trên nền đó, không lặp lại toàn bộ cơ chế.

## 1. Vấn đề 1 — Continuous (scroll) mode: màn che hiện quá lâu, không "tức thời" như Foxit

### 1.1 Hiện tượng

Khi nhảy tới một highlight/bookmark/note ở chế độ cuộn liên tục, màn che đen (`isJumpingToAnnotation`
/ `isJumpingToBookmark`) xuất hiện, đứng yên một khoảng có thể cảm nhận được bằng mắt, rồi mới biến
mất và lộ ra đúng vị trí — không giống hành vi "cắt cảnh tức thời" mà tài liệu §6 của
`jump-to-location.md` mô tả là mục tiêu thiết kế, và không giống Foxit PDF (nhảy gần như ngay lập
tức, không cần màn che).

### 1.2 Nguyên nhân (đã xác nhận trong code)

Màn che đúng là chủ đích (che khoảng "giật hình" trong lúc epub.js `display()`/reflow), nhưng nó
đang bị giữ mở **trong suốt toàn bộ chuỗi await tuần tự** bên dưới, cộng dồn lại thành độ trễ có
thể cảm nhận được, thay vì chỉ che đúng phần cần che:

| Bước | Ở đâu | Có thể mất tới |
|---|---|---|
| 1. `display()` lần 1 | `openEpubjs.ts` `goToBookmarkLocation` (dòng ~2087-2115) / `goToLocation` (dòng ~2025-2062) | tức thời → vài chục ms |
| 2. `waitForSectionResources()` — chờ ảnh trong section load xong | cùng hàm trên | tối đa **1200ms** |
| 3. `waitForFrames(2)` | cùng hàm trên | 2 frame RAF (~33ms @60Hz) |
| 4. `display()` lần 2 (trick "gọi lại để epub.js tính offset trên layout đã settle") | cùng hàm trên | vài chục ms |
| 5. `waitForFrames(2)` | cùng hàm trên | 2 frame |
| 6. `reportLocation()` | cùng hàm trên | tức thời |
| 7. `waitForFrames(2)` (thêm 1 lần nữa, ở tầng orchestration) | `useReaderAnnotations.ts` `jumpToAnnotationLocationRef` (~dòng 304-345) | 2 frame |
| 8. Poll tìm `<mark>` trong DOM | `annotation-flash.ts` `waitForAnnotationMarkElements` — poll mỗi `JUMP_MARK_POLL_MS` (40ms) | tối đa **`JUMP_MARK_TIMEOUT_MS` = 900ms** |
| 9. `scrollIntoView` + `waitForFrames(1)` | `jumpToAnnotationLocationRef` | 1 frame |
| 10. `finally { setIsJumpingToAnnotation(false) }` — **chỉ tắt màn che ở đây** | `jumpToAnnotationLocationRef` | — |

Toàn bộ chuỗi có timeout cứng `CFI_JUMP_TIMEOUT_MS = 2000` (`openEpubjs.ts` dòng ~1167) chỉ bọc bước
1-6; bước 7-9 (poll mark + scroll) nằm **ngoài** timeout đó và cộng thêm phía sau. Tệ nhất: 1200ms +
vài frame + 900ms + scroll ≈ **hơn 2 giây** màn che mới biến mất — đây chính là cảm giác "phủ lên
xong 1 lúc sau mới nhảy đúng chỗ".

Foxit không cần màn che vì PDF không có bước "chờ epub.js reflow rồi tính lại offset CFI trên layout
đã settle" — hình học trang PDF cố định sẵn, không phải suy ra sau khi DOM render.

### 1.3 Kế hoạch sửa

| # | Việc | File |
|---|---|---|
| 1.1 | Tắt màn che (`setIsJumpingToAnnotation(false)` / `setIsJumpingToBookmark(false)`) **ngay sau khi** `goToLocation`/`goToBookmarkLocation` resolve — tức là dời `finally` (hoặc gọi tường minh) lên trước bước 7-9 ở trên, thay vì sau. | `useReaderAnnotations.ts` (`jumpToAnnotationLocationRef`, hàm bookmark tương ứng ~dòng 1072-1120) |
| 1.2 | Để bước poll-tìm-mark (bước 8) + `scrollIntoView` (bước 9) + flash chạy **không cần màn che** — bản thân animation nhấp nháy hổ phách (`flashAnnotationMark`) đã là tín hiệu "đã tới nơi", không cần giấu nó dưới màn che nữa. | cùng file trên |
| 1.3 | Đo lại thời gian thực tế của `waitForSectionResources()` (bước 2) bằng `console.time`/telemetry tạm thời ở continuous mode cụ thể — nếu p95 thực tế thấp hơn nhiều so với trần 1200ms lý thuyết trong tài liệu (`docs/note/jump-to-location-phase0-spike-result.md` §3.3 đo được cho paginated, chưa có số riêng cho continuous), cân nhắc hạ trần cho continuous mode vì `ContinuousViewManager` có thể có đặc tính load khác `default` manager. | `openEpubjs.ts` (tạm, gỡ sau khi có số liệu) |
| 1.4 | Kiểm tra thủ công lại toàn bộ 3 nhánh jump (highlight, bookmark, typewriter note) ở cả continuous và paginated sau khi đổi thời điểm tắt màn che — đảm bảo không lộ ra khung hình "chưa ổn định" (lý do màn che tồn tại từ đầu). | thủ công |

**Definition of done 1**: màn che chỉ còn che đúng khoảng `display()` → `reportLocation()` ổn định
(bước 1-6/7); phần poll mark + scroll + flash hiển thị công khai (không bị giấu), và cảm giác chủ
quan khi test thủ công là "nhảy gần như tức thời" ở continuous mode, không còn khoảng đứng hình dài
trước khi màn che biến mất.

**Rủi ro**: nếu tắt màn che quá sớm mà layout thực tế chưa settle (đặc biệt continuous mode, theo
comment tại `jumpToAnnotationLocationRef` — ẩn toolbar sớm có thể "đua" với scroll-tới-CFI của
epub.js gây màn hình trắng), có thể lộ lại đúng bug cũ mà màn che được thêm vào để che. Cần test kỹ
bước 1.4 trước khi coi là xong, đặc biệt các sách có ảnh nhiều (ảnh hưởng `waitForSectionResources`).

## 2. Vấn đề 2 — Paginated mode: layout vỡ, panel "Panel" trống tự mở, tua tới highlight không được

### 2.1 Hiện tượng (theo ảnh chụp màn hình)

Ở chế độ phân trang: giao diện 2 cột bị bó hẹp bất thường, có 1 panel bên phải mở ra với tiêu đề
mặc định "Panel" và nội dung trống, đồng thời việc tua/nhảy tới vị trí có highlight không thành
công (không tới đúng chỗ, hoặc trang hiện tại không đổi).

### 2.2 Đã xác nhận qua đọc code (loại trừ được)

- Panel bên phải (`RightSidebarPanel`, component tại
  `src/screens/Reader/components/sidebar/RightSidebarPanel.tsx`) chỉ có **đúng 3 điểm gọi** làm nó
  mở ra trong toàn bộ codebase:
  - `chrome.openRightSidebar('freehand')` — `ReaderScreen.tsx` dòng ~591 (chọn công cụ Pencil).
  - `chrome.toggleRightSidebar('typewriter')` — `ReaderScreen.tsx` dòng ~763 và ~826 (nút Typewriter).
  - Không có điểm gọi nào từ `jumpToHighlight` / `jumpToAnnotationLocationRef` /
    `useReaderAnnotations.ts` nói chung.
- Tiêu đề mặc định "Panel" + nội dung trống chỉ xảy ra khi `chrome.rightSidebarKind === null`
  **trong khi** `chrome.rightSidebarOpen === true` (`ReaderScreen.tsx` dòng ~467-490, ternary tiêu
  đề). Rà toàn bộ `useReaderChromeUi.ts` (nơi 2 state này sống): mọi nơi set `rightSidebarOpen` đều
  set `rightSidebarKind` cùng lúc (mở: cả hai cùng true+kind; đóng/escape/đổi sách/immersive: cả hai
  cùng false+null) — **không tìm thấy đường nào trong code hiện tại tạo ra tổ hợp
  open=true + kind=null.**
- `contentInsetRight` (padding co hẹp khung đọc, gây layout 2 cột bị bó — `ReaderShell.tsx`) được
  tính trực tiếp từ `chrome.rightSidebarOpen` (`sidebarContentInsetRight(...)`,
  `ReaderScreen.tsx` dòng ~308), không có đường tính riêng/độc lập nào khác có thể gây co hẹp khi
  panel thực sự đóng.

### 2.3 Giả thuyết chưa xác minh được (cần tái hiện trực tiếp mới chốt được)

- **Giả thuyết chính**: panel Pencil/Typewriter đã được mở từ trước trong phiên đọc đó (bấm nhầm/
  cố ý), vẫn đang mở khi người dùng bấm "jump to highlight" — 2 việc trùng thời điểm chứ không phải
  nhân-quả. Nếu đúng, tiêu đề thực tế phải là "Typewriter" hoặc "Pencil", không phải "Panel" —
  **mâu thuẫn với ảnh chụp** (ảnh cho thấy đúng chữ "Panel"), nên giả thuyết này **chưa giải thích
  đủ** hiện tượng và cần xác minh thêm bằng tái hiện trực tiếp.
- Việc "tua tới highlight không được" ở paginated: theo `jump-to-location.md` §3.6, cơ chế
  double-`display()` được mô tả là áp dụng như nhau cho cả continuous và paginated (bug cũ từng chỉ
  vá cho continuous, sau đó hợp nhất) — nên về lý thuyết không nên có khác biệt hành vi giữa 2 mode.
  Nếu vẫn khác nhau trong bản build hiện tại, đây có thể là một regression chưa lần ra được nguyên
  nhân cụ thể bằng cách đọc code tĩnh, cần log/telemetry runtime.

### 2.4 Kế hoạch điều tra (trước khi sửa mù)

| # | Việc | Vì sao |
|---|---|---|
| 2.1 | Tái hiện trực tiếp (chạy `npm run dev`, DevTools mở sẵn) theo đúng thao tác đã gây ra ảnh chụp; ghi lại: state `chrome.rightSidebarOpen`/`rightSidebarKind` tại thời điểm panel xuất hiện (React DevTools), và có log `[annotation-flash] no mark found for selector within 900ms: ...` (`annotation-flash.ts` dòng ~90-93) xuất hiện trong console hay không. | Đây là 2 điểm dữ liệu duy nhất phân biệt được các giả thuyết ở §2.3 mà không cần đọc thêm code — bắt buộc phải có để không sửa mù. |
| 2.2 | Nếu xác nhận `rightSidebarOpen=true` mà `rightSidebarKind=null` thật: thêm log tạm thời (`console.trace`) vào `setRightSidebarOpen`/`setRightSidebarKind` trong `useReaderChromeUi.ts` để bắt caller thực tế — có thể là code path chưa được grep ra (ví dụ gọi qua một ref/callback gián tiếp, hoặc từ mã đã build nhưng khác với working tree hiện tại). | Xác định đúng caller trước khi patch, tránh vá nhầm chỗ. |
| 2.3 | Nếu mark không được tìm thấy (log ở 2.1 xuất hiện): kiểm tra `goToBookmarkLocation`/`goToLocation` có thực sự resolve đúng CFI ở paginated không (thêm log tạm `console.log` quanh `displayCfiSafely` 2 lần trong `openEpubjs.ts`) — phân biệt giữa "epub.js display() sai vị trí" và "vị trí đúng nhưng `<mark>` không được `overlayPainter` vẽ lại kịp lúc `waitForAnnotationMarkElements` đang poll". | 2 nguyên nhân này cần 2 hướng sửa khác hẳn nhau (một cái sửa trong `openEpubjs.ts`, một cái sửa timing/thứ tự `overlayPainter.resume()` so với lúc bắt đầu poll). |
| 2.4 | Kiểm tra `spreadForLayout`/pagination cache (`epub-pagination-cache.ts`, `hydrateFromCache` trong `openEpubjs.ts` dòng ~1568) có đang trả về kích thước cột/trang cũ (cache stale) ngay sau khi mở panel bên phải (đổi `contentInsetRight` → đổi width khung đọc → cần re-paginate) hay không — đây là ứng viên khác cho "layout 2 cột bị bó" nếu panel mở đúng lúc mà việc re-paginate theo width mới chưa chạy kịp. | Giải thích khả dĩ cho phần "layout vỡ" độc lập với nguyên nhân panel mở. |

### 2.5 Chưa sửa code cho vấn đề 2

Chủ động **chưa viết fix** ở mục này vì §2.2 cho thấy code hiện tại (đọc tĩnh) không có đường nào
tạo ra đúng tổ hợp state trong ảnh chụp — sửa dựa trên suy đoán có rủi ro sửa nhầm chỗ hoặc che dấu
hiệu triệu chứng mà không chạm gốc rễ. Cần hoàn thành §2.4 (mục 2.1 tối thiểu) trước khi lên kế
hoạch patch cụ thể.

## 3. [Đã xác nhận qua đọc code, phiên điều tra tiếp theo — 2026-09-01] Nguyên nhân cụ thể của "layout vỡ": `jumpToBookmark` chưa được vá theo pattern đã áp dụng cho highlight/note

### 3.0 Ghi chú: "continuous mode" không còn tồn tại trong code hiện tại

`openEpubjs.ts` khai báo cứng `export const EPUB_FLOW = 'paginated'` kèm comment "The reader is
paginated-only" (không còn View Manager nào khác được dùng). Toàn bộ §1 phía trên (màn che chậm ở
"continuous/scroll mode") mô tả một chế độ đọc **đã bị gỡ khỏi app** — không tìm thấy `continuous`/`scroll`
nào khác trong `src/reader/**` ngoài 1 comment không liên quan (CFI "continuous path"). §1 nên được đóng
lại hoặc viết lại cho đúng paginated nếu độ trễ màn che vẫn còn cảm nhận được; số đo `[jump-timing]` đã có
sẵn trong `goToBookmarkLocation` (xem §3.1) đo đúng cho paginated rồi, dùng lại được.

### 3.1 So sánh 2 nhánh jump bằng CFI — 1 nhánh đã vá, 1 nhánh chưa

`useReaderAnnotations.ts` có 2 cơ chế jump-bằng-CFI tách biệt:

| Nhánh | Hàm | Gọi `setChromeHidden(true)` ngay sau khi CFI resolve? |
|---|---|---|
| Highlight / typewriter note | `jumpToAnnotationLocationRef` (~dòng 319-373), dùng chung bởi `jumpToHighlight`/`jumpToTypewriterNote` | **Không** — bị gỡ có chủ đích (xem comment ~dòng 329-331) |
| Bookmark | `jumpToBookmark` (~dòng 1087-1141) | **Có** — dòng ~1112 (nhánh có CFI) và ~1130 (nhánh fallback không CFI) |

Comment tại dòng ~329-331 (`jumpToAnnotationLocationRef`) giải thích đúng lý do nhánh highlight/note bỏ
gọi `setChromeHidden`:

> No setChromeHidden() here — hiding chrome resizes the epub host, which fires EpubRenderer's
> ResizeObserver → resizeToHost() → settleResizeAnchor(), overwriting the CFI we just landed on.

`jumpToBookmark` **chưa được vá theo cùng pattern** — comment tại dòng ~1109-1111 ở đó chỉ xử lý đúng thứ
tự "hide chrome sau khi CFI đã settle" (tránh set quá sớm), nhưng bỏ sót rằng bản thân việc set
`chromeHidden` — dù đặt sau — vẫn kích hoạt lại chính chuỗi resize-race mà comment kia mô tả.

### 3.2 Chuỗi sự kiện đầy đủ (xác nhận qua đọc code, không cần đoán runtime)

1. `jumpToBookmark` await `goToBookmarkLocation(location)` xong — CFI đã landed, `reportLocation()` đã
   chạy ở bước cuối `goToBookmarkLocation` (`openEpubjs.ts` ~dòng 2130).
2. `setChromeHidden(true)` (`useReaderAnnotations.ts:1112`). Nếu toolbar đang **hiện** tại thời điểm này —
   trường hợp rất phổ biến, vì để bấm nút "Jump" trên bookmark, người dùng vừa mở `TocSidebar` (đòi hỏi
   toolbar đang mở) — đây là một state change thật, không phải no-op.
3. State đổi → `EpubRenderer` (theo dõi prop `chromeHidden`) gọi `handle.setChromeHidden(true)`
   (`EpubRenderer.tsx:432` → `openEpubjs.ts` ~dòng 2415-2420). Hàm này chạy **ngay lập tức, không
   debounce**: `applyEpubReadingStyle(...)`, rồi `resizeToHost()` (intent mặc định `'preserve'`), rồi
   `scheduleFullPaginationRemeasure()`.
4. `resizeToHost('preserve')` (`openEpubjs.ts` ~dòng 1819-1842) đọc CFI hiện tại từ
   `readRenditionLocation()` rồi gọi `activeRendition.resize(width, height, anchorCfi)`. Theo đúng comment
   ngay tại khai báo hàm (~dòng 1811-1818): **`manager.resize()` của epub.js xoá sạch mọi view đang render
   và cuộn container về đầu**, rồi mới khôi phục vị trí từ CFI neo — một chu trình "xoá rồi dựng lại" toàn
   bộ layout phân trang, không phải một resize nhẹ.
5. `settleResizeAnchor(anchorCfi)` (~dòng 1787-1809) chạy bất đồng bộ để sửa lại vị trí cho đúng — đây
   chính là chuỗi mà comment ở §3.1 cảnh báo "overwriting the CFI we just landed on".
6. Toàn bộ bước 3-5 **không nằm dưới màn che nào**: `isJumpingToBookmark` đã tắt ngay sau
   `waitForFrames(2)` (~dòng 1115-1118) — chỉ ~2 frame (~33ms) sau khi `setChromeHidden(true)` được gọi —
   trong khi chuỗi resize/settle thật (bước 3-5) không có gì đảm bảo xong trong 2 frame, đặc biệt bước 4 tự
   nó đã "xoá toàn bộ view" trước khi dựng lại.
7. Ngoài ra `EpubRenderer.tsx` còn có 1 `ResizeObserver` riêng theo dõi `host.clientWidth/clientHeight`
   (~dòng 2087-2101), debounce 100ms, cũng gọi `handle.resize()` (= `resizeToHost()` lần nữa) sau khi CSS
   transition `padding-top` (300ms — `chromeHidden` đổi `paddingTop` trong `ReaderShell.tsx`) làm kích
   thước host thật sự ổn định — nghĩa là có thể xảy ra **2 lượt** "xoá view rồi dựng lại": 1 lượt ngay lập
   tức (bước 3-5, đọc kích thước host gần như chưa đổi) + 1 lượt nữa ~400ms sau. Cả 2 lượt đều không có
   màn che.

### 3.3 Vì sao khớp với triệu chứng "có cái ok, có cái vỡ"

- Nhảy tới highlight/typewriter note: đã vá (không gọi `setChromeHidden`) → không có chuỗi trên → mượt.
- Nhảy tới bookmark: chưa vá → nếu **toolbar đang hiện** tại thời điểm bấm Jump (trường hợp phổ biến) →
  kích hoạt toàn bộ chuỗi §3.2, không được che → đúng cảm giác "layout 2 cột bị bó/vỡ" ở ảnh chụp đã ghi
  tại §2.1. Nếu toolbar **đã ẩn sẵn** trước khi bấm Jump thì `setChromeHidden(true)` là no-op (cùng giá trị
  cũ) → React bail-out, không resize nào bị kích hoạt → nhảy mượt như bình thường. Đây giải thích trực tiếp
  "có lúc ok có lúc vỡ" mà **không cần** đến giả thuyết `rightSidebarOpen`/`rightSidebarKind` mất đồng bộ ở
  §2.3 (giả thuyết đó chưa bị loại hẳn, nhưng nguyên nhân ở đây độc lập, xác nhận được qua đọc code tĩnh —
  không cần tái hiện runtime — nên nên sửa trước, rủi ro thấp hơn).
- Panel "Panel" trống ở ảnh chụp §2.1: có khả năng chỉ là cách người dùng diễn giải lại đúng khoảnh khắc
  epub.js xoá sạch view rồi dựng lại (bước 4 ở trên) — cột đọc co lại gần rỗng bên trong khung viền
  `ReaderShell`/panel khi đang giữa 2 lượt resize — chứ chưa chắc là component `RightSidebarPanel` thật sự
  mở với `open=true, kind=null`. Cần chụp lại sau khi vá §3.4 để xác nhận; nếu hiện tượng "Panel" biến mất
  thì giả thuyết `rightSidebarKind=null` ở §2.3 coi như bị loại, khỏi cần điều tra runtime thêm.

### 3.4 Kế hoạch sửa (rủi ro thấp, cô lập trong 1 hàm, cùng pattern đã dùng cho nhánh highlight/note)

| # | Việc | File |
|---|---|---|
| 3.4.1 | Bỏ `setChromeHidden(true)` khỏi nhánh có-CFI của `jumpToBookmark` (dòng ~1112) — copy nguyên comment giải thích lý do (dòng ~329-331 của `jumpToAnnotationLocationRef`) sang đây để không ai vô tình thêm lại. | `useReaderAnnotations.ts` |
| 3.4.2 | Xem lại nhánh fallback không-CFI (dòng ~1130): kiểm tra `goToPageRef` có tự gọi `resizeToHost('reflow')` (an toàn hơn — không giữ anchor, không có chu trình settle) trước khi quyết định giữ/bỏ `setChromeHidden(true)` ở đây. Rủi ro thấp hơn nhánh CFI vì không có vị trí cần bảo toàn chính xác. | `useReaderAnnotations.ts`, đối chiếu `next`/`prev`/page-nav trong `openEpubjs.ts` |
| 3.4.3 | Sau khi bỏ `setChromeHidden(true)` khỏi luồng jump, xác nhận toolbar còn cần "tự ẩn sau khi nhảy tới bookmark" hay không theo yêu cầu sản phẩm gốc — nếu có, cần một đường khác không kích hoạt `resizeToHost` ngay lập tức (ví dụ thêm cờ "silent"/debounce cho `handle.setChromeHidden`) thay vì gọi thẳng như hiện tại. | `useReaderAnnotations.ts`, `openEpubjs.ts` |
| 3.4.4 | Tái hiện thủ công (`npm run dev`): mở TocSidebar → tab Bookmark → bấm Jump **khi toolbar đang hiện** — trước khi vá phải thấy layout vỡ; sau khi vá phải mượt như nhảy highlight. Test thêm khi toolbar đã ẩn sẵn (phải luôn mượt cả trước/sau vá — dùng để xác nhận không có regression). | thủ công |
| 3.4.5 | **[Đã xong]** Gỡ các `console.trace`/`console.debug` tạm còn sót từ phiên điều tra trước (`useReaderChromeUi.ts` — các chỗ `TEMP debug`/`chrome-debug`, kể cả 2 wrapper `tracedSetRightSidebarOpen`/`tracedSetRightSidebarKind`, gộp lại thành setter thường; `openEpubjs.ts` — khối `[jump-timing]` cùng biến `t0..t5` trong `goToBookmarkLocation`; overlay debug "rightSidebarOpen=..." trong `ReaderScreen.tsx`). `npm run lint` sạch cho cả 4 file (`useReaderAnnotations.ts`, `openEpubjs.ts`, `ReaderScreen.tsx`, `useReaderChromeUi.ts`); `npm run typecheck` không phát sinh lỗi mới — các lỗi còn lại (`MarginMode` trong `toReadingPrefs.ts`, TS6133/TS6138 trong `packages/shared/services/*`) đã có từ trước, ngoài phạm vi. | `useReaderChromeUi.ts`, `openEpubjs.ts`, `ReaderScreen.tsx` |

**Definition of done (§3)**: nhảy tới bookmark khi toolbar đang hiện không còn gây layout vỡ/2 cột bị bó;
hành vi giống hệt nhảy tới highlight/typewriter note (đã mượt sẵn). Giả thuyết `rightSidebarKind=null`
(§2.3) coi như đóng nếu ảnh "Panel" không tái hiện sau vá; nếu vẫn tái hiện thì mới cần tiếp tục §2.4.

**Đã sửa (2026-09-01)**: §3.4.1 áp dụng — bỏ `setChromeHidden(true)` khỏi nhánh có-CFI của `jumpToBookmark`
(`useReaderAnnotations.ts`), thay bằng comment giải thích cùng lý do đã dùng cho
`jumpToAnnotationLocationRef`. `npm run typecheck` không phát sinh lỗi mới liên quan tới thay đổi này (các
lỗi còn lại trong output là lỗi có sẵn, không liên quan). **Còn lại cần làm**: §3.4.2 (nhánh fallback
không-CFI), §3.4.3 (xác nhận yêu cầu sản phẩm về tự-ẩn-toolbar-sau-khi-jump-bookmark), §3.4.4 (test thủ
công trong `npm run dev` — chưa chạy được trong phiên này vì không tái hiện được GUI Electron qua công cụ
hiện có), §3.4.5 (dọn debug tạm).

### 3.5 [Cập nhật, phiên live-debug tiếp theo] Nguyên nhân thật của "Panel" + layout vỡ: cache column-width cũ, không phải `rightSidebarOpen`

Sau khi thêm overlay debug hiển thị trực tiếp `rightSidebarOpen`/`rightSidebarKind` trên màn hình (không qua
DevTools) và test trực tiếp cùng người dùng: xác nhận `rightSidebarOpen=false` **ngay lúc** panel "Panel"
đang hiện trên màn hình — loại hẳn giả thuyết `rightSidebarKind=null` ở §2.3/§3.3. DOM breakpoint
"Attribute modifications" trên đúng node `[data-reader-right-sidebar-panel]` cũng xác nhận không dừng lại,
và `document.querySelectorAll(...).length === 1` (không bị nhân đôi node) — hộp "Panel" nhìn thấy được
không phải do component này mở.

Người dùng tái hiện chính xác được điều kiện: **nhảy tới annotation ở đầu section thì không sao; nhảy tới
annotation nằm sau trong CÙNG section đã hiển thị thì bị tách 1 trang thành 2 cột nửa-trang, dù đang ở chế
độ single-page.** Đây khớp với cơ chế 2 nhánh khác nhau trong `displayCfiSafely`/epub.js:

- CFI ở đầu section → `rendition.display(index)` (theo spine index) → epub.js load lại section từ đầu →
  luôn tính lại column-width mới, đúng với kích thước host hiện tại.
- CFI ở giữa/cuối 1 section **đã mount sẵn** → epub.js dùng nhánh nhanh "already shown" → **dùng lại
  column-width đã cache từ lần đo trước**, không tính lại.

Nếu kích thước host đã đổi (ví dụ vừa mở sidebar Notes bên trái để bấm nút Jump — resize thật chỉ chạy sau
`READER_CHROME_TRANSITION_MS` = 300ms, debounce, theo `scheduleEpubResizeAfterChromeTransition`) mà người
dùng bấm Jump **trước khi** resize 300ms đó kịp chạy, epub.js vẫn giữ column-width cũ (rộng hơn) trong khi
host đã hẹp lại — cột nội dung rộng-cũ không vừa khung hẹp-mới, hiển thị tách thành 2 cột nửa-trang. Đây
chính là "Panel" nhìn thấy trong các ảnh trước — không phải panel thật, mà là hệ quả trực quan của layout bị
vỡ cột (có thể là mép cột thứ 2 chồng lên đúng vị trí panel phải, tạo ảo giác "panel mở").

**Đã sửa**: thêm `epubApiRef.current?.resize()` + `waitForFrames(2)` ngay trước `goToBookmarkLocation()`
trong cả `jumpToAnnotationLocationRef` và `jumpToBookmark` (`useReaderAnnotations.ts`) — ép flush mọi resize
đang chờ trước khi nhảy, đảm bảo epub.js tính lại column-width đúng với kích thước host hiện tại trước khi
landing. `npm run typecheck` sạch cho thay đổi này.

**Còn cần**: người dùng test lại trực tiếp (restart `npm run dev`) đúng kịch bản đã tái hiện được (mở
sidebar Notes → bấm Jump ngay tới annotation nằm giữa/cuối section đã mount) để xác nhận hết vỡ. Nếu hết,
đóng hẳn §2/§3.

**[2026-09-01, phiên dọn dẹp]**: Không tự chạy được test GUI thủ công trong phiên này — không có công cụ
điều khiển cửa sổ Electron thật (Claude Browser chỉ tự động hoá trang web, không phải app desktop native).
Đã xác nhận qua đọc code tĩnh: patch `epubApiRef.current?.resize()` + `await waitForFrames(2)` ngay trước
`goToBookmarkLocation()` vẫn còn nguyên trong cả `jumpToAnnotationLocationRef` và `jumpToBookmark`
(`useReaderAnnotations.ts`), và fix "luôn `display(fallbackIndex)` trước khi `display(displayCfi)`" vẫn còn
nguyên trong `goToBookmarkLocation` (`openEpubjs.ts`) — khớp đúng mô tả ở §3.5/§3.7. Đã dọn xong toàn bộ
debug overlay tạm trong `ReaderScreen.tsx` (khối `{/* TEMP debug readout ... */}`) sau khi xác nhận qua đọc
code (xem §3.4.5). **Người dùng cần tự chạy `npm run dev` và test theo đúng kịch bản ở §3.4.4/đầu tài liệu
này để xác nhận cuối cùng bằng mắt** — việc dọn debug trong phiên này không thay thế được bước đó.

### 3.6 [Xác nhận] Vì sao bookmark mượt mà annotation vẫn vỡ dù cùng cơ chế viewport CFI

`locationRef` của highlight/typewriter/freehand **đã** dùng chung cơ chế viewport CFI với bookmark từ trước
(`captureCurrentLocationRef`, xem comment tại chỗ khai báo) — cả 2 đều gọi `goToBookmarkLocation`. Nhưng
`jumpToAnnotationLocationRef` có 1 đoạn mà `jumpToBookmark` **không có**: sau khi CFI landed, nó
`await waitForAnnotationMarkElements(markSelector)` (poll tìm `<mark>`, tối đa 900ms); nếu **không tìm
thấy**, code tự ý gọi `goToPageRef.current(...)` — **một lượt điều hướng trang hoàn toàn khác**, tách biệt
với luồng CFI. Trước khi sửa, shield (`isJumpingToAnnotation`) đã bị tắt **trước** đoạn poll/fallback này
(comment cũ giả định sau khi tắt màn che chỉ còn "poll thụ động", không tính tới việc fallback này là 1
lượt điều hướng chủ động) — nên nếu mark không được tìm thấy kịp, `goToPageRef` chạy hoàn toàn không được
che, gây đúng cảm giác "vỡ layout" mà bookmark (không có bước này) không bao giờ gặp.

**Đã sửa**: bỏ lệnh tắt shield sớm đó, để `finally` (đã có sẵn ở cuối hàm) là nơi duy nhất tắt shield — che
luôn cả đoạn poll + fallback `goToPageRef` nếu nó xảy ra. `npm run typecheck` sạch.

### 3.7 [Xác nhận] Dạng vỡ thứ 2: trang bị "hụt" khoảng trắng lớn ở cuối — cache chiều CAO trang cũ

Ảnh chụp mới cho thấy 1 dạng vỡ khác hẳn 2-cột: trang hiện đủ nội dung 1 cột đúng khổ, nhưng **dừng sớm**,
để trống 1 khoảng lớn phía dưới thay vì tràn tiếp chữ xuống hết chiều cao thật của khung đọc.

Cùng gốc rễ với §3 (mid-section CFI dùng nhánh "already shown" của epub.js, tái dùng metric đã cache thay
vì tính lại) — nhưng lần này là **chiều cao trang** bị cache cũ chứ không phải độ rộng cột: nếu section đó
được mount lần đầu lúc chiều cao khung khác (ví dụ toolbar đang hiện, hoặc sidebar khác trạng thái), rồi sau
đó chiều cao khung đổi (`chromeHidden` đổi, đóng/mở sidebar, …) nhưng section không được reload, epub.js vẫn
ngắt trang theo chiều cao cũ (thấp hơn) → thừa khoảng trắng ở dưới so với chiều cao thật hiện tại.

**Đã sửa**: `goToBookmarkLocation` (`openEpubjs.ts`) giờ luôn `activeRendition.display(fallbackIndex)`
(reload section theo spine index, ép epub.js đo lại từ đầu) **trước** khi `display(displayCfi)` — kể cả khi
section đó đã đang mở sẵn — rồi mới chạy tiếp chuỗi double-display(cfi) như cũ để lấy đúng offset. Việc này
nằm trong 1 lượt `withCfiJumpTimeout`, dưới `overlayPainter.suspend()` và dưới màn che
`isJumpingToAnnotation`/`isJumpingToBookmark` sẵn có, nên không lộ ra glitch phụ. Log `[jump-timing]` được
thêm cột `reload=Xms` để biết chi phí bước này. `npm run typecheck` sạch.

## 4. Thứ tự triển khai đề xuất

1. **§3.4** — nguyên nhân đã xác nhận qua đọc code tĩnh (không cần tái hiện runtime trước), rủi ro thấp,
   cô lập trong 1 hàm, cùng pattern đã áp dụng thành công cho nhánh highlight/note. Làm trước tiên.
2. Sau khi vá §3.4 và test thủ công (§3.4.4): nếu triệu chứng "Panel trống" trong ảnh chụp §2.1 **biến
   mất**, đóng luôn §2 (giả thuyết `rightSidebarKind=null` bị loại) và cập nhật tài liệu.
3. Nếu triệu chứng vẫn còn sau §3.4 (nghĩa là có 2 lỗi độc lập, không phải 1): tiếp tục §2.4 (tái hiện +
   thu thập log runtime — công cụ debug đã có sẵn trong `useReaderChromeUi.ts`).
4. Vấn đề 1 (§1.3, màn che chậm) — làm sau, và trước khi đo lại cần xác nhận §3.0 (chỉ còn paginated).

## 5. Tham chiếu

- [`docs/error/jump-to-location.md`](../error/jump-to-location.md) — cơ chế đầy đủ hiện có (nền của
  tài liệu này).
- [`docs/note/jump-to-location-phase0-spike-result.md`](./jump-to-location-phase0-spike-result.md)
  §3.3 — số đo p99 gốc cho trần thời gian `CFI_JUMP_TIMEOUT_MS`/`waitForSectionResources` (đo cho
  paginated; continuous chưa có số riêng, xem việc 1.3).
