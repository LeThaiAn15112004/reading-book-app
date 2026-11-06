import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { CriterionResult } from '../criteria'

export interface BaselineHandle {
  destroy: () => void
  next: () => void
  prev: () => void
  setTheme: (dark: boolean) => void
  chapterIndex: number
  chapterCount: number
  tocLabels: string[]
}

interface ParsedBook {
  chapters: Array<{ href: string; html: string; label: string }>
  tocLabels: string[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => ['item', 'itemref', 'rootfile'].includes(name),
})

async function parseEpub(buffer: ArrayBuffer): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer)
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('Missing META-INF/container.xml')
  const containerDoc = parser.parse(containerXml)
  const rootfiles = containerDoc.container?.rootfiles?.rootfile ?? []
  const rootfile = rootfiles[0]?.['@_full-path'] as string | undefined
  if (!rootfile) throw new Error('Missing rootfile')

  const opfDir = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : ''
  const opfText = await zip.file(rootfile)?.async('string')
  if (!opfText) throw new Error('Missing OPF')
  const opf = parser.parse(opfText)
  const pkg = opf.package ?? opf
  const items = (pkg.manifest?.item ?? []) as Array<Record<string, string>>
  const itemrefs = (pkg.spine?.itemref ?? []) as Array<Record<string, string>>
  const byId = new Map(items.map((it) => [it['@_id'], it]))

  const navItem = items.find((it) => String(it['@_properties'] ?? '').includes('nav'))
  let tocLabels: string[] = []
  if (navItem) {
    const navPath = `${opfDir}${navItem['@_href']}`.replace(/\/+/g, '/')
    const navHtml = await zip.file(navPath)?.async('string')
    tocLabels = [...(navHtml?.matchAll(/<a[^>]*>([^<]+)<\/a>/gi) ?? [])].map((m) =>
      m[1].trim(),
    )
  }

  const chapters: ParsedBook['chapters'] = []
  for (const ref of itemrefs) {
    const item = byId.get(ref['@_idref'])
    if (!item?.['@_href']) continue
    const href = `${opfDir}${item['@_href']}`.replace(/\/+/g, '/')
    const html = await zip.file(href)?.async('string')
    if (!html) continue
    chapters.push({
      href,
      html,
      label: tocLabels[chapters.length] ?? item['@_href'],
    })
  }

  return { chapters, tocLabels }
}

function rewriteAssets(html: string, blobUrls: Map<string, string>): string {
  let out = html
  for (const [name, url] of blobUrls) {
    const base = name.split('/').pop() ?? name
    out = out.split(`href="${base}"`).join(`href="${url}"`)
    out = out.split(`src="${base}"`).join(`src="${url}"`)
  }
  return out
}

export async function openBaseline(
  buffer: ArrayBuffer,
  host: HTMLElement,
): Promise<{ handle: BaselineHandle; results: CriterionResult[] }> {
  const results: CriterionResult[] = []
  const parsed = await parseEpub(buffer)
  results.push({
    id: 'open_arraybuffer',
    verdict: 'Pass',
    note: 'JSZip.loadAsync(ArrayBuffer)',
  })
  results.push({
    id: 'toc',
    verdict: parsed.tocLabels.length >= 1 ? 'Pass' : 'Partial',
    note: `${parsed.tocLabels.length} nav labels; ${parsed.chapters.length} spine chapters`,
  })
  results.push({
    id: 'nav_scroll',
    verdict: parsed.chapters.length >= 2 ? 'Partial' : 'Fail',
    note: 'Chapter index only; no paginated columns / CFI page units',
  })
  results.push({
    id: 'cfi',
    verdict: 'Fail',
    note: 'No CFI — blocks T4.1 resume / G5 highlight anchors',
  })
  results.push({
    id: 'theme_css',
    verdict: 'Partial',
    note: 'Can inject <style> into iframe; ad hoc',
  })
  results.push({
    id: 'selection',
    verdict: 'Partial',
    note: 'DOM selection works; no selection→location codec',
  })
  results.push({
    id: 'search',
    verdict: 'Partial',
    note: 'Scan chapter HTML strings',
  })
  results.push({
    id: 'electron_vite',
    verdict: 'Pass',
    note: 'No new deps beyond jszip already in app',
  })
  results.push({
    id: 'maintenance',
    verdict: 'Fail',
    note: 'Must build CFI, pagination, asset map, search — not viable for MVP',
  })

  host.replaceChildren()
  const iframe = document.createElement('iframe')
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframe.style.border = '0'
  iframe.title = 'Baseline EPUB chapter'
  host.append(iframe)

  let index = 0
  const themeStyle = { dark: false }

  const render = () => {
    const ch = parsed.chapters[index]
    if (!ch || !iframe.contentDocument) return
    const theme = themeStyle.dark
      ? 'body{color:#e8e4d9;background:#1c1b1a;font-size:112%;line-height:1.6;margin:1.5em;font-family:Georgia,serif}'
      : 'body{color:#1a1a1a;background:#f7f3ea;font-size:112%;line-height:1.6;margin:1.5em;font-family:Georgia,serif}'
    const html = rewriteAssets(ch.html, new Map())
    iframe.srcdoc = html.includes('</head>')
      ? html.replace('</head>', `<style id="spike-theme">${theme}</style></head>`)
      : `<style id="spike-theme">${theme}</style>${html}`
  }

  // wait a tick for iframe document
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  render()

  const handle: BaselineHandle = {
    chapterIndex: 0,
    chapterCount: parsed.chapters.length,
    tocLabels: parsed.tocLabels,
    destroy: () => {
      host.replaceChildren()
    },
    next: () => {
      if (index < parsed.chapters.length - 1) {
        index += 1
        handle.chapterIndex = index
        render()
      }
    },
    prev: () => {
      if (index > 0) {
        index -= 1
        handle.chapterIndex = index
        render()
      }
    },
    setTheme: (dark) => {
      themeStyle.dark = dark
      render()
    },
  }

  return { handle, results }
}
