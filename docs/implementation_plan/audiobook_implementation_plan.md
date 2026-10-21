# Audiobook — Implementation Plan (Phase 0 revised: audit + ma trận tương thích)

Date: 2026-10-21. Phiên bản này thay thế bản Phase 0 đầu tiên (chỉ xét MP3) bằng bản xét chín nhóm định dạng.

> **Cập nhật Phase 0.1 (2026-10-21): xem các phần "PHASE 0.1" ở cuối tài liệu**, gồm "Lượt 1: Electron runtime PoC" (đã chạy trên Windows, MP3 tổng hợp).

Status: **chỉ audit + kế hoạch.** Không sửa source, schema, `package.json`, lockfile, cấu hình build, fixture trong repo. Không cài gì. Không mở Electron/GUI/E2E. Không stage/commit/push.

> Tên file: repo dùng snake_case cho `docs/implementation_plan/*`, nên tôi giữ `audiobook_implementation_plan.md` (không tạo thêm bản `audiobook-implementation-plan.md` để tránh trùng). Đổi tên nếu bạn muốn.

Nhãn bằng chứng:
**[V]** đọc trực tiếp trong repo · **[T]** phép thử runtime (ghi môi trường) · **[D]** tài liệu chính thức · **[I]** suy luận, chưa xác minh · **[?]** chưa biết.

Môi trường các phép thử [T]: Windows 11 (10.0.26300), Node 22.13.0 (CLI, không phải Node nhúng của Electron), `music-metadata` 12.2.1 từ `source/node_modules`, fixture **tự tổng hợp trong thư mục tạm ngoài repo** (`…/scratchpad/mmprobe/`), chỉ kiểm **phân tích metadata**, **không** kiểm phát âm thanh.

---

## 1. Executive Summary

- **Khả thi**, nhưng "hỗ trợ audiobook" thực chất là bài toán *container × codec*, không phải *đuôi file*. Chỉ MP3, WAV, FLAC, Ogg (Vorbis/Opus) được Chromium liệt kê chính thức; AAC/M4A/M4B/ADTS phụ thuộc codec độc quyền; AIFF không được liệt kê **[D]**. Chưa định dạng nào được xác minh *phát được trong Electron 39.8.10* — vì Phase 0 không chạy runtime **[?]**.
- Hai hạng mục hạ tầng bắt buộc cho *bất kỳ* định dạng nào: (1) migration nới `CHECK` của `books.file_format`; (2) **không** phát qua `library:openBookContent` (đọc nguyên file vào `ArrayBuffer` qua IPC) mà dùng protocol streaming có Range **[V]**.
- Tiến độ nghe **không cần migration**: lưu ở `reading_state_json.audioProgress` bằng đường `json_patch`, tránh `saveSessionState` (ghi đè, làm mất key lạ) **[V]**.
- Không cần dependency mới: `music-metadata@12.2.1` đã có trong `package.json`/lockfile nhưng **chưa được import ở đâu** **[V]**.
- Đề xuất cho PoC (chưa phải danh sách hỗ trợ chính thức): **MP3, WAV, FLAC, M4A-AAC-LC, Ogg-Vorbis, Ogg-Opus**; M4B làm PoC riêng vì chapter; AAC thô (ADTS) và AIFF để sau/loại.

---

## 2. Kiến trúc hiện tại đã xác minh

### 2.1 Trạng thái Git (chỉ đọc)
Nhánh `anle-dev`, HEAD `c7d6c75`. Working tree **đang bẩn**: 61 file sửa (≈ +1904/−286) + nhiều file chưa theo dõi (Markdown annotations, PDF inserted text…), 2 file đã stage xoá (`electron/adapters/doc.adapter.ts`, `docx.adapter.ts`) **[V]**.
Khác với lần audit đầu: **DOCX/DOC đã bị gỡ khỏi working tree** — `DocumentFormat` chỉ còn `Epub, Pdf, Txt, Md`; `SUPPORTED_FORMATS` còn 4 mục; `package.json` bỏ `mammoth`, `word-extractor`, `@types/word-extractor`; `music-metadata` còn lại **[V]** (git diff). Migration SQL cũ vẫn liệt kê `docx`/`doc` trong CHECK **[V]**.
→ Mọi nhận định dưới đây là của working tree này, không phải của `main`.

### 2.2 Phiên bản
- Electron **39.8.10** (`desktop/node_modules/electron/package.json`, file `dist/version`) **[V]**. Chromium của Electron 39: tài liệu nội bộ repo (`document_audio_library_setup.md`) ghi 142.0.7444.265 **[V: đọc tài liệu repo, không tự đo]**.
- Node trong Electron 22.22.1 (theo cùng tài liệu) **[V-tài liệu]**; Node CLI trên máy 22.13.0 **[T]**. `music-metadata@12.2.1` yêu cầu `node >=22`, `type: module` **[V]**.
- `electron-builder ^26.15.3`, `vite ^8.1.4` **[V]**.
- `electron/dist/ffmpeg.dll` có mặt (≈3.06 MB) **[V]**. Quét chuỗi tên codec trong DLL cho kết quả rỗng (tên bị strip) → **không dùng được làm bằng chứng codec** **[T-không kết luận]**.

### 2.3 Tiến trình, IPC, bảo mật
- `main.ts`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` **[V]**. Renderer chỉ gọi qua `window.api` (kênh khai báo trong `electron/ipc/channels.ts`, preload, `api-types.ts`, `src/bridge/*`) **[V]** (CLAUDE.md + đọc code).
- Không thấy CSP trong `index.html`; không thấy `setPermissionRequestHandler` **[V]**.
- Custom protocol hiện có: `rb-cover` (`standard, secure, supportFetchAPI, bypassCSP, stream, corsEnabled`; trả file qua `net.fetch(pathToFileURL(...))`, tự đặt `Content-Type`) và `rb-md-asset` (`standard, secure`, `fsp.readFile` + trả cả `Uint8Array`). Hai scheme đăng ký gộp bằng `registerCoverSchemePrivileged(extraSchemes)` trước `app.whenReady()` **[V]** (`electron/files/cover-protocol.ts`, `electron/md/md-asset-protocol.ts`).
- **Chưa có protocol nào xử lý header `Range`/`206`** **[V]**; `rb-md-asset` đọc nguyên file vào RAM. `rb-cover` forward nguyên `fileResponse.body` nhưng **không** truyền `Range` của request vào `net.fetch` **[V]** → Range của `<audio>` qua `rb-cover`-style handler hiện **chưa được chứng minh** **[?]**.

### 2.4 Format & import
- Nguồn sự thật: `DocumentFormat` (`sdk/src/domain/book/document-format.ts`), `SUPPORTED_FORMATS`/`resolveFormatFromExtension` (`source/packages/config/formats.ts`), `assertSupportedExtension` (`electron/files/format-guard.ts`), `getDocumentImporter` + `REGISTRY` (`electron/adapters/importer-registry.ts`, **ném lỗi nếu thiếu entry**), `DocumentFormatDto` (`electron/ipc/api-types.ts:3`), `parseDocumentFormat` ở `sqlite-library-store.ts:106` (đọc), dòng ~437 lọc row có format không còn hỗ trợ **[V]**.
- **Ràng buộc 1-1 extension→format**: `checkRegisteredBookPath`/`resolveBookFile` (`electron/files/sandbox.ts`) so `resolveFormatFromExtension(ext)` với `book.format`, cả với đích symlink **[V]**. Hệ quả: `.m4a` và `.m4b` (cùng container) **phải là hai format riêng** hoặc guard phải đổi; một format chung `audio` phải sửa guard **[V → S]**.
- Import local: dialog native do Main mở (`importFromFile`) → `assertSupportedExtension` → chặn file trong `userData` → `rejectIfDuplicate` (SHA-256 stream, `hashFile`) → `finishImportByReference` (không copy). URL/cloud → tải tạm → `copyIntoBooksSandbox` **[V]** (`electron/ipc/import.ipc.ts`). Bộ lọc dialog sinh từ `SUPPORTED_FORMATS` **[V]**.
- Không có giới hạn kích thước cho file local (chỉ Markdown, và URL `too_large`) **[V]**.
- `ImportResult`/`buildImportResult` (`filename-fallback-importer.ts`) có title/authors/cover/description/genres/pageCount; **không có duration** **[V]**.

### 2.5 Mở sách & render
- Library `useLibraryScreen.ts:87` → `useOpenReading().openBook` (`src/hooks/app/OpenReadingContext.tsx`) → `navigate('/reader/:bookId')` → `App.tsx:67` `<ReaderScreen/>` **[V]**.
- `ReaderScreen.tsx` (≈1.6k dòng) gọi `useReaderBookOpen` → `openBookContent` (đọc **toàn bộ** file, trừ TXT trả buffer rỗng) rồi chọn renderer bằng so sánh `book.bookFormat` (EPUB/PDF/MD/TXT, còn lại `ReadingCanvas` placeholder) **[V]**.
- `src/reader/capabilities.ts`: `ReaderSurface = 'epub'|'pdf'|'txt'|'md'|'placeholder'`; format lạ → `placeholder` **[V]**.
- `useReaderBookOpen` khai báo `getBook` trả `{title, coverUrl, author}` — **chưa thấy `format`**; dispatcher route cần format trước khi mount **[?]** (xem `library:getBook`).

### 2.6 DB & tiến độ
- `books.file_format TEXT NOT NULL CHECK (file_format IN ('epub','pdf','txt','md','docx','doc'))` (migration 020; 021–025 không đổi) **[V]**. 25 migration, runner `migrate.ts` bọc transaction, tắt FK ở mức connection **[V]** (comment 020).
- `reading_state_json` (JSON, mặc định `'{}'`): hai đường ghi trong `sqlite-overlay-store.ts` — merge `json_patch` (~360) và `saveSessionState` ghi đè bằng object dựng từ trường cố định + guard `updatedAt` (~379) **[V]**.
- `Location` là union đóng `'cfi'|'page-rect'|'text-offset'`; `Location.parse` ném lỗi với kind lạ **[V]**.
- Flush khi đóng: `sessionFlushRegistry.ts` (`registerSessionFlushHandler`) + `main.ts` `requestSessionFlush` (timeout + ack) **[V]**.

### 2.7 Các điểm chạm theo format (quét bằng grep)
Có `switch/if/Set` theo format ở: `ReaderScreen.tsx`, `capabilities.ts`, `open-book-content.ts`, `chunking/extract-book-text.ts` (`CHUNKABLE_FORMATS = epub, txt, md, pdf` — audio tự bị loại), `chunking/book-chunk-service.ts`, `persistence/backfill-library-metadata.ts` (chỉ xử lý EPUB), `generateBookCover.ts` (`RENDERABLE = pdf,txt,md,epub`, `canGenerateCover()` — audio **không** nằm trong tập, tức mặc định không bị sinh bìa; cần xác nhận mọi nơi gọi đều qua `canGenerateCover` **[I]**), `CloudSourcesHub.tsx` (danh sách format theo provider), `sdk/src/services/library-service.ts`, các adapter cloud trong `sdk/host-adapters`, `electron/ipc/api-types.ts` **[V]**.
- Word count/search: `wordcount/` và FTS chạy trên `book_chunks` (chỉ format chunkable) **[V: comment capability + tập CHUNKABLE]**; chưa đọc chi tiết `word-count-service.ts` → xác nhận audio không rơi vào đây **[?]**.
- `music-metadata`: chỉ xuất hiện ở `desktop/package.json` (+ lockfile `12.2.1`); **không import ở source** **[V]**. Không nằm trong `external` của `vite.config.ts` (chỉ `better-sqlite3`, `@huggingface/transformers`, `onnxruntime-node`, `sharp`, `pdfjs-dist`) → sẽ bị bundle vào Main; bundle ESM thuần JS được **[I]**, phải chứng minh bằng build thật ở PoC **[?]**.

### 2.8 Đóng gói
`electron-builder.json5`: `asar: true`, `files: [dist, dist-electron]`, không `asarUnpack`/`extraResources`; NSIS x64, DMG, AppImage **[V]**. Không có entitlement/cấu hình riêng cho âm thanh **[V]** (macOS không cần quyền mic để *phát*, **[I]**).

### 2.9 Test hiện có
Unit test chỉ ở SDK (vitest, node); desktop kiểm bằng spike không GUI (`spike:txt:main`, `spike:txt:store`, `spike:pdf:*`…); E2E Playwright thủ công (hidden/offscreen) **[V]**. **Repo không có fixture âm thanh** và không có spike audio **[V]** (tìm `*.mp3/m4a/m4b/wav/flac/ogg/opus/aac/aif*` ngoài `node_modules` → không có).

---

## 3. Ma trận tương thích chín định dạng

Chú giải cột "Phát (Chromium)": căn cứ **[D]** Chromium media page (chromium.org/audio-video: container MP4/Ogg/WebM/WAV/Matroska; codec FLAC, MP3, Opus, Vorbis, PCM; **AAC chỉ ở Google Chrome**) + [I] về ffmpeg của Electron. Electron phát hành ffmpeg có codec độc quyền theo mặc định (H.264/AAC) và bản không có kèm theo mỗi release — tìm kiếm web, **không xác nhận trực tiếp danh sách codec MP3** **[D-yếu]**. **Chưa có ô nào được kiểm phát trong Electron 39.8.10** → mọi ô "phát" là [D]/[I]/[?], không phải [T].

| # | Đuôi | Container/codec thực tế | Phát (HTML Audio/Electron) | Duration | Seek tuỳ ý | Metadata | Bìa | Chapter | Rủi ro | Trạng thái |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.mp3` | MPEG-1/2 Layer III | MP3 nằm trong danh sách Chromium [D]; phát thực tế trong Electron 39.8.10 [?] | Header Xing/VBRI → chính xác; CBR không Xing → ước lượng từ kích thước [T: parse synthetic CBR cho 1.045s đúng bằng tính toán]; VBR thiếu header [?] | Cần Range; VBR không có bảng tìm → lệch [I] | ID3v1/v2, đọc bằng `music-metadata` [T: parse khung MP3 thành công, chưa có tag]; tag đầy đủ [?] | ID3 APIC qua `music-metadata` [I] | ID3v2 `CHAP`/`CTOC` — hỗ trợ trong `music-metadata` 12.2.1 [?] | VBR không Xing, ID3v2 rất lớn, file >2 GB, tag hỏng | **Ứng viên PoC (P0)**; [T] chỉ phần parse |
| 2 | `.m4a` | MP4/ISO-BMFF; codec **thay đổi**: AAC-LC (phổ biến), HE-AAC, ALAC… | AAC thuộc nhóm độc quyền (Chrome-branded) [D]; Electron có AAC theo mặc định [D-yếu]; ALAC không có trong danh sách Chromium [I→loại]; kiểm tra thực [?] | `mvhd` — thường chính xác [I] | `moov` ở cuối file → seek cần đọc cuối trước; Range bắt buộc [I] | iTunes atoms (`©nam`, `covr`) qua `music-metadata` [I]; [?] | `covr` [I] | Có thể có `chpl`/text track (hiếm với .m4a) [?] | Phân biệt AAC-LC/HE/ALAC; `moov` cuối; DRM (`.m4p` ngoài phạm vi) | **PoC (P1)**: AAC-LC; ALAC → đánh dấu chưa hỗ trợ |
| 3 | `.wav` | RIFF/WAVE; chủ yếu PCM | PCM 8-bit uint / 16-bit LE / 32-bit float / μ-law được liệt kê [D]; 24-bit PCM, ADPCM, WAVE_FORMAT_EXTENSIBLE [?] | Chính xác từ header [T: parse WAV PCM16 8kHz 2.000s đúng] | Tuyến tính, seek chính xác [I] | Chunk `LIST/INFO`, hạn chế [I]; [T: không có tag] | Thường không có | Không (có thể có `cue ` chunk, ngoài phạm vi) [I] | File rất lớn (RIFF 4 GB) [I]; sách nói WAV hiếm vì dung lượng | **PoC (P1)** |
| 4 | `.flac` | Native FLAC (hoặc FLAC-in-Ogg khác đuôi) | FLAC được liệt kê [D]; phát thực tế [?] | `STREAMINFO` có tổng mẫu → chính xác (nếu ≠0) [I] | Cần bảng `SEEKTABLE`; không có → seek xấp xỉ [I] | Vorbis comment, `PICTURE` qua `music-metadata` [I]; [?] | `PICTURE` block [I] | Cuesheet (hiếm) [?] | Thiếu SEEKTABLE, file lớn, FLAC 24-bit/96 kHz trên thiết bị | **PoC (P1)** |
| 5 | `.m4b` | MP4 (như M4A) + AAC; thường có `chpl` hoặc text track chapter | Như `.m4a` [D/I]; **không** suy rộng từ `.m4a` | Như M4A | Như M4A; seek theo chapter cần bảng chapter | Atoms iTunes | `covr` | **Có thể có, không đảm bảo**; `music-metadata` đọc `chpl`/text-track chapter [?] | M4B không chapter (1 track dài); chapter dạng tuỳ biến; DRM (AAX/Audible) không phát được | **PoC riêng (P0 cho Phase 4)** |
| 6 | `.aac` | ADTS (AAC thô, không container) | Chromium liệt kê AAC trong MP4, **không** nói về ADTS tự do [D]; ADTS demux trong `<audio>` [?] | **Không có header** → duration phải quét toàn file hoặc ước lượng | Không có chỉ mục → seek xấp xỉ [I] | Hầu như không (có thể ID3 ở đầu) [I] | Không | Không | Duration/seek kém, ít dùng cho sách | **Chưa đưa vào PoC**; chỉ cân nhắc sau |
| 7 | `.ogg` | Ogg container; codec **thay đổi**: Vorbis (phổ biến), Opus, FLAC, Speex | Ogg + Vorbis/Opus/FLAC được liệt kê [D]; Speex [I→ loại]; thực tế [?] | Cần granule position cuối file; Chromium đọc được nhưng chain/long file [?] | Cần bisect trong stream; có nhưng chậm với Range lớn [I] | Vorbis comment; `METADATA_BLOCK_PICTURE` [I] | Có thể [I] | Chapter Vorbis comment (`CHAPTERxx`) – không chuẩn, ngoài phạm vi [I] | Phải ghi rõ **biến thể**; chained Ogg | **PoC (P1)**: Ogg-Vorbis |
| 8 | `.opus` | Ogg container + Opus | Opus được liệt kê [D]; **đuôi `.opus`** có được MIME-sniff đúng khi qua custom protocol [?] | Granule position (48 kHz), pre-skip [I] | Như Ogg | `OpusTags` | Có thể | Không | Tên đuôi/MIME qua protocol, pre-skip | **PoC (P1)** (cùng bộ với Ogg-Opus) |
| 9 | `.aiff` / `.aif` | IFF/AIFF (PCM big-endian; AIFF-C có nén) | **Không được liệt kê** trong trang Chromium [D: không thấy] → **mặc định xem là không phát được** cho tới khi chứng minh [?] | Chính xác từ `COMM` [T: parse AIFF PCM16 8kHz 2.000s đúng] | N/A nếu không phát | `ID3`/`NAME`/`AUTH` chunks, hạn chế [I]; [T: không tag] | Hiếm | Không | Không phát được → cần transcode, ngoài phạm vi (không FFmpeg) | **Loại khỏi PoC**; chỉ kiểm tra 1 lần để ghi nhận |

Không đánh đồng (đã tuân thủ): "đuôi file" ≠ giải mã; `canPlayType()` ≠ phát thành công (sẽ dùng phát+`currentTime` trong PoC, không dựa vào `canPlayType`); có metadata ≠ đầy đủ; M4B ≠ luôn có chapter; đọc tuần tự ≠ seek chính xác.

---

## 4. Phân biệt kiểm tra tĩnh và runtime

| Loại | Đã làm | Kết quả |
|---|---|---|
| Tĩnh [V] | Đọc code, `git status/diff`, grep, đọc `package.json`/lockfile/vite/electron-builder | Mục 2 |
| Tài liệu [D] | chromium.org/audio-video; tìm kiếm về ffmpeg của Electron | Mục 3 (đã nêu mức tin cậy) |
| Runtime một phần [T] | Node 22.13.0 + `music-metadata@12.2.1` parse 3 fixture tổng hợp (WAV, AIFF, MP3-CBR) | Parse thành công, đúng duration/container/codec (xem §8) |
| Runtime **chưa làm** [?] | Phát/seek/duration bằng `<audio>` trong Electron 39.8.10; Range qua `protocol.handle`; bundle `music-metadata` trong Main/ASAR; FLAC/OGG/OPUS/M4A/M4B/AAC (không fixture, không công cụ) | Cần PoC 0.1 |

Công cụ có sẵn: không có `ffmpeg`, `ffprobe`, `mediainfo`, `sox`, `exiftool` trong môi trường **[T]**; chỉ có Node và Python 3.12. Không cài thêm (đúng quy tắc). Tạo fixture FLAC/AAC/Ogg/M4A hợp lệ cần encoder → **không làm được** trong Phase 0.

---

## 5. Danh sách định dạng có thể đưa vào PoC (chưa phải danh sách hỗ trợ)

| Ưu tiên | Biến thể cụ thể | Lý do |
|---|---|---|
| P0 | MP3 CBR có Xing; MP3 VBR (Xing); MP3 VBR **không** Xing; MP3 + ID3v2 có bìa | Định dạng chính của MVP |
| P0 | M4B có chapter (`chpl`); M4B không chapter | Quyết định Phase 4 |
| P1 | M4A AAC-LC (`moov` đầu và `moov` cuối) | Mở rộng cùng container |
| P1 | WAV PCM16; WAV PCM24 | Kiểm tra giới hạn PCM |
| P1 | FLAC có/không SEEKTABLE | |
| P1 | Ogg-Vorbis; Ogg-Opus (`.ogg`) và Opus (`.opus`) | Phân biệt đuôi vs MIME qua protocol |
| P2 | M4A ALAC; ADTS `.aac`; AIFF PCM | Chỉ để ghi nhận "không hỗ trợ"/giới hạn |

---

## 6. Rủi ro

**P0 (chặn triển khai)**
1. **Migration rebuild `books`** (CHECK) — bảng trung tâm, nhiều FK (`notes`, `book_authors`, `collection_books`, `book_chunks`, các bảng PDF/TXT) → nguy cơ mất dữ liệu/chỉ mục/FK **[V]**. Chưa chạy migration nào.
2. **Phát qua IPC nguyên file** (`openBookContent`) → hết RAM với audiobook lớn **[V]**. Bắt buộc streaming.
3. **Range/206 chưa được chứng minh** qua `protocol.handle` + `net.fetch` ở Electron 39 **[?]** → seek có thể hỏng.
4. **Codec thực tế trong Electron 39.8.10** (đặc biệt AAC/M4A/M4B) chưa kiểm **[?]**.

**P1**
5. `saveSessionState` ghi đè xoá `audioProgress` **[V]**.
6. MP3 VBR không Xing/ID3 lớn → duration/seek sai **[I]**.
7. Quy tắc 1-1 extension→format (`.m4a` vs `.m4b`; `.ogg` vs `.opus`) **[V]**.
8. Bundle `music-metadata` (ESM) trong Main/ASAR **[?]**.
9. Điểm chạm format phân tán (§2.7), đặc biệt cloud `CloudSourcesHub`/host-adapters và `word-count-service` **[?]**.
10. Dispatcher cần `format` trước khi mount (`getBook`) **[?]**.

**P2**
11. Phát khi rời reader/ẩn xuống tray (quyết định sản phẩm).
12. File trên ổ rời bị rút khi đang phát (đã có relink cho thiếu file).
13. Working tree bẩn lớn → xung đột với việc đang làm (MD annotations, PDF inserted text).
14. AIFF/ADTS/ALAC kỳ vọng người dùng.

---

## 7. Đề xuất kiến trúc và migration

### Kiến trúc [đề xuất]
- **Một `AudioBookPlayer` dùng chung** (zustand store sở hữu **một** `HTMLAudioElement`; hàm thuần trong SDK `app-models/` cho clamp/format thời gian/quyết định lưu). Đánh giá: tốt — format-agnostic vì phát qua Chromium; adapter theo format **chỉ cần ở lớp import/metadata**, không ở lớp phát.
- **Audio Format Registry (capability table)**, không phải adapter phát: một bảng `{ext, format, container/codec đã kiểm, supportedLevel: 'verified'|'experimental'|'unsupported'}` để UI báo lỗi chuẩn và để *không* đưa đuôi chưa kiểm chứng vào danh sách chính thức. Nối với `SUPPORTED_FORMATS` (chỉ đưa vào khi `verified`).
- **Metadata** qua `music-metadata` ở Main (import) — best-effort; thiếu tag không làm hỏng import; duration → `metadata_json.durationSeconds`.
- **Streaming**: protocol `rb-audio://local/{bookId}`: `resolveBookFile` + kiểm format audio; tự phục vụ Range (`createReadStream` + `206`/`Content-Range`/`Accept-Ranges`/`416`), 404 với id lạ/format sai/file mất; `Content-Type` do *app* quyết định theo bảng registry (không theo đuôi người dùng). Scheme cần `stream`/`supportFetchAPI` (`rb-cover` đã có) — **cần PoC xác nhận** privilege nào là bắt buộc cho `<audio>` **[?]**.
- **Route/screen riêng**: dispatcher cấp route (`ReaderRoute`) chọn `ReaderScreen` hoặc `AudioBookScreen`, không thêm nhánh vào `ReaderScreen` (≈1.6k dòng, hook gắn EPUB/PDF).
- **Tiến độ tách khỏi `Location`**: `reading_state_json.audioProgress` + IPC riêng bằng `json_patch` + guard `updatedAt`; **không** thêm kind vào `Location` ở MVP.
- **Mô hình dữ liệu nhiều file/chapter** (Phase 3–4): *chưa chốt*; ba trường hợp phải tách: (a) 1 sách = N file → cần bảng/JSON track; (b) 1 file = N chapter → `metadata_json.chapters` suy ra từ file; (c) 1 file không chapter. Không tự gom thư mục.
- **Loại khỏi luồng văn bản**: giữ `CHUNKABLE_FORMATS` nguyên (audio tự loại), `openBookContent` trả rỗng cho audio, `canGenerateCover` đã loại, kiểm `word-count`/`book-index` ở PoC.

### Migration [đề xuất, chưa viết]
- File mới `026_*.sql`, rebuild `books` theo mẫu 020 (`books_new` → copy → drop → rename; runner đã tắt FK + bọc transaction). Nới CHECK thêm **chỉ các format đã duyệt** (`mp3`, và cân nhắc `m4b` ngay để tránh rebuild lần hai). Có thể đồng thời **bỏ `docx`/`doc`** vì code đã gỡ — *cần quyết định riêng*, đừng gộp ngầm.
- Phải giữ: mọi cột, index, trigger (kể cả FTS liên quan nếu có), dữ liệu JSON, và các FK trỏ vào `books`.
- Cách chứng minh không mất dữ liệu (chạy trên **bản sao disposable**, không phải DB thật): tạo DB mẫu qua migration 001–025 + dữ liệu thật đại diện (books đủ 4 format, authors, genres, collections, notes/highlights EPUB/PDF/TXT/MD, `pdf_embedded_annotations`, `txt_documents`, `book_chunks`); so sánh trước/sau: số hàng mọi bảng, checksum nội dung `books` (trừ `file_format` không đổi), `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, danh sách index/trigger từ `sqlite_master`; thử insert `mp3` OK và `'xyz'` vẫn bị CHECK từ chối; chạy lại migration (idempotent qua `schema_version`).

---

## 8. Danh sách lệnh đã chạy và kết quả thật

| Lệnh (rút gọn) | Mục đích | Kết quả |
|---|---|---|
| `git status --short`, `git diff --stat`, `git diff -- <vài file>`, `git log -1` | Trạng thái Git (chỉ đọc) | 61 file sửa, 2 file xoá stage, nhiều file chưa theo dõi; HEAD `c7d6c75` |
| `node -v`; đọc `node_modules/electron/package.json` | Phiên bản | Node 22.13.0; Electron 39.8.10 |
| `command -v ffmpeg ffprobe mediainfo sox exiftool python` | Công cụ có sẵn | Chỉ có `python` (3.12); các công cụ audio: none |
| `find` fixture âm thanh ngoài `node_modules` | Fixture trong repo | Không có |
| `grep` import `music-metadata` | Nơi dùng | Chỉ `desktop/package.json` |
| Quét chuỗi codec trong `electron/dist/ffmpeg.dll` | Thử suy ra codec | 0 kết quả cho mọi tên → không kết luận |
| `node gen.mjs` (thư mục tạm ngoài repo) | Tổng hợp WAV/AIFF/MP3 | Tạo 3 file |
| `node probe.mjs` (`music-metadata@12.2.1.parseFile`) | Parse metadata | `t.wav`: WAVE/PCM, 2 s, 8000 Hz · `t.aiff`: AIFF/PCM, 2 s · `t.mp3`: MPEG 1 Layer 3, CBR, 1.0449 s, 44100 Hz |
| WebFetch chromium.org/audio-video; WebSearch về ffmpeg của Electron | Tài liệu | Xem §3 |

**Không chạy**: `typecheck`, `lint`, test SDK, `vite build`, spike, Electron, E2E (không cần cho phase chỉ đọc; không thay đổi code nào). Không có test nào được báo "pass" ngoài hai lần parse trên.

---

## 9. Câu hỏi chưa giải quyết

1. Phát được định dạng nào trong **Electron 39.8.10 trên Windows và macOS** (`<audio>` + seek)? [?]
2. `protocol.handle` + `net.fetch(file://)` có xử lý `Range` đúng không, hay phải tự phục vụ? Scheme cần privilege nào? [?]
3. `music-metadata@12.2.1` đọc chapter (`chpl`/text-track M4B, ID3 `CHAP`) tới mức nào? [?]
4. `music-metadata` bundle trong Main bằng Vite/Rollup và chạy trong bản đóng gói ASAR? [?]
5. `library:getBook` có trả `format`? Dispatcher đặt ở đâu? [?]
6. `word-count-service` / `book-index` xử lý format không chunkable thế nào? [?]
7. Quyết định sản phẩm (từ bản trước, chưa trả lời): `mp3` vs `audio` chung → **bản này nghiêng về format theo extension** (`mp3`, `m4a`, `m4b`, `wav`, `flac`, `ogg`, `opus`); nới CHECK một lần cho những gì chắc chắn; phát nền khi rời reader; tab đọc; import URL/cloud (đề xuất: chưa).
8. Có bỏ `docx`/`doc` khỏi CHECK trong cùng migration không?
9. Chính sách file lớn (>2 GB) và giới hạn kích thước import.
10. Đủ nguồn fixture hợp pháp (tự tạo bằng công cụ ngoài, CC0/public-domain) — ai cung cấp?

---

## 10. Kế hoạch PoC tương thích tối thiểu (Phase 0.1 — chờ phê duyệt)

Nguyên tắc: không sửa repo, không GUI chiếm desktop, không cài vào repo.
1. **Fixture** (thư mục tạm ngoài repo, có nguồn gốc ghi lại): sinh bằng công cụ ngoài repo được bạn chấp thuận (ví dụ ffmpeg cài ở máy bạn) hoặc dùng file CC0/public-domain; ma trận ở §5; mỗi file ghi codec/bitrate/mode/độ dài/kích thước/SHA-256.
2. **Parse metadata** bằng Node script (như `probe.mjs`) cho mọi fixture: container, codec, duration, tag, bìa, chapter → [T].
3. **Phát/seek** trong Electron: một app tối giản **ngoài repo** (thư mục tạm, dùng `electron` đã có trong `node_modules` của repo qua đường dẫn, không sửa repo), cửa sổ ẩn/offscreen (kiểu `E2E_HIDDEN`), `protocol.handle` thử hai cách (forward `net.fetch` vs tự Range), `<audio>`: `loadedmetadata` → duration, `currentTime` tại đầu/giữa/cuối/vượt cuối, pause/resume, `playbackRate`, `error.code`; chạy bằng `--autoplay-policy=no-user-gesture-required` chỉ trong PoC. **Cần bạn đồng ý** vì có thể phát âm thanh/chiếm tiến trình, dù không hiện cửa sổ.
4. **Streaming**: kiểm `200`, `206` + `Content-Range`, `416`, `404` (id lạ, file mất, format sai), chặn đường dẫn tuỳ ý; đo RSS khi phát file ≥500 MB (xác nhận không nạp vào RAM).
5. **M4B**: phân biệt có `chpl`/text-track chapter vs chỉ một track dài.
6. **Đóng gói**: dựng thử bundle Main với `music-metadata` (script riêng, không đổi cấu hình repo) hoặc ghi lại là cần làm ở Phase 1.
7. **Báo cáo**: OS, Electron/Chromium, fixture, kết quả; cập nhật ma trận §3.

---

## 11. Tiêu chí quyết định hỗ trợ chính thức từng định dạng

Một định dạng/biến thể chỉ vào `SUPPORTED_FORMATS` khi đạt **tất cả**:
- Phát + pause/resume + seek (đầu/giữa/cuối, sai số ≤ 1 s) thành công trên **cả Windows và macOS** trong Electron phát hành, với ≥ 2 fixture độc lập mỗi biến thể (không suy rộng từ một file).
- `duration` hợp lệ hoặc có đường fallback rõ ràng (không `NaN/Infinity` làm hỏng UI).
- Range/206 hoạt động qua protocol; RSS không tăng theo kích thước file.
- Import không crash khi thiếu/hỏng tag; dedupe SHA-256 đúng.
- File hỏng/không giải mã → thông báo dễ hiểu, không treo.
- Có fixture + test hồi quy trong repo (sau khi được duyệt).
- Giới hạn đã biết (codec/profile nào không hỗ trợ) được ghi lại.
- Mặc định chưa qua PoC = **không hỗ trợ**; "experimental" cần cờ rõ ràng, không liệt kê trong dialog mặc định.

---

## 12. Phạm vi, tiêu chí nghiệm thu và thứ tự các phase tiếp theo

**Thứ tự**: 0 (tài liệu này) → 0.1 PoC → 1 → 2 → 3 → 4 → 5 → 6. Mỗi phase kết thúc bằng báo cáo (file thay đổi, lý do, test thật, test không chạy được, tác động DB/import/streaming/format, rủi ro, nghiệm thu) và **dừng chờ duyệt**; không commit/push.

| Phase | Mục tiêu | Bao gồm | Không bao gồm | Khu vực dự kiến thay đổi (đề xuất, trừ khi ghi [V]) | Test | Hoàn thành | Rủi ro/phụ thuộc |
|---|---|---|---|---|---|---|---|
| **0** | Audit | Tài liệu này | Mọi thay đổi code | `docs/implementation_plan/audiobook_implementation_plan.md` | Không | Được duyệt + trả lời §9 | Working tree bẩn |
| **0.1** | PoC tương thích | Ma trận fixture, parse, phát/seek, Range, M4B chapter | Sửa repo, GUI chiếm desktop | Ngoài repo | Script PoC | Ma trận §3 cập nhật bằng [T]; chốt danh sách MVP | Cần encoder/fixture; cần bạn đồng ý chạy Electron ẩn |
| **1** | Nền tảng `AudioBookPlayer` | `rb-audio` streaming, store, màn audio, volume/rate/lỗi, **chỉ** định dạng đã duyệt; migration **được trình bày và duyệt trước** | Import UI hoàn chỉnh, chapter, bookmark, multi-file | `document-format.ts`, `formats.ts`, `api-types.ts`, migration 026, `importer-registry.ts` + adapter, protocol mới, `main.ts`, `capabilities.ts`, `App.tsx`, screen mới | vitest logic thuần; spike Main (protocol + migration trên DB disposable); typecheck/lint/vite build | Phát fixture MVP; không nạp file vào RAM; seek OK; lỗi xử lý; reader cũ không ảnh hưởng | Phụ thuộc 0.1 và duyệt migration |
| **2** | Import, Library, metadata, tiếp tục nghe | Importer, `music-metadata` best-effort, bìa, `audioProgress` (json_patch), debounce + flush, file thiếu/relink | Chapter, multi-file | `import.ipc.ts`, adapters, `overlay.ipc.ts`, `sqlite-overlay-store.ts`, preload/bridge, `ReadingStateJson` (SDK), Library card | Spike Main/store; hồi quy `saveSessionState` | Import→phát→đóng→mở lại khôi phục vị trí; dữ liệu cũ bảo toàn | R5, R9 |
| **3** | Nhiều file / nhiều chapter | Thiết kế dữ liệu riêng trước khi code | Auto-gom thư mục | Chưa xác định — cần thiết kế | Thứ tự track, chuyển track, khôi phục | Phát liên tục, nhảy chương, lưu/khôi phục | Mô hình dữ liệu |
| **4** | M4B + chapter | Chapter có sẵn vs tự tạo, seek theo chapter, fallback | Thay đổi cơ chế phát chung | Metadata parser/adapter | Fixture M4B (có/không chapter) | Chapter đúng khi có; không chapter = 1 track | Phụ thuộc kết quả PoC M4B |
| **5** | Tiện ích nâng cao | Bookmark/ghi chú theo timestamp, sleep timer, media keys, bìa/metadata | Dùng highlight văn bản cho audio | Có thể `Location` kind mới hoặc bảng riêng (cần khảo sát) | Logic + lưu/khôi phục | Từng tính năng được duyệt riêng | Động đến union `Location` |
| **6** | Mở rộng format & ổn định | Thêm AAC/OGG/Opus/AIFF… theo ma trận; đóng gói; Win/macOS | Format không qua tiêu chí §11 | `formats.ts`, registry, fixture | Ma trận fixture; đóng gói thật | Bảng hỗ trợ chính thức + hồi quy | Codec, VBR, file lớn, ổ ngoài |

---

# PHASE 0.1 — PoC tương thích có kiểm soát (kết quả)

Date: 2026-10-21. Trạng thái: **Phần A (không cần Electron) đã chạy; Phần B (runtime Electron: phát/seek/streaming/bộ nhớ) CHƯA chạy — chờ bạn cho phép (xem P6).**

Nhãn: **[V]** repo · **[T]** phép thử runtime (có môi trường) · **[D]** tài liệu · **[I]** suy luận · **[?]** chưa biết.

> Phạm vi: bản này **chưa kết luận định dạng nào "phát được"**. Mọi con số dưới đây là về *phân tích metadata* và *đóng gói parser*, không phải giải mã/phát.

## P1. Bảo vệ repository
- Trước và sau khi làm: `git status --short` giống hệt (77 mục, gồm 2 mục staged `D`) và hash của `git diff` không đổi **[T]**. Tôi chỉ ghi vào tài liệu này.
- Mọi fixture, script, bundle nằm ngoài repo (thư mục scratchpad của phiên, `…/scratchpad/poc/`). Không cài gì; không sửa `package.json`, lockfile, cấu hình, source.
- Không chạy Electron, GUI, E2E; không phát âm thanh.

## P2. Môi trường
Windows 11 Home (10.0.26300) · Node 22.13.0 (CLI) · `music-metadata@12.2.1` (từ `source/node_modules`) · Vite 8.1.5 (từ `source/node_modules`, chỉ dùng API `build`) · Electron 39.8.10 (chưa khởi chạy). Chỉ Windows; **không có kết luận nào cho macOS**.

## P3. Fixture
**Nguồn: toàn bộ do script `gen-fixtures.mjs` (thuần Node, do tôi viết trong phiên này) tạo ra, không phải file từ encoder thật.** Không có `ffmpeg`/`ffprobe`/`sox`/`mediainfo`/`exiftool` trên máy và không được cài thêm. Hệ quả:
- **PCM** (WAV, AIFF) và **cấu trúc đơn giản** (MP3 frame im lặng, FLAC *verbatim*, Ogg-Opus gói im lặng `F8 FF FE`): payload hợp lệ về cấu trúc, *khả năng giải mã chưa kiểm*.
- Nhóm **`*_STRUCTURE_ONLY`** (M4A/M4B/ALAC/ADTS): container/atom đúng nhưng `mdat`/payload là số 0 → **không phải AAC/ALAC giải mã được**. Chỉ dùng thử parser, **không dùng thử phát**.
- **Ogg Vorbis: không tạo được** (cần encoder thật). **FLAC nén thật, AAC thật, ALAC thật, MP3 từ LAME, WAV có tín hiệu: chưa có.**
- Mọi nội dung là im lặng số.

| File | Biến thể / codec (theo script) | Bytes | Thời lượng thật (tính từ cấu trúc) | SHA-256 | Payload giải mã được? |
|---|---|---:|---:|---|---|
| `wav_pcm16_44k_mono.wav` | PCM s16le | 264644 | 3.000 s | `9bf857f5d07d4f812ce979c0c6a882a4eedfe794421e2939ec5f4bb6a9f56f8e` | true |
| `wav_pcm24_48k_stereo.wav` | PCM s24le | 864044 | 3.000 s | `959bca8ff30ac11ae8dc1071e82ea1b77502a2dd478c582faa955e4d8bfeeff6` | true |
| `wav_float32_44k_mono.wav` | PCM f32le (IEEE float) | 529244 | 3.000 s | `4fda132d7d8bad53573daf9d3b14b27942f2372903e5481c892a3f63d99aff52` | true |
| `aiff_pcm16_44k_mono.aiff` | PCM s16be | 264654 | 3.000 s | `2694f2da54b532799f06ca5787eb924f1fc8c20331e72d6d155c2a13195e4704` | true |
| `mp3_cbr_noid3.mp3` | MPEG1 L3 CBR 128k | 47955 | 3.004 s | `1a2ea6d6538efc25a9f005920984d5ba882dd82330eac9bfd63d8664c456de38` | likely (silence frames, unverified) |
| `mp3_cbr_id3v23_cover.mp3` | MPEG1 L3 CBR 128k + ID3v2.3 (title/artist/album/APIC png) | 48131 | 3.004 s | `a045f13eea7feeb9f158d0b7dc2563784df16348a42ca35669607331a214dd19` | likely |
| `mp3_vbr_noxing.mp3` | MPEG1 L3 VBR (96k/160k alternating), NO Xing | 50100 | 3.135 s | `26f44a1497605445a2206a542fabaf08b31a43a51e66f425b11fc7fe2ef4ae7c` | likely |
| `mp3_vbr_xing.mp3` | MPEG1 L3 VBR + Xing header (frames/bytes/TOC) | 50517 | 3.135 s | `96b0d0eb179e974b328bf5bf91108f330628cd109d94a46dc61d3e3316b09cfd` | likely |
| `mp3_cbr_id3_chap_ctoc.mp3` | MPEG1 L3 CBR + ID3v2.3 CHAP x3 + CTOC | 48189 | 3.004 s | `51ab657b75aebfd36270a64f591fb494cfecbb27b2e8c28e97a20d7aafc341d0` | likely |
| `mp3_truncated_midframe.mp3` | CBR cut mid-frame | 25220 | — | `0ac10131505d7dddf9526882429cfd611dd622a48c53b7a84c64fe63c831566f` | partial |
| `mp3_corrupt_id3_size.mp3` | ID3 header declares size >> file | 8369 | — | `4fa9eebbed657dcd0cf1a723242e8b6d68a166fb7f00c3ba68101835d38ce489` | ? |
| `mp3_garbage.mp3` | not audio | 1200 | — | `3296c2ee577734671f121564dee385d86292b34bc43348ffa705f8fa1795f5da` | false |
| `mp3_empty.mp3` | empty | 0 | — | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | false |
| `flac_pcm16_seektable_tags.flac` | FLAC 16-bit verbatim, SEEKTABLE, VORBIS_COMMENT | 265600 | 3.000 s | `8e9b5600f4cb247fd890cf7f153a1c0e5de349b590cb9dc821d258c4f8f28110` | likely (hand-built; md5 zero) |
| `flac_pcm16_noseektable.flac` | FLAC 16-bit verbatim, no SEEKTABLE, no tags | 264941 | 3.000 s | `20b1f58bb6f950439fae073d0d284ca48cd597dde9fc8da9692eb1f42b8e9124` | likely (hand-built; md5 zero) |
| `opus_ogg_container.opus` | Ogg Opus mono 48k (silence packets F8 FF FE) | 825 | 3.000 s | `e96dc2851e409235a394f71869f4772fd31d997cef03096bc316ac751dba2a4b` | likely |
| `opus_in_ogg_ext.ogg` | identical bytes to .opus, extension .ogg | 825 | 3.000 s | `e96dc2851e409235a394f71869f4772fd31d997cef03096bc316ac751dba2a4b` | likely |
| `aac_adts_STRUCTURE_ONLY.aac` | ADTS AAC-LC 44.1k stereo headers; payload zeros (not real AAC) | 13910 | 3.019 s | `9e07c531718943dbb213b8c046439a1994beae0ec1467c11283431bddbb7c631` | false |
| `m4a_aac_moovfirst_STRUCTURE_ONLY.m4a` | MP4 mp4a/esds AAC-LC AudioSpecificConfig 0x1210; mdat zeros (not real AAC); moov first | 17481 | 3.019 s | `f98b4609b7f5b54cf11c8f55cd4dceb117f1169aac621370fb306fc7c34302ce` | false |
| `m4a_aac_moovlast_STRUCTURE_ONLY.m4a` | same, moov LAST | 17481 | 3.019 s | `f366956608eec7fc9a26227854d10a45232d80f32304919da8958eb5447d61df` | false |
| `m4a_alac_STRUCTURE_ONLY.m4a` | MP4 alac sample entry + cookie; mdat zeros | 17226 | 3.019 s | `afd7f42320630b9ff22a37a4c6fa432f2a64c79e6f448ea89f380562ad588714` | false |
| `m4b_nochapter_STRUCTURE_ONLY.m4b` | M4B, one long track, no chapter atoms | 17481 | 3.019 s | `62eca282acb4f10964e81a4ac0a77e3971c567e5a98283ce7ff0cedf616962ba` | false |
| `m4b_chpl_chapters_STRUCTURE_ONLY.m4b` | M4B + Nero chpl x3 (QuickTime text-track chapters NOT built) | 17552 | 3.019 s | `ce72409fd24e7c9634e83e1f605e3e86868c83465f1b8c3d76a9ab90e2a73170` | false |


(`opus_ogg_container.opus` và `opus_in_ogg_ext.ogg` **trùng byte** — cùng SHA-256 — để chỉ thay đổi biến "đuôi file".)

**Fixture cần bạn cung cấp (hoặc cho phép dùng encoder)**, lệnh gợi ý nếu bạn tự có ffmpeg (tôi **không** chạy các lệnh này):

```
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a libmp3lame -b:a 128k mp3_cbr.mp3
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a libmp3lame -q:a 4 mp3_vbr_xing.mp3
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a libmp3lame -q:a 4 -write_xing 0 mp3_vbr_noxing.mp3
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a aac -b:a 96k -movflags +faststart m4a_aac_moovfirst.m4a
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a aac -b:a 96k m4a_aac_moovlast.m4a
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a alac m4a_alac.m4a
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a flac flac_seektable.flac
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a libvorbis ogg_vorbis.ogg
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a libopus opus.opus   (và bản đổi đuôi .ogg)
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a aac -f adts aac_adts.aac
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a pcm_s24le wav_pcm24.wav
ffmpeg -f lavfi -i sine=frequency=220:duration=30 -af volume=0.05 -c:a pcm_s16be aiff_pcm.aiff
M4B có chapter: tạo file FFMETADATA1 có [CHAPTER], rồi: -i meta.txt -map_metadata 1 -f ipod -c:a aac out.m4b
Một M4B/MP3 dài (>= 500 MB) để đo bộ nhớ.
```

## P4. Kết quả metadata (`music-metadata@12.2.1`, Node 22.13.0) [T]
Phép thử: `parseFile(path, { includeChapters: true, duration: false|true })`. **"Parse thành công" ≠ "phát được".**

| Fixture | Container / codec nhận diện | Duration so với thật | Tag | Bìa | Chapter | Ghi chú |
|---|---|---|---|---|---|---|
| WAV PCM16 44.1k mono | WAVE / PCM | 3.000 ✔ | — | — | — | Cảnh báo `Data chunk size exceeds file size` |
| WAV PCM24 48k stereo | WAVE / PCM | 3.000 ✔ | — | — | — | cùng cảnh báo |
| WAV float32 44.1k | WAVE / IEEE_FLOAT | 3.000 ✔ | — | — | — | cùng cảnh báo |
| AIFF PCM16 | AIFF / PCM | 3.000 ✔ | — | — | — | không cảnh báo |
| MP3 CBR (không tag) | MPEG / MPEG 1 Layer 3 | 3.004 ✔ (ước từ kích thước) | — | — | — | |
| MP3 CBR + ID3v2.3 | như trên | 3.004 ✔ | title/artist/album đúng | **1** (PNG) | — | |
| MP3 VBR **không** Xing | như trên | mặc định **không có duration**; `duration:true` → 3.135 ✔ | — | — | — | Phải bật `duration:true` (quét toàn file; chi phí với file lớn chưa đo) |
| MP3 VBR + Xing | như trên | 3.135 ✔ | — | — | — | |
| MP3 + ID3 CHAP×3 + CTOC | như trên | 3.004 ✔ | title ✔ | — | **3** (`start`/`end` tính bằng **giây**: 0/1, 1/2, 2/3.004) | Fixture tổng hợp; chưa thử tag từ công cụ thực |
| MP3 cắt giữa frame | MPEG | 1.567 (theo byte còn lại), **không báo lỗi** | — | — | — | Không phát hiện file bị cắt |
| MP3 header ID3 khai size ≫ file | — | — | — | — | — | **Ném `Id3v2ContentError`** → import phải bắt lỗi, có fallback |
| MP3 garbage / rỗng (0 byte) | **không có container/codec/duration** | — | — | — | — | **Không ném lỗi** — phải tự kiểm `format.container`/`duration` để coi là không hợp lệ |
| FLAC có SEEKTABLE + tag | FLAC / FLAC | 3.000 ✔ | title/artist ✔ | 0 | — | |
| FLAC không SEEKTABLE | FLAC | 3.000 ✔ (từ STREAMINFO) | — | — | — | Duration không phụ thuộc SEEKTABLE; **seek** thì có thể [I] |
| Ogg Opus `.opus` | Ogg / Opus | 2.994 (thật 3.000 trừ pre-skip 312 mẫu = 6.5 ms → hợp lý) | title/artist ✔ | — | — | |
| Ogg Opus mang đuôi `.ogg` | Ogg / Opus | như trên | ✔ | — | — | Parser nhận theo nội dung, không theo đuôi |
| ADTS `.aac` (payload giả) | ADTS/MPEG-4 / AAC | mặc định **không có**; `duration:true` → 2.995 (thật 3.019, lệch ~24 ms) | — | — | — | Duration chỉ ước lượng |
| M4A AAC moov-đầu / moov-cuối | M4A/isom/mp42 / MPEG-4/AAC | 3.019 ✔ cả hai | ✔ | **1** | — | Parse từ đĩa đọc được cả hai vị trí `moov` |
| M4A ALAC | M4A / ALAC (lossless) | 3.019 ✔ | — | — | — | |
| M4B không chapter | M4B/isom/mp42 / MPEG-4/AAC | 3.019 ✔ | ✔ | 1 | **0** | |
| M4B + chpl ×3 | như trên | 3.019 ✔ | ✔ | 1 | **3**: `start` = 0 / 10 000 000 / 20 000 000 kèm `timeScale: 10000000` (**đơn vị thô 100 ns; không có `end`**) | |

Điểm rút ra **[T], trên fixture tổng hợp**:
1. **Đơn vị chapter không thống nhất**: ID3 CHAP trả giây (có `end`), M4B `chpl` trả đơn vị `timeScale` thô (không `end`). Cần lớp chuẩn hoá riêng, có test.
2. `duration` mặc định **vắng** với MP3 VBR không Xing và ADTS → cần `duration:true` hoặc fallback `<audio>.duration`.
3. File garbage/rỗng **không ném lỗi** → import cần tiêu chí hợp lệ riêng; ID3 hỏng **có** ném lỗi → bắt lỗi, coi metadata là best-effort.
4. MP3 bị cắt cụt **không bị phát hiện**.
5. Cảnh báo WAV `Data chunk size exceeds file size` xuất hiện với fixture của tôi kể cả khi thêm byte thừa hoặc chunk `LIST` sau `data`; duration vẫn đúng. Nguyên nhân chưa rõ (lỗi fixture hoặc kiểm tra biên của parser) **[?]** → thử lại với WAV từ encoder thật.
6. `chpl` (Nero) đọc tốt; **chưa thử** chapter QuickTime text-track (`tref/chap`) và ID3 CHAP từ công cụ thực — **[?] chưa xác minh**.

## P5. Đóng gói `music-metadata` (cô lập) [T]
- Dùng API `build` của Vite 8.1.5 trong repo (chỉ đọc) với **cấu hình nằm ngoài repo**: `ssr.noExternal: true`, `target: node22`, ESM, alias `music-metadata` → `source/node_modules/music-metadata/lib/index.js`.
- Kết quả: build thành công (`entry.mjs` ≈ 19 KB + `assets/`); `node bundle_run/entry.mjs <file>` chạy độc lập và đọc đúng MP3 có CHAP (3 chapter) và M4B có chpl (3 chapter) **[T]**.
- **Chưa chứng minh**: chạy trong **Electron Main** (Node 22.22.1 nhúng), trong **ASAR** do `electron-builder`, và với `vite-plugin-electron` thật (cấu hình khác PoC) → rủi ro **R-pack** giữ cho Phase 1.

## P6. Runtime Electron — CHƯA CHẠY; xin phép
Đề xuất PoC cô lập, cần bạn chấp thuận từng điểm:

| Hạng mục | Chi tiết |
|---|---|
| Cách chạy | App tối giản **trong thư mục tạm ngoài repo** (`main.cjs` + `index.html`), chạy bằng `source/apps/reading-book-desktop/node_modules/electron/dist/electron.exe` (chỉ đọc). Không đụng source/`userData` của Readmate; dùng `--user-data-dir` tạm |
| Cửa sổ | `BrowserWindow({ show: false })` + `offscreen: true` (như hidden mode E2E): **không hiển thị, không lấy focus** |
| Âm thanh | `<audio muted>`; fixture im lặng. Windows vẫn có thể mở phiên âm thanh ngắn cho `electron.exe` (có thể hiện trong Volume Mixer vài giây). Cờ `--autoplay-policy=no-user-gesture-required` chỉ cho PoC. Không phát ra loa |
| Tài nguyên | 1 cây tiến trình Electron (~150–300 MB RAM), CPU thấp, ~2–5 phút; không mở cổng mạng (chỉ custom protocol); ghi RSS/private bytes tiến trình |
| Đĩa | fixture hiện ≈ 3 MB. Thử file lớn: sinh **WAV PCM im lặng ~500 MB–1 GB** trong thư mục tạm (xoá sau). Cần bạn đồng ý dung lượng |
| Streaming | **A**: `protocol.handle` → `net.fetch(file://…)` có/không forward `Range`; **B**: tự phục vụ `createReadStream` + `206`/`Content-Range`/`416` |
| Kiểm tra | 200 toàn phần; 206 + `Content-Range` đúng; 416; bookId lạ / file mất / format sai → 404; URL `..`, `%2e%2e`, đường dẫn tuyệt đối, symlink → chặn; `Content-Type` do bảng registry quyết định; `<audio>`: play/pause/resume, seek 0 / giữa / cuối / vượt cuối, `duration` finite, `error.code`; RSS trước/trong/sau |
| Phạm vi | Chỉ **Windows 11**; macOS ghi [?] |
| Dọn dẹp | Xoá thư mục tạm, fixture lớn, `user-data-dir`; liệt kê trong báo cáo |
| Giới hạn | Với `*_STRUCTURE_ONLY` (M4A/M4B/ALAC/ADTS) **phát có thể lỗi vì payload giả, không phải do Chromium** → kết quả phát AAC/M4A/M4B/ALAC/ADTS **vô nghĩa** nếu không có file encoder thật |

## P7. Phân biệt M4B (kết quả tạm)
| Trường hợp | Kết quả | Trạng thái |
|---|---|---|
| M4B có chapter metadata (chpl) | Parser đọc 3 chapter, đơn vị 100 ns | [T] cấu trúc; **chưa** trên M4B thực |
| M4B một track dài | `chapters: []` | [T] |
| Parser nhận chapter nhưng `<audio>` không có điều hướng chapter | `<audio>` không có API chapter; app tự seek theo `start` | [I] — xác nhận runtime |
| Chapter không đọc được / không tương thích (text-track, hỏng) | **Chưa thử** | [?] |
| Nghe M4B (AAC) trong Chromium của Electron 39 | **Chưa thử** | [?] |

## P8. Ma trận tương thích — trạng thái sau Phase 0.1
"Metadata" là [T] trên fixture tổng hợp; "Phát/Seek/Streaming" **chưa có [T]**.

| Biến thể | Metadata | Duration | Phát | Seek | Range | Kết luận hiện tại |
|---|---|---|---|---|---|---|
| MP3 CBR / ID3 / cover | ✔ [T] | ✔ [T] | [?] | [?] | [?] | Ứng viên MVP, cần runtime |
| MP3 VBR Xing | ✔ [T] | ✔ [T] | [?] | [?] | [?] | Ứng viên MVP |
| MP3 VBR không Xing | ✔ [T] | cần `duration:true` | [?] | [?] | [?] | Ứng viên, rủi ro P1 |
| MP3 + CHAP/CTOC | ✔ [T] | ✔ | [?] | [?] | [?] | Chapter MP3: Phase 4+ |
| M4A AAC-LC (moov đầu/cuối) | ✔ [T] cấu trúc | ✔ [T] | [?] cần file thật | [?] | [?] | Chưa thể kết luận |
| M4A ALAC | ✔ [T] cấu trúc | ✔ | [?] (không có trong danh sách codec Chromium [D]) | — | — | Đề xuất **không hỗ trợ** tới khi chứng minh |
| WAV PCM16 / PCM24 / float32 | ✔ [T] (cảnh báo lạ) | ✔ | [?] (PCM16 & float32 có trong danh sách [D]; PCM24 không thấy) | [?] | [?] | PCM16: ứng viên; còn lại cần runtime |
| FLAC có/không SEEKTABLE | ✔ [T] tổng hợp | ✔ | [?] | [?] | [?] | Ứng viên, cần FLAC thật |
| M4B (không chapter / chpl) | ✔ [T] cấu trúc | ✔ | [?] cần file thật | [?] | [?] | Phase 4, cần PoC thật |
| AAC ADTS | ✔ [T] (duration ước lượng) | ≈ | [?] | [?] kém [I] | [?] | Đề xuất **không** vào MVP |
| Ogg Vorbis | **không tạo được fixture** | — | [?] | [?] | [?] | Chưa thể thử |
| Ogg-Opus `.opus` | ✔ [T] | ✔ (trừ pre-skip) | [?] | [?] | [?] | Ứng viên |
| Ogg-Opus đuôi `.ogg` | ✔ [T] (theo nội dung) | ✔ | [?] (MIME/đuôi qua protocol) | [?] | [?] | Ứng viên; kiểm MIME runtime |
| AIFF PCM16 | ✔ [T] | ✔ [T] | [?] **không nằm trong danh sách Chromium [D]** | — | — | Đề xuất **không hỗ trợ** |

## P9. Chưa thử được và lý do
- **Ogg Vorbis**: không có encoder.
- **AAC/M4A/M4B/ALAC/ADTS giải mã thật**: không có encoder; fixture chỉ có cấu trúc.
- **FLAC nén thật, MP3 từ LAME, WAV có tín hiệu**: nên dùng file thật.
- **Runtime Electron** (phát/seek/duration/Range/bộ nhớ): chờ phép (P6).
- **macOS**: không có máy.
- **File lớn** (>500 MB / >2 GB): chưa thử.
- **QuickTime text-track chapter, ID3 từ công cụ thực, tag Unicode**: chưa thử.

## P10. Danh sách MVP đề xuất (tạm, chờ runtime)
- **PoC runtime ưu tiên**: MP3 (CBR, VBR-Xing, VBR không Xing), WAV PCM16.
- **MVP Phase 1 (nếu runtime đạt)**: **`.mp3`** duy nhất.
- **Cân nhắc sau MP3** (cần runtime với file thật): `.flac`, `.opus`/Ogg-Opus, `.wav` PCM16, `.m4a` AAC-LC.
- **M4B**: Phase 4, riêng.
- **Chưa hỗ trợ**: ALAC, AAC ADTS, AIFF, WAV PCM24/float (đến khi chứng minh), Vorbis (chưa thử).
- Không thêm gì vào `SUPPORTED_FORMATS`; không migration; không UI.

## P11. Quyết định cần bạn đưa ra trước Phase 1
1. **Cho phép chạy runtime Electron PoC** như P6 (cửa sổ ẩn, tắt tiếng, thư mục tạm)? Có đồng ý fixture lớn ~500 MB–1 GB?
2. **Fixture thật**: bạn cung cấp (P3), tự chạy ffmpeg, hay chỉ định nguồn CC0/public domain? Nếu không → M4A/M4B/AAC/Vorbis giữ [?].
3. Format theo extension riêng (`mp3`, `m4a`, `m4b`, …) hay chung `audio`.
4. Nới CHECK một lần cho các format dự kiến hay từng lần; có bỏ `docx`/`doc` luôn không.
5. MVP chỉ `.mp3` hay `.mp3 + .wav + .flac + .opus`.
6. Chấp nhận lớp chuẩn hoá chapter riêng (ID3 = giây; M4B = timeScale) ở Phase 4.
7. Chính sách khi `duration` vắng: quét toàn file lúc import hay dựa vào `<audio>.duration` khi mở.

## P12. Tiêu chí nghiệm thu còn thiếu (bổ sung vào §11)
- Phát + seek thực trên **file encoder thật** cho từng biến thể đề xuất (≥2 file độc lập), **Windows và macOS**.
- Range/206/416/404 đúng và an toàn path (A vs B đã so sánh, chọn có bằng chứng).
- RSS không tăng theo kích thước file khi phát file ≥500 MB.
- `music-metadata` chạy trong **Electron Main đã đóng gói ASAR** (Windows và macOS).
- Import chịu được: tag hỏng (`Id3v2ContentError`), file rỗng/garbage (không ném lỗi nhưng không có `container`), MP3 bị cắt, VBR không Xing.
- Chuẩn hoá chapter (giây) có unit test cho ID3 CHAP và M4B chpl; fallback khi không có chapter.
- `<audio>.duration` finite và khớp `music-metadata` (chênh ≤ 1 s) cho từng định dạng.
- Xử lý cảnh báo WAV trên WAV thật.
- macOS = chưa xác nhận cho tới khi có máy.

## P13. Lệnh đã chạy (Phase 0.1) và kết quả thật
| Lệnh | Kết quả |
|---|---|
| `git status --short`, `git diff \| sha256sum` (trước/sau) | Giống nhau (77 mục; hash không đổi) |
| `node gen-fixtures.mjs` (scratchpad) | 23 fixture; lần đầu lỗi do mã hoá `©nam` (UTF-8) → sửa `latin1`, chạy lại thành công |
| `node probe.mjs` (`parseFile`, `duration` false/true, `includeChapters`) | Bảng P4; lần đầu 4 fixture MP4 lỗi `Mp4ContentError` do **bug fixture của tôi** (đã sửa) → sau đó parse thành công |
| `node ch.mjs`, `node wavchk.mjs` | Đơn vị chapter; cảnh báo WAV lặp lại với biến thể trailing/`LIST` |
| `node bundle.mjs` (Vite 8.1.5 `build`, SSR, cấu hình ngoài repo) | Build thành công |
| `node bundle_run/entry.mjs <mp3 CHAP>` và `<m4b chpl>` | 3 chapter mỗi file; bundle chạy độc lập |

**Không chạy**: Electron, E2E, GUI, `typecheck`/`lint`/test/`vite build` của repo (không thay đổi code).

## P14. Điều kiện kết thúc Phase 0.1
Dừng. Chưa triển khai Phase 1, chưa thêm format vào `SUPPORTED_FORMATS`, không migration, không đổi UI. **Cần bạn duyệt danh sách định dạng (P10) và trả lời P11** — đặc biệt phép chạy runtime Electron (P6) và nguồn fixture thật.


---

# PHASE 0.1 — Lượt 1: Electron runtime PoC (MP3, Windows)

Date: 2026-10-21. Nhãn: **[T]** đo được trong lượt này (môi trường bên dưới) · **[I]** suy luận · **[?]** chưa kiểm tra.

> **Cảnh báo giới hạn lớn nhất:** môi trường không có encoder (không ffmpeg), nên **mọi fixture MP3 là fixture tổng hợp do script tạo** (frame MPEG-1 Layer III im lặng, payload toàn số 0, xem P3). Chúng **không phải** MP3 từ encoder thật. Kết quả phát dưới đây **không chứng minh** giải mã đúng nội dung MP3 thật. Phần này chỉ chứng minh được hành vi của **tầng protocol/Range và cách Chromium của Electron phản ứng**, cùng khả năng demux/giải mã *các frame im lặng hợp lệ về cấu trúc*.
> Quy tắc lượt này nói "dừng phát nếu thiếu fixture encoder thật" nhưng cũng nói "ghi rõ hạn chế nếu fixture chỉ có silence/tổng hợp"; tôi chọn **chạy kèm cảnh báo** vì các kiểm tra Range/seek vẫn có giá trị. **Thiếu fixture encoder thật vẫn là điều kiện chặn trước Phase 1.**

## E1. Bảo vệ repository và an toàn
- Trước khi chạy: `git status --short` và hash `git diff` **giống baseline** (so với `git-before.txt`/`diff-before.sha`) **[T]**. Electron hiện có: `source/apps/reading-book-desktop/node_modules/electron/dist/electron.exe`, **39.8.10** (`dist/version`).
- Không sửa file nào trong repo; không chạy app Readmate, E2E, test, build; không `userData` của Readmate; không cổng mạng (chỉ custom protocol); không đụng 5 tiến trình `electron.exe` đã chạy sẵn trên máy (ghi PID trước, chỉ `taskkill` PID do chính runner sinh ra).
- Tất cả (PoC, fixture, log, profile) nằm trong scratchpad của phiên, **ngoài repo**. File lớn nhất: `big.mp3` ≈ 8.0 MB (< 10 MB) dùng cho test huỷ request.
- Cách cô lập cửa sổ/âm thanh: `BrowserWindow({show:false, webPreferences:{offscreen:true,…}})` + `--mute-audio` + `webContents.setAudioMuted(true)` + `<audio muted volume=0>` + `app.disableHardwareAcceleration()`; `--user-data-dir` tạm; watchdog 110 s (trong main) + 140 s (runner, `taskkill /T /F`).
- Xác nhận ẩn: trong lượt chạy hoàn chỉnh, tại t≈14 s và 25 s **mọi tiến trình `electron.exe` của PoC có `MainWindowHandle = 0`** (không có top-level window hiển thị) **[T]**; `win.isVisible() === false`, `isAudioMuted() === true` **[T]**.
- Focus: HWND foreground **trước = sau = 198580** trong lượt chạy hoàn chỉnh (tiêu đề đổi từ "Google Maps" sang "Gemini" vì đó là cửa sổ trình duyệt của bạn đổi tab, không phải PoC) **[T, chỉ hai điểm đầu/cuối — không giám sát liên tục]**. Ở lượt thất bại đầu tiên (2.5 s), foreground đổi từ cửa sổ "Downloads - File Explorer" sang một cửa sổ "Dialog"; **không xác định được nguyên nhân** (PoC chỉ có cửa sổ ẩn, nhiều khả năng do thao tác của bạn) **[?]**.
- **Sự cố của chính tôi** (không ảnh hưởng repo): lượt chạy 1 thoát sau 2.5 s do `executeJavaScript` trả về giá trị không clone được; lượt 2 treo 141 s tới khi watchdog giết cây tiến trình vì một lệnh `sed` làm hỏng cú pháp `main.cjs` (Electron in lỗi nạp). Sau đó tôi thêm `node --check` trước mỗi lần chạy. Lượt 3 hoàn chỉnh (exit 0, Electron chạy ≈48 s). Không còn tiến trình PoC sau khi kết thúc **[T]**.

## E2. Môi trường thực tế [T]
Windows 11 Home 10.0.26300 · Electron **39.8.10** · Chromium **142.0.7444.265** · Node (nhúng) **22.22.1** · V8 14.2.231.22-electron.0 (đọc từ `process.versions` trong PoC). Chỉ Windows; **macOS chưa xác minh**.

## E3. Fixture dùng
Từ Phase 0.1 (xem P3): `mp3_cbr_noid3.mp3` (47 955 B), `mp3_vbr_xing.mp3` (50 517 B), `mp3_vbr_noxing.mp3` (50 100 B), `mp3_cbr_id3v23_cover.mp3` (48 131 B), `mp3_truncated_midframe.mp3` (25 220 B), `mp3_empty.mp3` (0 B), `mp3_garbage.mp3` (1 200 B) — SHA-256 đầy đủ ở bảng P3. Thêm trong lượt này (tạo bởi `runner.mjs`, xoá sau khi chạy): `big.mp3` = 19 184 frame MPEG-1 L3 128 kbps im lặng liên tiếp (8 000 328 B, **không có SHA-256 được lưu**), `note.txt` (9 B), `secret.mp3` ngoài thư mục thư viện + symlink `link.mp3` trong thư viện trỏ ra ngoài (tạo thành công **[T]**).
**Loại fixture:** tất cả là **cấu trúc tổng hợp**; không có fixture từ encoder thật. Lệnh ffmpeg gợi ý ở P3 vẫn chưa ai chạy.

## E4. Cách thử (script đã chạy)
Mã nằm ngoài repo: `…/scratchpad/poc/electron-poc/{main.cjs,runner.mjs,package.json}` (bản sao + kết quả JSON: `…/scratchpad/poc/results-electron/`). Lệnh: `node --check main.cjs && node --check runner.mjs && node runner.mjs` (runner tự `spawn` `electron.exe <appdir> --user-data-dir=<tmp>`).
Thiết kế: renderer **chỉ gửi bookId trong URL** `scheme://local/<bookId>`; Main tra bảng `REG{id → file, format}`, kiểm `realpath` nằm trong thư viện, đuôi `.mp3`, là file thường; MIME do Main đặt `audio/mpeg`. Bốn scheme cùng chạy trên cùng fixture:
- **A (`rba`)**: `net.fetch(file://…)` có **chuyển tiếp** header `Range`.
- **A0 (`rbn`)**: `net.fetch(file://…)` **không** chuyển `Range`.
- **B (`rbb`)**: tự phục vụ bằng `fs.createReadStream({start,end})` + `Readable.toWeb`, tự parse `Range`, tự đặt `206/416`, `Content-Range/Length`, `Accept-Ranges`.
- **B-min (`rbm`)**: như B nhưng scheme chỉ có `standard, secure, supportFetchAPI` (không `stream`, không `bypassCSP`, không `corsEnabled`).
Test Range/path gọi bằng `fetch()` từ trang cùng origin (đúng đường đi renderer → protocol handler), so sánh SHA-256 body với lát cắt kỳ vọng tính từ file.

## E5. Kết quả Range và trạng thái HTTP [T]
Fixture `b-cbr` (47 955 B). "Đạt" = status, `Content-Range`, `Content-Length`, bytes (SHA-256 lát cắt) và `Content-Type=audio/mpeg` đều đúng.

| Phép thử | A (forward Range) | A0 (không forward) | B | B-min |
|---|---|---|---|---|
| GET toàn phần | 200, **không thấy** `Content-Length`/`Accept-Ranges` ở renderer; bytes đúng | như A | **200**, `Content-Length: 47955`, `Accept-Ranges: bytes`; bytes đúng | như B |
| `Range: bytes=0-99` | **200** (không phải 206), body **100 B đúng**, không có `Content-Range` | 200, body **47 955 B** (bỏ qua Range) | **206**, `Content-Range: bytes 0-99/47955`, `Content-Length: 100`; bytes đúng | như B |
| `bytes=1000-` | 200 + body đúng phần (46 955 B), không `Content-Range` | 200 toàn file | 206, `bytes 1000-47954/47955` | như B |
| `bytes=-500` (suffix) | 200 + 500 B đúng, không `Content-Range` | 200 toàn file | 206, `bytes 47455-47954/47955` | như B |
| `bytes=0-0` | 200 + 1 B | 200 toàn file | 206, `bytes 0-0/47955`, len 1 | như B |
| `bytes=0-999999999` (end vượt EOF) | 200 toàn file, không `Content-Range` | 200 toàn file | 206, `bytes 0-47954/47955` (kẹp về EOF) | như B |
| `bytes=99999999-` (start vượt EOF) | **`TypeError: Failed to fetch`** (net::ERR_REQUEST_RANGE_NOT_SATISFIABLE ném ra từ `net.fetch` trong handler; renderer không nhận 416) | 200 toàn file | **416**, `Content-Range: bytes */47955` | như B |
| Range sai cú pháp (`abc`), multi-range (`0-1,5-6`), đảo (`200-100`) | **`Failed to fetch`** (cả ba) | 200 toàn file | 200 toàn file (thiết kế: bỏ qua Range không hợp lệ, RFC 9110 cho phép) | như B |
| File rỗng + `bytes=0-` | `Failed to fetch` | 200 | **416**, `bytes */0` | như B |
| File rỗng GET | 200 (0 B) | 200 (0 B) | 200, `Content-Length: 0` | như B |

Kết luận Range **[T]**: B và B-min đạt mọi phép thử Range theo thiết kế. A **trả đúng bytes nhưng sai ngữ nghĩa** (200 thay vì 206, thiếu `Content-Range`/`Content-Length`) và làm vỡ yêu cầu với Range không thoả mãn/không hợp lệ (ném lỗi mạng thay vì 416/200). A0 bỏ qua Range hoàn toàn. Chưa thử phương án "A+" (đọc `net.fetch`, tự dựng 206) — **[?] chưa kiểm tra**; nó vẫn cần tự tính kích thước/Range nên gần như là B.

## E6. Lỗi, bảo vệ đường dẫn, huỷ request [T]
Mọi hàng dưới đây đúng ở **cả bốn scheme** (Main tra bảng, không đọc path từ URL):

| Phép thử | Kết quả |
|---|---|
| bookId lạ (`nope`) | 404 |
| File đã đăng ký nhưng mất | 404 |
| Format không cho phép (`.txt` trong registry) | 404 |
| Symlink trong thư viện trỏ ra file ngoài | **404** (`realpath` thoát khỏi thư viện bị chặn) |
| `../../secret`, `%2e%2e%2fsecret`, `%2f..%2f..%2fsecret.mp3`, double-encode `%252e%252e%252fsecret` | 404 |
| Đường dẫn tuyệt đối (`C:\Windows\win.ini`, `/etc/passwd` mã hoá URL) | 404 |
| `b-cbr%00` (NUL) | 404 |
| `b-cbr?path=C:\Windows\win.ini` | 200 nhưng trả **b-cbr**, query bị bỏ qua (không có đường đọc file khác) |
| `b-id3/../b-cbr` | URL parser chuẩn hoá thành `b-cbr` → 200 hợp lệ |
| File rác (`garbage`) / rỗng, được đăng ký | Protocol vẫn trả bytes (200) — **việc kiểm hợp lệ không nằm ở protocol** |
| Huỷ request giữa chừng (`b-big` 8 MB, đọc chunk đầu rồi `cancel()`) | B/B-min: chunk đầu 65 536 B, **1 stream mở, 1 đóng** (stream được đóng khi huỷ). Toàn bộ run: 38 mở / 38 đóng (không rò stream). A/A0: không đo được (không theo dõi stream) |

Giới hạn: kiểm host khác (`other`) không có trong PoC; chưa thử HEAD, `If-Range`, `Range` song song, tên file Unicode, đường dẫn UNC/dài > 260, ổ mạng/USB rút ra.

## E7. Phát bằng `<audio>` (muted) [T]
Đo `readyState`, `networkState`, `duration`, `currentTime`, `error`, các event và thời gian. Fixture `b-cbr` (CBR không Xing), `b-xing`, `b-vbr` (VBR không Xing), `b-id3`. `ended` = sự kiện nhận trong 2.5 s sau khi phát từ `duration−0.3`.

| Scheme | Metadata (ms) | Duration lúc `loadedmetadata` | Play / Pause / Resume | Seek 0 / giữa / gần cuối | Phát tới hết (`ended`) | Seek vượt (dur+10) | Seek âm (−5) |
|---|---|---|---|---|---|---|---|
| **B** | 9–15 | hữu hạn mọi fixture (cbr 2.997188, xing 3.134694, vbr 3.13125, id3 2.997189) | `play()` resolved; `currentTime` tiến >0.4 s; pause giữ nguyên; resume +0.59–0.62 s | **`currentTime` đến đúng**: giữa 1.499/1.567/1.566; gần cuối 2.697/2.835/2.831 | **có** (4/4) | kẹp về `duration` (≈2.997…3.135), 4/4 | → 0, 4/4 |
| **B-min** | 7–9 | như B | như B | như B | có (4/4) | kẹp về `duration` | → 0 |
| **A** | 6–16 | **`Infinity`** với `b-cbr` và `b-vbr`; hữu hạn với `b-xing`, `b-id3` (từ header) | play/pause/resume chạy (+0.6 s) | **Seek không có tác dụng: `seeked` bắn nhưng `currentTime` về 0** (b-xing, b-id3: giữa/gần cuối/vượt đều 0); `b-cbr`/`b-vbr` duration không hữu hạn lúc metadata → harness bỏ qua seek | không đạt | không đạt | — |
| **A0** | 8–23 | như A | như A | như A (seek về 0) | không đạt | không đạt | — |

Điều rút ra **[T]**:
- Với B, tất cả hành vi cơ bản đạt trên fixture tổng hợp: metadata sẵn sàng trong ~10 ms, duration hữu hạn, phát/pause/resume/seek chính xác tới ±1 ms ở các điểm thử.
- Với A/A0, **seek hỏng** và (CBR/VBR không Xing) duration ban đầu là `Infinity` — nhất quán với việc server trả 200 cho yêu cầu Range (Chromium coi nguồn không seek được) **[I cho cơ chế]**.
- File nhỏ (≈48 KB) được Chromium đệm hết ngay: log yêu cầu cho thấy mỗi `<audio>` chỉ gửi **một** yêu cầu `Range: bytes=0-`. Do đó **chưa chứng minh** rằng seek trên file lớn sẽ phát ra yêu cầu Range mới tới đúng offset và Phương án B xử lý đúng → **[?] cần fixture lớn hơn buffer của Chromium (≳ vài chục MB), nằm ngoài giới hạn 10 MB của lượt này.**
- Duration Chromium vs `music-metadata` (Phase 0.1): CBR 2.997188 vs 3.004 (chênh ≈7 ms); VBR không Xing 3.13125 vs 3.135 (≈3.5 ms); Xing 3.134694 = 3.135 — **[T] chênh nhỏ, cùng bậc**.

Tải lỗi (`LOAD`, 4 s timeout; giống nhau ở cả bốn scheme trừ ghi chú):

| Fixture | Kết quả | `MediaError` |
|---|---|---|
| `b-missing` (404) | `error` sau ~5 ms | **code 4** `DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed` |
| `b-empty` (200, 0 B) | `error` | code 4 (`MEDIA_ELEMENT_ERROR: Format error` ở một lượt; còn lại `COULD_NOT_OPEN`) |
| `b-garbage` | `error` | code 4 `COULD_NOT_OPEN` |
| `b-txt` (404 do registry) | `error` | code 4 `COULD_NOT_OPEN` |
| `b-trunc` (MP3 cắt giữa frame) | **`loadedmetadata`, không lỗi**, duration 1.57625 | — |

⇒ **Mọi lỗi đều là `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4)**: file mất, rỗng, rác, không phải audio **không phân biệt được** qua `MediaError`; muốn thông báo đúng ("file đã bị di chuyển" vs "không giải mã được") thì Main phải tiền kiểm (`resolveBookFile` + kiểm kích thước/đầu file) trước khi đặt `src` **[I → thiết kế]**. File bị cắt cụt **không báo lỗi** (giống `music-metadata`).

## E8. Bộ nhớ [T, giới hạn]
Tổng `workingSetSize` / `privateBytes` của mọi tiến trình Electron (5–6 tiến trình) lấy mỗi 250 ms: bắt đầu ≈153 MB WS / 98 MB private; cao nhất ≈504 MB WS / 238 MB private (giai đoạn fetch); khi nghỉ cuối ≈424 MB WS / 205 MB private. Trong lúc phát (audio) ≈428 MB WS / 210 MB private. **Không rút ra được gì về tác động của kích thước file** vì mọi fixture ≤ 8 MB và biến động chủ yếu là nền của Chromium. **Chưa chứng minh** streaming tiết kiệm RAM với file lớn **[?]**.

## E9. Đề xuất streaming
**Chọn Phương án B** (tự phục vụ `createReadStream` với Range tường minh), vì:
1. [T] Chỉ B cho `206/Content-Range/Content-Length/Accept-Ranges` đúng, `416` đúng, và **seek đúng** trong `<audio>` (A/A0 seek hỏng, duration `Infinity` ở vài fixture).
2. [T] Bảo vệ path: tra bảng id→file + `realpath` trong thư viện + đuôi `.mp3` chặn mọi biến thể thử (traversal, mã hoá, tuyệt đối, symlink, NUL).
3. [T] Huỷ request đóng stream (không rò); 38/38 stream đóng.
4. [T] MIME do Main quyết định; `nosniff`.
5. [T] Scheme tối thiểu (`standard, secure, supportFetchAPI`, không `stream`/`bypassCSP`/`corsEnabled`) vẫn phát và seek đúng trong PoC này → không cần cấp thêm quyền; nhưng đây là quan sát trên **một cấu hình offscreen**, nên giữ `stream` như `rb-cover` nếu chưa có lý do bỏ **[I]**.
Đã biết còn thiếu cho B: tiền kiểm hợp lệ file để báo lỗi đúng; xử lý khoá file trên Windows khi `createReadStream` đang mở (rename/xoá file trong lúc nghe) **[?]**; `If-Range`/HEAD **[?]**.

## E10. Công việc còn thiếu trước Phase 1
1. **Fixture MP3 từ encoder thật** (CBR, VBR+Xing, VBR không Xing, ID3 có bìa) ≥2 file độc lập — vẫn chặn kết luận "phát đúng nội dung".
2. **File lớn (> buffer Chromium, ví dụ vài chục–trăm MB) để kiểm Range thực sự khi seek, RSS không tăng theo kích thước, huỷ request khi seek liên tục** (vượt giới hạn 10 MB của lượt này, cần bạn cho phép riêng).
3. Thử HEAD, `If-Range`, tên file Unicode / đường dẫn dài / UNC / ổ rút ra; khoá file khi đang phát.
4. macOS.
5. Chạy trên **Electron Main thật + ASAR** (bundle `music-metadata`) — chưa làm.
6. Mô hình lỗi: tiền kiểm ở Main vì `MediaError` luôn code 4.
7. Các định dạng khác (FLAC/Opus/WAV/M4A…) bằng file thật — **không** thuộc lượt này.
8. Kiểm chứng foreground liên tục (không chỉ hai điểm) nếu cần chứng minh "không chiếm focus".

## E11. Xác nhận cuối lượt
- `git status --short` giống baseline, hash `git diff` không đổi, không file nào trong repo bị sửa (chỉ file tài liệu này được cập nhật) — xem kết quả đo cuối ở báo cáo trong chat.
- Đã xoá thư mục chạy (`run/`: fixture copy, `big.mp3`, profile, symlink); không còn tiến trình `electron.exe` do PoC sinh ra; các `electron.exe` có sẵn của bạn không bị đụng.
- Không triển khai Phase 1, không thêm `.mp3` vào `SUPPORTED_FORMATS`, không migration, không đổi UI, không commit.

---

## Quyết định của chủ dự án (2026-10-21)
- **Streaming: duyệt Phương án B** (`createReadStream` + Range tường minh, tra id→file trong Main, `realpath` trong thư viện, MIME do Main quyết định).
- **Điều kiện chặn trước Phase 1 vẫn giữ nguyên:**
  1. Chưa có fixture MP3 từ encoder thật → chưa kết luận "phát đúng nội dung".
  2. Chưa thử file lớn (Range khi seek, RSS, huỷ request liên tục).
  3. Chưa thử HEAD / `If-Range` / khoá file Windows / macOS / Main thật + ASAR.
- Các quyết định còn mở: mục P11 và §9 (format theo extension, CHECK/migration, phạm vi MVP, phát nền).
- Trạng thái: chờ fixture thật; không bắt đầu Phase 1.


---

# PHASE 1 — Nền tảng phát audiobook (MP3): kết quả triển khai

Date: 2026-10-21. Phạm vi: chỉ **MP3**. Mọi định dạng khác giữ trạng thái chưa hỗ trợ cho tới khi có file từ encoder thật.
Nhãn: **[V]** đọc trong repo · **[T]** đo/chạy trong phiên này · **[D]** tài liệu · **[I]** suy luận · **[?]** chưa kiểm tra.

## F1. Ma trận khả năng (dựa trên bằng chứng)

Trạng thái: `supported` = phát và hành vi thiết yếu đã xác minh · `conditionally-supported` = phụ thuộc điều kiện phải ghi rõ · `metadata-only` = đọc được metadata, chưa xác minh phát · `unsupported`.

| Định dạng | Trạng thái | Bằng chứng | Điều kiện / giới hạn đã biết |
|---|---|---|---|
| `.mp3` | **conditionally-supported** (đã triển khai) | [T] Electron 39.8.10 / Chromium 142, Windows 11: **một MP3 CBR 128 kbps thật (175 s)** phát, pause/resume, seek đầu/giữa/25 %/gần cuối/vượt/âm, phát tới hết, `webkitAudioDecodedByteCount` tăng (giải mã thật), qua `rb-audio` bằng Range 206. [T] fixture tổng hợp (CBR, VBR±Xing, ID3+bìa, CHAP) cũng phát/seek qua cùng protocol | **Chưa**: MP3 VBR từ encoder thật; seek bắt buộc tải Range mới trên file lớn thật (file thử chỉ 2,8 MB bị đệm hết nên không phát sinh Range khi seek); macOS; bộ nhớ khi phát file lớn thật; mọi lỗi giải mã chỉ ra `MediaError` code 4 (xem F5) |
| `.m4a` | metadata-only | [T] `music-metadata` đọc cấu trúc AAC/ALAC (moov đầu/cuối) trên fixture tổng hợp; payload giả | AAC thuộc nhóm codec độc quyền của Chromium [D]; ALAC không có trong danh sách [D]; không có fixture encoder thật |
| `.m4b` | metadata-only | [T] file thật `LaFloridaDelInca_00-29_LibriVox.m4b` (214 832 689 B, AAC mono 44,1 kHz, 25 510 s): parse container/codec/tag/bìa OK; **không phát được thử** (PoC chỉ MP3) | Chapter: chỉ **một** mục "Chapter 001 - 07:05:10" bắt đầu ở 0, `start` theo `timeScale` thô → **không** có điều hướng chương; không khẳng định hỗ trợ chapter |
| `.aac` (ADTS) | metadata-only | [T] parse fixture tổng hợp; duration chỉ ước lượng (lệch ≈24 ms), mặc định không có duration | Không có chỉ mục → seek kém [I]; payload giả |
| `.wav` | metadata-only | [T] parse PCM16/24/float32 tổng hợp (cảnh báo `Data chunk size exceeds file size` chưa lý giải) | PCM16/float32 có trong danh sách Chromium [D]; PCM24 không thấy; file lớn (RIFF 4 GB) [I] |
| `.flac` | metadata-only | [T] parse FLAC verbatim tổng hợp, có/không SEEKTABLE | Cần FLAC nén thật; SEEKTABLE ảnh hưởng seek [I] |
| `.ogg` (Vorbis) | unsupported (chưa thử) | Không tạo/không có fixture Vorbis | Ogg-Opus mang đuôi `.ogg` parse được [T]; Vorbis [?] |
| `.opus` | metadata-only | [T] parse Ogg-Opus tổng hợp (duration trừ pre-skip) | MIME/đuôi qua protocol [?] |
| `.aiff`/`.aif` | unsupported | [T] parse được; **AIFF không có trong danh sách codec/container của Chromium** [D] | Cần chuyển mã — ngoài phạm vi |
| `.zip` chứa MP3 | **không phải định dạng audio** | Chỉ khảo sát thiết kế (F7) | Chưa triển khai |

Đuôi file **chưa đủ** để nhận diện: `.m4a/.m4b` cùng container nhưng codec khác nhau (AAC-LC, HE-AAC, ALAC); `.ogg` có thể là Vorbis hoặc Opus; `.mp3` có thể là tệp văn bản đổi tên (parser **không ném lỗi** → importer kiểm `format.container`/`codec` và từ chối) [T].

## F2. Đã triển khai

**Hạ tầng / mô hình**
- `DocumentFormat.Mp3 = 'mp3'` + `SUPPORTED_FORMATS` (`.mp3`, `audio/mpeg`) → dialog nhập, `assertSupportedExtension`, `checkRegisteredBookPath`/`resolveBookFile` (đuôi ↔ format) tự cập nhật. Quy tắc dedupe SHA-256, tham chiếu file tại chỗ, bảo vệ đường dẫn **giữ nguyên**.
- **Migration `026_books_audio_format.sql`**: rebuild `books` (nới `CHECK` thêm `'mp3'`; vẫn giữ `docx`/`doc`); đăng ký trong `migrate.ts`.
- Importer `mp3.adapter.ts` (`music-metadata`): title/artist/album/genre/bìa nhúng; thiếu tag → tên file; file không phải MP3 / rỗng / ID3 hỏng → bị từ chối (`corrupted`).
- Giao thức `rb-audio://local/{bookId}`: `audio-stream-handler.ts` (không phụ thuộc Electron, kiểm thử được) + `audio-protocol.ts` (tra thư viện → `resolveBookFile` mỗi request). Phương án B đã duyệt.
- Tiến độ nghe: `reading_state_json.audioProgress` (`{positionSeconds, durationSeconds?, playbackRate, updatedAt}`) + `percent`; ghi bằng `json_patch` ở kênh mới `overlay:saveAudioProgress` (chỉ sách `mp3`, Main tự đóng dấu thời gian, kiểm tra đầu vào); đọc bằng `overlay:getAudioProgress`. Không đụng `lastReadLocation`/`Location`.
- Renderer: `ReaderRoute` (chọn màn theo format; EPUB/PDF/TXT/MD vẫn đi vào `ReaderScreen` **không đổi**), `AudioBookScreen`, `audioPlayerStore` (zustand; một `<audio>` tại một thời điểm).
- Loại audio khỏi luồng văn bản: `openBookContent` trả buffer rỗng sau khi kiểm path (đồng thời là preflight cho thông báo lỗi cụ thể); `isChunkableFormat('mp3') === false` (không trích văn bản/FTS/đếm từ); `canGenerateCover` không có `mp3`.

**Phần SDK thuần (có vitest)**: `src/audio/` — `parseByteRange`, `audioMimeForFormat`/`isAudioFormat`, helpers phát (clamp seek/rate, định dạng thời gian, `resolveRestorePosition`, `shouldPersistProgress`), `audio-progress` (sanitize/parse/patch).

## F3. File đã thay đổi / tạo

Mới: `sdk/src/audio/{byte-range,audio-formats,audio-playback,audio-progress,index}.ts`; `sdk/tests/audio/{byte-range,audio-playback,audio-progress}.test.ts`; `desktop/electron/audio/{audio-stream-handler,audio-protocol}.ts`; `desktop/electron/adapters/mp3.adapter.ts`; `desktop/electron/persistence/migrations/026_books_audio_format.sql`; `desktop/src/screens/AudioBook/{AudioBookScreen.tsx,logic/audioPlayerStore.ts}`; `desktop/src/screens/ReaderRoute.tsx`; `desktop/spikes/audio/{run-audio-main,run-audio-store,run-audio-migration}.mjs`.
Sửa (các file này **đã có thay đổi chưa commit của bạn**; tôi chỉ thêm đúng các dòng cần): `sdk/src/domain/book/document-format.ts`, `sdk/src/persistence/books-json.ts`, `sdk/src/index.ts`, `source/packages/config/formats.ts`, `desktop/electron/{main.ts,preload.ts}`, `desktop/electron/ipc/{channels,api-types,overlay.ipc}.ts`, `desktop/electron/persistence/{migrate.ts,sqlite-overlay-store.ts}`, `desktop/electron/adapters/importer-registry.ts`, `desktop/electron/files/open-book-content.ts`, `desktop/src/{App.tsx,bridge/overlay.ts}`, `desktop/package.json` (chỉ 3 script `spike:audio:*`; **không** đổi dependency), `CLAUDE.md` (mô tả kiến trúc audio + script). Không sửa tài liệu kế hoạch khác ngoài file này.

Không thêm dependency: `music-metadata@12.2.1` đã có sẵn từ trước.

## F4. Kiểm thử đã chạy (kết quả thật)

| Lệnh | Kết quả |
|---|---|
| SDK `npm run verify` (typecheck + test typecheck + vitest + build) | **pass**: 23 file / **374 test** (34 test audio mới) |
| Desktop `npm run typecheck` | pass |
| Desktop `npm run lint` (`--max-warnings 0`) | pass |
| Desktop `npm run e2e:typecheck` (chỉ biên dịch) | pass |
| Desktop `npx vite build` | pass; các parser của `music-metadata` được gộp vào `dist-electron/` |
| `spike:audio:main` | **40 check pass** (với `READMATE_AUDIO_SAMPLE` trỏ tới MP3 thật). Gồm: định dạng/đuôi, importer (tag, bìa, rác, rỗng, ID3 hỏng, thiếu file), dedupe, 200/206/416, header, HEAD/405, id lạ/file mất/sách không phải audio/đuôi bị sửa, symlink, traversal, huỷ response đóng stream, **file 512 MB: range giữa file đọc 1000 B (RSS +0,0 MB); GET toàn phần huỷ sau 4 chunk chỉ đọc 262 144 B (RSS +0,2 MB)**, tiến độ (merge giữ khoá khác, chỉ sách audio, validate IPC), cô lập khỏi chunking/openBookContent |
| `spike:audio:store` | **17 check pass**: store thật + `Audio` giả: preflight, khôi phục vị trí/tốc độ, sách đã hết bắt đầu lại, ghi tiến độ (throttle 5 s, tức thì khi pause/đổi tốc độ/hết/rời sách/đóng cửa sổ), một phần tử tại một thời điểm, load cũ bị bỏ, clamp seek, lỗi phần tử |
| `spike:audio:migration` (Electron làm Node, **không cửa sổ**, better-sqlite3 + FTS5 thật, SQLite 3.53.2) | **12 check pass**: DB đã có 12 bảng dữ liệu (books 5 định dạng, authors, collections, notes, chunks+FTS, txt_documents, pdf_*) → sau 026: số dòng và hash nội dung **bằng nhau ở mọi bảng**, index/trigger/FTS nguyên vẹn và vẫn truy vấn được, `foreign_key_check` và `integrity_check` sạch, `mp3` chèn được, `xyz`/`m4b`/trạng thái sai/JSON sai/SHA trùng vẫn bị từ chối, CASCADE (kể cả trigger FTS) vẫn hoạt động, runner idempotent, DB mới 001–026 cùng schema |
| Hồi quy: `spike:txt:main` (37), `spike:md:main` (12), `spike:pdf:annotations` (39), `spike:pdf:two-way` (21), `spike:reader:toolbar` (35), `spike:signature:status` (23) | **tất cả pass** (chúng chạy trên schema đã có 026) |

**Không chạy**: Electron có cửa sổ, ứng dụng Readmate thật, E2E/Playwright, `electron-builder`/đóng gói, macOS.

## F5. Chưa xác minh (và lý do)

- **UI thật** (`AudioBookScreen`, `ReaderRoute`) chưa được chạy trong ứng dụng — chỉ có typecheck/lint/build và store test với `Audio` giả. Playback thật qua Chromium đã đo ở PoC (cùng giao thức), nhưng ghép nối React + route chưa được nhìn thấy chạy. Cần chạy tay hoặc E2E ẩn khi bạn cho phép.
- **Seek trên file lớn thật**: Range mới do seek sinh ra chưa quan sát được (file 2,8 MB bị đệm hết). Phần phục vụ Range đã được kiểm thử độc lập với file 512 MB, nhưng hành vi Chromium với file lớn thật là [?].
- **MP3 VBR thật** (Xing hoặc không), MP3 có bìa/ID3 phức tạp từ công cụ thật; **macOS**; đóng gói ASAR.
- **Thông báo lỗi**: `MediaError` luôn là code 4, nên chỉ lỗi "file mất / không đọc được" (preflight ở Main) được báo cụ thể; file hỏng giữa chừng chỉ báo thông điệp chung. MP3 bị cắt cụt vẫn mở và phát tới đoạn còn lại, không báo lỗi.
- **Khoá file Windows** khi đang phát (đổi tên/xoá file đang stream), `If-Range`, tên file Unicode rất dài/UNC: chưa thử.
- Quy tắc cũ chưa đổi (chủ ý, "giữ nguyên quy tắc đường dẫn"): với file **managed** (`{userData}/books/{uuid}/`), `resolveBookFile` không `realpath` — một symlink trong thư mục đó trỏ ra ngoài sẽ được theo; chỉ kẻ có quyền ghi vào `userData` mới tạo được. Với file tham chiếu, symlink được theo nhưng đích phải có đúng đuôi `.mp3` [V].

## F6. Bảo mật và file lớn

- Renderer chỉ gửi **bookId**; Main tra thư viện, kiểm `isAudioFormat`, `resolveBookFile` (tuyệt đối, không `\\?\`, đuôi khớp format, realpath cho file tham chiếu, là file thường) **ở mỗi request**; MIME do Main quyết định (`audio/mpeg`) + `nosniff`; id chứa `/`, `\`, NUL, host khác → 404. Không mở quyền Node/fs cho renderer; `contextIsolation`, `sandbox`, `nodeIntegration:false` giữ nguyên. Một kênh IPC ghi mới được kiểm đầu vào (số hữu hạn, trần, `bookId` chuỗi) và giới hạn SQL ở `file_format='mp3'`.
- Không đọc nguyên file vào RAM/IPC: `fs.createReadStream({start,end})` → web stream; huỷ request huỷ stream [T]. `openBookContent` không đọc file audio.
- Scheme `rb-audio` dùng đúng bộ đặc quyền đã đo ở PoC (`standard, secure, supportFetchAPI, stream, corsEnabled`).
- URL/cloud: vì `.mp3` nay nằm trong `SUPPORTED_FORMATS`, import qua URL cũng nhận `.mp3` (tải về `{userData}/books` như các định dạng khác); chưa kiểm giới hạn kích thước ở đường này. Các danh sách gợi ý định dạng trong UI (`LibraryHint`, `ImportUrlDialog`, `LibraryEmptyState`, `CloudSourcesHub`) **chưa** thêm MP3 (cosmetic, nằm ngoài phạm vi).

## F7. Khảo sát ZIP chứa nhiều MP3 (chỉ thiết kế, chưa triển khai)

Mẫu thật: `war_peace1_maude_translation_2212_librivox.zip` — 68 mục, toàn `.mp3` 64 kbps, đặt tên `…_NN_tolstoy_64kb.mp3`, **lưu không nén** (method 0), mỗi file 2,5–10,8 MB, tổng 420 MB [T: chỉ liệt kê, chưa giải nén].

1. **Kiểm tra trước khi giải nén**: đọc *central directory* (không nạp cả file); từ chối nếu mã hoá, đa phần (multi-disk), entry >N (đề xuất ≤ 1 000), tổng kích thước giải nén > trần (đề xuất ≤ 4 GB và ≤ ổ đĩa trống), tỉ lệ nén > ~1,5 trên mục `.mp3` (MP3 đã nén sẵn; tỉ lệ cao là dấu hiệu bom giải nén), kích thước khai báo ≠ kích thước thực, entry lồng zip, thư mục rỗng/không phải `.mp3` (bỏ qua hoặc từ chối cả gói — **cần quyết định**), ZIP64 chỉ khi cần.
2. **Tên entry**: chuẩn hoá và từ chối `..`, tuyệt đối, ổ đĩa (`C:`), `\\?\`, NUL, ký tự điều khiển, symlink (cờ trong external attributes), tên trùng (không phân biệt hoa/thường), tên Windows dành riêng; **không bao giờ** ghép tên entry vào đường dẫn đích — ghi ra tên do app sinh (`{index:03}.mp3`).
3. **Lưu trữ app-owned đề xuất**: `{userData}/audiobooks/{bookUuid}/{001..N}.mp3` (+ `manifest.json` ghi tên gốc, thứ tự, SHA-256, kích thước) — là bản sao *managed* (đúng quy tắc hiện có về file do app tạo), ghi qua thư mục tạm rồi đổi tên nguyên tử; xoá sách → xoá thư mục; lỗi giữa chừng → dọn.
4. **Dựa trên thư viện nào?** `jszip` đã cài **nạp cả file vào RAM** → không hợp với 420 MB. Cần bộ đọc zip dạng stream (thêm dependency, hoặc viết bộ phân tích central directory tối thiểu cho method 0/8): **cần phê duyệt**.
5. **Thứ tự chương**: sắp *natural sort* theo số trong tên; đối chiếu `TRCK` (ID3) nếu có; nếu mơ hồ (không số, trùng số, lỗ hổng) → hiển thị và cho người dùng sắp xếp/xác nhận trước khi nhập; không tự gom file của cùng một thư mục thành một sách (nguyên tắc đã nêu ở Phase 0).
6. **Mô hình dữ liệu**: hiện `books.file_path`/`sha256` là một file duy nhất (SHA unique). Cần quyết định: bảng `book_tracks(book_id, idx, rel_path, sha256, duration_seconds, title)` hay mảng trong `metadata_json`; `books.file_path` trỏ tới thư mục/manifest (đụng `checkRegisteredBookPath`, `resolveBookFile`, `rb-audio` — phải nhận `trackIndex`). Trùng lặp: SHA-256 của gói zip (không còn sau giải nén) hay của manifest; cần định nghĩa.
7. **Tiến độ**: `audioProgress = { trackIndex, positionSeconds, … }` + `percent` toàn sách theo tổng thời lượng các track đã biết; cần thời lượng từng track lúc nhập (`music-metadata` với `duration:true` quét toàn file — tốn I/O, nhưng chỉ làm một lần); phát liên tục giữa các track không ngắt (preload track kế tiếp) cần PoC riêng.
8. **Giới hạn**: chưa có tiện ích zip an toàn trong repo; không khẳng định hỗ trợ ZIP; là pha riêng (Phase 3).

## F8. Quyết định cần bạn duyệt

1. Giữ **`conditionally-supported`** cho `.mp3` cho tới khi có MP3 VBR thật + macOS + seek file lớn thật? (Hiện UI không phân biệt: mọi `.mp3` hợp lệ đều nhập được.)
2. Cho phép **chạy ứng dụng ở chế độ ẩn/offscreen (như E2E hidden mode)** để xem `ReaderRoute`/`AudioBookScreen` hoạt động thật, hay bạn tự chạy `npm run dev`?
3. Thêm "MP3" vào các danh sách gợi ý định dạng trong UI (4 file; 2 file đang có thay đổi chưa commit của bạn)?
4. Giữ `docx`/`doc` trong `CHECK` hay gỡ trong một migration riêng?
5. ZIP: chấp nhận thêm dependency giải nén dạng stream (hoặc viết bộ đọc tối thiểu) cho Phase 3?
6. Chính sách file `.mp3` bị cắt cụt/hỏng nhẹ: hiện vẫn nhập và phát; có muốn quét xác nhận khi nhập (chi phí I/O)?

## F9. Đề xuất giai đoạn kế tiếp

1. (Nhỏ) Xác minh tay/E2E ẩn `AudioBookScreen` + MP3 VBR/bìa thật + seek file lớn thật trên Windows; macOS khi có máy.
2. Phase 2 còn lại: thanh tiến độ/nhãn thời lượng trên thẻ Library (cần ghi `lastReadLocation`-tương-đương hoặc đọc `audioProgress` trong `listBooks`), danh sách định dạng trong UI.
3. Phase 3 (ZIP/nhiều file) theo F7 sau khi quyết định mô hình dữ liệu và dependency.
4. Phase 4 (M4B): cần M4B và M4A **phát được** thật (PoC với `.m4b` cần mở rộng registry/MIME `audio/mp4`) và lớp chuẩn hoá đơn vị chapter.

---

## F10. Xác minh giao diện thật (E2E ẩn) — 2026-10-21

Chạy bằng chế độ ẩn của E2E (`READMATE_E2E_HIDDEN=1`, userData tạm, thêm `setAudioMuted(true)`; tiến trình Electron có `MainWindowHandle = 0`). Spec mới `e2e/specs/audio-reader.spec.ts` (2 test, **pass**, ~20 s): nhập qua "Add file" → mở từ toast → `AudioBookScreen` (tiêu đề/tác giả/bìa `rb-cover://`, duration ≈39 s, không có chrome của text reader) → play/pause/resume → seek bằng slider (lưu ngay cả khi đang pause) → skip −15/+30 → đổi tốc độ → rời sách khi đang phát (vị trí được flush) → vào lại: vị trí và tốc độ khôi phục, không tự phát → mở sách TXT trong cùng phiên (ReaderScreen không đổi) rồi quay lại audiobook → **khởi động lại cả ứng dụng**: vị trí/tốc độ vẫn còn → xoá file: lỗi "could not be found" + "Locate file…" (không phải lỗi media chung). File người dùng không bị đổi (mtime, kích thước). Fixture là MP3 tổng hợp (im lặng), nên đây là bằng chứng nối dây giao diện, không phải về codec.

Lỗi thật tìm được và đã sửa nhờ chạy app thật:
1. **Ứng dụng không khởi động**: `music-metadata` bị gộp vào bundle Main kéo theo `debug` → `require('tty')` ném lỗi lúc nạp (`Calling require for "tty"…`). `npx vite build` vẫn "thành công". Sửa: thêm `music-metadata` vào `external` của `vite.config.ts` (như `better-sqlite3`, `sharp`); chưa kiểm tra bản đóng gói `electron-builder`/ASAR (cần xác minh: `music-metadata` và phụ thuộc của nó phải nằm trong app đã đóng gói).
2. Seek khi đang **pause** không được lưu cho tới khi rời sách (không có timer). Sửa: lưu ngay ở sự kiện `seeked`; thêm check vào `spike:audio:store` (18 check).

Hồi quy (cùng chế độ ẩn): `txt-reader`, `md-reader`, `epub-toc-regression`, `pdf-toc-sync` → 15 pass, 2 fail:
- `md-reader` "E" fail ở một `expect` của chính spec về độ dài fixture (178 661 < 200 000) — không liên quan tới audio.
- `epub-toc-regression` fail (`button[aria-current="location"]` không có). Chạy lại **với `App.tsx` dùng thẳng `ReaderScreen` (không qua `ReaderRoute`)** cho kết quả y hệt → không do `ReaderRoute`. Nguyên nhân chưa xác định (có thể từ các thay đổi chưa commit khác trong `ReaderScreen`/`EpubRenderer`); chưa so với commit sạch.
