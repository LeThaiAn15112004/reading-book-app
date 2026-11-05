/**
 * M2 only (T020): a fake `window.api` serving fixed sample books, so the unmodified UI can be judged in a
 * WebView before the bridge exists. Absent from the production bundle. Nothing here is saved.
 */
type Sample = { id: string; title: string; format: 'epub' | 'pdf' | 'txt' | 'md'; file: string; bytes: number }

const LIST_METHOD = /^(list|search|getAll)/

/** XHR, not fetch: Chromium's fetch refuses file:, and T017 must judge modules and workers, not this harness. */
function readBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url)
    request.responseType = 'arraybuffer'
    request.onload = () => resolve(request.response as ArrayBuffer)
    request.onerror = () => reject(new Error(`Could not read ${url}`))
    request.send()
  })
}

async function loadSamples(): Promise<Sample[]> {
  const bytes = await readBytes('./feasibility/manifest.json')
  return JSON.parse(new TextDecoder().decode(bytes)) as Sample[]
}

function summary(sample: Sample) {
  const now = new Date(0).toISOString()
  return {
    id: sample.id,
    title: sample.title,
    format: sample.format,
    addedAt: now,
    updatedAt: now,
    fileName: sample.file,
    fileSizeBytes: sample.bytes,
    fileStorage: 'managed',
  }
}

function fakeGroup(group: string, overrides: Record<string, unknown> = {}): object {
  return new Proxy(overrides, {
    get: (target, method) => {
      // `then` must stay absent, or awaiting this object would treat it as a promise and hang.
      if (typeof method !== 'string' || method === 'then') return undefined
      if (method in target) return target[method]
      if (/^on[A-Z]/.test(method)) return () => () => {}
      return async () => {
        console.debug(`[feasibility] ${group}.${method}`)
        if (LIST_METHOD.test(method)) return []
        return method.startsWith('get') ? null : { ok: true }
      }
    },
  })
}

export async function createFakeApi(): Promise<object> {
  const samples = await loadSamples()
  const byId = new Map(samples.map((sample) => [sample.id, sample]))

  const read = async (id: string) => {
    const sample = byId.get(id)
    if (!sample) return null
    return { sample, data: await readBytes(`./feasibility/${sample.file}`) }
  }

  const groups: Record<string, object> = {
    library: fakeGroup('library', {
      listBooks: async () => samples.map(summary),
      getBook: async (id: string) => {
        const sample = byId.get(id)
        return sample ? summary(sample) : null
      },
      openBookContent: async (id: string) => {
        const book = await read(id)
        if (!book) return { ok: false, bookId: id, errorCode: 'not_found', errorMessage: 'Unknown sample' }
        reportMemory(`opened ${book.sample.title}`)
        return { ok: true, bookId: id, format: book.sample.format, data: book.data, byteLength: book.data.byteLength }
      },
    }),
    txt: fakeGroup('txt', {
      open: async (id: string) => {
        const book = await read(id)
        if (!book) return { ok: false, bookId: id, errorCode: 'not_found', errorMessage: 'Unknown sample' }
        return {
          ok: true,
          bookId: id,
          text: new TextDecoder().decode(book.data),
          revision: 0,
          editable: false,
          edited: false,
          notices: [],
          encoding: 'utf-8',
          highlights: [],
        }
      },
    }),
  }

  showReport()
  return new Proxy(
    fakeGroup('app', {
      ping: async () => 'pong',
      getAppInfo: async () => ({ name: 'Readmate', version: 'feasibility', platform: 'android', transcriptionSupported: false }),
      getFullscreen: async () => false,
    }),
    {
      get: (target, key) => {
        if (typeof key !== 'string') return undefined
        return FEATURE_GROUPS.has(key) ? (groups[key] ??= fakeGroup(key)) : Reflect.get(target, key)
      },
    },
  )
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

const LAUNCH_KEY = 'readmate.feasibility.launches'
let reportLine: HTMLElement | null = null

/** Heap figures exist on Chromium only; the line says so rather than showing a zero. */
function heapText(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  if (!memory) return 'heap n/a'
  const mb = (value: number) => Math.round(value / 1048576)
  return `heap ${mb(memory.usedJSHeapSize)}/${mb(memory.jsHeapSizeLimit)} MB`
}

function reportMemory(label: string) {
  if (reportLine) reportLine.dataset.last = `${label}: ${heapText()}`
  renderReport()
}

function renderReport() {
  if (!reportLine) return
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?'
  reportLine.textContent = `launch ${reportLine.dataset.launch} | Chrome ${chrome} | ${location.protocol} | ${reportLine.dataset.last ?? heapText()}`
}

/** Launch count survives a restart only if `localStorage` does, which is what M2 needs to see. */
function showReport() {
  let launch = 1
  try {
    launch = Number(localStorage.getItem(LAUNCH_KEY) ?? 0) + 1
    localStorage.setItem(LAUNCH_KEY, String(launch))
  } catch {
    launch = -1
  }
  const line = document.createElement('div')
  line.id = 'feasibility-report'
  line.dataset.launch = String(launch)
  line.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:99999;font:10px monospace;background:#000c;color:#fff;padding:2px 4px;pointer-events:none'
  document.body.append(line)
  reportLine = line
  renderReport()
}
