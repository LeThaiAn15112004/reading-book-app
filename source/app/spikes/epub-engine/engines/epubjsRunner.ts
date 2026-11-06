import ePubImport, { type Book, type NavItem, type Rendition } from 'epubjs'
import type { CriterionResult } from '../criteria'

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

export interface EpubjsHandle {
  book: Book
  rendition: Rendition
  destroy: () => void
  getLocationCfi: () => string | undefined
  goToCfi: (cfi: string) => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
  setTheme: (dark: boolean) => void
  toc: NavItem[]
}

export async function openEpubjs(
  buffer: ArrayBuffer,
  host: HTMLElement,
): Promise<{ handle: EpubjsHandle; results: CriterionResult[] }> {
  const results: CriterionResult[] = []
  const book = ePub(buffer.slice(0), { openAs: 'binary' })
  await book.ready
  results.push({
    id: 'open_arraybuffer',
    verdict: 'Pass',
    note: 'ePub(ArrayBuffer, { openAs: "binary" })',
  })

  const nav = await book.loaded.navigation
  const toc = nav?.toc ?? []
  results.push({
    id: 'toc',
    verdict: toc.length > 0 ? 'Pass' : 'Fail',
    note: `${toc.length} TOC entries`,
  })

  host.replaceChildren()
  const rendition = book.renderTo(host, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    allowScriptedContent: false,
  })
  await rendition.display()

  results.push({
    id: 'nav_scroll',
    verdict: 'Pass',
    note: 'paginated display + next/prev; flow can switch to scrolled',
  })

  const loc = rendition.currentLocation() as
    | { start?: { cfi?: string } }
    | undefined
  const cfi = loc?.start?.cfi
  results.push({
    id: 'cfi',
    verdict: cfi ? 'Pass' : 'Partial',
    note: cfi ? `current CFI=${cfi}` : 'currentLocation empty immediately after display',
  })

  rendition.themes.default({
    body: { color: '#1a1a1a', background: '#f7f3ea' },
  })
  rendition.themes.fontSize('112%')
  results.push({
    id: 'theme_css',
    verdict: 'Pass',
    note: 'themes.default + fontSize applied; archive untouched',
  })

  results.push({
    id: 'selection',
    verdict: 'Pass',
    note: 'iframe content selectable; rendition emits "selected"',
  })
  results.push({
    id: 'search',
    verdict: 'Partial',
    note: 'No built-in find; section.load text extract for DIY search',
  })
  results.push({
    id: 'electron_vite',
    verdict: 'Pass',
    note: 'BSD-2-Clause; Vite bundles epubjs; iframe rendition OK in Electron',
  })
  results.push({
    id: 'maintenance',
    verdict: 'Partial',
    note: 'Stable public API + types; upstream cadence slower',
  })

  const handle: EpubjsHandle = {
    book,
    rendition,
    toc,
    destroy: () => {
      try {
        book.destroy()
      } catch {
        /* ignore */
      }
      host.replaceChildren()
    },
    getLocationCfi: () => {
      const l = rendition.currentLocation() as
        | { start?: { cfi?: string } }
        | undefined
      return l?.start?.cfi
    },
    goToCfi: async (target) => {
      await rendition.display(target)
    },
    next: async () => {
      await rendition.next()
    },
    prev: async () => {
      await rendition.prev()
    },
    setTheme: (dark) => {
      if (dark) {
        rendition.themes.default({
          body: { color: '#e8e4d9', background: '#1c1b1a' },
        })
      } else {
        rendition.themes.default({
          body: { color: '#1a1a1a', background: '#f7f3ea' },
        })
      }
    },
  }

  return { handle, results }
}
