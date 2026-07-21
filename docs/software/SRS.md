# Software Requirements Specification (SRS)

**Sản phẩm:** Reading Book App — Trình đọc sách / tài liệu thông minh (Trợ lý tri thức cá nhân)  
**Phiên bản tài liệu:** 1.4  
**Ngày:** 2026-07-20  
**Changelog 1.1:** FR-13 Import từ URL (MVP); cập nhật UC-01, WF-02; FR-36 chuyển thành FR-13.  
**Changelog 1.2:** Phạm vi định dạng MVP = **EPUB, PDF, TXT, Markdown** (4 format; bỏ MOBI/AZW3/DOCX tạm thời).  
**Changelog 1.3:** **FR-14 Collections** — bộ sưu tập user-curated (`COLLECTION` / `COLLECTION_BOOK`); cập nhật BR-06 cascade membership.  
**Changelog 1.4:** **Không tài khoản app** (không email/password, không OAuth2 đăng nhập). Phase 3 **FR-30** = liên kết thư viện ngoài (Google Drive, Google Books, Apple Books) để kéo danh sách tài liệu vào Library local — thay sync account đa thiết bị.  
**Trạng thái:** Draft — căn cứ research + plan MVP Free Core

---


## Mục lục

- [1. Giới thiệu (Introduction)](#1-giới-thiệu-introduction)
  - [1.1. Mục đích](#11-mục-đích)
  - [1.2. Phạm vi sản phẩm](#12-phạm-vi-sản-phẩm)
  - [1.3. Định nghĩa, viết tắt](#13-định-nghĩa-viết-tắt)
  - [1.4. Tài liệu tham khảo](#14-tài-liệu-tham-khảo)
- [2. Mô tả tổng quát (Overall Description)](#2-mô-tả-tổng-quát-overall-description)
  - [2.1. Context Diagram](#21-context-diagram)
  - [2.2. Quan điểm sản phẩm](#22-quan-điểm-sản-phẩm)
  - [2.3. Đặc điểm người dùng (Personas)](#23-đặc-điểm-người-dùng-personas)
  - [2.4. Môi trường vận hành](#24-môi-trường-vận-hành)
  - [2.5. Các ràng buộc](#25-các-ràng-buộc)
  - [2.6. Use Cases (MVP)](#26-use-cases-mvp)
  - [2.7. Main Workflows (MVP)](#27-main-workflows-mvp)
  - [2.8. Business Rules (Quy tắc nghiệp vụ)](#28-business-rules-quy-tắc-nghiệp-vụ)
- [3. Yêu cầu cụ thể (Specific Requirements)](#3-yêu-cầu-cụ-thể-specific-requirements)
  - [3.1. Functional Requirements (FR)](#31-functional-requirements-fr)
  - [3.2. Non-Functional Requirements (NFR)](#32-non-functional-requirements-nfr)

---

## 1. Giới thiệu (Introduction)

### 1.1. Mục đích

Tài liệu SRS này xác định yêu cầu phần mềm cho dự án **reading-book-app**, nhằm:

- Thống nhất tầm nhìn sản phẩm giữa nghiên cứu người dùng, thiết kế và triển khai.
- Làm cơ sở viết **SDS**, backlog triển khai và tiêu chí nghiệm thu (acceptance criteria).
- Phân biệt rõ phạm vi **MVP (P0)**, **Premium (P1)** và **Special (P2)** để tránh scope creep.

Đối tượng đọc: product owner, designer, developer, tester.

### 1.2. Phạm vi sản phẩm

#### Ứng dụng **sẽ làm**

- Cung cấp **không gian đọc yên tĩnh** (content-first, Invisible UI) cho **EPUB, PDF, TXT, Markdown** (4 định dạng chiếm phần lớn nhu cầu thực tế).
- Quản lý **thư viện cá nhân local**, mở nhanh sách đang đọc, lưu **vị trí đọc** chính xác.
- Hỗ trợ **highlight**, **ghi chú**, trang tổng hợp lại dấu ấn tri thức.
- (Sau MVP) Đóng vai **trợ lý tri thức**: AI Chat/RAG theo sách, tóm tắt/giải thích theo yêu cầu, semantic search, flashcards + spaced repetition.
- (Special) **Liên kết thư viện ngoài** (Google Drive, Google Books, Apple Books) để load/đồng bộ danh sách tài liệu vào Library local; auto-tagging (opt-in), thống kê thói quen, kết nối ý tưởng giữa sách.

#### Ứng dụng **sẽ không làm** (out of scope tổng thể / không ưu tiên)

- Marketplace bán sách, DRM store, hay thay thế hoàn toàn Kindle/Apple Books.
- Hỗ trợ MOBI/AZW3, DOCX và các định dạng ít phổ biến khác trong MVP (có thể mở rộng sau).
- Mạng xã hội realtime / feed cộng đồng đầy đủ trong MVP–Premium.
- AI tự động tóm tắt / gắn tag toàn bộ thư viện **mà không có sự đồng ý** của người dùng.
- OCR hàng loạt PDF scan chất lượng thấp (chỉ cân nhắc spike riêng).
- **Tài khoản app** — đăng nhập email/password, Sign-in with Google/Apple (OAuth2) hay bất kỳ identity provider nào cho Reading Book App.
- Đồng bộ cloud kiểu “account đa thiết bị” (progress/note qua server app) trong **MVP**; Phase 3 cũng **không** dùng account app — chỉ connector thư viện ngoài.

### 1.3. Định nghĩa, viết tắt


| Thuật ngữ                    | Định nghĩa                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **MVP**                      | Minimum Viable Product — phiên bản đầu tiên đủ dùng: đọc sạch + thư viện + highlight/note + tiến độ local. |
| **P0 / P1 / P2**             | Mức ưu tiên: P0 = Must (MVP), P1 = Should (Premium), P2 = Could (Special).                                 |
| **Invisible UI**             | Giao diện công cụ ẩn mặc định; chỉ hiện khi người dùng chủ động gọi (tap giữa, bôi chọn).                  |
| **Flow State**               | Trạng thái tập trung sâu vào nội dung; phần mềm “biến mất” khỏi nhận thức.                                 |
| **RAG**                      | Retrieval-Augmented Generation — AI trả lời dựa trên đoạn nội dung được truy xuất từ tài liệu.             |
| **Semantic Search**          | Tìm kiếm theo nghĩa / khái niệm, không chỉ khớp từ khóa hoặc tên file.                                     |
| **Spaced Repetition**        | Ôn tập ngắt quãng để chuyển kiến thức sang trí nhớ dài hạn.                                                |
| **CFI**                      | Canonical Fragment Identifier — định vị vị trí trong EPUB.                                                 |
| **Local-first**              | Dữ liệu ưu tiên lưu trên thiết bị; không phụ thuộc tài khoản app.                                          |
| **External library connector** | Liên kết nguồn thư viện ngoài (Google Drive, Google Books, Apple Books) để kéo danh mục tài liệu vào Library local (Special). |
| **Free / Premium / Special** | Ba tầng gói sản phẩm theo persona và mức AI / connector / ads.                                             |
| **Collector's Guilt**        | Cảm giác tội lỗi khi sưu tầm nhiều tài liệu mà không đọc / không có kế hoạch.                              |


### 1.4. Tài liệu tham khảo


| Tài liệu                | Đường dẫn                                                                                                                | Vai trò                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Nỗi đau khi đọc sách    | [docs/reading-habbit/Nỗi_đau_khi_đọc_sách.md](../reading-habbit/Nỗi_đau_khi_đọc_sách.md)                                 | Pain points P01–P11                               |
| Thói quen người đọc     | [docs/reading-habbit/Thoi_quen_nguoi_doc_sach.md](../reading-habbit/Thoi_quen_nguoi_doc_sach.md)                         | Hành vi → yêu cầu                                 |
| UX of Reading           | [docs/reading-habbit/UX_of_Reading.md](../reading-habbit/UX_of_Reading.md)                                               | Flow, Control, Seamlessness, Invisible Assistance |
| Reader Personas         | [docs/reading-habbit/Reader_Personas_Analysis.md](../reading-habbit/Reader_Personas_Analysis.md)                         | Persona + Free/Premium/Special                    |
| Design System           | [docs/reading-habbit/Reading_App_Design_System.md](../reading-habbit/Reading_App_Design_System.md)                       | UI tokens, don'ts                                 |
| Khoảng trống thị trường | [docs/reading-habbit/Khoang_trong_thi_truong_app_doc_sach.md](../reading-habbit/Khoang_trong_thi_truong_app_doc_sach.md) | Định vị cạnh tranh                                |
| Plan Overview           | [docs/plan/00_Overview_and_Roadmap.md](../plan/00_Overview_and_Roadmap.md)                                               | Roadmap phase                                     |
| Plan Requirements       | [docs/plan/01_Requirements.md](../plan/01_Requirements.md)                                                               | Map pain → FR                                     |


---

## 2. Mô tả tổng quát (Overall Description)

### 2.1. Context Diagram

Biên giới hệ thống chỉ có **hai thực thể ngoài** tương tác với **Reading Book App**:


| Thực thể          | Vai trò                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| **User**          | Người đọc: import sách, đọc, highlight, ghi chú, cấu hình, và chủ động gọi AI khi cần.                      |
| **AI Assistance** | Dịch vụ AI bên ngoài hệ thống: nhận ngữ cảnh/câu hỏi từ app, trả về giải thích, tóm tắt, câu trả lời (RAG). |


Context Diagram — Reading Book App

> Nguồn PlantUML: `[docs/diagram/context/context.puml](../diagram/context/context.puml)`

**Ghi chú biên hệ thống**

- Mọi tương tác AI đều **đi qua app** theo yêu cầu của User; AI không tự động tác động lên thư viện khi User không gọi.
- Các thành phần nội bộ (thư viện local, reader, store) nằm **trong** Reading Book App — không phải thực thể ngoài trên context diagram.
- MVP có thể chưa kết nối AI Assistance; quan hệ User ↔ App vẫn giữ nguyên.

### 2.2. Quan điểm sản phẩm

Hầu hết app đọc hiện nay đóng vai **thùng chứa tài liệu thụ động**: hiển thị PDF/EPUB, tìm theo tên file, để highlight/note bị **cô lập** trong silo, thiếu hỗ trợ ghi nhớ và tìm theo ngữ nghĩa.

Sản phẩm này định vị lại thành **Trợ lý tri thức cá nhân**:

1. **Trước hết** — không gian đọc đạt Flow (giảm P01, P02).
2. **Tiếp theo** — biến highlight/note thành tài sản ôn tập và truy xuất (giảm P03, P05, P08).
3. **Sau cùng** — tổ chức thư viện, liên kết thư viện ngoài, và kết nối ý tưởng đa sách (giảm P04, P07, P10).

Nguyên tắc bất biến: **AI không xâm lấn**; người dùng luôn giữ quyền kiểm soát nội dung gốc (P11).

### 2.3. Đặc điểm người dùng (Personas)


| Persona                            | Nhu cầu cốt lõi                                  | Tính năng trọng tâm                                          | Gói            |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | -------------- |
| **Thợ săn thông tin** (Researcher) | Tìm nhanh số liệu / giải pháp trong tài liệu dài | Chat/RAG, tóm tắt theo chủ đề, semantic search               | Premium        |
| **Nhà chiêm nghiệm** (Deep Reader) | Đọc sâu, ghi chú, không quên sau thời gian       | Reader sạch, highlight, note, flashcards + spaced repetition | Free → Premium |
| **Người sưu tầm** (Collector)      | Thư viện gọn, biết đọc gì tiếp                   | Library, tiến độ, auto-tag (opt-in), gợi ý, linked libraries | Free → Special |
| **Người kết nối** (Social Reader)  | Chia sẻ trích dẫn, thảo luận góc nhìn            | Quote cards, chia sẻ (sau); AI giải thích ngữ cảnh           | Special / sau  |


### 2.4. Môi trường vận hành

Sản phẩm triển khai trên monorepo hiện có:


| Nền tảng                        | Công nghệ                                   | Ghi chú                            |
| ------------------------------- | ------------------------------------------- | ---------------------------------- |
| **Desktop (ưu tiên MVP)**       | Electron + Vite + React + TypeScript        | `source/apps/reading-book-desktop` |
| **Mobile (sau MVP desktop ổn)** | Expo + React Native + Expo Router           | `source/apps/reading-book-mobile`  |
| **Domain dùng chung**           | `source/packages/domain`, `shared`, `config` | Tránh lệch model giữa app          |


**Lưu ý:** Tài liệu Design System có đề cập gợi ý tối ưu render (.NET). **Yêu cầu vận hành chính thức của dự án này** bám stack Electron/Expo ở trên; SDS sẽ chi tiết hóa engine EPUB, persistence và IPC.

### 2.5. Các ràng buộc


| Loại                        | Ràng buộc                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------- |
| **Phạm vi MVP**             | Không AI, không connector thư viện ngoài, không social; 4 định dạng: EPUB, PDF, TXT, Markdown. |
| **Kỹ thuật**                | Local-first; path file sandbox qua Electron main process; không remote code tùy ý.    |
| **UX**                      | Không popup giữa phiên đọc; không animation gây xao nhãng; tuân Design System don'ts. |
| **Thời gian**               | Phase 1 hoàn thành khi DoD ở mục 6.1 đạt — trước khi mở Phase 2 AI.                   |
| **Ngân sách / vận hành AI** | Chi phí LLM và embedding thuộc Premium; MVP không phụ thuộc API trả phí.              |
| **Dữ liệu / identity**      | MVP chỉ lưu local; **không** tài khoản app (email/password hay OAuth2). Connector Google Drive / Books / Apple Books = Phase 3. |


### 2.6. Use Cases (MVP)

Actor duy nhất: **User**. Quan hệ **extend**: Highlight, Note, Đánh dấu là tùy chọn trong lúc **Đọc sách**.

#### 2.6.1. Use Case Diagram

Use Case Diagram — Reading Book App (MVP)

> Nguồn PlantUML: `[docs/diagram/use-case/use-case.puml](../diagram/use-case/use-case.puml)`

#### 2.6.2. Danh sách Use Case


| ID        | Tên Use Case | Actor | Mối quan hệ      | Mô tả ngắn                                      | WF / FR liên quan                |
| --------- | ------------ | ----- | ---------------- | ----------------------------------------------- | -------------------------------- |
| **UC-01** | Import sách  | User  | —                | Thêm tài liệu từ file máy hoặc URL vào thư viện local | WF-02, FR-01, FR-13          |
| **UC-02** | Đọc sách     | User  | Base             | Mở sách, đọc, lưu vị trí / preference           | WF-01, WF-03, FR-02–FR-05, FR-10 |
| **UC-03** | Highlight    | User  | **extend** UC-02 | Bôi chọn và lưu highlight tại đoạn đang đọc     | WF-04, FR-06                     |
| **UC-04** | Note         | User  | **extend** UC-02 | Gắn ghi chú văn bản vào đoạn đang đọc           | WF-04, FR-07                     |
| **UC-05** | Đánh dấu     | User  | **extend** UC-02 | Đánh dấu trang / vị trí để quay lại nhanh       | WF-03, FR-11                     |
| **UC-06** | Xem note     | User  | —                | Xem danh sách note/highlight; nhảy về đúng đoạn | WF-04, FR-09                     |


#### 2.6.3. Use Case Specification

##### UC-01 — Import sách


| Mục                            | Nội dung                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| **ID / Tên**                   | UC-01 Import sách                                                                                |
| **Actor**                      | User                                                                                             |
| **Mục đích**                   | Thêm tài liệu vào thư viện cá nhân local từ **file trên máy** hoặc **URL** (download → sandbox) |
| **Độ ưu tiên**                 | P0 (MVP)                                                                                         |
| **Tiền điều kiện**             | App đã mở; User ở Library (hoặc màn có nút Import / Add)                                         |
| **Hậu điều kiện (thành công)** | File nằm trong app data; metadata + bản ghi thư viện đã lưu; sách hiện trong Library; đọc offline |
| **Hậu điều kiện (thất bại)**   | Không tạo bản ghi rỗng; User nhận thông báo lỗi rõ                                               |


**Luồng chính — From device**

1. User chọn **Add** → **From this device** (hoặc **Import** / **Add file**).
2. Hệ thống mở File Picker (định dạng hỗ trợ: EPUB, PDF, TXT, Markdown).
3. User chọn file hợp lệ.
4. Hệ thống kiểm tra file, copy vào app data, trích metadata, lưu SQLite (SHA-256).
5. Hệ thống hiển thị sách mới trong Library.

**Luồng chính — From URL**

1. User chọn **Add** → **From link**.
2. User dán URL trực tiếp tới file (ưu tiên `https://`).
3. Hệ thống (Main) download file về temp/sandbox, suy ra format, kiểm tra hợp lệ.
4. Hệ thống chạy cùng bước metadata + SHA + SQLite như import file.
5. Hệ thống hiển thị sách mới trong Library; optional lưu `source_url`.

**Ngoại lệ**

- **E1 — User hủy picker / dialog URL:** Quay Library, không đổi dữ liệu.
- **E2 — File / URL không hợp lệ:** Báo lỗi; cho thử lại / kết thúc tạm.
- **E3 — Trùng sách (SHA-256):** Thông báo; không nhân đôi (chi tiết SDS).
- **E4 — Lỗi mạng / timeout / quá dung lượng (URL):** Báo lỗi; xóa temp; không bản ghi rỗng.
- **E5 — URL không phải direct file (HTML trang web):** Từ chối với thông báo rõ — không scrape bookstore.

---

##### UC-02 — Đọc sách


| Mục                            | Nội dung                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| **ID / Tên**                   | UC-02 Đọc sách                                                   |
| **Actor**                      | User                                                             |
| **Mục đích**                   | Đọc nội dung trong Reader (Invisible UI); lưu & khôi phục vị trí |
| **Độ ưu tiên**                 | P0 (MVP)                                                         |
| **Tiền điều kiện**             | Có ít nhất một sách trong thư viện (sau UC-01)                   |
| **Hậu điều kiện (thành công)** | Progress đã flush local; lần sau mở lại đúng CFI/offset          |
| **Extension points**           | Khi bôi chọn text → UC-03 / UC-04; khi đánh dấu trang → UC-05    |


**Luồng chính**

1. User chọn sách (hoặc Continue Reading) từ Library.
2. Hệ thống mở Reader; chrome ẩn mặc định; khôi phục vị trí nếu có.
3. User lật / cuộn trang; hệ thống cập nhật vị trí đọc.
4. (Tuỳ chọn) User đổi theme / font; hệ thống lưu Reading Preferences.
5. User thoát sách / đóng app; hệ thống flush progress.

**Ngoại lệ**

- **E1 — File sách mất / hỏng:** Báo lỗi; không crash.
- **E2 — Crash giữa phiên:** Giữ vị trí autosave gần nhất.

---

##### UC-03 — Highlight *(extends UC-02)*


| Mục                  | Nội dung                                     |
| -------------------- | -------------------------------------------- |
| **ID / Tên**         | UC-03 Highlight                              |
| **Actor**            | User                                         |
| **Mục đích**         | Lưu đoạn text đã bôi chọn làm highlight      |
| **Độ ưu tiên**       | P0 (MVP)                                     |
| **Tiền điều kiện**   | Đang ở UC-02 (Reader đang mở)                |
| **Điều kiện extend** | User bôi chọn text và chọn Highlight         |
| **Hậu điều kiện**    | Highlight + CFI lưu local; User tiếp tục đọc |


**Luồng chính**

1. User bôi chọn text trong Reader.
2. Hệ thống hiện context menu.
3. User chọn **Highlight**.
4. Hệ thống lưu highlight local (≤ 2 thao tác từ selection).

---

##### UC-04 — Note *(extends UC-02)*


| Mục                  | Nội dung                              |
| -------------------- | ------------------------------------- |
| **ID / Tên**         | UC-04 Note                            |
| **Actor**            | User                                  |
| **Mục đích**         | Gắn ghi chú văn bản vào đoạn đang đọc |
| **Độ ưu tiên**       | P0 (MVP)                              |
| **Tiền điều kiện**   | Đang ở UC-02                          |
| **Điều kiện extend** | User bôi chọn text và chọn Note       |
| **Hậu điều kiện**    | Note gắn đoạn + CFI lưu local         |


**Luồng chính**

1. User bôi chọn text → chọn **Note**.
2. User nhập nội dung ghi chú.
3. Hệ thống lưu note local; quay lại Reader.

**Ngoại lệ**

- **E1 — Note rỗng:** Không tạo bản ghi (hoặc chỉ giữ highlight nếu có — SDS).

---

##### UC-05 — Đánh dấu *(extends UC-02)*


| Mục                  | Nội dung                                           |
| -------------------- | -------------------------------------------------- |
| **ID / Tên**         | UC-05 Đánh dấu                                     |
| **Actor**            | User                                               |
| **Mục đích**         | Đánh dấu trang / vị trí hiện tại để quay lại nhanh |
| **Độ ưu tiên**       | P0 (MVP)                                           |
| **Tiền điều kiện**   | Đang ở UC-02                                       |
| **Điều kiện extend** | User chủ động chọn Đánh dấu (bookmark)             |
| **Hậu điều kiện**    | Bookmark + vị trí (CFI) lưu local                  |


**Luồng chính**

1. User mở toolbar / menu trong Reader.
2. User chọn **Đánh dấu**.
3. Hệ thống lưu bookmark tại vị trí hiện tại.

---

##### UC-06 — Xem note


| Mục                | Nội dung                                                     |
| ------------------ | ------------------------------------------------------------ |
| **ID / Tên**       | UC-06 Xem note                                               |
| **Actor**          | User                                                         |
| **Mục đích**       | Xem lại note / highlight theo sách và nhảy về đúng đoạn      |
| **Độ ưu tiên**     | P0 (MVP)                                                     |
| **Tiền điều kiện** | Có ít nhất một note hoặc highlight (sau UC-03 / UC-04)       |
| **Hậu điều kiện**  | User đang ở đúng vị trí đoạn đã chọn trong Reader (nếu Jump) |


**Luồng chính**

1. User mở **Highlights & Notes** (từ Reader hoặc Library).
2. Hệ thống liệt kê theo sách.
3. User chọn một mục.
4. Hệ thống Jump tới đúng CFI trong Reader.

**Ngoại lệ**

- **E1 — Vị trí không còn tồn tại:** Báo không tìm thấy đoạn; vẫn giữ nội dung note/highlight.

---

### 2.7. Main Workflows (MVP)

MVP gồm **4 luồng chính**. Persona chỉ dùng khi phân tích thiết kế; runtime **không** lưu hay nhận diện persona.


| ID        | Tên           | Mục đích                                              | FR liên quan        |
| --------- | ------------- | ----------------------------------------------------- | ------------------- |
| **WF-01** | Library (hub) | Vào app → tìm sách đang đọc / chọn sách / sang Import / Collections | FR-08, FR-10, FR-14 |
| **WF-02** | Import sách   | Thêm tài liệu từ file máy hoặc URL vào thư viện local | FR-01, FR-13        |
| **WF-03** | Phiên đọc     | Đọc sạch (Invisible UI), lưu & khôi phục vị trí       | FR-02–FR-05, FR-10  |
| **WF-04** | Nắm tri thức  | Highlight / note → xem lại → nhảy về đúng đoạn        | FR-06, FR-07, FR-09 |


Tổng quan Main Workflows (MVP)

> Nguồn PlantUML: `[docs/diagram/overview-mvp/overview.puml](../diagram/overview-mvp/overview.puml)`

---

#### WF-01 — Library (hub)

**Mục đích:** Điểm vào sau khi mở app — tiếp tục sách đang đọc, chọn sách khác, hoặc sang Import.  
**Trigger:** User mở app / quay về Library từ Reader.  
**Kết thúc thành công:** Reader mở đúng sách (và đúng vị trí nếu Continue Reading).


| Bước | Hành động                     | Kết quả mong đợi                                      |
| ---- | ----------------------------- | ----------------------------------------------------- |
| 1    | Hiển thị Library              | Danh sách sách local + vùng Continue Reading (nếu có) |
| 2a   | Chọn Continue Reading         | Mở sách gần nhất đúng CFI/offset đã lưu               |
| 2b   | Chọn một sách trong danh sách | Mở Reader tại vị trí đã lưu của sách đó               |
| 2c   | Chọn Import                   | Chuyển sang **WF-02**                                 |
| 3    | (Sau Import thành công)       | Quay lại Library; sách mới xuất hiện trong danh sách  |


WF-01 — Library (hub)

> Nguồn PlantUML: `[docs/diagram/wf-01-library/wf-01.puml](../diagram/wf-01-library/wf-01.puml)`

**Ngoại lệ**

- Thư viện trống → chỉ hiện CTA Import (không hiện Continue Reading).
- File sách bị mất / hỏng khi mở → báo lỗi rõ; không crash; giữ entry hoặc đề xuất xóa / import lại.

---

#### WF-02 — Import sách

**Mục đích:** Thêm tài liệu vào thư viện local từ **file máy** hoặc **URL** (download → copy app data + metadata).  
**Trigger:** User bấm Add / Import từ Library (**WF-01**).  
**Kết thúc thành công:** Sách xuất hiện trong Library; User quay lại **WF-01**; đọc được offline.


| Bước | Hành động                    | Kết quả mong đợi                                                      |
| ---- | ---------------------------- | --------------------------------------------------------------------- |
| 1    | Từ Library — Bấm Add/Import  | Bắt đầu WF-02                                                         |
| 2    | Chọn nguồn                   | **Device** → File Picker · **URL** → dialog nhập link                 |
| 3    | User hủy?                    | Có → Kết thúc, Library không đổi                                      |
| 4a   | (Device) File hợp lệ?        | Không → báo lỗi; Có → copy App Data                                   |
| 4b   | (URL) Download + format OK?  | Không → báo lỗi mạng/format; Có → ghi App Data                        |
| 5    | Trích xuất Metadata          | Title, author, cover (nếu có); optional `source_url` nếu từ URL       |
| 6    | SHA-256 / trùng?             | Trùng → thông báo, không nhân đôi; Không → lưu SQLite                 |
| 7    | Lưu bản ghi                  | Library + progress mặc định (0%)                                      |
| —    | Kết thúc                     | Quay Library; sách mới hiện trong danh sách                           |


WF-02 — Import sách

> Nguồn PlantUML: `[docs/diagram/wf-02-import/wf-02.puml](../diagram/wf-02-import/wf-02.puml)` *(cập nhật diagram khi chỉnh nhánh URL)*

**Ngoại lệ**

- User hủy picker / dialog URL → không tạo bản ghi rỗng.
- Trùng sách (cùng hash) → thông báo; không nhân đôi bản ghi (hoặc hỏi mở sách cũ — SDS).
- Thiếu metadata → vẫn import; dùng tên file làm title tạm.
- URL không phải direct file / lỗi mạng → thông báo rõ; không scrape HTML.

---

#### WF-03 — Phiên đọc

**Mục đích:** Đọc trong không gian yên tĩnh (Invisible UI); tiến độ và preference được lưu local.  
**Trigger:** User mở sách từ Library (**WF-01**).  
**Kết thúc thành công:** Thoát phiên với progress đã flush; lần sau mở lại đúng chỗ.


| Bước | Hành động                             | Kết quả mong đợi                              |
| ---- | ------------------------------------- | --------------------------------------------- |
| 1    | Mở Reader                             | Nội dung EPUB render; chrome **ẩn** mặc định  |
| 2    | Lật / cuộn trang                      | Điều hướng mượt; cập nhật vị trí (CFI/offset) |
| 3    | Tap giữa màn hình                     | Hiện / ẩn toolbar (không popup)               |
| 4    | Đổi theme / font / size / line-height | Áp dụng ngay; lưu Reading Preferences         |
| 5    | Bôi chọn text                         | Có thể sang **WF-04** (Highlight / Note)      |
| 6    | Thoát sách / đóng app                 | Flush progress local trước khi rời            |
| 7    | Mở lại cùng sách                      | Khôi phục đúng CFI/offset                     |


WF-03 — Phiên đọc

> Nguồn PlantUML: `[docs/diagram/wf-03-reading-session/wf-03.puml](../diagram/wf-03-reading-session/wf-03.puml)`

**Ngoại lệ / ràng buộc UX**

- Không popup giữa phiên (rate app, promo, ads trong vùng đọc — theo NFR-02).
- Mất điện / crash → tối thiểu giữ được vị trí đã autosave gần nhất.
- Đổi theme không reload toàn bộ document (NFR-03).

---

#### WF-04 — Nắm tri thức

**Mục đích:** Biến đoạn đang đọc thành highlight/note; xem lại và nhảy về đúng vị trí.  
**Trigger:** User bôi chọn text trong Reader (**WF-03**), hoặc mở trang Highlights & Notes.  
**Kết thúc thành công:** Dấu ấn lưu local; từ danh sách Review nhảy đúng đoạn trong Reader.


| Bước | Hành động             | Kết quả mong đợi                               |
| ---- | --------------------- | ---------------------------------------------- |
| 1    | Bôi chọn text         | Hiện context menu (≤ 2 thao tác tới Highlight) |
| 2a   | Chọn Highlight        | Lưu highlight + vị trí (CFI) local             |
| 2b   | Chọn Note             | Nhập nội dung → lưu note gắn đoạn              |
| 3    | Tiếp tục đọc          | Quay Reader; không phá flow                    |
| 4    | Mở Highlights & Notes | Danh sách theo sách (từ Reader hoặc Library)   |
| 5    | Chọn một mục          | Jump tới đúng vị trí trong Reader              |
| 6    | (Tuỳ chọn) Sửa / xóa  | Cập nhật hoặc xóa bản ghi local                |


WF-04 — Nắm tri thức

> Nguồn PlantUML: `[docs/diagram/wf-04-knowledge/wf-04.puml](../diagram/wf-04-knowledge/wf-04.puml)`

**Ngoại lệ**

- Note rỗng khi lưu → không tạo bản ghi (hoặc chỉ tạo highlight nếu User đã chọn cả hai — chi tiết SDS).
- Mục Review trỏ tới vị trí không còn tồn tại (sách thay file) → báo không tìm thấy đoạn; vẫn giữ nội dung note/highlight.

---

### 2.8. Business Rules (Quy tắc nghiệp vụ)

Các quy tắc dưới đây **bắt buộc** với mọi UC / WF liên quan. SDS và implementation phải tuân thủ; vi phạm coi như defect.


| ID        | Quy tắc nghiệp vụ                                                                                                                                | Phạm vi áp dụng           | Phase                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------- |
| **BR-01** | **Bất biến dữ liệu:** Mọi file sách gốc (EPUB/PDF/TXT/MD) được lưu ở trạng thái **Read-Only**. Hệ thống cấm mọi thao tác ghi đè lên file gốc. | Import, Reader, AI/Audio  | MVP →                       |
| **BR-02** | **Cơ chế Overlay:** Mọi thay đổi (Theme, Highlight, Note) được xử lý qua lớp phủ (Overlay) lưu trong **SQLite** và áp dụng ở **runtime**.        | UC-02–UC-06, WF-03, WF-04 | MVP                         |
| **BR-03** | **Tính duy nhất:** Sử dụng **Hash (SHA-256)** để ngăn chặn việc import trùng lặp file sách.                                                      | UC-01, WF-02              | MVP                         |
| **BR-04** | **Chuẩn hóa hiển thị:** EPUB/TXT/Markdown render **Reflowable**; PDF render **Fixed-layout Overlay**.                                             | Reader (FR-02)            | MVP                         |
| **BR-05** | **Tính tương phản:** Khi thay đổi Background, hệ thống **tự động điều chỉnh màu Text** theo bảng màu định sẵn để đảm bảo độ đọc (Accessibility). | UC-02 theme, NFR contrast | MVP                         |
| **BR-06** | **Tính toàn vẹn (Cascade):** Khi xóa một cuốn sách, hệ thống phải **tự động xóa sạch** Note, Highlight, Bookmark, membership collection (`COLLECTION_BOOK`) và dữ liệu liên quan trong DB. Xóa collection chỉ gỡ membership — **không** xóa sách. | Library / Collections / xóa sách | MVP |
| **BR-07** | **Xử lý AI/Audio:** AI tóm tắt và Text-to-Speech chỉ thực hiện trên **nội dung văn bản đã bóc tách**, không làm ảnh hưởng đến tệp gốc.           | AI / TTS                  | Premium+ (sau MVP)          |
| **BR-08** | **Không identity app:** Ứng dụng **không** tạo / yêu cầu tài khoản Reading Book App — cấm đăng nhập email/password và cấm OAuth2 (Sign in with Google/Apple/…) làm identity. Phase 3 chỉ **liên kết thư viện ngoài** (FR-30). | Settings / FR-30 / NFR-11 | MVP → |


**Ghi chú triển khai**

- **BR-01 + BR-02 + BR-07:** File gốc bất biến; mọi annotation / theme / AI output là dữ liệu phụ (SQLite / cache), không mutate EPUB/PDF trên đĩa.
- **BR-03:** Khi hash trùng → thông báo User; không tạo bản ghi thư viện thứ hai (khớp ngoại lệ WF-02).
- **BR-05:** Không cho User chọn tổ hợp nền/chữ phá contrast tối thiểu (Design System / NFR-07).
- **BR-06:** Xóa sách = transaction cascade (file app-data + metadata + note/highlight/bookmark + `collection_books`); không để orphan records. Xóa collection cascade `collection_books` nhưng giữ `books`.
- **BR-08:** Không màn Sign in / Log out identity; unlink connector thư viện ngoài **không** xóa thư viện / overlay local đã import.

---

## 3. Yêu cầu cụ thể (Specific Requirements)

### 3.1. Functional Requirements (FR)

Quy ước ưu tiên: **P0 = Must (MVP)**, **P1 = Should (Premium)**, **P2 = Could (Special)**.  
Mỗi FR P0 có acceptance criteria kiểm thử được; map tới UC / WF / BR liên quan.

#### 3.1.1. MVP — Phase 1 (P0)


| ID        | Tên                                                    | UC / WF      | BR           | Pain / Habit |
| --------- | ------------------------------------------------------ | ------------ | ------------ | ------------ |
| **FR-01** | Import từ file máy vào thư viện local                  | UC-01, WF-02 | BR-01, BR-03 | P04, P06     |
| **FR-02** | Mở sách và render nội dung                             | UC-02, WF-03 | BR-04        | P01, P02     |
| **FR-03** | Lật trang / cuộn mượt, UI ẩn mặc định                  | UC-02, WF-03 | —            | P01, P02     |
| **FR-04** | Theme light / sepia / dark + font / size / line-height | UC-02, WF-03 | BR-02, BR-05 | Habit #7     |
| **FR-05** | Lưu & khôi phục vị trí đọc                             | UC-02, WF-03 | BR-02        | Habit #1     |
| **FR-06** | Highlight selection (≤ 2 thao tác)                     | UC-03, WF-04 | BR-02        | Habit #3     |
| **FR-07** | Thêm / sửa / xóa note gắn đoạn                         | UC-04, WF-04 | BR-02        | Habit #4     |
| **FR-08** | Danh sách thư viện + Continue Reading                  | UC-02, WF-01 | —            | Habit #2     |
| **FR-09** | Trang tổng hợp highlight & note theo sách              | UC-06, WF-04 | —            | Habit #6     |
| **FR-10** | Progress bar mỏng / % hoàn thành                       | WF-01, WF-03 | —            | Habit #8     |
| **FR-11** | Đánh dấu trang (bookmark)                              | UC-05        | BR-02        | note.txt     |
| **FR-12** | Xóa sách kèm cascade dữ liệu liên quan                 | WF-01        | BR-06        | P04          |
| **FR-13** | Import từ URL (direct file → sandbox local)            | UC-01, WF-02 | BR-01, BR-03 | note.txt     |
| **FR-14** | Collections — tạo tập sách do user gom                 | WF-01        | BR-06        | Collector    |


##### FR-01 — Import từ file máy vào thư viện local

- **Story:** As a User, I want to import a supported document from my device, so that it appears in my personal library.
- **Acceptance:**
  - Given User ở Library, When chọn Import from device và file hợp lệ (EPUB/PDF/TXT/MD), Then sách xuất hiện sau khi copy + metadata + lưu DB.
  - Given file không hợp lệ hoặc User hủy, Then không tạo bản ghi rỗng.
  - Given file có SHA-256 trùng sách đã có (**BR-03**), Then hệ thống báo trùng và không nhân đôi.
- **Priority / Phase:** Must / 1

##### FR-13 — Import từ URL (direct file)

- **Story:** As a User, I want to paste a direct link to a book/document file, so that the app downloads it into my local library and I can read offline.
- **Acceptance:**
  - Given User nhập URL `https` trỏ tới file hỗ trợ, When import, Then file được tải về sandbox (Main), metadata lưu DB, sách hiện Library; đọc offline không cần mạng.
  - Given URL lỗi / không phải direct file / format không hỗ trợ / timeout, Then thông báo rõ; không tạo bản ghi rỗng; temp được dọn.
  - Given nội dung tải về có SHA trùng sách đã có (**BR-03**), Then báo trùng; không nhân đôi.
  - Given import từ URL thành công, Then có thể lưu `source_url` tham chiếu; **không** tự re-download mỗi lần mở Reader.
  - Given UI Import, When quan sát, Then **không** có bookstore / mua sách / browse catalog.
- **Priority / Phase:** Must / 1

##### FR-02 — Mở sách và render nội dung

- **Story:** As a User, I want to open a book and read its content, so that I can immerse in the text.
- **Acceptance:**
  - Given sách EPUB/TXT/Markdown trong thư viện, When User mở sách, Then nội dung render **Reflowable** (**BR-04**); file gốc không bị ghi đè (**BR-01**).
  - Given sách PDF trong thư viện, When User mở sách, Then nội dung render **Fixed-layout** (**BR-04**); file gốc không bị ghi đè (**BR-01**).
  - Given mở sách, When Reader hiện, Then chrome ẩn mặc định (Invisible UI).
- **Priority / Phase:** Must / 1

##### FR-03 — Lật trang / cuộn mượt, UI ẩn mặc định

- **Story:** As a User, I want fast page turn / scroll with minimal chrome, so that reading flow is not interrupted.
- **Acceptance:**
  - Given đang đọc, When lật / cuộn, Then điều hướng mượt; không popup giữa phiên (**NFR-02**).
  - Given chrome ẩn, When tap giữa màn hình, Then hiện / ẩn toolbar.
- **Priority / Phase:** Must / 1

##### FR-04 — Theme và typography

- **Story:** As a User, I want to change background theme and text size, so that reading is comfortable for my eyes.
- **Acceptance:**
  - Given đang đọc, When chọn light / sepia / dark, Then nền đổi và **màu chữ tự điều chỉnh** theo bảng định sẵn (**BR-05**).
  - Given đổi font / size / line-height, When áp dụng, Then không reload toàn bộ document (**NFR-03**); preference lưu local (**BR-02**).
- **Priority / Phase:** Must / 1

##### FR-05 — Lưu & khôi phục vị trí đọc

- **Story:** As a User, I want the app to remember where I left off, so that I can resume instantly.
- **Acceptance:**
  - Given đang đọc, When thoát sách / đóng app, Then vị trí (CFI/offset) đã flush local.
  - Given mở lại cùng sách, When Reader load, Then khôi phục đúng vị trí đã lưu.
- **Priority / Phase:** Must / 1

##### FR-06 — Highlight

- **Story:** As a User, I want to highlight text in ≤ 2 actions, so that marking insight does not break flow.
- **Acceptance:**
  - Given đang đọc, When bôi chọn text và chọn Highlight, Then highlight + CFI lưu SQLite overlay (**BR-02**); file gốc không đổi (**BR-01**).
  - Given selection, When hoàn tất Highlight, Then số thao tác từ selection ≤ 2.
- **Priority / Phase:** Must / 1

##### FR-07 — Note gắn đoạn

- **Story:** As a User, I want to add / edit / delete a text note on a passage, so that I can capture my thoughts in context.
- **Acceptance:**
  - Given selection, When thêm Note có nội dung, Then note + CFI lưu local.
  - Given note tồn tại, When sửa hoặc xóa, Then DB cập nhật đúng; note rỗng không được tạo mới.
- **Priority / Phase:** Must / 1

##### FR-08 — Library + Continue Reading

- **Story:** As a User, I want a library list and a Continue Reading entry, so that I can jump back into books quickly.
- **Acceptance:**
  - Given có ≥ 1 sách, When mở Library, Then thấy danh sách sách local.
  - Given có sách gần nhất, When chọn Continue Reading, Then mở đúng sách + đúng vị trí.
  - Given thư viện trống, When mở Library, Then chỉ hiện CTA Import.
- **Priority / Phase:** Must / 1

##### FR-09 — Tổng hợp highlight & note

- **Story:** As a User, I want a list of highlights and notes per book, so that I can review and jump back to the passage.
- **Acceptance:**
  - Given có highlight/note, When mở Highlights & Notes, Then liệt kê theo sách.
  - Given chọn một mục, When Jump, Then Reader mở đúng CFI.
- **Priority / Phase:** Must / 1

##### FR-10 — Progress

- **Story:** As a User, I want to see thin progress / completion %, so that I know how far I am in the book.
- **Acceptance:**
  - Given đang đọc hoặc xem Library, When có progress, Then hiển thị % (hoặc thanh mỏng) theo dữ liệu local; không phá Invisible UI trong Reader.
- **Priority / Phase:** Must / 1

##### FR-11 — Đánh dấu trang (bookmark)

- **Story:** As a User, I want to bookmark the current page, so that I can return to it quickly.
- **Acceptance:**
  - Given đang đọc, When chọn Đánh dấu, Then bookmark + CFI lưu local (**BR-02**).
  - Given có bookmark, When User mở lại từ danh sách / menu, Then Jump đúng vị trí.
- **Priority / Phase:** Must / 1

##### FR-12 — Xóa sách (cascade)

- **Story:** As a User, I want to delete a book and all related marks, so that my library stays clean.
- **Acceptance:**
  - Given sách có note/highlight/bookmark/collection membership, When User xóa sách, Then file app-data + metadata + note + highlight + bookmark + `collection_books` bị xóa sạch (**BR-06**); không orphan; collection vẫn tồn tại nếu còn sách khác.
- **Priority / Phase:** Must / 1

##### FR-14 — Collections (bộ sưu tập)

- **Story:** As a User, I want to group books into my own collections, so that I can organize reading by topic or purpose (beyond status shelves / favorites).
- **Acceptance:**
  - Given ở Library, When mở nav Collections, Then thấy danh sách bộ sưu tập do user tạo (có thể rỗng + CTA New collection).
  - Given tạo collection với tên hợp lệ, When lưu, Then tập xuất hiện trong hub; optional description.
  - Given collection tồn tại, When thêm / gỡ sách, Then membership `COLLECTION_BOOK` cập nhật; một sách có thể thuộc nhiều collection.
  - Given mở một collection, When xem list, Then thấy sách trong tập (theo `sort_order`) và mở Reader được như Library.
  - Given xóa collection, When xác nhận, Then chỉ xóa tập + membership — sách vẫn còn trong Library (**BR-06**).
- **Priority / Phase:** Must / 1

#### 3.1.2. Premium — Phase 2 (P1)


| ID        | Tên                                        | Pain / ghi chú                           | BR liên quan |
| --------- | ------------------------------------------ | ---------------------------------------- | ------------ |
| **FR-20** | AI giải thích / tóm tắt đoạn khi User chọn | P01, P11                                 | BR-01, BR-07 |
| **FR-21** | Chat Q&A trong phạm vi 1 sách (RAG)        | Researcher                               | BR-07        |
| **FR-22** | Semantic search trong sách                 | P05                                      | —            |
| **FR-23** | Tạo flashcard từ highlight                 | P03                                      | BR-02        |
| **FR-24** | Spaced repetition review                   | P03                                      | —            |
| **FR-25** | Tóm tắt highlight của một sách             | Habit #13                                | BR-07        |
| **FR-26** | Freemium gate + ads policy theo gói        | Monetization; **cấm ads trong vùng đọc** | NFR-02       |
| **FR-27** | Text-to-Speech (đọc audio)                 | note.txt — sau MVP                       | BR-01, BR-07 |


> P1 **không** thuộc DoD Phase 1. AI/TTS chỉ chạy khi User chủ động gọi (**NFR-05**, **BR-07**).

#### 3.1.3. Special — Phase 3 (P2)


| ID        | Tên                                     | Pain / ghi chú             |
| --------- | --------------------------------------- | -------------------------- |
| **FR-30** | Liên kết thư viện ngoài — kéo danh sách tài liệu từ **Google Drive**, **Google Books**, **Apple Books** vào Library local (connector; **không** tài khoản app, **không** email/password, **không** OAuth2 đăng nhập) | P07 |
| **FR-31** | Auto-tagging (opt-in)                   | P04, P11                   |
| **FR-32** | Reading stats dashboard                 | Collector                  |
| **FR-33** | Link ý tưởng giữa sách                  | P08                        |
| **FR-34** | Quote card & share                      | P09                        |
| **FR-35** | Reading suggestions / learning workflow | P10                        |
| **FR-36** | ~~Import sách từ link mạng (URL)~~ — **đã chuyển MVP thành FR-13** | — |


### 3.2. Non-Functional Requirements (NFR)


| ID         | Hạng mục         | Yêu cầu                                                                                 | Đo / kiểm                                        | Phase    |
| ---------- | ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| **NFR-01** | UX               | Reader chrome mặc định **ẩn**; hiện khi tap center / selection                          | Quan sát UI Reader                               | MVP      |
| **NFR-02** | UX               | **Không popup** giữa phiên đọc (rate app, feature promo, ads trong vùng đọc)            | Checklist QA phiên đọc                           | MVP      |
| **NFR-03** | Performance / UX | Đổi theme **không reload** toàn bộ document (CSS variables / style engine)              | Đổi theme khi đang đọc                           | MVP      |
| **NFR-04** | Performance      | Mở lại sách local **< 3s** trên máy mid-range (target)                                  | Đo cold/warm open                                | MVP      |
| **NFR-05** | Privacy / AI     | AI **không** chạy auto trên nội dung trừ khi User bật / gọi                             | Không có job nền tóm tắt thư viện                | Premium+ |
| **NFR-06** | Data             | Dữ liệu Free/MVP **local-first**; không bắt buộc cloud / connector ở MVP                | Dùng đủ app offline; không màn login             | MVP      |
| **NFR-07** | Accessibility    | Contrast đủ ở 3 theme (**BR-05**); font size adjustable                                 | Contrast checklist + đổi size                    | MVP      |
| **NFR-08** | Integrity        | File sách gốc **Read-Only** trên đĩa (**BR-01**); annotation chỉ overlay DB (**BR-02**) | Kiểm tra file hash không đổi sau highlight/theme | MVP      |
| **NFR-09** | Reliability      | Crash / tắt đột ngột: giữ được vị trí autosave gần nhất                                 | Kill app giữa phiên → mở lại                     | MVP      |
| **NFR-10** | Security         | Path file qua sandbox / main process (Electron); không remote code tùy ý                | Review IPC / file access                         | MVP      |
| **NFR-11** | Identity         | **Không** tài khoản Reading Book App: cấm email/password login; cấm OAuth2 (Sign in with Google/Apple/…) làm identity app | Không có flow Sign in / Log out identity; Settings không có guest/member account | MVP+ |


**Out of scope MVP** (nhắc lại): social feed realtime, marketplace/DRM, OCR hàng loạt PDF scan, AI tự động tóm tắt cả thư viện không hỏi User, connector thư viện ngoài (→ FR-30 P2), TTS/audio (→ FR-27 P1), tài khoản app / sync account đa thiết bị.

---

