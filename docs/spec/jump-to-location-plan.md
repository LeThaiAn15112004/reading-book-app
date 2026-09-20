# Kế hoạch triển khai: Jump to Location hợp nhất

Tài liệu thi công cho [`jump-to-location-unified.md`](./jump-to-location-unified.md) (spec đầy đủ —
đọc trước khi bắt tay vào code). Tài liệu này chỉ trả lời "làm theo thứ tự nào, kiểm thử ra sao,
khi nào coi là xong" — không lặp lại thiết kế đã có trong spec.

Repo **không có test runner** (theo `CLAUDE.md`) → mọi "Definition of Done" dưới đây là **kiểm thử
thủ công có kịch bản rõ ràng**, không phải `npm test`. Ghi lại kết quả kiểm thử thủ công (sách nào,
loại annotation nào, pass/fail) vào PR description hoặc note riêng — đây là bằng chứng duy nhất khi
review.

## Nguyên tắc thi công

1. **Rủi ro cao nhất đi trước, code thật đi sau.** Toàn bộ giá trị của spec đứng trên giả thuyết
   "Tier 1 CFI giờ đã an toàn" (spec §4.7). Nếu giả thuyết sai, kiến trúc 2 tầng vẫn đúng nhưng kỳ
   vọng UX (nhảy chính xác) phải hạ xuống — cần biết điều này **trước** khi viết `useReaderJump.ts`,
   không phải sau.
2. **Không đổi hành vi hiện tại cho tới khi có bằng chứng.** Phase 1 (nền tảng) phải merge được mà
   người dùng không thấy khác biệt gì — đây là bước refactor an toàn, tách khỏi bước "bật CFI thật".
   Nếu Phase 2 (bật Tier 1) bị trì hoãn hoặc revert, Phase 1 vẫn có giá trị đứng riêng (dọn code
   trùng lặp).
3. **Bật Tier 1 từng loại một, không bật đồng loạt.** Bookmark trước (rủi ro thấp nhất — đã chạy
   CFI production), rồi mới đến highlight/typewriter note (rủi ro cao nhất — nơi bug cũ xảy ra).
4. **Mỗi phase có thể dừng lại và vẫn ở trạng thái dùng được.** Không có phase nào để app ở trạng
   thái nửa vời (vd: orchestrator mới tồn tại song song 4 hàm cũ chưa xoá — ổn, không phải "nợ kỹ
   thuật nguy hiểm", chỉ là chưa dọn xong).

## Tổng quan các Phase

| Phase | Mục tiêu | Đổi hành vi người dùng thấy? | Có thể dừng ở đây? |
|---|---|---|---|
| 0 — Spike xác minh Tier 1 | Trả lời: CFI có còn lỗi như cũ không? | Không (code thử nghiệm, revert sau) | Có — quyết định go/no-go cho Phase 2 |
| 1 — Nền tảng dùng chung | `JumpTarget`, resolver, `annotation-flash.ts`, `useReaderJump.ts` (chỉ chạy Tier 2, y hệt hành vi cũ) | Không | Có — đã dọn code trùng lặp |
| 2 — Bật Tier 1 có kiểm soát | CFI thật cho bookmark → highlight → typewriter note | Có (nhảy chính xác hơn) | Có, sau mỗi loại |
| 3 — Flash effect | Hiệu ứng viền hổ phách khi landedPrecise | Có | Có |
| 4 — Jump-back | Pill "Quay lại vị trí đang đọc" | Có | Có |
| 5 — Dọn dẹp & thay thế | Xoá 4 hàm cũ, cập nhật doc lỗi cũ | Không (chỉ refactor) | — (kết thúc) |

Thứ tự 0→1→2→3→4→5 là **khuyến nghị**, không phải bắt buộc tuyệt đối — Phase 3 (flash) và Phase 4
(jump-back) độc lập với nhau, có thể đảo chỗ nếu muốn ưu tiên trải nghiệm nào trước.

---

## Phase 0 — Spike xác minh Tier 1 an toàn

**Vì sao làm trước tiên**: nếu bug `IndexSizeError` cũ vẫn còn, toàn bộ ước lượng effort của Phase 2
thay đổi (cần thêm việc sửa root cause, không chỉ "wiring"). Làm rõ điều này trong 1–2 giờ thay vì
phát hiện giữa chừng Phase 2.

- [ ] Tạm sửa `jumpToHighlight` trong `useReaderAnnotations.ts`: bỏ qua nhánh chương-chỉ hiện tại,
      gọi thẳng `epubApiRef.current?.goToLocation(new CfiLocation(epubJumpCfi(h)))` (hàm
      `epubJumpCfi` đã có trong `highlight-persistence.ts`, không cần viết mới).
- [ ] Test thủ công trên **≥ 3 EPUB khác nhau** (ưu tiên: 1 sách nhiều ảnh, 1 sách CSS/font phức
      tạp, 1 sách text thuần — đây là 3 kiểu layout dễ gây lệch offset theo phân tích trong
      `docs/error/jump-to-location.md` §3.6), mỗi sách tạo **≥ 7 highlight** rải khắp các chương
      (đầu chương, giữa chương, cuối chương — vị trí đầu/cuối là nơi CFI dễ tính sai nhất).
- [ ] Với mỗi highlight: bấm "Jump to location" 1 lần, ghi lại — có nhảy đúng câu/đoạn không? Có
      lỗi console (`IndexSizeError` hoặc tương tự) không? Thời gian từ lúc bấm tới lúc ổn định
      (ước lượng bằng mắt hoặc `console.time`) — số này quyết định `CFI_JUMP_TIMEOUT_MS`.
- [ ] Lặp lại tương tự cho `jumpToTypewriterNote` với ghi chú có `cfi-offset` (tạo note bằng cách
      gõ trực tiếp lên text, không phải note "thả tự do" — chỉ note gõ lên text mới có CFI theo
      `typewriter-persistence.ts`).
- [ ] **Revert toàn bộ thay đổi thử nghiệm** — không merge code spike, chỉ merge kết luận (ghi vào
      phần "Kết quả spike" bên dưới, hoặc comment trong PR mở Phase 1).

**Quyết định go/no-go**:
- Nếu **> ~90% thành công**, không có lỗi console mới → Tier 1 an toàn như spec giả định, đi thẳng
  Phase 1 → 2 theo kế hoạch.
- Nếu **lỗi lặp lại ở 1 pattern cụ thể** (vd chỉ sách nhiều ảnh, chỉ CFI ở cuối section) → vẫn đi
  Phase 1 → 2, nhưng Tier 1 chỉ bật cho pattern an toàn, các case còn lại đợi fix riêng (out of
  scope spec này) — cập nhật §9 "Câu hỏi mở" trong spec với phát hiện cụ thể.
- Nếu **lỗi xảy ra thường xuyên, không rõ pattern** → tạm dừng Phase 2, báo lại để đánh giá có nên
  đầu tư sửa root cause `locationOf`/epub.js trước, hay chấp nhận giữ Tier 2-only cho các loại đó
  (tức là chỉ hợp nhất kiến trúc/UX, không phục hồi độ chính xác — vẫn đạt US-1/US-3/US-4/US-5,
  chỉ US-2 bị hạ kỳ vọng).

---

## Phase 1 — Nền tảng dùng chung

Refactor thuần tuý — hành vi người dùng thấy phải **giống hệt trước và sau** phase này.

- [ ] `packages/shared/models/jump-target.ts`: `JumpTarget`, `PreciseLocator`,
      `highlightJumpTarget`, `bookmarkJumpTarget`, `typewriterJumpTarget`, `freehandJumpTarget`
      (spec §4.1–4.2). Đây là hàm thuần (input/output, không DOM) — có thể viết một script thử
      nhanh kiểu `spikes/` hiện có để gọi từng resolver với dữ liệu mẫu và in `JumpTarget` ra
      console, đối chiếu bằng mắt với `location_data` gốc — thay cho unit test chính thức.
- [ ] `src/reader/overlays/annotation-flash.ts`: viết lại `findAnnotationMarkElement` /
      `waitForAnnotationMarkElement` / `flashAnnotationMark` theo mô tả §3.5 trong
      `docs/error/jump-to-location.md` (code cũ đã bị xoá khỏi repo — đây là viết mới từ tài
      liệu, không phải khôi phục git history). Test độc lập: mở DevTools trên 1 trang đang có sẵn
      `<mark data-rb-hl-id="...">`, gọi `flashAnnotationMark('[data-rb-hl-id="<id>"]')` thẳng từ
      console, xác nhận animation viền hổ phách chạy đúng 900ms rồi tắt.
- [ ] `src/screens/Reader/logic/hooks/useReaderJump.ts`: orchestrator `jumpToLocation()` (spec
      §4.3) — **nhưng tạm thời luôn ép `landedPrecise = false`** (bỏ qua nhánh Tier 1 dù
      `target.precise` có giá trị), tức là mọi jump đều rơi thẳng xuống Tier 2. Đây là cách merge
      an toàn: đổi kiến trúc gọi hàm (4 hàm rời → 1 orchestrator) mà không đổi kết quả quan sát
      được, giảm diện tích cần review khi Phase 2 bật thật Tier 1.
- [ ] Đổi 4 hàm trong `useReaderAnnotations.ts` thành wrapper gọi `jumpToLocation(xxxJumpTarget(..))`
      — **trừ `jumpToBookmark`**, giữ nguyên hàm cũ ở phase này (nó đang là hàm duy nhất thật sự
      dùng CFI hôm nay — đổi nó sớm nhất làm tăng rủi ro không cần thiết cho 1 phase vốn nên "an
      toàn tuyệt đối"). `jumpToBookmark` sẽ chuyển sang orchestrator ở Phase 2 khi Tier 1 được bật
      thật cho nó.

**Definition of Done Phase 1**:
- [ ] Test hồi quy thủ công: jump tới 1 highlight, 1 typewriter note, 1 freehand stroke — cả trên
      sách EPUB thật lẫn bề mặt "fake chapter" — hành vi (nhảy tới đâu, có/không có flash) **giống
      hệt trước phase này** (vì Tier 1 đang bị ép tắt, flash cũng sẽ không chạy — đúng dự kiến, vì
      `landedPrecise` luôn `false`).
- [ ] Không còn cảnh báo TypeScript/ESLint mới (`npm run typecheck`, `npm run lint` trong
      `reading-book-desktop`).

---

## Phase 2 — Bật Tier 1 có kiểm soát

Bật từng loại một, theo thứ tự rủi ro tăng dần. Mỗi mục là 1 PR/commit riêng, có thể dừng giữa
chừng nếu phát hiện vấn đề.

- [ ] **2a. Bookmark**: đổi `jumpToBookmark` sang gọi `jumpToLocation(bookmarkJumpTarget(b))`, bỏ
      cờ ép Tier 2 cho riêng nhánh bookmark trong `useReaderJump.ts` (hoặc bỏ cờ ép chung nếu xử
      lý theo `entityKind`). Vì bookmark đã chạy CFI production từ trước, đây là bài test "orchestrator
      mới có tái tạo đúng hành vi cũ không" — không phải bài test "CFI có an toàn không" (đã biết
      rồi). Test: tạo bookmark tại 5 vị trí khác nhau, jump tới từng cái, so hành vi với bản build
      trước Phase 1 (chrome-hidden timing, `justJumpedBookmarkId` 2000ms, v.v. — spec §4.5).
- [ ] **2b. Highlight**: bỏ cờ ép Tier 2 cho `annotationType === 'highlight'`. Áp dụng
      `CFI_JUMP_TIMEOUT_MS` + try/catch fallback đúng như spec §4.3. Test lại đúng kịch bản Phase 0
      (cùng sách, cùng highlight) — lần này qua code thật, không phải bản sửa tạm.
- [ ] **2c. Typewriter note** (chỉ note có `anchor: 'cfi-offset'`): bỏ cờ ép Tier 2 cho
      `annotationType === 'textbox'` khi resolver trả `precise`. Test cả 2 nhánh: note có CFI (gõ
      lên text) và note không có CFI (thả tự do / `fake-pct`) — nhánh sau phải vẫn luôn rơi Tier 2,
      không được vô tình cố gọi CFI rỗng.
- [ ] **2d. Freehand**: không có việc gì để bật — resolver luôn trả `precise: undefined` (spec
      §4.2). Chỉ cần xác nhận không có regression sau khi orchestrator chung tiếp quản.

**Definition of Done Phase 2**: với mỗi loại đã bật (2a–2c), có tối thiểu 10 lần jump thử trên ≥ 2
sách khác nhau không phát sinh lỗi console, tất cả nhảy đúng vị trí (không chỉ "đúng chương").

---

## Phase 3 — Flash effect

- [ ] Gắn `markSelector` đã có trong resolver (spec §4.2) — không cần code thêm, chỉ cần Phase 2
      đã bật `landedPrecise = true` cho loại đó thì `flashAnnotationMark` tự chạy theo logic đã
      viết ở Phase 1.
- [ ] Xử lý spam-click (edge case §8): huỷ animation cũ trước khi tạo animation mới
      (`el.getAnimations().forEach(a => a.cancel())`), và token tăng dần để cú jump mới luôn thắng
      cú jump cũ chưa resolve xong.
- [ ] Test: bấm "Jump" liên tiếp rất nhanh vào 2 highlight khác nhau — xác nhận chỉ highlight thứ 2
      được flash, không có 2 animation chồng nhau hoặc flash nhầm annotation.

**Definition of Done Phase 3**: flash chạy đúng cho highlight + typewriter note (2 loại có
`markSelector` và đã bật Tier 1 ở Phase 2), im lặng (không lỗi, không toast) khi không tìm thấy
DOM mark trong 900ms.

---

## Phase 4 — Jump-back

- [ ] State 1-slot (`JumpBackAnchor`, spec §4.6) trong `useReaderJump.ts` hoặc hook riêng
      `useJumpBackAnchor.ts` nếu muốn tách nhỏ.
- [ ] Xoá slot khi: đổi `bookId` (thêm vào effect reset đã có trong `useReaderNavigation.ts`), và
      khi phát hiện điều hướng thủ công sau jump (`switchPage`, chọn TOC, cuộn tay) — cần hook vào
      đúng các điểm gọi này, không chỉ dựa vào timeout ẩn UI (edge case đã nêu trong spec §8).
- [ ] UI pill trong `ReaderScreen.tsx`: hiện ~5–8s sau mỗi jump thành công, ẩn khi hết giờ hoặc khi
      bấm, gọi `jumpBack()` khi bấm.
- [ ] Test theo đúng danh sách edge case ở spec §8 mục "Về jump-back": jump rồi jump tiếp (slot bị
      ghi đè, không chồng); đổi sách giữa chừng (slot bị xoá); đổi theme/font sau jump rồi bấm
      "quay lại" (CFI vẫn hoạt động qua remount); tự cuộn sau jump rồi bấm "quay lại" (pill phải tự
      ẩn trước đó, không phải bấm vào rồi mới nhận ra không có tác dụng).

**Definition of Done Phase 4**: cả 4 kịch bản test trên đều đúng như mô tả, không có trường hợp
pill hiện nhưng bấm vào không làm gì (silent no-op).

---

## Phase 5 — Dọn dẹp & thay thế

- [ ] Xoá hoàn toàn code nhánh "ép Tier 2" tạm thời trong `useReaderJump.ts` (rác còn lại từ Phase 1
      nếu chưa dọn hết trong Phase 2).
- [ ] Rà lại `useReaderAnnotations.ts` — đảm bảo cả 4 hàm (`jumpToHighlight`, `jumpToBookmark`,
      `jumpToTypewriterNote`, `jumpToFreehandStroke`) giờ chỉ còn là wrapper 1 dòng.
- [ ] Viết lại `docs/error/jump-to-location.md` — tài liệu hiện mô tả kiến trúc CFI-cho-highlight
      đã bị gỡ từ trước, nay lại đúng trở lại nhưng qua đường khác (orchestrator chung, không phải
      4 hàm riêng) — cần viết lại để không gây hiểu nhầm cho người đọc sau này (có thể thay bằng
      1 dòng trỏ sang `docs/spec/jump-to-location-unified.md` làm nguồn sự thật mới, giữ lại phần
      lịch sử bug cũ làm bối cảnh).
- [ ] Test hồi quy toàn diện lần cuối: đi qua **toàn bộ ma trận** loại × bề mặt trước khi coi feature
      "hoàn thành":

  | Loại | EPUB (real) | Fake surface |
  |---|---|---|
  | Highlight | Jump CFI + flash | Jump chương |
  | Bookmark | Jump CFI + `justJumpedBookmarkId` | Jump chương |
  | Typewriter note (cfi-offset) | Jump CFI + flash | — |
  | Typewriter note (fake-pct/page-rect) | Jump chương/trang | Jump chương |
  | Freehand | Jump trang (luôn Tier 2) | Jump chương |
  | Jump-back | Từ mọi loại trên | Từ mọi loại trên |

**Definition of Done Phase 5 (= Done toàn bộ tính năng)**: bảng trên pass 100%, không còn hàm
`jumpTo*` nào chứa logic ngoài 1 dòng gọi `xxxJumpTarget` + `jumpToLocation`.

---

## Rollback nếu Tier 1 gây vấn đề sau khi ship

Vì mỗi loại được bật độc lập (Phase 2a–2d), rollback cũng độc lập: ép lại `landedPrecise = false`
cho riêng loại đang lỗi (1 dòng thay đổi trong `useReaderJump.ts`, theo `annotationType` hoặc
`entityKind`) — các loại khác không bị ảnh hưởng, không cần revert toàn bộ tính năng.

## Ngoài phạm vi kế hoạch này

`underline` / `strikethrough` / `stamp` chưa có UI tạo — khi được xây ở một hạng mục khác, việc
"có jump" chỉ còn là viết thêm 1 resolver (copy `highlightJumpTarget`/`freehandJumpTarget`, đổi
`annotationType` + `markSelector`) — không cần quay lại sửa `useReaderJump.ts`. Đây chính là mục
tiêu US-5 của spec.
