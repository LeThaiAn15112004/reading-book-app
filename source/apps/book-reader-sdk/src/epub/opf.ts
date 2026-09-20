import { findElements, innerOf, preprocessXml, textOf } from './xml.js'
import { resolveZipHref, zipDirname } from './zip-path.js'

export const EPUB_CONTAINER_PATH = 'META-INF/container.xml'
const OPF_MEDIA_TYPE = 'application/oebps-package+xml'

/** `full-path` of the package document declared in `META-INF/container.xml`. */
export function parseContainerXml(xml: string): string | undefined {
  const rootfiles = findElements(preprocessXml(xml), 'rootfile')
  const preferred =
    rootfiles.find((r) => r.attrs['media-type'] === OPF_MEDIA_TYPE) ?? rootfiles[0]
  const fullPath = preferred?.attrs['full-path']?.trim()
  return fullPath || undefined
}

export interface OpfManifestItem {
  id: string
  /** Resolved ZIP entry path (relative to the archive root). */
  path: string
  href: string
  mediaType: string
  properties: string[]
}

export interface OpfSpineItem {
  idref: string
  linear: boolean
  /** Resolved ZIP path of the referenced manifest item, when it exists. */
  path?: string
}

export interface OpfCreator {
  name: string
  role?: string
  fileAs?: string
}

export interface OpfPackage {
  /** ZIP path of the OPF itself. */
  opfPath: string
  version?: string
  title?: string
  subtitle?: string
  creators: OpfCreator[]
  description?: string
  language?: string
  identifier?: string
  publisher?: string
  publishedDate?: string
  subjects: string[]
  manifest: OpfManifestItem[]
  spine: OpfSpineItem[]
  /** ZIP path of the cover image, when one can be identified. */
  coverPath?: string
  /** EPUB 3 navigation document (`properties="nav"`). */
  navPath?: string
  /** EPUB 2 NCX table of contents. */
  ncxPath?: string
}

/** Strip simple HTML from `dc:description` (publishers often embed `<p>`). */
function plainDescription(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned || undefined
}

/**
 * Parse an OPF package document. Mirrors the desktop `epub.adapter.ts` cover heuristics:
 * EPUB 3 `properties="cover-image"` → EPUB 2 `<meta name="cover">` → an image item whose id/href
 * mentions "cover".
 */
export function parseOpf(opfXml: string, opfPath: string): OpfPackage {
  const xml = preprocessXml(opfXml)
  const baseDir = zipDirname(opfPath)
  const metadataXml = innerOf(xml, 'metadata') ?? xml
  const manifestXml = innerOf(xml, 'manifest') ?? ''
  const spineXml = innerOf(xml, 'spine') ?? ''

  const firstText = (local: string) =>
    findElements(metadataXml, local).map(textOf).find(Boolean) || undefined

  const titles = findElements(metadataXml, 'title')
  const subtitleEl = titles.find((t) => t.attrs['title-type'] === 'subtitle')
  const mainTitle =
    titles.find((t) => t.attrs['title-type'] === 'main') ?? titles.find((t) => t !== subtitleEl)

  const creators: OpfCreator[] = findElements(metadataXml, 'creator')
    .map((el) => {
      const creator: OpfCreator = { name: textOf(el) }
      if (el.attrs.role) creator.role = el.attrs.role
      if (el.attrs['file-as']) creator.fileAs = el.attrs['file-as']
      return creator
    })
    .filter((c) => c.name)

  const subjects = [
    ...new Set(findElements(metadataXml, 'subject').map(textOf).filter(Boolean)),
  ].slice(0, 8)

  const manifest: OpfManifestItem[] = findElements(manifestXml, 'item')
    .filter((el) => el.attrs.id && el.attrs.href)
    .map((el) => ({
      id: el.attrs.id ?? '',
      href: el.attrs.href ?? '',
      path: resolveZipHref(baseDir, el.attrs.href ?? ''),
      mediaType: el.attrs['media-type'] ?? '',
      properties: (el.attrs.properties ?? '').split(/\s+/).filter(Boolean),
    }))
  const byId = new Map(manifest.map((item) => [item.id, item]))

  const spine: OpfSpineItem[] = findElements(spineXml, 'itemref')
    .filter((el) => el.attrs.idref)
    .map((el) => {
      const idref = el.attrs.idref ?? ''
      const item: OpfSpineItem = { idref, linear: el.attrs.linear !== 'no' }
      const path = byId.get(idref)?.path
      if (path) item.path = path
      return item
    })

  const pkg: OpfPackage = {
    opfPath,
    creators,
    subjects,
    manifest,
    spine,
  }
  const set = <K extends keyof OpfPackage>(key: K, value: OpfPackage[K] | undefined) => {
    if (value !== undefined) pkg[key] = value
  }

  set('version', findElements(xml, 'package')[0]?.attrs.version)
  set('title', mainTitle ? textOf(mainTitle) || undefined : undefined)
  set('subtitle', subtitleEl ? textOf(subtitleEl) || undefined : undefined)
  set('description', plainDescription(firstText('description') ?? ''))
  set('language', firstText('language'))
  set('identifier', firstText('identifier'))
  set('publisher', firstText('publisher'))
  set('publishedDate', firstText('date'))
  set('coverPath', findCoverPath(metadataXml, manifest, byId))
  set('navPath', manifest.find((i) => i.properties.includes('nav'))?.path)
  set(
    'ncxPath',
    byId.get(findElements(xml, 'spine')[0]?.attrs.toc ?? '')?.path ??
      manifest.find((i) => i.mediaType === 'application/x-dtbncx+xml')?.path,
  )
  return pkg
}

function findCoverPath(
  metadataXml: string,
  manifest: readonly OpfManifestItem[],
  byId: ReadonlyMap<string, OpfManifestItem>,
): string | undefined {
  const epub3 = manifest.find((i) => i.properties.includes('cover-image'))
  if (epub3) return epub3.path

  for (const meta of findElements(metadataXml, 'meta')) {
    if (meta.attrs.name !== 'cover' || !meta.attrs.content) continue
    const item = byId.get(meta.attrs.content)
    if (item) return item.path
  }

  return manifest.find((i) => {
    const looksCover = i.id.toLowerCase().includes('cover') || i.href.toLowerCase().includes('cover')
    return looksCover && i.mediaType.startsWith('image/')
  })?.path
}

/** Linear spine index of a content document path — maps a TOC href to a chapter index. */
export function spineIndexOfPath(pkg: OpfPackage, zipPath: string): number | undefined {
  const target = zipPath.split('#')[0]
  const index = pkg.spine.findIndex((s) => s.path === target)
  return index >= 0 ? index : undefined
}
