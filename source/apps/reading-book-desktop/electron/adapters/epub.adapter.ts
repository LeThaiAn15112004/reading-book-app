import type { DocumentImporter, ImportResult } from '@reading-book/domain'
import { DocumentFormat } from '@reading-book/domain'
import { resolveFormatFromExtension } from '@reading-book/config'
import { XMLParser } from 'fast-xml-parser'
import fsp from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { coverDirForBook } from '../files/metadata-filename'
import { buildImportResult } from './filename-fallback-importer'

const COVER_IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) =>
    ['item', 'itemref', 'meta', 'title', 'creator', 'rootfile'].includes(name),
})

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim()
    return t || undefined
  }
  const rec = asRecord(value)
  if (!rec) return undefined
  if (typeof rec['#text'] === 'string') {
    const t = rec['#text'].trim()
    return t || undefined
  }
  return undefined
}

function collectTexts(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.flatMap((v) => collectTexts(v))
  }
  const single = textContent(value)
  return single ? [single] : []
}

function normalizeZipPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '')
}

function resolveZipRelative(baseDir: string, href: string): string {
  const joined = path.posix.normalize(
    path.posix.join(baseDir.replace(/\\/g, '/'), href.replace(/\\/g, '/')),
  )
  return normalizeZipPath(joined)
}

interface ParsedOpf {
  title?: string
  authors: string[]
  coverHref?: string
}

function findManifestItems(opf: Record<string, unknown>): Record<string, unknown>[] {
  const packageNode = asRecord(opf.package) ?? opf
  const manifest = asRecord(packageNode.manifest)
  if (!manifest) return []
  const items = manifest.item
  if (!items) return []
  if (Array.isArray(items)) {
    return items.map(asRecord).filter((x): x is Record<string, unknown> => !!x)
  }
  const one = asRecord(items)
  return one ? [one] : []
}

function findMetaNodes(opf: Record<string, unknown>): Record<string, unknown>[] {
  const packageNode = asRecord(opf.package) ?? opf
  const metadata = asRecord(packageNode.metadata)
  if (!metadata) return []
  const metas = metadata.meta
  if (!metas) return []
  if (Array.isArray(metas)) {
    return metas.map(asRecord).filter((x): x is Record<string, unknown> => !!x)
  }
  const one = asRecord(metas)
  return one ? [one] : []
}

function parseOpf(opfXml: string): ParsedOpf {
  const root = asRecord(xmlParser.parse(opfXml)) ?? {}
  const packageNode = asRecord(root.package) ?? root
  const metadata = asRecord(packageNode.metadata) ?? {}

  const titles = collectTexts(metadata.title)
  const authors = collectTexts(metadata.creator)

  const items = findManifestItems(root)
  const byId = new Map<string, Record<string, unknown>>()
  for (const item of items) {
    const id = typeof item['@_id'] === 'string' ? item['@_id'] : undefined
    if (id) byId.set(id, item)
  }

  let coverHref: string | undefined

  // EPUB3: properties="… cover-image …"
  for (const item of items) {
    const props = typeof item['@_properties'] === 'string' ? item['@_properties'] : ''
    if (props.split(/\s+/).includes('cover-image')) {
      const href = typeof item['@_href'] === 'string' ? item['@_href'] : undefined
      if (href) {
        coverHref = href
        break
      }
    }
  }

  // EPUB2: <meta name="cover" content="id"/>
  if (!coverHref) {
    for (const meta of findMetaNodes(root)) {
      const name = typeof meta['@_name'] === 'string' ? meta['@_name'] : undefined
      if (name !== 'cover') continue
      const content =
        typeof meta['@_content'] === 'string' ? meta['@_content'] : undefined
      if (!content) continue
      const item = byId.get(content)
      const href = item && typeof item['@_href'] === 'string' ? item['@_href'] : undefined
      if (href) {
        coverHref = href
        break
      }
    }
  }

  // Fallback: item id/href containing "cover" and image media-type
  if (!coverHref) {
    for (const item of items) {
      const id = typeof item['@_id'] === 'string' ? item['@_id'].toLowerCase() : ''
      const href = typeof item['@_href'] === 'string' ? item['@_href'] : ''
      const media =
        typeof item['@_media-type'] === 'string' ? item['@_media-type'] : ''
      const looksCover = id.includes('cover') || href.toLowerCase().includes('cover')
      const isImage = media.startsWith('image/')
      if (looksCover && isImage && href) {
        coverHref = href
        break
      }
    }
  }

  return {
    title: titles[0],
    authors,
    coverHref,
  }
}

function parseContainerRootfile(containerXml: string): string | undefined {
  const root = asRecord(xmlParser.parse(containerXml)) ?? {}
  const container = asRecord(root.container)
  const rootfiles = asRecord(container?.rootfiles)
  if (!rootfiles) return undefined

  const list = rootfiles.rootfile
  const entries = Array.isArray(list) ? list : list ? [list] : []
  for (const entry of entries) {
    const rec = asRecord(entry)
    const fullPath =
      rec && typeof rec['@_full-path'] === 'string' ? rec['@_full-path'] : undefined
    if (fullPath) return normalizeZipPath(fullPath)
  }
  return undefined
}

async function extractCoverToSandbox(
  zip: JSZip,
  opfPath: string,
  coverHref: string,
  sandboxFilePath: string,
): Promise<string | undefined> {
  const opfDir = path.posix.dirname(opfPath)
  const zipEntryPath = resolveZipRelative(opfDir === '.' ? '' : opfDir, coverHref)
  const entry =
    zip.file(zipEntryPath) ??
    zip.file(normalizeZipPath(coverHref)) ??
    Object.values(zip.files).find(
      (f) => !f.dir && normalizeZipPath(f.name).toLowerCase() === zipEntryPath.toLowerCase(),
    )

  if (!entry || entry.dir) return undefined

  const ext = path.extname(entry.name).toLowerCase()
  if (!COVER_IMAGE_EXTS.has(ext)) return undefined

  const data = await entry.async('nodebuffer')
  const dest = path.join(coverDirForBook(sandboxFilePath), `cover${ext}`)
  await fsp.writeFile(dest, data)
  return dest
}

async function extractEpubMetadata(filePath: string): Promise<{
  title?: string
  authors: string[]
  coverPath?: string
}> {
  const buf = await fsp.readFile(filePath)
  const zip = await JSZip.loadAsync(buf)

  const containerEntry = zip.file('META-INF/container.xml')
  if (!containerEntry) {
    return { authors: [] }
  }

  const containerXml = await containerEntry.async('string')
  const opfPath = parseContainerRootfile(containerXml)
  if (!opfPath) {
    return { authors: [] }
  }

  const opfEntry = zip.file(opfPath)
  if (!opfEntry) {
    return { authors: [] }
  }

  const opfXml = await opfEntry.async('string')
  const parsed = parseOpf(opfXml)

  let coverPath: string | undefined
  if (parsed.coverHref) {
    try {
      coverPath = await extractCoverToSandbox(zip, opfPath, parsed.coverHref, filePath)
    } catch {
      coverPath = undefined
    }
  }

  return {
    title: parsed.title,
    authors: parsed.authors,
    coverPath,
  }
}

/** EPUB DocumentImporter — OPF title/author + cover when present (T2.9). */
export const epubAdapter: DocumentImporter = {
  canHandle(filePath: string): boolean {
    const ext = path.extname(path.basename(filePath)).toLowerCase()
    return resolveFormatFromExtension(ext) === DocumentFormat.Epub
  },

  async import(filePath: string): Promise<ImportResult> {
    let title: string | undefined
    let authorNames: string[] | undefined
    let coverPath: string | undefined

    try {
      const meta = await extractEpubMetadata(filePath)
      title = meta.title
      authorNames = meta.authors.length > 0 ? meta.authors : undefined
      coverPath = meta.coverPath
    } catch {
      // Corrupt / unreadable EPUB metadata → filename fallback; do not fail import.
    }

    return buildImportResult(filePath, DocumentFormat.Epub, {
      title,
      authorNames,
      coverPath,
    })
  },
}
