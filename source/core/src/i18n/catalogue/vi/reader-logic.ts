import type { AreaShape } from '../../types.js'
import type { en } from '../en/reader-logic.js'

/** Area `reader.logic` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  page: 'Trang {page}',
  text: 'Văn bản',
  toast: {
    copied: 'Đã sao chép.',
    translateHint: 'Dịch: chọn văn bản để dịch — Esc để thoát.',
    shareStub: 'Chia sẻ — chưa khả dụng.',
    favoritesStub: 'Đã thêm vào yêu thích (bản thử nghiệm trên máy).',
    goToPageScroll: 'Không dùng được Đến trang khi đang cuộn dọc.',
    goToPageNotReady: 'Số trang chưa sẵn sàng.',
    aiSoon: 'Hỏi AI — sắp ra mắt.',
    trashStub: 'Xác nhận thùng rác — chức năng xóa sẽ có sau.',
    sectionNotFound: 'Không tìm thấy mục đó trong tài liệu.',
    linkFailed: 'Không mở được liên kết đó.',
    endUnreachable: 'Không đến được cuối sách.',
    snapshotCopied: 'Đã sao chép vùng chọn vào bộ nhớ tạm.',
    snapshotFailed: 'Không thể chụp vùng đã chọn.',
  },
  insertPopup: {
    placeholder: 'Chữ cần chèn…',
    aria: 'Chèn chữ',
  },
  bookmarks: {
    loadFailed: 'Không tải được dấu trang.',
    deleteFailed: 'Không xóa được dấu trang.',
    notYet: 'Chưa thể đặt dấu trang tại đây.',
    removed: 'Đã gỡ dấu trang.',
    added: 'Đã thêm dấu trang.',
    saveFailed: 'Không lưu được dấu trang.',
    locationNotFound: 'Không tìm thấy vị trí của dấu trang này trong sách.',
  },
  markup: {
    done: '{action} — Ctrl+Z để hoàn tác',
    highlight: 'Đã tô sáng',
    underline: 'Đã gạch chân',
    squiggly: 'Đã gạch lượn sóng',
    strikethrough: 'Đã gạch ngang',
    replace: 'Đã đánh dấu để thay — thêm chữ mới vào ghi chú',
    insert: 'Đã đánh dấu để chèn — thêm chữ cần chèn vào ghi chú',
  },
  relink: {
    failed: 'Không liên kết được tệp đó với sách này.',
  },
  open: {
    failed: 'Không mở được tệp sách này.',
  },
} as const satisfies AreaShape<typeof en>
