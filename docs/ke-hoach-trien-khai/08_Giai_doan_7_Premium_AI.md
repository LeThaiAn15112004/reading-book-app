# Giai đoạn 7 — Premium AI

**Mục tiêu:** Trợ lý AI theo yêu cầu user — không phá flow đọc.

**Điều kiện vào:** MVP desktop (G0–G6) DoD đạt; highlight + extract text ổn.

**Tham chiếu:** [`docs/plan/05_Phase_Premium_AI.md`](../plan/05_Phase_Premium_AI.md), SRS FR-20+ (P1)

---

## 1. Outcome

1. Bôi đoạn → Explain / Summarize (user chủ động).
2. Chat Q&A trong **một sách**, có citation location khi có thể.
3. Semantic search trong tài liệu.
4. Flashcards từ highlight + spaced repetition (opt-in).
5. Free/Premium entitlement; ads **không** nằm giữa nội dung đang đọc.

## 2. Nguyên tắc bắt buộc

- Không auto-tóm tắt cả sách khi import
- Không notification AI giữa phiên đọc
- Mọi AI = explicit action
- Offline / lỗi API: thông báo rõ, không crash reader

## 3. Việc cần làm (theo epic)

| Epic | Task chính |
| :--- | :--- |
| **Platform** | Thay `NoOpAiProvider`; chunking + embedding per book; retrieval + prompt có citation; rate limit |
| **In-reader UX** | Context menu Explain/Summarize; side panel nhỏ, đóng dễ, không block scroll |
| **Search & memory** | Semantic search UI; generate flashcards từ highlight; hàng đợi ôn; “tóm tắt highlights của tôi” |
| **Monetization** | Entitlement Free/Premium; banner ngoài vùng đọc; gate AI bằng empty/upsell ngoài content |

## 4. Thứ tự khuyến nghị

```text
Provider + chunk/embed một sách
  → Explain/Summarize selection
  → Chat + citation
  → Semantic search
  → Flashcards + SR
  → Entitlement / ads policy
```

## 5. Nghiệm thu

- [ ] Deep Reader ôn được từ highlight (flashcard)
- [ ] Researcher hỏi nội dung sách có căn cứ đoạn
- [ ] Tắt mạng → AI fail mềm; đọc vẫn bình thường
- [ ] Không auto-AI khi import

## 6. Không làm trong giai đoạn này

- Linked libraries Drive / Books / Apple Books (G8)
- Knowledge graph đa sách (G8)
- Social feed đầy đủ
