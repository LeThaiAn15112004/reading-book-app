# Reset App Settings (Settings → Advanced)

## Chức năng làm gì

Đưa các **application-level preferences** về giá trị mặc định. Thao tác chỉ ghi lại default cho đúng các
nhóm setting đã liệt kê; không xoá, không chạm dữ liệu người dùng hay trạng thái gắn với từng sách.

UI: `Settings → Advanced → Reset App Settings` → hộp thoại xác nhận *Reset App Settings?* (Cancel / Reset
Settings, Esc = Cancel) → thông báo *"Settings have been reset to their defaults."* hoặc thông báo lỗi nêu
tên nhóm không lưu được.

## Được reset

| Nhóm | Field | Default | Lưu ở (renderer `localStorage`) |
|---|---|---|---|
| Appearance | `themeMode`, `accent`, `customAccent`, `density`, `language` | `dark`, `orange`, `#ec4899`, `balanced`, `system` | `reading-book.app-appearance.v1` |
| Library | `sort`, `layout` | `recently-added`, `grid` | `reading-book.library.browse-prefs.v1` |
| Notifications | `enabled` (Enable Notifications) | `false` | `reading-book.notifications.v1` |

Hệ quả kèm theo (không phải do reset ghi trực tiếp): `AppAppearanceBridge` thấy `themeMode` đổi nên patch
**chỉ field `theme`** trong `readmate.globalReadingPrefs.v1` (`dark` → `night`), như mọi lần đổi theme.

Chưa tồn tại nên chưa có gì để reset: Keyboard Shortcuts (đang hard-code), Library grouping. Reset Notifications
chỉ tắt công tắc của app; không đổi quyền thông báo ở cấp OS.
Khi xây, thêm một dòng vào `APP_SETTINGS_RESETTERS`.

## Không được reset

- **User data (SQLite + file):** books, file sách (managed lẫn referenced), collections, annotations /
  notes / bookmarks, genres, favorite, reading status, `metadata_json` (gồm `signatureStatus`), FTS index,
  cover, cloud tokens, translation models.
- **Book-specific state:** `books.reading_state_json` — vị trí, % tiến độ, font / cỡ chữ / line height /
  căn lề / layout / margin riêng từng sách.
- **Global reading defaults:** các field typography trong `readmate.globalReadingPrefs.v1` (default để
  resolve mọi sách chưa có override). Chỉ `theme` đi theo Appearance qua bridge.
- **History:** Library search history (`reading-book.library.search-history.v1`) — xoá ở Settings → Privacy.
- **Ngoài phạm vi đã chốt:** Read aloud (`reading-book.readAloud.prefs`), Translation target
  (`reading-book.translation.prefs`), vị trí/kích thước panel Search / Translation / Word count, độ rộng
  sidebar Reader, trạng thái thu gọn sidebar Settings.

## Default settings — nguồn duy nhất

| Nhóm | Hằng số | File |
|---|---|---|
| Appearance | `DEFAULT_APP_APPEARANCE` | `src/theme/appAppearance.ts` |
| Library | `DEFAULT_LIBRARY_BROWSE_PREFS` | `src/screens/Library/logic/libraryBrowseStore.ts` |
| Notifications | `DEFAULT_NOTIFICATION_PREFS` | `src/screens/Settings/logic/notificationsStore.ts` |

Cùng một hằng được dùng cho lần chạy đầu / giá trị hỏng khi load **và** cho `reset()`. Hàm điều phối không
chứa giá trị cụ thể nào.

## Kiến trúc & data flow

App preferences không đi qua IPC và không nằm trong SQLite (migration `005_drop_app_settings.sql`): mỗi
zustand store ở renderer sở hữu persistence của nó. Vì vậy reset nằm hoàn toàn trong renderer, tái dùng
pattern store sẵn có — **không thêm IPC channel, preload API, handler Main hay migration**.

```
AdvancedSettings  ──(confirm)──▶  resetAppSettings()                  src/screens/Settings/logic/resetAppSettings.ts
                                    │  APP_SETTINGS_RESETTERS (mỗi nhóm try/catch riêng)
                                    ├─ useAppAppearanceStore.reset()  → commit(DEFAULT_APP_APPEARANCE)
                                    │     → ghi đè app-appearance.v1 → applyAppearanceAttributes (<html> accent/density/lang)
                                    │     → AppAppearanceBridge → setPrefs({ theme }) → applyTheme → titlebar (app:setChromeTheme sẵn có)
                                    └─ useLibraryBrowseStore.reset()  → set(DEFAULT_LIBRARY_BROWSE_PREFS, selectedBookId: null)
                                          → ghi đè browse-prefs.v1
                                  ◀── { failed: AppSettingsResetter[] }
AdvancedSettings  → notice success / error
```

Thao tác đồng bộ (localStorage), nên không có trạng thái loading; hộp thoại đóng ngay sau khi chạy. Các
component đang subscribe store re-render ngay — không cần restart.

## Safety boundaries

1. **Không có clear chung:** không `localStorage.clear()`, không xoá theo prefix `reading-book.*`, không
   DELETE SQL. Mỗi nhóm chỉ ghi đè đúng một key của nó.
2. **Accent tùy chỉnh:** `accent: 'custom'` áp màu qua CSS variable inline trên `<html>`
   (`customAccentTokens` trong `src/theme/accentColor.ts`); khi reset về preset, `applyAppearanceAttributes` xoá
   các biến inline đó.
3. **Ghi đè, không `removeItem`:** thiếu key appearance thì `loadAppAppearance` lấy theme cũ từ
   `globalReadingPrefs.theme` (là theme đang dùng) → sau restart theme sẽ không về `dark`.
4. **Record dùng chung được patch theo field:** `globalReadingPrefs` chứa cả theme lẫn reading defaults; reset
   không ghi record này, chỉ bridge patch `theme`.
5. **Không chạm `window.api`:** đường reset không gọi IPC nên không thể tới SQLite hay file sách. Renderer
   không có thêm quyền nào.
6. **Lỗi theo nhóm:** ghi thất bại (quota / storage bị chặn) hoặc exception ở một nhóm → nhóm đó vào
   `failed`, các nhóm khác vẫn chạy; state trong bộ nhớ vẫn về default cho phiên hiện tại và UI báo nhóm có
   thể quay lại giá trị cũ sau restart. Không có rollback (chỉ ghi default, không có trạng thái dở dang).

## Kiểm thử

`npm run spike:settings:reset` (`spikes/reset-app-settings/`, chạy store thật trên `node
--experimental-strip-types` với `localStorage` / `document` giả lập): default đúng, reset từng nhóm, reset
toàn bộ (store + storage + thuộc tính `<html>`), sống qua restart (không rơi về legacy theme), idempotent,
key ngoài phạm vi giữ nguyên từng byte, không truy cập `window.api`, cancel không đổi gì, lỗi ghi và nhóm ném
exception được báo đúng.

Kiểm tra thủ công trong app: đặt Light / Red / Compact và Library Table + sort Title → Reset → giao diện về
Dark / Orange / Balanced, Library Grid + Recently added ngay lập tức và sau restart; font / tiến độ của một
sách đã chỉnh, highlight, collection, search history không đổi; Cancel và Esc không đổi gì.
