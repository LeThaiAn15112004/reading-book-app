import type { AreaShape } from '../../types.js'
import type { en } from '../en/reader-phone.js'

/** Area `reader.phone` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  bars: {
    removeBookmark: 'Gỡ dấu trang',
    addBookmark: 'Thêm dấu trang',
    progress: 'Tiến độ đọc',
    contents: 'Mục lục',
    notes: 'Ghi chú',
    panels: 'Bảng của trình đọc',
  },
  sheet: {
    close: 'Đóng',
    contents: 'Mục lục',
    appearance: 'Giao diện',
  },
  marks: {
    bookmarks: 'Dấu trang',
    notes: 'Ghi chú',
    tabLabel: '{label} ({count})',
    removeHere: 'Gỡ dấu trang tại đây',
    addHere: 'Thêm dấu trang tại đây',
    noBookmarks: 'Chưa có dấu trang nào.',
    removeBookmark: 'Gỡ dấu trang {label}',
    remove: 'Gỡ',
    noNotes: 'Chưa có ghi chú hay tô sáng nào. Chọn văn bản để thêm.',
    edit: 'Sửa',
  },
  mark: {
    note: 'Ghi chú',
    highlight: 'Tô sáng',
    style: 'Kiểu',
    strike: 'Gạch ngang',
    placeholder: 'Thêm bình luận…',
    saveNote: 'Lưu bình luận',
  },
  selection: {
    aria: 'Văn bản đã chọn',
    mark: 'Đánh dấu vùng chọn',
  },
  screen: {
    page: 'Trang {page}',
    copied: 'Đã sao chép.',
    copyFailed: 'Không sao chép được.',
    anchorNotFound: 'Không tìm thấy mục đó trong tài liệu.',
    externalLink: 'Phiên bản này chưa mở liên kết tới trang web khác.',
    formatUnsupported: 'Định dạng của sách này chưa mở được trên điện thoại.',
  },
} as const satisfies AreaShape<typeof en>
