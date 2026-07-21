# reading-book-app

Ứng dụng đọc tài liệu/sách thông minh, tập trung vào trải nghiệm đọc yên tĩnh, ghi chú nhẹ nhàng và AI hỗ trợ đúng lúc.

## Mục tiêu sản phẩm

Project này được xây dựng từ 4 lớp phân tích chính:

1. Trải nghiệm đọc phải giữ được trạng thái tập trung sâu, ít xao nhãng.
2. Hành vi đọc thực tế thường là đọc ngắn theo phiên, highlight nhiều, quay lại ghi chú và tiến độ.
3. Thiết kế cần tối giản, có tính cá nhân hóa cao và hỗ trợ đồng bộ liền mạch.
4. AI nên đóng vai trò trợ lý lặng lẽ, chỉ xuất hiện khi người dùng cần.

## Nền tảng nghiên cứu

Các quyết định sản phẩm trong repository này đang bám theo 4 tài liệu sau:

- [UX of Reading](docs/reading-habbit/UX_of_Reading.md)
- [Thói quen của người đọc sách](docs/reading-habbit/Thoi_quen_nguoi_doc_sach.md)
- [Design System: Trình Đọc Sách "Yên tĩnh"](docs/reading-habbit/Reading_App_Design_System.md)
- [Phân loại Người Đọc Sách (Reader Personas)](docs/reading-habbit/Reader_Personas_Analysis.md)

## Định vị người dùng

Ứng dụng đang được định vị theo các nhóm người đọc sau:

- Thợ săn thông tin: cần tìm nhanh, hỏi đáp, trích xuất dữ liệu.
- Nhà chiêm nghiệm: cần đọc sâu, ghi chú, flashcards và ôn tập.
- Người sưu tầm: cần thư viện gọn gàng, auto-tagging và thống kê.
- Người kết nối: cần quote cards và chia sẻ thảo luận.

## Phân tầng gói sản phẩm

### Free

- Tập trung vào nhóm Chiêm nghiệm.
- Có trình đọc sạch, highlight, lưu tiến độ.
- Có banner ads sau một ngưỡng thời gian sử dụng trong app.

### Premium

- Tập trung vào nhóm Thợ săn và Chiêm nghiệm nâng cao.
- Có AI Chat, Flashcards, Spaced Repetition, tóm tắt theo chương, tìm kiếm ngữ nghĩa trong tài liệu.
- Bỏ toàn bộ banner ads trong trải nghiệm đọc chính.

### Special

- Dành cho người dùng chuyên sâu và power user.
- Có trợ lý AI cá nhân hóa, bộ sưu tập tri thức nâng cao, đồng bộ đa thiết bị, gợi ý đọc thông minh, dashboard thống kê và workflow học tập tự động.
- Loại bỏ quảng cáo hoàn toàn trên mọi màn hình, kể cả banner, nhắc nâng cấp hay gợi ý mua gói.

## Triết lý trải nghiệm

- Content-first: nội dung là trung tâm.
- Invisible UI: công cụ chỉ xuất hiện khi cần.
- Visual comfort: màu sắc, typography và khoảng trắng phải hỗ trợ đọc lâu.
- Seamless: lưu tiến độ, highlight và ghi chú phải liền mạch giữa các phiên đọc.

## Cấu trúc repository

- `docs/reading-habbit/`: tài liệu nghiên cứu, UX và design system.
- `source/`: workspace chính cho các app.
- `source/apps/reading-book-desktop/`: app desktop Electron + Vite + React.
- `source/apps/reading-book-mobile/`: app mobile Expo + React Native.
- `source/packages/`: các package dùng chung.

## Chạy ứng dụng

### Desktop

```bash
cd source/apps/reading-book-desktop
npm install
npm run dev
```

Các lệnh khác:

- `npm run build`: build production cho desktop app.
- `npm run lint`: kiểm tra lint.

### Mobile

```bash
cd source/apps/reading-book-mobile
npm install
npm run start
```

Các lệnh khác:

- `npm run android`: chạy trên Android.
- `npm run ios`: chạy trên iOS.
- `npm run web`: chạy bản web.

## Ghi chú kỹ thuật

- Workspace dùng cấu trúc monorepo, nên các app được phát triển trong `source/apps`.
- Desktop app hiện dùng Electron + Vite + React + TypeScript.
- Mobile app hiện dùng Expo Router + React Native.

## Hướng phát triển tiếp theo

- Hoàn thiện luồng đọc sạch và lưu tiến độ.
- Xây dựng highlight, note và trang tổng hợp lại nội dung đã đánh dấu.
- Thêm AI Chat và tóm tắt theo ngữ cảnh cho Premium.
- Mở rộng tự động hóa học tập và cá nhân hóa sâu cho Special.
