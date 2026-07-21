# Plan: Từ nghiên cứu đến triển khai




## Mục lục

- [Giả định đã chốt](#giả-định-đã-chốt)
- [Tài liệu nguồn](#tài-liệu-nguồn)
- [Thứ tự đọc / làm việc](#thứ-tự-đọc--làm-việc)
- [Output chính thức (software docs)](#output-chính-thức-software-docs)

---

Bộ tài liệu này chuyển 5 nghiên cứu trong [`docs/reading-habbit/`](../reading-habbit/) thành lộ trình sản phẩm: xác định yêu cầu → thiết kế → triển khai.

## Giả định đã chốt

| Quyết định | Giá trị |
| :--- | :--- |
| MVP | **Free core**: trình đọc sạch, thư viện, highlight/note, lưu tiến độ |
| Nền tảng giai đoạn 1 | **Desktop trước** (Electron), sau đó Mobile (Expo) dùng chung domain |
| AI / Sync | Đưa vào **Phase 2+** (Premium / Special), không nằm trong MVP |
| Định vị | Trợ lý tri thức cá nhân — bắt đầu bằng trải nghiệm đọc yên tĩnh |

Nếu đổi giả định (ví dụ đưa AI vào MVP), cập nhật lại các file Phase trong thư mục này trước khi viết SRS/SDS.

## Tài liệu nguồn

| File | Vai trò trong plan |
| :--- | :--- |
| [UX_of_Reading.md](../reading-habbit/UX_of_Reading.md) | Trụ cột trải nghiệm (Flow, Control, Seamlessness, Invisible Assistance) |
| [Thoi_quen_nguoi_doc_sach.md](../reading-habbit/Thoi_quen_nguoi_doc_sach.md) | Hành vi thực tế → yêu cầu chức năng |
| [Nỗi_đau_khi_đọc_sách.md](../reading-habbit/Nỗi_đau_khi_đọc_sách.md) | Pain points → ưu tiên giải quyết |
| [Reader_Personas_Analysis.md](../reading-habbit/Reader_Personas_Analysis.md) | Persona + Free / Premium / Special |
| [Reading_App_Design_System.md](../reading-habbit/Reading_App_Design_System.md) | Design tokens, Invisible UI, don'ts |

## Thứ tự đọc / làm việc

1. [00_Overview_and_Roadmap.md](./00_Overview_and_Roadmap.md) — tầm nhìn, phase, tiêu chí thành công  
2. [01_Requirements.md](./01_Requirements.md) — cách viết SRS từ research  
3. [02_Design.md](./02_Design.md) — UX, IA, SDS, kiến trúc  
4. [03_Implementation.md](./03_Implementation.md) — backlog kỹ thuật theo phase  
5. [04_Phase_MVP_Free_Core.md](./04_Phase_MVP_Free_Core.md) — chi tiết Phase 1  
6. [05_Phase_Premium_AI.md](./05_Phase_Premium_AI.md) — chi tiết Phase 2  
7. [06_Phase_Special_Sync.md](./06_Phase_Special_Sync.md) — chi tiết Phase 3  

## Output chính thức (software docs)

Sau khi chốt plan:

- Điền [`docs/software/SRS.md`](../software/SRS.md) theo [01_Requirements.md](./01_Requirements.md)
- Điền [`docs/software/SDS.md`](../software/SDS.md) theo [02_Design.md](./02_Design.md)
- Triển khai trong `source/apps/` và `source/packages/` theo [03_Implementation.md](./03_Implementation.md)
