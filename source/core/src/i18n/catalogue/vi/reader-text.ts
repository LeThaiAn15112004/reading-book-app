import type { AreaShape } from '../../types.js'
import type { en } from '../en/reader-text.js'

/** Area `reader.text` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  epub: {
    cover: 'Bìa',
    openFailed: 'Không mở được EPUB này.',
    opening: 'Đang mở sách…',
    preparing: 'Đang chuẩn bị sách…',
    unableToOpen: 'Không mở được sách này',
    tryAgain: 'Thử lại',
    coverAlt: 'Ảnh bìa sách',
  },
  md: {
    remoteBlocked: 'Ảnh từ xa bị chặn.',
    onlyLocal: 'Chỉ hiển thị được ảnh nằm cạnh tài liệu.',
    imageNotShown: '[Không hiển thị ảnh]',
    imageNotShownAlt: '[Không hiển thị ảnh: {alt}]',
    imageLoadFailed: 'Không tải được ảnh.',
    imageNotFound: '[Không tìm thấy ảnh]',
    imageNotFoundAlt: '[Không tìm thấy ảnh: {alt}]',
    plainFallback: 'Không định dạng được phần này nên hiển thị dạng văn bản thuần.',
    empty: 'Tệp Markdown này trống.',
    lossy: 'Tệp này không phải UTF-8 hợp lệ. Một số ký tự không đọc được và hiển thị là �.',
    loadingRest: 'Đang tải phần còn lại của tài liệu…',
  },
  txt: {
    bookText: 'Nội dung sách',
    workingCopyLost: 'Không đọc được bản đã sửa — đang hiển thị tệp gốc.',
    sourceChanged: 'Tệp gốc đã bị thay đổi bên ngoài Readmate.',
    legacyEncoding: 'Tệp này không phải UTF-8; được đọc theo Windows-1252 nên một số ký tự có thể hiển thị sai.',
    stale: { other: '{count} chú thích không còn khớp với văn bản và bị ẩn.' },
    tooLarge: 'Tệp này quá lớn để sửa ở đây — vẫn có thể đọc và chú thích.',
    removed: { other: 'Đã gỡ {count} chú thích vì đoạn văn bản bên dưới đã thay đổi.' },
    saveFailed: 'Không lưu được các thay đổi.',
    readFailed: 'Không đọc được tệp sách.',
  },
  toast: {
    markFailed: 'Không đánh dấu được vùng chọn này.',
    loadFailed: 'Không tải được tô sáng.',
    deleteFailed: 'Không xóa được tô sáng.',
    saveFailed: 'Không lưu được tô sáng.',
    updateFailed: 'Không cập nhật được tô sáng.',
    undoFailed: 'Không hoàn tác được.',
  },
} as const satisfies AreaShape<typeof en>
