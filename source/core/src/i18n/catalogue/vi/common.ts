import type { AreaShape } from '../../types.js'
import type { en } from '../en/common.js'

/** Vietnamese texts shared by every area (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  actions: {
    ok: 'OK',
    cancel: 'Hủy',
    close: 'Đóng',
    save: 'Lưu',
    delete: 'Xóa',
    remove: 'Gỡ',
    retry: 'Thử lại',
    open: 'Mở',
    undo: 'Hoàn tác',
    redo: 'Làm lại',
  },
  duration: {
    hours: { other: '{count} giờ' },
    minutes: { other: '{count} phút' },
    seconds: { other: '{count} giây' },
  },
  units: {
    bytes: '{value} B',
    kilobytes: '{value} KB',
    megabytes: '{value} MB',
    gigabytes: '{value} GB',
  },
  appLanguage: {
    system: 'Theo hệ thống',
  },
} as const satisfies AreaShape<typeof en>
