import type { AreaShape } from '../../types.js'
import type { en } from '../en/appHooks.js'

/** Area `appHooks` in Vietnamese (glossary: specs/012-app-ui-i18n/contracts/glossary.md). */
export const vi = {
  cloud: {
    notConfigured: 'Chưa được cấu hình',
    comingSoon: 'Sắp ra mắt',
  },
} as const satisfies AreaShape<typeof en>
