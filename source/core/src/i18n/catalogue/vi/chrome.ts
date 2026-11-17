import type { AreaShape } from '../../types.js'
import type { en } from '../en/chrome.js'

/** Area `chrome` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  nav: {
    library: 'Thư viện',
    collections: 'Bộ sưu tập',
    cloudSources: 'Nguồn đám mây',
    reading: 'Đang đọc',
    settings: 'Khác',
    tools: 'Công cụ',
    mainNavigation: 'Điều hướng chính',
    cloudProviders: 'Các nguồn đám mây',
    providerUnavailable: '{provider} — {reason}',
    noOpenBooks: 'Mở một cuốn sách từ Thư viện để bắt đầu đọc',
    openBookCount: { other: '{count} sách đang mở' },
  },
  tabs: {
    openBooks: 'Sách đang mở',
    dragToReorder: '{title} — kéo để sắp xếp lại',
    closeTitle: 'Đóng “{title}”',
    closeAria: 'Đóng {title}',
  },
  splash: {
    loading: 'Đang tải',
  },
} as const satisfies AreaShape<typeof en>
