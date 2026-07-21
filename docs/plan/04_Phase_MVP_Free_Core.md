# 04 — Phase 1: MVP Free Core




## Mục lục

- [1. Outcomes](#1-outcomes)
- [2. Backlog theo epic](#2-backlog-theo-epic)
  - [Epic A — Foundation & domain](#epic-a--foundation--domain)
  - [Epic B — Library](#epic-b--library)
  - [Epic C — Reader](#epic-c--reader)
  - [Epic D — Highlight & Note](#epic-d--highlight--note)
  - [Epic E — Polish & Free policy stub](#epic-e--polish--free-policy-stub)
- [3. Thứ tự implement khuyến nghị](#3-thứ-tự-implement-khuyến-nghị)
- [4. Acceptance checklist (Phase 1 done)](#4-acceptance-checklist-phase-1-done)
- [5. Spike kỹ thuật (làm sớm nếu chưa chắc)](#5-spike-kỹ-thuật-làm-sớm-nếu-chưa-chắc)

---

**Mục tiêu:** Desktop app cho phép đọc yên tĩnh, highlight/note, resume chính xác — phục vụ persona Nhà chiêm nghiệm (Free).

**Nền tảng:** `source/apps/reading-book-desktop`  
**Không làm:** AI, linked libraries connector thật, social, auto-tag, dashboard stats nặng.

## 1. Outcomes

Người dùng có thể:

1. Thêm EPUB vào thư viện local  
2. Mở đọc với theme / typography tùy chỉnh  
3. Highlight và ghi note trong ≤ 2 thao tác chính  
4. Đóng app và mở lại đúng vị trí  
5. Xem lại toàn bộ highlight/note của một sách  

## 2. Backlog theo epic

### Epic A — Foundation & domain

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| A1 | Định nghĩa domain models: Book, Collection, CollectionBook, ReadingSessionState, Highlight, Note, Preferences (`packages/domain`) | FR-14 |
| A2 | Local store (SQLite hoặc JSON schema versioned) | FR-01,05 |
| A3 | Repository APIs trong `packages/shared` | — |
| A4 | Electron IPC: import file, read book path an toàn | FR-01 |

### Epic B — Library

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| B1 | Màn Library: list sách (title, cover nếu có, % tiến độ) | FR-08 |
| B2 | Continue Reading (sách cập nhật gần nhất có progress) | FR-08 |
| B3 | Flow Import (chọn file → copy vào app data → metadata) | FR-01 |
| B4 | Book detail tối giản: mở đọc / xem highlights | FR-09 |
| B5 | Collections: tạo tập, gắn/gỡ sách, mở list sách trong tập | FR-14 |

### Epic C — Reader

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| C1 | Tích hợp EPUB renderer | FR-02 |
| C2 | Navigation trang / scroll mượt | FR-03 |
| C3 | Invisible chrome: tap center toggle toolbar | FR-03, NFR-01 |
| C4 | Progress bar mỏng + persist location (CFI/offset) | FR-05, FR-10 |
| C5 | Reading settings: theme, font, size, line-height | FR-04 |
| C6 | CSS variables / theme switch không reload doc | NFR-03 |

### Epic D — Highlight & Note

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| D1 | Text selection → Highlight | FR-06 |
| D2 | Note gắn selection / location | FR-07 |
| D3 | Render lại highlight khi mở sách | FR-06 |
| D4 | Màn Highlights & Notes (jump tới vị trí) | FR-09 |

### Epic E — Polish & Free policy stub

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| E1 | Empty states: thư viện trống, chưa có highlight | — |
| E2 | Performance: mở sách local nhanh | NFR-04 |
| E3 | Feature flag chỗ ads Free (có thể chưa hiện ad thật) | FR-26 stub |
| E4 | Lint + manual test checklist Phase 1 | — |

## 3. Thứ tự implement khuyến nghị

```text
A1 → A2 → A3 → A4
  → B3 → B1 → B2
  → C1 → C2 → C4 → C3 → C5 → C6
  → D1 → D3 → D2 → D4
  → B4 → E*
```

## 4. Acceptance checklist (Phase 1 done)

- [ ] Import ≥ 1 EPUB thật, hiện trong Library  
- [ ] Đọc 2 phiên: vị trí khôi phục đúng  
- [ ] Đổi theme/font, mở lại vẫn giữ preference  
- [ ] Tạo ≥ 3 highlight + 1 note; Review list đủ và jump được  
- [ ] Reader mặc định không hiện toolbar  
- [ ] Không có AI panel / Sign-in / OAuth2 identity trong UI MVP  
- [ ] SRS Must FR-01…10 được đánh dấu Implemented  

## 5. Spike kỹ thuật (làm sớm nếu chưa chắc)

1. Chọn EPUB engine trên Electron/Chromium  
2. Chọn cách lưu location ổn định (CFI)  
3. Chọn SQLite vs JSON cho volume thư viện cá nhân  

Kết quả spike ghi vào SDS trước khi khóa Epic C.
