# Thorium Reader: lưu vị trí đọc & cơ chế "jump to location"

> Đọc trực tiếp mã nguồn `thorium-reader`, chủ yếu `src/r2-xxx-js/r2-navigator-js/electron/renderer/{location.ts,dom.ts,webview/preload.ts}`, `src/renderer/reader/components/Reader.tsx`, `src/main/storage/publication-data.ts`, `src/main/redux/sagas/{persist.ts,win/reader.ts}`. Ngày 2026-09-05.

---

## 1. Hai khái niệm cần tách bạch ngay từ đầu

Thorium có **hai kho lưu trữ hoàn toàn khác nhau**, dễ nhầm là một:

| | Vị trí đang đọc (reading position / "last location") | Bookmark & Annotation |
|---|---|---|
| Model | `LocatorExtended` (r2-navigator-js) | `INoteState` (đã nói ở docs trước) |
| Nơi lưu | **1 file JSON nhỏ / sách**, không phải SQL | bảng `notes` SQLite (`node:sqlite`, STRICT) |
| Đường dẫn | `%appData%\config-data-json{-dev}\publication\<uuid>\locator.json` | file DB SQLite dùng chung cho cả app |
| Ghi khi nào | mỗi lần vị trí đọc đổi (scroll/turn page), gần như ngay lập tức, không debounce | khi user bấm tạo/sửa/xoá |
| Class quản lý | `PublicationData` (`main/storage/publication-data.ts`) — đọc/ghi 1 file JSON, có mutex per-file | `sqlite/note.ts` |

Đây là điểm khác biệt kiến trúc đáng chú ý: **Thorium không dùng SQL cho "đang đọc tới đâu"**. Nó dùng đúng 1 file `locator.json` viết đè toàn bộ mỗi lần (không phải diff/patch), giống hệt các file `config.json`, `pdfConfig.json`, `divina.json`, `bound.json` khác cũng nằm cạnh nó trong cùng thư mục `<uuid>/` — tất cả đều do cùng 1 class `PublicationData` quản lý, chỉ khác tên file (`assertAndGetFileName`).

---

## 2. Cấu trúc dữ liệu: `Locator` và `LocatorExtended`

`Locator` (chuẩn Readium, `r2-shared-js/models/locator.ts` + bản mở rộng của Thorium ở `r2-navigator-js/electron/common/locator.ts`):

```ts
interface Locator {
  href: string;                 // resource trong Spine/Resources
  title?: string;
  text?: { before?, highlight?, after?, beforeRaw?, highlightRaw?, afterRaw? };
  locations: {
    cfi?: string;                // CÓ lưu, nhưng KHÔNG dùng để "jump" (xem mục 5)
    cssSelector?: string;        // <-- đây mới là thứ thật sự dùng để tìm lại vị trí
    xpath?: string;
    position?: number;           // trang tuyệt đối (1 số định dạng)
    progression?: number;        // % tiến độ trong chương (0..1) — fallback khi không có cssSelector
    caretInfo?: ISelectionInfo;  // range ký tự chính xác (để không "giật" về đầu 1 element dài)
  };
}
```

`LocatorExtended` (r2-navigator-js) là **payload runtime đầy đủ hơn nhiều**, được emit mỗi khi vị trí đọc thay đổi — đây mới là thứ thật sự được lưu:

```ts
interface LocatorExtended {
  locEventID?: number;
  audioPlaybackInfo: IAudioPlaybackInfo | undefined; // audiobook
  locator: Locator;
  paginationInfo: IPaginationInfo | undefined;   // totalColumns, currentColumn, isTwoPageSpread...
  selectionInfo: ISelectionInfo | undefined;
  selectionIsNew: boolean | undefined;
  docInfo: IDocInfo | undefined;                 // isFixedLayout, isRightToLeft, isVerticalWritingMode
  epubPage: string | undefined;                  // epub:type="pagebreak" gần nhất
  epubPageID: string | undefined;
  headings: Array<{ id, txt, level }> | undefined;
  secondWebViewHref: string | undefined;         // trang bên cạnh, khi hiển thị 2 trang (spread)
  followingElementIDs?: string[];                // bị cắt bỏ trước khi lưu (xem "Mini" bên dưới)
}
```

Trước khi lưu, Thorium cắt bớt thành `MiniLocatorExtended` (bỏ `followingElementIDs` — chỉ dùng tạm thời lúc runtime, không cần lưu):

```ts
// common/redux/states/locatorInitialState.ts
type MiniLocatorExtended = Omit<LocatorExtended, "followingElementIDs">;
```

---

## 3. Luồng LƯU vị trí đọc (khi user scroll/lật trang)

```
[iframe nội dung sách]
  scroll/turn page
    → notifyReadingLocationDebounced()  (preload.ts, bên trong iframe)
    → gửi IPC "R2_EVENT_READING_LOCATION" ra ngoài webview
        (payload: locations.cfi, cssSelector, progression, paginationInfo, headings...)

[renderer, ngoài webview — r2-navigator-js/electron/renderer/location.ts]
    → _saveReadingLocation(activeWebView, payload)
        - tính thêm `position` cho audiobook nếu cần
        - build đối tượng LocatorExtended đầy đủ, gán vào biến module-level _lastSavedReadingLocation
        - gọi callback đã đăng ký: _readingLocationSaver(_lastSavedReadingLocation)

[Reader.tsx — do gọi setReadingLocationSaver(this.handleReadingLocationChange) lúc componentDidMount]
    → handleReadingLocationChange(locatorExtended)
        - minimizeLocatorExtended()  → bỏ followingElementIDs
        - this.saveReadingLocation(mini) → this.props.setMiniLocatorExtended(mini)
        - đồng thời setState({ currentLocation }) để UI (progress bar, footer %) cập nhật ngay

[redux renderer, reader window]
    → dispatch action READER_SET_LOCATOR (readerActions.setLocator.build(mini))
        - reducer readerLocator.ts cập nhật state cục bộ (chỉ để UI đọc, KHÔNG phải nơi lưu bền)
        - reduxSyncMiddleware (renderer/reader/redux/middleware/sync.ts) thấy action này nằm
          trong SYNCHRONIZABLE_ACTIONS → forward nguyên action qua IPC sang main process,
          kèm sender = { type: Renderer, reader_pubId }

[main process — main/redux/sagas/persist.ts]
    → saga takeSpawnLeading(readerActions.setLocator.ID, ...)
        - lấy pubId từ sender.reader_pubId
        - diMainGet("publication-data").writeJsonObj(pubId, "locator", locatorJsonObj)
        - GHI NGAY, không debounce (bản debounce 10s đã bị comment-out, xem PUBLICATION_STORAGE_DEBOUNCE_TIME)

[main/storage/publication-data.ts — class PublicationData]
    → open("write", pubId, "locator")
        - path = <publicationConfigPath>/<pubId>/locator.json
        - tạo thư mục <pubId>/ nếu chưa có
    → writeJsonObj: JSON.stringify(...) rồi fs.promises.writeFile(...) đè toàn bộ file
        - có mutex theo từng file để tránh 2 write chồng nhau
```

Vài điểm đáng chú ý:
- **Ghi gần như realtime, mỗi lần vị trí đổi**, không gộp/patch — khác hẳn cách Thorium lưu `state.json` tổng (redux persist toàn app, có debounce 1s, có checksum SHA1 để verify — xem `main/redux/sagas/persist.ts::persistStateToFs`). Vị trí đọc được cố tình tách riêng để **mất điện/crash cũng không mất quá 1 lần scroll**.
- File `locator.json` **không có versioning/history** — ghi đè hoàn toàn, không phải "danh sách vị trí đã qua". Lịch sử điều hướng (back/forward trong session) chỉ sống trong `window.history` của renderer, mất khi đóng cửa sổ.
- `readJsonObj` cache kết quả trong bộ nhớ (`file.jsonObj`) sau lần đọc đầu, tránh đọc lại file nhiều lần trong 1 phiên.

---

## 4. Luồng ĐỌC LẠI khi mở sách (resume)

```
[main/redux/sagas/win/reader.ts — chạy khi tạo cửa sổ Reader cho 1 pubId]
    const locator = await diMainGet("publication-data").readJsonObj(pubId, "locator");
    → đưa vào initial redux state của cửa sổ Reader (props.locator)

[Reader.tsx, lần mount đầu tiên, nhánh EPUB/DAISY (không phải PDF/Divina)]
    const locator = this.props.locator?.locator?.href ? this.props.locator.locator : undefined;
    installNavigatorDOM(publication, ..., locator, ...)   // r2-navigator-js/electron/renderer/dom.ts

[dom.ts::installNavigatorDOM]
    ... setup win.READIUM2 state, tạo webview đầu tiên ...
    handleLinkLocator(location, rcss);   // <-- GIỐNG HỆT hàm dùng khi user bấm 1 link/bookmark
```

**Điểm quan trọng nhất của mục này**: Thorium **không có code path riêng cho "resume"**. `installNavigatorDOM` (chạy đúng 1 lần, lúc mở sách) gọi thẳng `handleLinkLocator()` — cùng một hàm dùng khi:
- user bấm vào 1 bookmark trong panel bên trái,
- user bấm vào kết quả tìm kiếm,
- user bấm "Go to page",
- code xử lý nút Back/Forward trong lịch sử điều hướng.

Tất cả đều hội tụ về **một cơ chế "jump" duy nhất** (mục 5). Vị trí đọc lúc mở sách chỉ là một `Locator` như mọi `Locator` khác — không có khái niệm "load trang đầu rồi mới nhảy tới vị trí đã lưu" như một bước hai giai đoạn tách rời.

---

## 5. Cơ chế "jump" thực sự: `handleLinkLocator` → `loadLink`

`handleLinkLocator(locator)` (`location.ts`) chuyển `Locator` thành 1 URL rồi gọi `handleLink()`:

```ts
const hrefToLoad = urlNoQueryParams +
  "?goto=" + base64(JSON.stringify(locator.locations)) +   // toàn bộ {cfi, cssSelector, progression,...}
  "&gotoDomRange=" + base64(JSON.stringify(rangeInfo));    // nếu có caretInfo.rangeInfo
```

→ gọi `loadLink(hrefToLoad, ...)`. Hàm này rẽ nhánh theo **1 điều kiện sống còn**: *"webview hiện có đang hiển thị đúng document (`href`) này không?"*

### Nhánh A — CÙNG document đang mở (fast path, không reload)

```ts
if (!isAudio && !webviewNeedsForcedRefresh &&
    activeWebView.READIUM2.link === pubLink && !isFixedLayout(pubLink)) {

  // KHÔNG load lại webview/iframe — chỉ gửi 1 IPC message vào trong
  activeWebView.send(R2_EVENT_SCROLLTO, { goto, gotoDomRange, hash, ... });
  return true;
}
```

Đây chính là trường hợp: đang đọc chương 3, bấm vào 1 bookmark cũng nằm trong chương 3 → Thorium **không reload iframe**, chỉ scroll trong document đang có sẵn.

### Nhánh B — KHÁC document, hoặc bị ép refresh (slow path, reload thật)

Xảy ra khi: `href` khác chương đang mở, hoặc `activeWebView.READIUM2.forceRefresh === true` (bị set khi vừa bật/tắt TTS click-to-read), hoặc là Fixed-Layout, hoặc audio.

- Nếu là **Fixed-Layout**: che `win.READIUM2.domRootElement.style.opacity = "0"` (tăng `opacityMaskCounter`) trước khi đổi trang — webview container bị ẩn hoàn toàn cho tới khi phía trong gửi `R2_EVENT_SHOW` báo đã render/định vị xong (`opacityMaskCounter` giảm về 0 thì mới trả `opacity = "1"`).
- Nếu là **EPUB reflow bình thường**: **không dùng tầng mask ngoài này** — `activeWebView.setAttribute("src", url + "?goto=...")` để Electron `<webview>` load lại tài liệu từ đầu, kèm y hệt query param `goto`/`gotoDomRange` như trên. Việc "ẩn khi đang định vị" ở trường hợp này do tầng mask **bên trong iframe** đảm nhiệm (mục 6).

---

## 6. Bên trong iframe: `goto` được giải mã và resolve thế nào

Đây là phần trả lời trực tiếp câu hỏi "Thorium dùng CFI để nhảy tới vị trí à?" — **KHÔNG hẳn**. Hàm `scrollToHashRaw()` (`webview/preload.ts`) đọc `goto` (base64 → JSON `LocatorLocations`) và chỉ dùng:

```ts
const locObj = JSON.parse(atob(gto)) as LocatorLocations;
gotoCssSelector = locObj.cssSelector;   // ưu tiên #1
gotoProgression = locObj.progression;   // fallback nếu không có cssSelector
// locObj.cfi KHÔNG được đọc ở đây!
```

Thứ tự ưu tiên khi resolve:

1. **`cssSelector` có giá trị** → `document.querySelector(cssSelector)` tìm thẳng ra element, rồi:
   - nếu có `gotoDomRange` (từ `caretInfo.rangeInfo`) → `convertRangeInfo()` dựng lại 1 DOM `Range` chính xác tới từng ký tự → lấy `getBoundingClientRect()` của range đó (chứ không phải của cả element) → **đây là cơ chế tránh "giật về đầu element"**: nếu chỉ dùng `querySelector` rồi `scrollIntoView` cả thẻ `<p>`, mà đoạn text nằm ở giữa/cuối 1 đoạn văn dài, vị trí cuộn sẽ sai lệch — `rangeInfo` sửa đúng điều này.
   - gọi `scrollElementIntoView(selected, true, animate, domRect)`.
2. **Không có `cssSelector`, chỉ có `progression`** → tính offset cuộn/số cột trực tiếp bằng toán học (`gotoProgression * maxScrollShift`, hoặc với chế độ phân trang thì `Math.floor(progression * tổng_số_cột)`), không cần tìm DOM element nào cả. Đây là fallback khi không định vị được element cụ thể (ví dụ vị trí lưu từ trước khi 1 số DOM id đổi do sách được cập nhật).
3. **`cfi`**: có mặt trong dữ liệu lưu (để tương thích chuẩn Readium / export sang app khác), nhưng **không phải là cơ chế Thorium tự dùng để tìm lại vị trí của chính nó**.

`scrollElementIntoView()` sau đó xử lý 2 chế độ khác hẳn nhau:
- **Chế độ cuộn liên tục (scrolled)**: tính `offset` = vị trí element trừ nửa viewport, set `scrollTop`/`scrollLeft` trực tiếp (có animate hoặc không), có ngưỡng "diff < 10px thì bỏ qua" để tránh giật do làm tròn.
- **Chế độ phân trang cột (paged/CSS columns)**: gọi `scrollIntoView()` riêng, tính `columnIndex`/`spreadIndex` dựa trên `calculateColumnDimension()` — **đòi hỏi layout cột phải đã ổn định trước đó**, nếu không số cột tính ra sẽ sai (đúng loại bug "nhảy sai vị trí" mà app của bạn từng gặp).

Khi target được set qua `hash`/`selected` (không phải `locationHashOverride` có sẵn), Thorium **cố tình delay 100ms** trước khi gọi `scrollToHashRaw`:

```ts
if (delayScrollIntoView) {
  setTimeout(() => scrollToHashRaw(false, true), 100);
}
```

— để chờ `win.location.href = "#..."` phản ánh xong lên layout trước khi đo `getBoundingClientRect()`/tính cột, **cùng bản chất với "double display + waitForFrames" mà bạn đã tự vá cho `openEpubjs.ts`** — chỉ khác cơ chế chờ (setTimeout cố định 100ms thay vì đợi frame + resource event).

---

## 7. Cơ chế chống "chớp sai vị trí" (visibility mask) — và giới hạn thật của nó

Có **2 tầng mask độc lập**, dễ nhầm là một:

| Tầng | Ở đâu | Cách hoạt động | Dùng khi nào |
|---|---|---|---|
| Ngoài (outer) | `win.READIUM2.domRootElement.style.opacity` + `opacityMaskCounter` | ẩn/hiện cả `<webview>` container bằng inline style, đếm số lần "đang ẩn" để tránh 2 luồng cùng reveal sớm | **Chỉ** Fixed-Layout (đổi trang/spread) và resize/zoom — reflow EPUB thường KHÔNG dùng tầng này lúc load lại document |
| Trong (inner) | class CSS `readium2-invisible-mask` add/remove trên `<html>` **bên trong** chính iframe nội dung | `showHideContentMask(doHide)` | Mỗi lần tiêm/áp lại ReadiumCSS (`R2_EVENT_READIUMCSS`: hide → set style/columns → recreate highlights → show) |

Sự thật cần biết (để không thần thánh hoá): với EPUB reflow — trường hợp phổ biến nhất — trình tự lúc `<iframe>` load xong (`loaded()` trong preload.ts) là:

```
showHideContentMask(false, ...)   // REVEAL ngay — nội dung đã hiện, có thể đang ở vị trí mặc định (đầu trang)
scrollToHashDebounced(false)      // debounce 100ms rồi mới thực sự scroll tới goto
```

Nghĩa là: Thorium **reveal nội dung trước, rồi mới cuộn tới đúng vị trí trong cửa sổ 100ms tiếp theo** — không phải "tính xong vị trí chính xác rồi mới cho hiện". Nếu máy chậm/tài liệu nặng, về lý thuyết vẫn có thể thấy 1 khung hình ở vị trí mặc định trước khi giật tới đúng chỗ — Thorium chấp nhận đánh đổi này để tránh màn hình trắng/đen kéo dài, dựa vào việc 100ms là đủ ngắn để mắt người khó nhận ra trong đa số trường hợp, chứ không phải một cam kết "không bao giờ chớp sai vị trí".

→ Vậy: claim "Thorium khoá viewport tới khi định vị xong rồi mới hiện" là **đúng cho Fixed-Layout / đổi trang**, nhưng **không hoàn toàn đúng cho EPUB reflow lúc mở tài liệu lần đầu** — ở đó Thorium ưu tiên "hiện nhanh, chấp nhận cuộn muộn 100ms" hơn là "khoá cứng tới khi chắc chắn đúng vị trí".

---

## 8. Liên hệ ngắn với `reading-book-app`

- Thorium tách "vị trí đọc" (file JSON riêng/sách, ghi mỗi lần scroll, không debounce) hoàn toàn khỏi "annotation/bookmark" (SQLite `notes`). App của bạn hiện gộp chung vào SQLite (`reading_session_states` cho vị trí đọc, nay `notes` cho annotation+bookmark) — không sai, chỉ là lựa chọn khác; điểm cần giữ là **đường ghi vị trí đọc nên rẻ và không debounce quá lâu**, giống tinh thần Thorium, vì mất vài giây cuối trước khi crash không nên làm mất luôn vị trí đọc.
- Thorium **không có code path "resume" tách riêng** — `installNavigatorDOM` gọi thẳng `handleLinkLocator`, cùng hàm dùng cho mọi kiểu nhảy vị trí khác. Đây chính là điểm khác biệt với `openEpubjs.ts` của bạn: `goToBookmarkLocation` (nhảy thủ công) đã được vá kỹ (double-display, suspend/resume overlay, waitForFrames), nhưng path resume-on-open (dòng ~1518, gọi `displayCfiSafely` đơn lẻ) lại là một nhánh code **riêng, không đi qua cùng cơ chế đã vá** — đúng loại rủi ro mà kiến trúc "1 hàm jump duy nhất cho mọi nguồn gọi" của Thorium tránh được từ đầu. Gộp `resume-on-open` vào chung pipeline với `goToBookmarkLocation` (thay vì giữ 2 đường code riêng) là hướng đáng cân nhắc, độc lập với việc có đổi sang cơ chế webview-reload của Thorium hay không.
- Việc Thorium ưu tiên `cssSelector` (+ `rangeInfo` để refine tới ký tự) hơn `cfi` để tự jump, dù vẫn lưu `cfi` cho mục đích tương thích, là một gợi ý: **địa chỉ dùng để "jump" và địa chỉ dùng để "trao đổi/tương thích chuẩn" không nhất thiết phải là cùng một thứ** — khớp với thiết kế `locationRef`/`locationData` tách biệt mà bạn đã chọn từ trước.

---

## 9. Nguồn

- `src/r2-xxx-js/r2-navigator-js/electron/renderer/location.ts` — `handleLinkLocator`, `loadLink`, `_saveReadingLocation`, `setReadingLocationSaver`, opacity mask (Fixed-Layout)
- `src/r2-xxx-js/r2-navigator-js/electron/renderer/dom.ts` — `installNavigatorDOM`, resize-observer opacity mask
- `src/r2-xxx-js/r2-navigator-js/electron/renderer/webview/preload.ts` — `R2_EVENT_SCROLLTO` handler, `scrollToHashRaw`, `scrollElementIntoView`, `showHideContentMask`, `loaded()`
- `src/r2-xxx-js/r2-navigator-js/electron/common/locator.ts`, `src/r2-xxx-js/r2-shared-js/models/locator.ts` — model `Locator`
- `src/renderer/reader/components/Reader.tsx` — `handleReadingLocationChange`, `saveReadingLocation`, `goToLocator`, `handleLinkLocator`, gọi `installNavigatorDOM` lúc mount
- `src/common/redux/states/locatorInitialState.ts` — `MiniLocatorExtended`, `minimizeLocatorExtended`
- `src/common/redux/actions/reader/setLocator.ts`, `src/renderer/reader/redux/reducers/readerLocator.ts`, `src/renderer/reader/redux/middleware/sync.ts` — đường đi action `READER_SET_LOCATOR` renderer → main
- `src/main/redux/sagas/persist.ts` — saga ghi `locator.json` khi nhận action từ renderer
- `src/main/redux/sagas/win/reader.ts` — đọc lại `locator.json` khi mở cửa sổ Reader
- `src/main/storage/publication-data.ts` — class `PublicationData`, đường dẫn file thật
- `src/main/di.ts` — `publicationConfigPath`

*Nguồn: phân tích tĩnh mã nguồn, không chạy thử app. Ngày: 2026-09-05.*
