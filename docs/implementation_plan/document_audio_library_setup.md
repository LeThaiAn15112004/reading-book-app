# Thư viện cho TXT / Markdown / DOCX / DOC và Audiobook — khảo sát & cài đặt

Date: 2026-10-15.

Status: **chỉ chuẩn bị dependencies.** Chưa có renderer TXT/MD/DOCX/DOC, chưa có audio player. Không đổi UI,
schema, IPC, preload, import pipeline, `SUPPORTED_FORMATS` hay annotation. Các thư viện dưới đây đã nằm trong
`package.json` + lockfile nhưng **chưa được import ở đâu trong app**.

## Môi trường đã kiểm tra

| Thành phần | Phiên bản (thực tế, đo trong máy) |
|---|---|
| Electron | 39.8.10 → Chromium 142.0.7444.265, Node 22.22.1 (trong Electron) |
| Node (CLI dev) | 22.13.0, npm 11.5.2 |
| React / React DOM | 18.3.1 (`^18.2.0`) |
| Vite | 8.1.5; `vite-plugin-electron` bundle Main bằng Rollup (chỉ `better-sqlite3`, `@huggingface/transformers`, `onnxruntime-node`, `sharp`, `pdfjs-dist` là external) |
| Desktop package | `"type": "module"`; renderer `sandbox` + `contextIsolation` |
| Package manager | npm workspaces, lockfile **`source/package-lock.json`** (CI `npm ci` trong `source/`). `apps/reading-book-desktop/package-lock.json` là file cũ từ commit đầu, không còn được dùng — không động vào |

Trước khi cài: không có thư viện Markdown, DOC/DOCX, audio hay metadata audio nào trong dự án (`docx.adapter.ts`,
`doc.adapter.ts`, `txt.adapter.ts`, `md.adapter.ts` chỉ là `createFilenameFallbackImporter` — metadata lấy từ tên
file). Có sẵn `jszip@3.10.1` (mammoth dùng lại, không thêm bản mới).

## Dependencies đã cài

Cài bằng `npm install -w reading-book-desktop …` từ `source/` → `dependencies` của desktop (runtime; được Vite
bundle vào renderer / Main, theo cùng quy ước với `epubjs`, `fast-xml-parser`, `jszip`).

| Package | Phiên bản | Khai báo | Giấy phép | Dùng cho |
|---|---|---|---|---|
| `react-markdown` | 10.1.0 | `^10.1.0` | MIT | Render Markdown → React elements (renderer) |
| `mammoth` | 1.13.0 | `^1.13.0` | BSD-2-Clause | DOCX → HTML ngữ nghĩa (Main, Node) |
| `word-extractor` | 1.0.4 | `^1.0.4` | MIT | Trích xuất văn bản `.doc` (OLE/Word 97+) (Main, Node) |
| `music-metadata` | 12.2.1 | `^12.2.1` | MIT | Metadata audiobook: title/artist/album/duration/chapter/cover (Main, Node) |
| `@types/word-extractor` | 1.0.6 | `^1.0.6` (devDependency) | MIT | Kiểu TS (word-extractor không kèm `.d.ts`) |

Lockfile: 102 entry package mới (94 MIT, 2 ISC, 4 BSD-2-Clause — `mammoth`, `lop`, `option`, `dingbat-to-unicode`,
1 BSD-3-Clause — `sprintf-js`, 1 "BSD" — `duck`). Không dependency trực tiếp nào đổi phiên bản (react 18.3.1,
jszip 3.10.1, `@xmldom/xmldom` 0.9.10, electron 39.8.10, vite 8.1.5, pdfjs-dist 5.4.624 giữ nguyên). Thay đổi
gián tiếp duy nhất: `@ungap/structured-clone` 1.3.3 → 1.4.0 (npm dedupe — `mdast-util-to-hast` cần `^1.0.0`).
`mammoth` kéo `@xmldom/xmldom@0.8.15` lồng riêng (khác major với 0.9.10 của desktop; không xung đột).

**Không cài:** `remark-gfm`, `rehype-raw`, DOMPurify/sanitizer, thư viện phát audio (howler, wavesurfer…),
FFmpeg, thư viện dò encoding (`jschardet`/`chardet`/`iconv-lite`), TTS/STT/AI.

## Đánh giá theo định dạng

### A. TXT — không cần thư viện

| | |
|---|---|
| API | `fs` (đã có qua `resolveBookFile`/`library:openBookContent` → bytes) + `TextDecoder` |
| Bằng chứng | Probe trong Electron 39: `new TextDecoder(x)` dùng được cả Main lẫn renderer sandbox cho `utf-8`, `utf-16le`, `utf-16be`, `windows-1258` (tiếng Việt), `windows-1252`, `gbk`, `shift_jis` |
| Cần thêm | Không |

Việc cần làm khi viết renderer TXT:
- **BOM:** tự dò `EF BB BF` / `FF FE` / `FE FF` để chọn decoder; `TextDecoder` chỉ bỏ BOM khớp đúng encoding của nó.
- **UTF-8 hợp lệ:** `new TextDecoder('utf-8', { fatal: true })` → lỗi thì fallback (gợi ý `windows-1258`, rồi
  `windows-1252`); không cần thư viện dò encoding cho MVP.
- **Rủi ro tiếng Việt cũ:** file TCVN3 (ABC) / VNI là "encoding theo font", **không** có trong `TextDecoder` → sẽ
  hiển thị sai ký tự. Cần bảng chuyển đổi riêng nếu muốn hỗ trợ (không làm ở MVP; nên báo người dùng).
- **Dòng:** chuẩn hoá `\r\n` / `\r` → `\n` trước khi tính `text-offset` Location (offset phải ổn định giữa các lần mở).
- **File lớn:** hiện bytes đi nguyên khối qua IPC (giống PDF); TXT hàng chục MB cần render ảo hoá / chia đoạn,
  không đổ toàn bộ vào một DOM node.

### B. Markdown — `react-markdown@10.1.0` (đã cài), `remark-gfm` (chưa cài)

| | |
|---|---|
| Mục đích | Markdown (CommonMark) → cây React, trong renderer |
| Giấy phép | MIT (cả hệ unified/remark/micromark kéo theo đều MIT) |
| Tương thích | ESM-only (`"type": "module"`), peer `react >= 18` → khớp React 18.3.1; có `index.d.ts` |
| Bằng chứng | Bundle bằng Vite 8 của dự án (build thư viện tạm ngoài repo) rồi chạy trong renderer sandbox Electron 39: `# Chương 1` → `<h1>Chương 1</h1>`, `**đậm**` → `<strong>` |

Giới hạn / ghi chú cho renderer:
- **GFM:** cùng probe, `~~gạch~~` và bảng `| a |` hiện nguyên văn bản thô — CommonMark không có bảng, task list,
  strikethrough, autolink literal. **Đề xuất cài `remark-gfm@4.0.1` (MIT, ESM) khi viết renderer Markdown**, vì
  file `.md` ngoài thực tế (README, ghi chú kỹ thuật — đúng nhóm SDS mô tả cho Markdown) hầu hết viết theo GFM. Chưa cài
  vì task này không có yêu cầu cụ thể.
- **HTML thô trong `.md`:** mặc định react-markdown **không** render HTML (an toàn). Không thêm `rehype-raw`
  trừ khi đi kèm sanitizer.
- **Link/ảnh:** `defaultUrlTransform` đã chặn `javascript:`; link ngoài nên mở bằng `shell.openExternal` qua Main.
  Ảnh đường dẫn tương đối (`./img.png`) **không** tải được — renderer không có path FS; cần protocol/IPC riêng sau này.
- Location `block + range` (SDS) cần gắn id ổn định cho block — dùng `components`/plugin rehype ở giai đoạn renderer.

### C. DOCX — `mammoth@1.13.0` (đã cài)

| | |
|---|---|
| Mục đích | DOCX → HTML ngữ nghĩa (`convertToHtml`), hoặc văn bản thuần (`extractRawText`) |
| Giấy phép | BSD-2-Clause; deps: `jszip` (MIT/GPLv3 dual — dùng MIT, đã có sẵn), `@xmldom/xmldom` (MIT), `lop`, `underscore`, `xmlbuilder`, `argparse`… đều permissive |
| Duy trì | Phát hành đều (1.10 → 1.13 trong 2025–2026); có `.d.ts` riêng |
| Tương thích | CommonJS, Node ≥ 12; chạy trong Main Electron 39 (Node 22.22.1) và bundle được bằng Vite (SSR build tạm ngoài repo) |
| Bằng chứng | File `.docx` tạo bằng Word 2007 (COM, cục bộ): heading, đậm/nghiêng, bảng 2×2, footnote, tiếng Việt có dấu → `<h1>`, `<strong>`, `<em>`, `<table>`, `<ol>` footnote đúng; 1 cảnh báo `w:tblPrEx` bị bỏ qua |

Giới hạn đã biết:
- Chuyển đổi **ngữ nghĩa, không giữ bố cục**: bỏ font, cỡ chữ, màu, căn lề, giãn dòng, cột, header/footer, ngắt
  trang; bảng giữ cấu trúc nhưng bỏ viền/định dạng bảng; text box thành đoạn riêng sau đoạn chứa nó; công thức
  (OMML), SmartArt, chart không được chuyển. Heading chỉ đúng khi tài liệu dùng style Heading thật.
- Ảnh mặc định nhúng `data:` base64 vào HTML → tài liệu nhiều ảnh tốn RAM và IPC; nên dùng `convertImage` để
  tách ảnh ra (ví dụ cache trong `{userData}` + protocol như `rb-cover://`).
- `externalFileAccess` mặc định **tắt** (file tham chiếu bên ngoài tài liệu không được đọc) — giữ nguyên mặc định.
- README cảnh báo tài liệu dựng ác ý có thể gây tốn CPU/RAM → chạy trong worker/utility process + timeout.
- HTML đầu ra đổ vào DOM renderer → cần lọc phần tử/thuộc tính (sanitizer — đánh giá ở giai đoạn renderer).
- Chạy ở **Main** (nhận bytes từ `resolveBookFile`), gửi HTML/AST qua IPC mới — kênh IPC chưa làm.

### D. DOC (Word nhị phân) — `word-extractor@1.0.4` (đã cài, có điều kiện)

| | |
|---|---|
| Mục đích | Trích xuất **văn bản thuần** từ `.doc` OLE (Word 97+): body, footnote, endnote, header/footer, comment, textbox |
| Giấy phép | MIT; deps `saxes` (ISC), `yauzl` (MIT) — pure JS, không native binary |
| Duy trì | **Bản cuối 1.0.4 ngày 2021-07-26** — không phát hành mới hơn 5 năm; ~0,9 triệu lượt tải/tuần |
| Tương thích | CommonJS, `Buffer`; chạy trong Main Electron 39; bundle được bằng Vite (SSR build tạm ngoài repo) |
| Bằng chứng | `.doc` (Word 97-2003) tạo bằng Word 2007 cục bộ: tiếng Việt có dấu đúng hết; bảng → dòng tab-separated; footnote lấy riêng qua `getFootnotes()` |

Lý do cài: là phương án pure-JS, miễn phí, không cần Office/LibreOffice duy nhất đọc đúng `.doc` có tiếng Việt
trong thử nghiệm; giải pháp khác đều cần native/office hoặc cloud (loại theo yêu cầu).

Giới hạn — **chỉ dùng được cho chế độ "văn bản thuần"**, không bao giờ giữ bố cục Word:
- Không heading, không đậm/nghiêng, không danh sách, không ảnh; bảng mất cấu trúc (thành tab).
- Có chuẩn hoá ký tự: em dash `—` thành `-` trong thử nghiệm → văn bản không trùng 100% với bản gốc.
- Chưa thử: file Word 6/95, file mã hoá (password), "fast save", file rất lớn, file do LibreOffice/WPS tạo.
  Chỉ có **một** fixture — cần bộ fixture thật trước khi coi DOC là ổn định.
- Thư viện không còn được bảo trì → nếu gặp lỗi phải tự vá/fork. Nếu bộ fixture thực tế cho kết quả kém, phương
  án dự phòng là cho người dùng tự chuyển DOC → DOCX bằng Word/LibreOffice của họ (không chuyển hộ qua cloud).
- word-extractor cũng đọc được `.docx` nhưng **không** dùng cho DOCX (mammoth đã đảm nhận, có cấu trúc HTML).

### E. Audiobook — phát bằng `HTMLAudioElement` (không cần thư viện phát), metadata bằng `music-metadata@12.2.1`

**Phát:** `canPlayType()` đo trong renderer sandbox Electron 39 (bản Electron dựng ffmpeg có codec AAC/MP3):

| Định dạng | Container / codec | `canPlayType` | Kết luận |
|---|---|---|---|
| `.mp3` | MPEG audio | `probably` | Phát được |
| `.m4a` | MP4 + AAC (`mp4a.40.2`) | `probably` | Phát được |
| `.m4b` | MP4 + AAC (`audio/mp4`) | `maybe` | Phát được khi codec bên trong là AAC (m4b chỉ là m4a đổi đuôi) |
| `.m4a`/`.m4b` | MP4 + **ALAC** | `""` | **Không phát được** |
| `.m4a`/`.m4b` | MP4 + **AC-3 / E-AC-3** | `""` | **Không phát được** |
| `.aac` | ADTS AAC | `probably` | Phát được |
| `.wav` | RIFF PCM (`codecs="1"`) | `probably` | Phát được (WAV nén ADPCM/khác chưa đo) |
| `.ogg` | Vorbis / Opus | `probably` / `probably` | Phát được |
| `.flac` | FLAC | `probably` | Phát được |

`canPlayType` là dự đoán theo MIME/codec, **không** phải bảo đảm: đuôi file không cho biết codec thật (m4a/m4b có
thể là AAC, ALAC, AC-3…). Player phải đọc codec thật (`music-metadata` → `format.codec`) và bắt sự kiện `error` của
`<audio>` để báo "không hỗ trợ codec". Chưa thử phát file âm thanh thật — chỉ đo `canPlayType`.

**Metadata — vì sao cài `music-metadata`:** `<audio>` chỉ cho `duration`; không cho title/artist/album, ảnh bìa
nhúng hay **chapter**. Với M4B, chapter là trải nghiệm cốt lõi và không có API trình duyệt nào đọc được.
`music-metadata` (MIT, phát hành thường xuyên — bản 12.2.1 ngày 2026-10-14):
- Đọc ID3v1/v2 (kèm **ID3v2 Chapters** cho MP3), iTunes/MP4 atoms, Vorbis comment (OGG/FLAC), RIFF/INFO (WAV).
- `includeChapters: true` → parser MP4 đọc **QuickTime chapter track** và **Nero `chpl`** (README bản đã cài);
  `selectCover()` lấy ảnh bìa nhúng.
- ESM-only, `engines.node >= 22`; entry `node` có `parseFile` (đọc theo luồng, không nạp cả file vào RAM). Chạy
  ở **Main** (Node 22.22.1 trong Electron 39 — đạt yêu cầu); bundle được bằng Vite 8 (các parser thành chunk riêng).
- Bằng chứng: trong Main Electron 39, `parseBuffer` WAV PCM 1 giây → `duration = 1`, container `WAVE`, codec
  `PCM`, title từ RIFF INFO đúng.
- **Chưa xác minh M4B chapter thực tế** — máy không có FFmpeg/file m4b có chapter để làm fixture. Khả năng *đọc
  chapter* (music-metadata) và khả năng *phát* (Chromium) là hai việc độc lập: một M4B có thể đọc được chapter
  nhưng không phát được (ALAC/AC-3), hoặc ngược lại phát được nhưng không có chapter (chapter kiểu khác/không có).

Audiobook **không** nằm trong phạm vi MVP 6 định dạng của SDS; `SUPPORTED_FORMATS`/`DocumentFormat` chưa có định
dạng audio — đây chỉ là chuẩn bị.

## Bảng sẵn sàng

| Định dạng | Sẵn sàng về dependencies? | Còn phải đánh giá |
|---|---|---|
| TXT | ✅ (API có sẵn) | TCVN3/VNI; ảo hoá file lớn |
| Markdown | ✅ CommonMark — ⚠️ GFM cần `remark-gfm` | Cài `remark-gfm` khi viết renderer; ảnh tương đối |
| DOCX | ✅ | Sanitizer HTML; tách ảnh; worker + timeout |
| DOC | ⚠️ chỉ văn bản thuần | Bộ fixture thật (Word 95/97–2003, LibreOffice, mã hoá) trước khi coi là ổn định |
| MP3 / AAC / OGG / FLAC / WAV PCM | ✅ phát + metadata | Thử file thật |
| M4A / M4B (AAC) | ✅ phát · ⚠️ chapter chưa thử thực tế | Fixture M4B có chapter (QuickTime + Nero); ALAC/AC-3 không phát được |

## Kiểm tra (2026-10-15)

- `npm run typecheck` (desktop) — pass, trước và sau khi cài.
- `npm run lint` (desktop) — pass (0 warning), trước và sau khi cài.
- `npm run build` — `tsc` pass, `vite build` pass (renderer, Main, preload, workers); **`electron-builder` lỗi**
  `connect ETIMEDOUT 20.205.243.166:443` ở bước `packaging` (tải Electron zip từ GitHub), sau khi rebuild
  `better-sqlite3` thành công. Thử lại riêng `electron-builder` → cùng lỗi mạng. Lỗi môi trường mạng, không liên
  quan dependencies mới (chúng chưa được import nên không vào bundle).
- Các thư viện mới chưa được app import → build hiện tại **không** chứng minh được việc bundle; bằng chứng
  bundle/runtime là các probe tạm ngoài repo nêu trên (Vite 8 + Electron 39 thật của dự án).
- SDK (`book-reader-sdk`) không thay đổi → không chạy lại test SDK.

## Việc chưa làm / đề xuất cho giai đoạn tiếp theo

1. **TXT renderer** (T6.4): decode theo BOM → UTF-8 `fatal` → fallback; chuẩn hoá dòng; `TextOffsetCodec`; ảo hoá.
2. **Markdown renderer** (T6.5): cài `remark-gfm`; id block ổn định cho Location; link ngoài qua Main; không HTML thô.
3. **DOCX** (T6.5a): `mammoth.convertToHtml` ở Main (worker + timeout), `convertImage` tách ảnh, kênh IPC mới trả
   HTML, sanitizer ở renderer, overlay DOM như SDS.
4. **DOC** (T6.5b): thu thập fixture thật → quyết định giữ `word-extractor` (chế độ văn bản thuần, nhãn rõ cho
   người dùng) hay chỉ hướng dẫn tự chuyển sang DOCX.
5. **Audiobook** (ngoài MVP): thêm định dạng audio vào config/domain; đọc metadata ở Main bằng `parseFile` +
   `includeChapters`; phát bằng `<audio>` qua protocol stream file (không gửi cả file qua IPC); kiểm tra codec thật
   trước khi phát; tạo fixture M4B có chapter để xác minh.
6. Cập nhật `import adapters` (`docx/doc/txt/md.adapter.ts`) để lấy metadata thật — chưa làm ở task này.
