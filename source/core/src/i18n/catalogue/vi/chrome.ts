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
    tools: 'Tiện ích',
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
  miniPlayer: {
    region: 'Trình phát thu nhỏ',
    openPlayer: 'Mở trình phát: {title}',
    popOut: 'Mở cửa sổ nổi',
    popOutTitle: 'Mở cửa sổ nổi, nằm trên các ứng dụng khác',
    close: 'Dừng và đóng trình phát thu nhỏ',
    closeWindow: 'Dừng và đóng',
    returnToApp: 'Về ứng dụng',
    minimize: 'Thu nhỏ',
    openPlayerHint: '{title} — bấm đúp để mở trình phát',
    play: 'Phát',
    pause: 'Tạm dừng',
    skipBack: 'Lùi {seconds} giây',
    skipForward: 'Tới {seconds} giây',
    skipBackShort: '{seconds}',
    skipForwardShort: '{seconds}',
    seek: 'Vị trí trong sách nói',
    trackFailed: 'Không phát được track này.',
    tryAgain: 'Thử lại',
    skipNext: 'Sang track sau',
    windowTitle: 'Readmate — trình phát thu nhỏ',
  },
} as const satisfies AreaShape<typeof en>
