# Phân loại Người Đọc Sách (Reader Personas)

Tài liệu này tổng hợp các kiểu người đọc sách phổ biến, phục vụ mục đích phân tích và định hướng phát triển tính năng cho ứng dụng Trình đọc tài liệu thông minh.

---


## Mục lục

- [1. Mục tiêu](#1-mục-tiêu)
- [2. Các nhóm người đọc chính](#2-các-nhóm-người-đọc-chính)
  - [A. Nhóm "Thợ săn thông tin" (The Researcher / Utility Reader)](#a-nhóm-"thợ-săn-thông-tin"-the-researcher--utility-reader)
  - [B. Nhóm "Nhà chiêm nghiệm" (The Deep/Active Reader)](#b-nhóm-"nhà-chiêm-nghiệm"-the-deepactive-reader)
  - [C. Nhóm "Người sưu tầm" (The Collector / Curator)](#c-nhóm-"người-sưu-tầm"-the-collector--curator)
  - [D. Nhóm "Người kết nối" (The Social/Connected Reader)](#d-nhóm-"người-kết-nối"-the-socialconnected-reader)
- [3. Bảng đối chiếu chiến lược](#3-bảng-đối-chiếu-chiến-lược)
- [4. Gợi ý áp dụng cho dự án](#4-gợi-ý-áp-dụng-cho-dự-án)

---

## 1. Mục tiêu
Hiểu rõ hành vi và nhu cầu của người dùng để thiết kế kiến trúc AI và trải nghiệm (UX) phù hợp, từ đó xác định giá trị cốt lõi cho ứng dụng.

---

## 2. Các nhóm người đọc chính

### A. Nhóm "Thợ săn thông tin" (The Researcher / Utility Reader)
*   **Đặc điểm:** Xem tài liệu là công cụ để giải quyết vấn đề.
*   **Hành vi:**
    *   Đọc không theo trình tự (nhảy cóc, đọc mục lục).
    *   Tìm kiếm dữ liệu cụ thể, số liệu hoặc giải pháp.
    *   Ưu tiên sự nhanh chóng và chính xác.
*   **Nỗi đau:** Mất nhiều thời gian để tìm kiếm trong tài liệu dài.
*   **AI Feature trọng tâm:** Chat với tài liệu (RAG), tóm tắt nhanh theo chủ đề, trích xuất dữ liệu.

### B. Nhóm "Nhà chiêm nghiệm" (The Deep/Active Reader)
*   **Đặc điểm:** Đọc để thấu hiểu và kiến thức hóa vấn đề.
*   **Hành vi:**
    *   Đọc chậm, nghiền ngẫm, đọc kỹ từng chương.
    *   Thích ghi chú bên lề (annotate) và viết tóm tắt của riêng mình.
    *   Cần sự tập trung tuyệt đối.
*   **Nỗi đau:** Quên nội dung sau một thời gian.
*   **AI Feature trọng tâm:** Tạo Flashcards, ôn tập theo Spaced Repetition, kết nối ý tưởng.

### C. Nhóm "Người sưu tầm" (The Collector / Curator)
*   **Đặc điểm:** Yêu thích việc xây dựng thư viện tri thức.
*   **Hành vi:**
    *   Tải tài liệu về, quản lý theo thư mục/tag kỹ lưỡng.
    *   Quan tâm tính thẩm mỹ và đồng bộ đa thiết bị.
*   **Nỗi đau:** Thư viện lộn xộn, không biết bắt đầu đọc từ đâu.
*   **AI Feature trọng tâm:** Auto-tagging (tự động phân loại), thống kê tiến độ đọc, gợi ý đọc.

### D. Nhóm "Người kết nối" (The Social/Connected Reader)
*   **Đặc điểm:** Xem sách là chất liệu để kết nối, thảo luận.
*   **Hành vi:**
    *   Chia sẻ trích dẫn (quote) hay, đoạn gây tranh cãi.
    *   So sánh quan điểm với người khác.
*   **Nỗi đau:** Cô độc trong quá trình đọc, khó tìm người cùng góc nhìn.
*   **AI Feature trọng tâm:** Tạo Quote Cards tự động, tóm tắt thảo luận cộng đồng.

---

## 3. Bảng đối chiếu chiến lược

| Nhóm người đọc | Ưu tiên | Tương tác AI |
| :--- | :--- | :--- |
| **Thợ săn** | Tốc độ, tìm kiếm | Trả lời câu hỏi (Q&A) |
| **Chiêm nghiệm** | Ghi chú, ôn tập | Flashcards, Spaced Repetition |
| **Sưu tầm** | Tổ chức, quản lý | Auto-tagging, Thống kê |
| **Kết nối** | Chia sẻ | Quote Generator |

---

## 4. Gợi ý áp dụng cho dự án
*   **Gói Free:** Tập trung vào nhóm "Chiêm nghiệm" (trình đọc sạch, highlight, lưu tiến độ) và có banner ads sau một ngưỡng thời gian sử dụng trong app.
*   **Gói Premium:** Tập trung vào nhóm "Thợ săn" và "Chiêm nghiệm nâng cao" (AI Chat, Flashcards, Spaced Repetition, tóm tắt theo chương, tìm kiếm ngữ nghĩa trong tài liệu) và bỏ toàn bộ banner ads trong trải nghiệm đọc chính.
*   **Gói Special:** Dành cho người dùng chuyên sâu và power user (trợ lý AI cá nhân hóa, bộ sưu tập tri thức nâng cao, đồng bộ đa thiết bị, gợi ý đọc thông minh, dashboard thống kê và workflow học tập tự động) và loại bỏ quảng cáo hoàn toàn trên mọi màn hình, kể cả banner, nhắc nâng cấp hay gợi ý mua gói.
