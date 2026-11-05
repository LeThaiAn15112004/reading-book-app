import { SdkError } from '../core/errors.js'
import type { ArchiveReader } from '../ports/archive.js'
import { EPUB_CONTAINER_PATH, parseContainerXml, parseOpf, type OpfPackage } from './opf.js'

/** Metadata the library needs from an EPUB at import time. */
export interface EpubImportMetadata {
  title?: string
  authors: string[]
  description?: string
  genres: string[]
  language?: string
  /** Spine length — the desktop app's "page count" for EPUB. */
  pageCount?: number
  cover?: { bytes: Uint8Array; extension: string }
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])

/** Locate and parse the OPF package document through the injected archive reader. */
export async function readEpubPackage(archive: ArchiveReader): Promise<OpfPackage> {
  const containerXml = await archive.readText(EPUB_CONTAINER_PATH)
  let opfPath = containerXml ? parseContainerXml(containerXml) : undefined

  // Some real-world EPUBs ship without (or with a broken) container.xml.
  if (!opfPath) {
    opfPath = archive.listEntries().find((entry) => entry.toLowerCase().endsWith('.opf'))
  }
  if (!opfPath) {
    throw new SdkError('EPUB_MALFORMED', 'EPUB has no package document (.opf)')
  }

  const opfXml = await archive.readText(opfPath)
  if (opfXml === null) {
    throw new SdkError('EPUB_MALFORMED', `EPUB package document not found: ${opfPath}`)
  }
  return parseOpf(opfXml, opfPath)
}

export async function readEpubImportMetadata(
  archive: ArchiveReader,
  options: { includeCover?: boolean } = {},
): Promise<EpubImportMetadata> {
  const pkg = await readEpubPackage(archive)

  const metadata: EpubImportMetadata = {
    authors: pkg.creators
      .filter((c) => !c.role || c.role === 'aut')
      .map((c) => c.name),
    genres: pkg.subjects,
  }
  if (metadata.authors.length === 0) metadata.authors = pkg.creators.map((c) => c.name)
  if (pkg.title) metadata.title = pkg.title
  if (pkg.description) metadata.description = pkg.description
  if (pkg.language) metadata.language = pkg.language
  if (pkg.spine.length > 0) metadata.pageCount = pkg.spine.length

  if (options.includeCover !== false && pkg.coverPath) {
    const extension = (/\.([A-Za-z0-9]+)$/.exec(pkg.coverPath)?.[1] ?? '').toLowerCase()
    if (IMAGE_EXTENSIONS.has(extension)) {
      const bytes = await archive.readBytes(pkg.coverPath)
      if (bytes && bytes.length > 0) metadata.cover = { bytes, extension }
    }
  }
  return metadata
}
