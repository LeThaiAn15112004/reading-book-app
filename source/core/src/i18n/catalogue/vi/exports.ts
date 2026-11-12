import type { AreaShape } from '../../types.js'
import type { en } from '../en/exports.js'

/** Area `exports` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  exported: 'Xuất ngày {date}',
  annotationCount: { other: ' · {count} chú thích' },
  attachmentCount: { other: ' · {count} tệp đính kèm' },
  headings: {
    page: 'Trang {n}',
    chapter: 'Chương {n}',
    section: 'Mục {n}',
    annotations: 'Chú thích',
  },
  place: {
    onPage: ' ở trang {n}',
    inChapter: ' ở chương {n}',
  },
  kinds: {
    highlight: 'Tô sáng',
    underline: 'Gạch chân',
    squiggly: 'Gạch lượn sóng',
    strikethrough: 'Gạch ngang',
    replace: 'Thay chữ',
    insert: 'Chèn chữ',
    textbox: 'Khung chữ',
    rectangle: 'Hình chữ nhật',
    ellipse: 'Hình elip',
    line: 'Đường thẳng',
    arrow: 'Mũi tên',
    typewriter: 'Ghi chú đánh máy',
  },
  note: 'Bình luận: {text}',
  attachment: '📎 {name} ({size}), trang {page}',
} as const satisfies AreaShape<typeof en>
