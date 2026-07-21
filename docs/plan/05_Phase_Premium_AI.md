# 05 — Phase 2: Premium AI




## Mục lục

- [1. Outcomes](#1-outcomes)
- [2. Nguyên tắc AI (bắt buộc)](#2-nguyên-tắc-ai-bắt-buộc)
- [3. Backlog theo epic](#3-backlog-theo-epic)
  - [Epic F — AI platform](#epic-f--ai-platform)
  - [Epic G — In-reader AI UX](#epic-g--in-reader-ai-ux)
  - [Epic H — Search & memory](#epic-h--search--memory)
  - [Epic I — Monetization](#epic-i--monetization)
- [4. Thứ tự khuyến nghị](#4-thứ-tự-khuyến-nghị)
- [5. Acceptance checklist (Phase 2 done)](#5-acceptance-checklist-phase-2-done)
- [6. Mobile trong Phase 2](#6-mobile-trong-phase-2)

---

**Mục tiêu:** Thêm trợ lý AI không xâm lấn cho Thợ săn thông tin và Chiêm nghiệm nâng cao; giữ Flow trong reader.

**Điều kiện vào phase:** Phase 1 DoD đạt; domain Highlight/Note ổn định (AI chủ yếu xây trên highlight + text range).

## 1. Outcomes

1. User bôi đoạn → hỏi AI / xin giải thích / tóm tắt — có kiểm soát  
2. Chat Q&A trong phạm vi **một sách** với trích dẫn vị trí  
3. Semantic search theo khái niệm trong sách  
4. Flashcards từ highlight + spaced repetition  
5. Premium: không banner trong reader; Free: ads theo SRS  

## 2. Nguyên tắc AI (bắt buộc)

Từ pain P11 và UX “Invisible Assistance”:

- Không auto-summarize cả sách khi import  
- Không xen notification AI giữa phiên đọc  
- Mọi hành động AI cần explicit user action  
- Hiện nguồn đoạn (location) kèm câu trả lời khi có thể  

## 3. Backlog theo epic

### Epic F — AI platform

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| F1 | Interface `AiProvider` + config (API key / endpoint) | — |
| F2 | Chunking nội dung sách + embedding index (per book) | FR-21,22 |
| F3 | Retrieval + prompt template có citation | FR-21 |
| F4 | Rate limit / offline graceful error | NFR |

### Epic G — In-reader AI UX

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| G1 | Context menu: Explain / Summarize selection | FR-20 |
| G2 | Floating AI entry (góc, nhỏ) → side panel | Design System |
| G3 | Panel không block scroll; đóng dễ | P02 |
| G4 | Tóm tắt chương khi user chọn mục lục / lệnh | FR-20 |

### Epic H — Search & memory

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| H1 | Semantic search UI trong sách | FR-22 |
| H2 | Generate flashcards từ highlight (batch/opt-in) | FR-23 |
| H3 | Spaced repetition queue + review screen | FR-24 |
| H4 | “Tóm tắt các highlight của tôi” | FR-25 |

### Epic I — Monetization

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| I1 | Entitlement Free vs Premium | FR-26 |
| I2 | Banner Free sau ngưỡng thời gian — **ngoài** vùng đọc đang focus | Personas |
| I3 | Premium: ẩn ads trong reader | Personas |
| I4 | Gate AI features với empty/upsell state ngoài content | P02 |

## 4. Thứ tự khuyến nghị

```text
F1 → F2 → F3
  → G1 → G2 → G3 → G4
  → H1 → H2 → H3 → H4
  → I1 → I2 → I3 → I4
```

## 5. Acceptance checklist (Phase 2 done)

- [ ] Explain selection hoạt động trên EPUB mẫu  
- [ ] Chat trả lời có ít nhất một reference location khi retrieval hit  
- [ ] Semantic search tìm được đoạn theo paraphrase (test set nhỏ)  
- [ ] Flashcard tạo từ highlight; review cập nhật due date  
- [ ] AI không chạy nền khi chỉ mở/đọc sách  
- [ ] Free/Premium ad behavior đúng SRS  

## 6. Mobile trong Phase 2

- Ưu tiên port Phase 1 parity trước khi port AI panel  
- Nếu resource hạn chế: AI chỉ desktop trước; mobile đọc + schema local chung (không account sync)
