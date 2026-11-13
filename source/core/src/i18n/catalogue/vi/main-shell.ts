import type { AreaShape } from '../../types.js'
import type { en } from '../en/main-shell.js'

/** Area `main.shell` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  tray: {
    tooltip: 'Readmate Reader',
    open: 'Mở {app}',
    quit: 'Thoát {app}',
  },
  dialogs: {
    exportReadable: 'Xuất bản đọc được',
    exportAnnotations: 'Xuất chú thích',
    importAnnotations: 'Nhập chú thích',
    markdownFilter: 'Markdown (*.md)',
    annotationsFilter: 'Chú thích Readmate (*.readmate-notes.json)',
    annotationFilesFilter: 'Tệp chú thích (*.readmate-notes.json)',
    allFiles: 'Mọi tệp',
    saveAttachment: 'Lưu tệp đính kèm',
    attachFile: 'Đính kèm tệp vào trang này',
    documents: 'Tài liệu',
    audiobookZip: 'ZIP sách nói',
    locateBook: 'Tìm “{title}”',
    exportPdf: 'Xuất PDF kèm chú thích',
    exportTranscript: 'Xuất bản chép lời',
    textFilter: 'Văn bản',
  },
  reminder: {
    title: '📚 Đến giờ đọc sách',
    continue: 'Đọc tiếp {title}?',
    pick: 'Chọn một cuốn sách trong thư viện và đọc vài trang?',
  },
} as const satisfies AreaShape<typeof en>
