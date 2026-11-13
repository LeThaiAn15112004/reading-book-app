import type { AreaShape } from '../../types.js'
import type { en } from '../en/appHooks.js'

/** Area `appHooks` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  cloud: {
    notConfigured: 'Chưa được cấu hình',
    comingSoon: 'Sắp ra mắt',
    connection: {
      connected: { other: 'Đã kết nối {provider}. Tìm thấy {count} tệp sách.' },
      failed: 'Kết nối {provider} không thành công: {error}',
      folderLinked: 'Đã kết nối thư mục {provider} đồng bộ: {path}',
      notConnected: 'Chưa kết nối {provider}. Hãy đăng nhập, hoặc chọn một thư mục đồng bộ trên máy này.',
      clientConfigured: 'Đã thiết lập {provider}. Hãy đăng nhập để kết nối.',
      defaultMode: '{provider} đã sẵn sàng. Hãy đăng nhập để đồng bộ từ đám mây.',
      syncFailed: 'Đồng bộ {provider} không thành công: {error}',
      unsupported: '{provider} không phải nguồn đám mây được hỗ trợ.',
      untitledFolder: 'Thư mục không tên',
      unknownFile: 'Tệp không rõ tên',
    },
  },
} as const satisfies AreaShape<typeof en>
