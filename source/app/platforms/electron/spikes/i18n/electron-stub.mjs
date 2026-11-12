/** Stand-in for the parts of `electron` that `i18n/main-i18n.ts` and `prefs/json-prefs-file.ts` use (spec 012). */
export const stub = {
  userData: '',
  /** What `app.getPreferredSystemLanguages()` answers; `null` → it throws. */
  preferredLanguages: ['en-US'],
  /** What `app.getLocale()` answers. */
  locale: 'en-US',
}

export const app = {
  getPath: (name) => {
    if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
    return stub.userData
  },
  getPreferredSystemLanguages: () => {
    if (stub.preferredLanguages === null) throw new Error('not available')
    return [...stub.preferredLanguages]
  },
  getLocale: () => stub.locale,
}

/** For `background/background-mode.ts` (tray texts, spec 012 US3): records nothing, builds the template as is. */
export const Menu = { buildFromTemplate: (template) => ({ items: template }) }
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true, setTemplateImage() {} }) }
export class Tray {}
