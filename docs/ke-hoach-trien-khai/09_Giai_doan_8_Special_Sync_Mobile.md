# Giai đoạn 8 — Special Linked Libraries & Mobile

**Mục tiêu:** Liên kết thư viện ngoài (Google Drive, Google Books, Apple Books) để kéo danh sách tài liệu vào Library local; mang trải nghiệm cốt lõi sang mobile; tính năng Special (opt-in).

**Điều kiện vào:** Premium AI ổn định hoặc tối thiểu MVP + domain không còn thay lớn.

**Tham chiếu:** [`docs/plan/06_Phase_Special_Sync.md`](../plan/06_Phase_Special_Sync.md) · SRS FR-30, NFR-11, BR-08 · SDS SCR-06 Linked libraries

---

## 1. Outcome

1. User liên kết được ≥ 1 nguồn (Drive / Google Books / Apple Books) → pull danh mục tài liệu → chọn import vào sandbox local (dedup SHA-256).
2. **Không** tài khoản Reading Book App: không email/password, không OAuth2 Sign-in identity.
3. Unlink nguồn **không** xóa sách / highlight đã import.
4. Mobile (Expo) parity: Library, Import, Reader, annotation trên domain chung.
5. Auto-tag thư viện **chỉ khi user bật**.
6. Dashboard thói quen đọc; gợi ý đọc (Special).
7. Knowledge links giữa nhiều sách (có thể tăng dần).
8. Quote cards / chia sẻ cơ bản (persona Social — sau core connectors).

## 2. Việc cần làm

### 2.1. Linked libraries (thay Auth / sync account)

| Task | Chi tiết |
| :--- | :--- |
| T8.1 | Port `ExternalLibraryConnector` + adapters stub → thật (thay Auth/account / `SyncService` account-based) |
| T8.2 | Google Drive: link folder Drive đã sync trên máy → list file hỗ trợ → import sandbox |
| T8.3 | Google Books: link / import catalog → list → chọn tài liệu vào Library |
| T8.4 | Apple Books: link thư mục / thư viện Books trên máy → pull danh mục |
| T8.5 | SCR-06 Linked libraries UI thật (bỏ Sign in / Log out); Sync now + Unlink |
| T8.6 | Special: không ads mọi màn |

### 2.2. Mobile

| Task | Chi tiết |
| :--- | :--- |
| T8.7 | Map IA sang Expo Router: Splash → Library → Reader → Settings |
| T8.8 | Infrastructure: FileSystem + SQLite tương đương; **reuse** `packages/shared` |
| T8.9 | Import: bottom sheet URL + picker |
| T8.10 | Reader engines tương thích RN / WebView tùy quyết định spike |

### 2.3. Special intelligence

| Task | Chi tiết |
| :--- | :--- |
| T8.11 | Auto-tag opt-in |
| T8.12 | Dashboard thống kê |
| T8.13 | Gợi ý đọc / workflow |
| T8.14 | Knowledge links đa sách |
| T8.15 | Quote cards / share |

## 3. Thứ tự khuyến nghị

```text
T8.7–T8.9 (mobile parity tối thiểu song song được nếu domain đóng băng)
  → T8.1 → T8.2 → T8.3 → T8.4 → T8.5
  → T8.11 → T8.12 → T8.13
  → T8.14 → T8.15 → T8.6
```

**Lưu ý:** Mobile UI parity nên bắt đầu **sau khi** model `Location` / overlay không còn đổi lớn (cuối G6 hoặc đầu G7).

## 4. Nghiệm thu

- [ ] Không có flow đăng nhập email/password hay OAuth2 identity app
- [ ] Link Drive / Books / Apple Books → thấy list tài liệu; import vào Library (ít nhất 1 nguồn E2E)
- [ ] Unlink không wipe local library / overlays
- [ ] Dedup SHA-256 khi catalog trùng file đã có
- [ ] Auto-tag không chạy khi opt-out
- [ ] Mobile: import → đọc → highlight → resume được với ít nhất EPUB (hoặc format đã chọn spike)
- [ ] Special user: không ads mọi màn

## 5. Phạm vi để sau G8

- Sync progress/note đa thiết bị qua server app (đã loại — không account)
- Mạng xã hội realtime / feed cộng đồng đầy đủ
- Marketplace sách
- OCR hàng loạt PDF scan
