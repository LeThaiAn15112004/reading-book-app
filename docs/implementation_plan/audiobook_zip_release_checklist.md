# Audiobook ZIP (multi-track) — release checklist

Dùng trước khi bật `audiobookZipImportEnabled` cho người dùng. Kế hoạch gốc: `audiobook_multi_chapter_import.md` (§6, §8) và
`audiobook_multi_track_playback_b.md` (§5, §6). **B1 và B2 ra cùng một bản phát hành.** Đánh dấu `[x]` khi đã làm.

## 0. Chuẩn bị (trên máy bạn)
- [ ] `source/packages/config/features.ts`: đặt `audiobookZipImportEnabled: true` **chỉ trong working tree** (đừng commit).
- [ ] Tắt hẳn app rồi `npm run dev` (cờ được đọc lúc khởi động).
- [ ] Có sẵn: ZIP LibriVox 68 track; một audiobook mp3 đơn trong thư viện; một ZIP chỉ có 1 file audio.

## 1. Máy đã kiểm tra thay bạn (chạy lại, không cần nhìn)
Chạy từ `source/apps/reading-book-desktop` (E2E chạy cửa sổ ẩn, tắt tiếng) và `source/apps/book-reader-sdk`:

| Lệnh | Phủ cái gì |
|---|---|
| `npm run verify` (SDK) | logic thuần: thứ tự track, hash, `trackId`, cổng phát hành (cờ commit phải `false`) |
| `npm run typecheck && npm run lint && npx vite build && npm run e2e:typecheck` | biên dịch, lint, bundle |
| `npm run spike:audio:main` | URL từng track, MIME từng định dạng, chặn track giả/symlink, rào chặn ghi tiến độ và Notes |
| `npm run spike:audio:store` | player: đổi track, race A→B lỗi→C, không ghi khi đang chuyển, auto-advance, hẹn giờ cuối track, khôi phục |
| `npm run spike:audio:zip-import` | import thật: thứ tự, trùng, một track, rollback, hủy, dọn `.partial`, xóa audiobook, Add file nhận `.zip` |
| `npm run spike:audio:zip-store` | store import nền: spinner, tiến độ, panel kết quả, hủy, lỗi + thử lại |
| `npm run spike:audio:zip`, `:chapters`, `:migration` | đọc ZIP an toàn, bảng chapter, migration 028 trên better-sqlite3 thật |
| `npx playwright test -c e2e/playwright.config.ts audiobook-zip audio-reader` | luồng thật trong app: spinner → chọn file → import nền → panel kết quả → mở; **tự chuyển bài khi hết track**, trước/sau, bấm track, track cuối dừng, khôi phục sau khi đóng app, track hỏng; sách mp3 đơn không đổi |

- [ ] Tất cả các lệnh trên xanh (ghi ngày: ______).

## 2. Bạn kiểm tra bằng mắt / tai (máy không làm được)

### 2.1 Import
- [ ] Import → **Audiobook ZIP** → chọn ZIP: nút có **spinner xoay** + "Reading ZIP…", **không có hộp thoại chặn**; bấm vào nút mở thẻ nhỏ có Cancel.
- [ ] Đọc xong: panel chọn file mở ra, **các nút ở đầu (Cancel) bấm được**, không bị thanh menu đè (thử cửa sổ thấp và cao).
- [ ] Panel: cây thư mục mở/đóng được, thời lượng từng track, cảnh báo "File names are not numbered", mục Cover hiển thị đúng; chọn cover khác / "No cover" hoạt động.
- [ ] Bỏ tick vài track → "Import N chapters" đúng số; "Select all / Deselect all" đúng.
- [ ] Bấm Import: **panel đóng ngay**, nút chuyển spinner + `Importing 12/68` → `Saving…`; lúc đó **mở một sách khác đọc được**, vào Settings/Collections được.
- [ ] Xong: panel "Audiobook added" liệt kê đúng các file đã import (số thứ tự, tên, thời lượng); "Open audiobook" mở đúng sách; để panel mở rồi vào đọc sách khác và quay lại vẫn thấy panel.
- [ ] Khi import đang chạy, thử bấm lại nút ZIP / chọn ZIP khác trong Add file: có thông báo "already running", không mở picker.
- [ ] Hủy giữa chừng ("Cancel import"): không có sách mới, không thư mục thừa; có thông báo.
- [ ] Import lại **đúng ZIP và lựa chọn đó**: hộp thoại "already in your library" (mở bản có sẵn).
- [ ] ZIP chỉ tick **1 track**: nút "Import audiobook", hai dòng cam (cover không dùng, tiêu đề lấy từ track) hiện **trước** khi bấm; sách ra như file đơn.
- [ ] Add file (hộp thoại hệ thống) chọn `.zip`: hiện đúng panel như trên.
- [ ] Màn hình hẹp (< 640 px): mục "Audiobook ZIP" trong menu thả xuống có spinner/đếm; nút "Import" tổng có spinner.

### 2.2 Thư viện
- [ ] Chuột phải sách nhiều track: chỉ có "Remove audiobook…" (đỏ), không có "Remove from library"/"Delete file…". Sách một file vẫn có đủ như cũ.
- [ ] "Book info": hiện "Audiobook", số chapter; "Copy file path" sao chép **thư mục**; "Open file location" mở thư mục sách.
- [ ] "Remove audiobook…": hộp xác nhận nói rõ số file bị xóa và ZIP gốc không bị đụng; xác nhận → sách biến mất, thư mục chapter bị xóa, **ZIP gốc còn nguyên**.

### 2.3 Player
- [ ] Sidebar Contents: 68 hàng, hàng hiện tại sáng + thanh tiến độ mỏng, cuộn tự theo track; **sidebar cao hết cửa sổ** (không còn khoảng trống phía dưới); kéo đổi độ rộng được.
- [ ] Tiêu đề lớn là tên track, "TRACK N OF M" phía trên, tên sách + tác giả ở dòng phụ.
- [ ] **Nghe thật** (bỏ tắt tiếng): chuyển track không giật/kẹt; hết track tự sang track kế, khoảng lặng giữa hai track chấp nhận được (không gapless — đã biết).
- [ ] Tua bằng thanh, −15s/+30s trong track, tốc độ, âm lượng hoạt động.
- [ ] Hẹn giờ: "End of track" dừng ở cuối track; "15 min" vẫn đếm qua các track.
- [ ] Track hỏng (đổi tên một file chapter trong thư mục sách): hộp vàng "could not be played" + Try again / Skip to next track; ⚠ ở hàng; player không sập.
- [ ] Đóng cửa sổ **khi đang phát**, mở lại: về đúng track, lệch vài giây là cùng lắm.
- [ ] Không có: tab Notes, "+ Note", phần trăm cả sách, nút Book/Chapter.

### 2.4 Hồi quy sách một file
- [ ] Mở một mp3 đơn: có tab Notes, "+ Note" thêm/sửa/xóa được, phần trăm, nút Book/Chapter (hoặc báo không có chapter), tua, nghỉ, mở lại đúng vị trí; nút trước/sau theo chapter như cũ.
- [ ] Import mp3 đơn qua Add file như trước (không bị hỏi ZIP).

## 3. Giới hạn đã biết (không chặn phát hành, ghi vào release notes)
- Sách nhiều track **chưa có Notes** và **chưa có phần trăm / tổng thời lượng** cả sách (Stage C).
- Chapter nhúng bên trong từng file bị bỏ qua cho sách từ ZIP.
- Không phát liền mạch (gapless); tua +30s ở cuối track không tràn sang track sau.
- Đóng app giữa lúc import: sách có thể vẫn được thêm nhưng panel kết quả mất.
- Cờ đang off cho người dùng; sách đã import lúc cờ bật vẫn dùng và xóa được sau khi tắt cờ.

## 4. Phát hành
1. [ ] Mục 1 xanh, mục 2 đạt (ghi mục nào chưa đạt và cách xử lý: ______).
2. [ ] Trả cờ về `false` trong working tree; `git diff packages/config/features.ts` không còn `true`.
3. [ ] Commit phát hành **duy nhất** đổi cờ sang `true` **và** sửa `tests/config/audiobook-zip-gate.test.ts` (test đang đòi `false`): đây là điểm duyệt.
4. [ ] Cập nhật mục "Audiobook ZIP" trong `CLAUDE.md` (bỏ "off until…").
5. [ ] Release notes nêu các giới hạn ở mục 3.
