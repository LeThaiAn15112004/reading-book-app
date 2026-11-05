/**
 * Temporary `window.api` until the Mobile Bridge exists (specs/008-shared-core-architecture, T063 replaces it).
 * Enough for the UI to reach an empty Library in Expo Go (FR-017k): subscriptions return an unsubscribe function and
 * reads answer empty. Every action rejects, so nothing pretends to work.
 */
const EMPTY_LIST = /^(list|search|getAll)/

function stubGroup(group: string, known: Record<string, unknown> = {}): object {
  return new Proxy(known, {
    get: (target, method) => {
      if (typeof method !== 'string' || method === 'then') return undefined
      if (method in target) return target[method]
      if (/^on[A-Z]/.test(method)) return () => () => {}
      if (EMPTY_LIST.test(method)) return async () => []
      if (method.startsWith('get')) return async () => null
      return () => Promise.reject(new Error(`window.api.${group}.${method} is not implemented on Mobile yet`))
    },
  })
}

export function createStubApi(): object {
  const app = stubGroup('app', {
    ping: async () => 'pong',
    getFullscreen: async () => false,
    getAppInfo: async () => ({ name: 'Readmate', version: 'mobile-stub', platform: 'mobile', transcriptionSupported: false }),
    setChromeTheme: async () => undefined,
  })
  return new Proxy(app, {
    get: (target, key) => {
      if (typeof key !== 'string') return undefined
      // `app` methods sit directly on window.api; feature groups are lower-case nouns without a call.
      return FEATURE_GROUPS.has(key) ? stubGroup(key) : Reflect.get(target, key)
    },
  })
}

const FEATURE_GROUPS = new Set([
  'library',
  'import',
  'attachments',
  'graphics',
  'annotationTransfer',
  'zipImport',
  'audio',
  'overlay',
  'bookIndex',
  'search',
  'wordCount',
  'txt',
  'notifications',
  'background',
  'updates',
  'storage',
  'translation',
  'transcription',
  'cloud',
])
