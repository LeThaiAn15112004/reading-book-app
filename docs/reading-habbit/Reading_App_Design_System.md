# Design System: Trình Đọc Sách "Yên tĩnh" (Minimalist Reading UI)

Tài liệu này định nghĩa hệ thống thiết kế (Design System) cho ứng dụng đọc sách, tuân thủ triết lý "Vô hình nhưng hữu dụng" (Invisible UI), giúp người dùng duy trì sự tập trung tối đa.

---


## Mục lục

- [1. Triết lý thiết kế (Core Philosophy)](#1-triết-lý-thiết-kế-core-philosophy)
- [2. Màu sắc (Color Palette)](#2-màu-sắc-color-palette)
- [3. Typography (Kiểu chữ)](#3-typography-kiểu-chữ)
- [4. Bố cục & Khoảng trắng (Layout & Spacing)](#4-bố-cục--khoảng-trắng-layout--spacing)
- [5. Nguyên tắc Tương tác (Interaction Principles)](#5-nguyên-tắc-tương-tác-interaction-principles)
- [6. Những điều cấm kỵ (Don'ts)](#6-những-điều-cấm-kỵ-donts)
- [7. Lời khuyên triển khai (.NET 8)](#7-lời-khuyên-triển-khai-net-8)

---

## 1. Triết lý thiết kế (Core Philosophy)
*   **Content-First:** Nội dung là nhân vật chính. Giao diện chỉ đóng vai trò hỗ trợ.
*   **Invisible UI:** Các công cụ chỉ xuất hiện khi người dùng thực sự cần đến.
*   **Visual Comfort:** Ưu tiên sức khỏe thị giác thông qua bảng màu và typography chuẩn.

---

## 2. Màu sắc (Color Palette)
Sử dụng bảng màu trung tính để tránh mỏi mắt.

| Chức năng | Màu sắc (Gợi ý) | Mã HEX (Ví dụ) |
| :--- | :--- | :--- |
| **Nền (Light)** | Trắng ngà (Cream) | `#FDFBF7` |
| **Nền (Sepia)** | Vàng ấm nhẹ | `#F4ECD8` |
| **Nền (Dark)** | Xám cực tối | `#1A1A1A` |
| **Văn bản chính** | Xám đậm (Charcoal) | `#2D2D2D` |
| **Điểm nhấn (Accent)** | Xanh dương trầm | `#4A90E2` |

---

## 3. Typography (Kiểu chữ)
Ưu tiên các font chữ dễ đọc cho màn hình kỹ thuật số.

*   **Font Serif (Sách giấy truyền thống):** *Merriweather, Playfair Display, hoặc Literata.* (Dành cho nội dung chính, tạo cảm giác như sách thật).
*   **Font Sans-Serif (Giao diện):** *Inter, Roboto, hoặc SF Pro.* (Dành cho các menu, ghi chú).
*   **Khoảng cách dòng (Line-height):** 1.5 đến 1.7 (giúp mắt dễ theo dòng).
*   **Chiều rộng dòng (Max-width):** 600px - 750px (để tránh dòng quá dài gây mỏi mắt).

---

## 4. Bố cục & Khoảng trắng (Layout & Spacing)
*   **Padding:** Tối thiểu 40px cho mỗi bên lề để nội dung không bị sát màn hình.
*   **Giao diện tùy biến (Contextual UI):**
    *   Thanh công cụ: Ẩn mặc định. Chỉ hiện khi nhấn vào trung tâm màn hình hoặc bôi đen chữ.
    *   Nút bấm AI: Chỉ là một floating icon nhỏ ở góc dưới màn hình.

---

## 5. Nguyên tắc Tương tác (Interaction Principles)
*   **Phản hồi (Feedback):** Khi highlight, dùng một hiệu ứng chuyển màu nhẹ (không chớp nháy).
*   **Điều hướng:**
    *   Chạm 2 bên màn hình để lật trang.
    *   Nhấn giữ để gọi menu ngữ cảnh (AI Chat, Note, Highlight).
*   **Đồng bộ:** Luôn hiển thị vị trí đọc (Progress bar mỏng) ở cạnh dưới màn hình một cách tinh tế.

---

## 6. Những điều cấm kỵ (Don'ts)
*   **KHÔNG** dùng màu neon, màu chói cho giao diện.
*   **KHÔNG** sử dụng hiệu ứng động (animations) quá nhanh hoặc gây xao nhãng.
*   **KHÔNG** ép người dùng xem popup không mong muốn (ví dụ: đánh giá app, gợi ý tính năng).
*   **KHÔNG** làm cấu trúc UI phức tạp, nhiều lớp (tầng) che khuất nội dung.

---

## 7. Lời khuyên triển khai (.NET 8)
*   Tối ưu hóa **Render Engine** để các thay đổi về font/size/theme diễn ra tức thì mà không cần load lại toàn bộ trang.
*   Sử dụng **CSS Variables** để dễ dàng chuyển đổi giữa các theme sáng/tối/sepia một cách mượt mà.
