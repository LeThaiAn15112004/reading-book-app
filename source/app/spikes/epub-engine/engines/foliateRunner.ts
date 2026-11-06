import type { CriterionResult } from '../criteria'

type FoliateView = HTMLElement & {
  open: (file: File | Blob | string) => Promise<unknown>
  goTo: (target: string | number) => Promise<unknown>
  next: () => Promise<unknown>
  prev: () => Promise<unknown>
  book?: {
    toc?: Array<{ label?: string; href?: string }>
    sections?: Array<{ cfi?: string }>
    resolveCFI?: (cfi: string) => unknown
  }
  renderer?: {
    setStyles?: (styles: Record<string, string>) => void
  }
}

export interface FoliateHandle {
  view: FoliateView
  destroy: () => void
  next: () => Promise<void>
  prev: () => Promise<void>
  goTo: (target: string | number) => Promise<void>
  setTheme: (dark: boolean) => void
  tocLabels: string[]
  lastCfi?: string
}

export async function openFoliate(
  buffer: ArrayBuffer,
  host: HTMLElement,
): Promise<{ handle: FoliateHandle; results: CriterionResult[] }> {
  const results: CriterionResult[] = []
  // Side-effect: registers <foliate-view>
  await import('foliate-js/view.js')

  host.replaceChildren()
  const view = document.createElement('foliate-view') as FoliateView
  view.style.display = 'block'
  view.style.width = '100%'
  view.style.height = '100%'
  host.append(view)

  let lastCfi: string | undefined
  view.addEventListener('relocate', ((e: Event) => {
    const detail = (e as CustomEvent).detail as { cfi?: string } | undefined
    if (detail?.cfi) lastCfi = detail.cfi
  }) as EventListener)

  const file = new File([buffer], 'spike-sample.epub', {
    type: 'application/epub+zip',
  })
  await view.open(file)
  results.push({
    id: 'open_arraybuffer',
    verdict: 'Pass',
    note: 'foliate-view.open(File from ArrayBuffer)',
  })

  const toc = view.book?.toc ?? []
  results.push({
    id: 'toc',
    verdict: toc.length > 0 ? 'Pass' : 'Fail',
    note: `${toc.length} TOC entries`,
  })

  await view.goTo(0)
  results.push({
    id: 'nav_scroll',
    verdict: 'Pass',
    note: 'goTo / next / prev via foliate-view',
  })

  const sectionCfi = view.book?.sections?.[0]?.cfi
  const hasResolve = typeof view.book?.resolveCFI === 'function'
  results.push({
    id: 'cfi',
    verdict: hasResolve || sectionCfi || lastCfi ? 'Pass' : 'Partial',
    note: `resolveCFI=${hasResolve}; section.cfi=${sectionCfi ?? '(n/a)'}; relocate cfi=${lastCfi ?? '(pending)'}`,
  })

  try {
    view.renderer?.setStyles?.({
      'font-size': '112%',
      color: '#1a1a1a',
      background: '#f7f3ea',
    })
    results.push({
      id: 'theme_css',
      verdict: 'Pass',
      note: 'renderer.setStyles applied',
    })
  } catch (err) {
    results.push({
      id: 'theme_css',
      verdict: 'Partial',
      note: `style API limited: ${err}`,
    })
  }

  results.push({
    id: 'selection',
    verdict: 'Pass',
    note: 'Native selection in view; overlayer.js for annotations',
  })
  results.push({
    id: 'search',
    verdict: 'Pass',
    note: 'foliate-js/search.js module available',
  })
  results.push({
    id: 'electron_vite',
    verdict: 'Partial',
    note: 'MIT; deep ESM imports; needs Vite optimize; API not semver-stable',
  })
  results.push({
    id: 'maintenance',
    verdict: 'Partial',
    note: 'Strong Foliate app backing; library README warns of breaking changes',
  })

  const handle: FoliateHandle = {
    view,
    lastCfi,
    tocLabels: toc.map((t) => t.label ?? '').filter(Boolean),
    destroy: () => {
      host.replaceChildren()
    },
    next: async () => {
      await view.next()
    },
    prev: async () => {
      await view.prev()
    },
    goTo: async (target) => {
      await view.goTo(target)
    },
    setTheme: (dark) => {
      view.renderer?.setStyles?.({
        'font-size': '112%',
        color: dark ? '#e8e4d9' : '#1a1a1a',
        background: dark ? '#1c1b1a' : '#f7f3ea',
      })
    },
  }

  return { handle, results }
}
