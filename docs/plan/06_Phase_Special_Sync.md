# 06 — Phase 3: Special Linked Libraries & Knowledge




## Mục lục

- [1. Outcomes](#1-outcomes)
- [2. Backlog theo epic](#2-backlog-theo-epic)
  - [Epic J — External library connectors](#epic-j--external-library-connectors)
  - [Epic K — Library intelligence](#epic-k--library-intelligence)
  - [Epic L — Insights & connection](#epic-l--insights--connection)
  - [Epic M — Special entitlement](#epic-m--special-entitlement)
- [3. Thứ tự khuyến nghị](#3-thứ-tự-khuyến-nghị)
- [4. Acceptance checklist (Phase 3 done)](#4-acceptance-checklist-phase-3-done)
- [5. Sau Phase 3 (backlog giữ, không scope-creep sớm)](#5-sau-phase-3-backlog-giữ-không-scope-creep-sớm)

---

**Mục tiêu:** Liên kết thư viện ngoài (Google Drive, Google Books, Apple Books) để kéo danh sách tài liệu vào Library local; tổ chức thư viện thông minh, thống kê và kết nối tri thức — phục vụ Collector + power user (Special).

**Không thuộc phase này:** tài khoản Reading Book App, đăng nhập email/password, OAuth2 Sign-in identity, sync progress/note qua server app.

**Điều kiện vào phase:** Phase 2 AI ổn; schema local có `version`; mobile hoặc nguồn thư viện ngoài sẵn sàng test connector.

## 1. Outcomes

1. Link Drive / Google Books / Apple Books → pull catalog → import vào Library (dedup SHA-256)  
2. Auto-tagging **opt-in** giảm clutter  
3. Dashboard thống kê thói quen đọc  
4. Link ý tưởng giữa sách; quote card chia sẻ  
5. Special: không ads mọi màn hình  

## 2. Backlog theo epic

### Epic J — External library connectors

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| J1 | Port `ExternalLibraryConnector` + model link (folder/path) — **không** Auth/account | FR-30, NFR-11, BR-08 |
| J2 | Google Drive adapter: folder đã sync trên máy → list → import sandbox | FR-30 |
| J3 | Google Books adapter: catalog / library path → list → import | FR-30 |
| J4 | Apple Books adapter: Books library folder → list → import | FR-30 |
| J5 | SCR-06 Linked libraries UI; Sync now / Unlink; không Sign-in dialog | FR-30, SCR-06 |
| J6 | Status tinh tế khi refresh catalog (không spam toast khi đọc) | P02 |

### Epic K — Library intelligence

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| K1 | Auto-tagging opt-in + user edit tags | FR-31, P11 |
| K2 | Filters / smart collections | P04 |
| K3 | Reading suggestions (dựa progress + tags) | FR-35, P10 |

### Epic L — Insights & connection

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| L1 | Dashboard: thời gian đọc, streak, sách đang đọc | FR-32 |
| L2 | Knowledge links giữa highlights/notes across books | FR-33, P08 |
| L3 | Quote card generator + share | FR-34, P09 |
| L4 | Learning workflow automation (Special) | FR-35 |

### Epic M — Special entitlement

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| M1 | Gói Special unlock linked libraries + dashboard + no ads all surfaces | Personas |
| M2 | Personal AI preferences (tone, language, automation level) | P11 |
| M3 | Remove upgrade nags trên mọi màn hình Special | Personas |

## 3. Thứ tự khuyến nghị

```text
J1 → J2 → J3 → J4 → J5 → J6
  → mobile/desktop both clients (folder pickers)
  → K1 → K2 → K3
  → L1 → L2 → L3 → L4
  → M*
```

## 4. Acceptance checklist (Phase 3 done)

- [ ] Không có email/password login hay OAuth2 identity app  
- [ ] Ít nhất 1 connector E2E: list từ nguồn → import vào Library  
- [ ] Unlink không xóa sách/overlay đã import  
- [ ] Dedup SHA-256 khi trùng file  
- [ ] Auto-tag chỉ chạy khi user bật  
- [ ] Dashboard phản ánh session thật  
- [ ] Knowledge link tạo và navigate được  
- [ ] Special user: 0 ads / 0 upgrade nag  

## 5. Sau Phase 3 (backlog giữ, không scope-creep sớm)

- Sync progress/note đa thiết bị qua server app (đã loại khỏi SRS)  
- Cộng đồng thảo luận realtime  
- Marketplace nội dung  
- On-device LLM đầy đủ offline  
- OCR PDF scan hàng loạt  
