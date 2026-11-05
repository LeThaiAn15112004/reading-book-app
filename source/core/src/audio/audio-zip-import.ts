import { audioFormatFromExtension, audioPlaybackStatus } from './audio-formats.js'

/**
 * Audiobook ZIP import — the platform-free half: limits, path safety, entry classification, natural
 * ordering, cover ranking, the archive tree and the selection state. The ZIP is untrusted input; reading
 * it lives in the desktop Main process (docs/implementation_plan/audiobook_zip_import_preview.md).
 */

export const ZIP_IMPORT_LIMITS = {
  maxEntries: 5000,
  maxPathDepth: 12,
  maxPathChars: 400,
  /** Sum of declared uncompressed sizes. */
  maxTotalBytes: 8 * 1024 ** 3,
  /** One audio entry. */
  maxAudioEntryBytes: 2 * 1024 ** 3,
  maxCoverBytes: 10 * 1024 ** 2,
  /** Largest cover sent to the renderer as a preview. */
  maxCoverPreviewBytes: 2 * 1024 ** 2,
  maxCentralDirectoryBytes: 16 * 1024 ** 2,
} as const

export type ZipEntryKind = 'folder' | 'audio' | 'image' | 'metadata' | 'document' | 'archive' | 'junk' | 'other'

export type ZipEntryStatus = 'ok' | 'unsupported' | 'ignored'

export type ZipRejectCode =
  | 'invalid_zip'
  | 'empty_zip'
  | 'too_many_entries'
  | 'too_large'
  | 'unsafe_path'
  | 'path_too_deep'
  | 'duplicate_path'

export type ArchivePathResult = { ok: true; path: string } | { ok: false; code: ZipRejectCode; reason: string }

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Normalise an entry name from the central directory into a safe relative path (no trailing slash).
 * Anything that could leave the extraction boundary rejects the whole archive.
 */
export function normalizeArchivePath(raw: string): ArchivePathResult {
  const unsafe = (reason: string): ArchivePathResult => ({ ok: false, code: 'unsafe_path', reason })
  if (typeof raw !== 'string' || raw.length === 0) return unsafe('empty entry name')
  if (raw.length > ZIP_IMPORT_LIMITS.maxPathChars) return unsafe('entry name too long')
  if (CONTROL_CHARS.test(raw)) return unsafe('control character in entry name')
  if (raw.includes('\\')) return unsafe('backslash in entry name')
  if (raw.startsWith('/')) return unsafe('absolute path')
  if (/^[a-zA-Z]:/.test(raw)) return unsafe('drive-letter path')
  const segments = raw.replace(/\/+$/, '').split('/')
  const kept: string[] = []
  for (const seg of segments) {
    if (seg === '..') return unsafe('path traversal')
    if (seg === '') return unsafe('empty path segment')
    if (seg === '.') continue
    kept.push(seg)
  }
  if (kept.length === 0) return unsafe('empty entry name')
  if (kept.length > ZIP_IMPORT_LIMITS.maxPathDepth) {
    return { ok: false, code: 'path_too_deep', reason: 'folders are nested too deeply' }
  }
  return { ok: true, path: kept.join('/') }
}

/** Key for collision detection: Unicode-normalised and case-folded (Windows/macOS file systems collide on these). */
export function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

export const COVER_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const METADATA_EXTENSIONS: ReadonlySet<string> = new Set(['txt', 'nfo', 'md', 'json', 'xml', 'cue', 'm3u', 'm3u8', 'pls', 'opf', 'log', 'csv', 'ini'])
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'epub', 'doc', 'docx', 'rtf', 'odt', 'mobi', 'azw3'])
const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'rar', '7z', 'tar', 'gz'])

export function archiveExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function archiveBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function isJunkPath(path: string): boolean {
  const segments = path.split('/')
  if (segments[0] === '__MACOSX') return true
  const name = segments[segments.length - 1] ?? ''
  return name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._')
}

export interface ZipEntryClassification {
  kind: ZipEntryKind
  status: ZipEntryStatus
  reason?: string
  /** Audio format key for `kind: 'audio'` (extension only — the content is probed separately). */
  audioFormat?: string
}

/**
 * Classify by name. An audio extension only makes a *candidate*: the desktop probe (container + codec) has the
 * final say, and a format the app cannot play (aiff) is reported unsupported with the reason.
 */
export function classifyEntry(path: string, isDirectory: boolean): ZipEntryClassification {
  if (isDirectory) return { kind: 'folder', status: 'ignored' }
  if (isJunkPath(path)) return { kind: 'junk', status: 'ignored', reason: 'Archive-generated metadata' }
  const ext = archiveExtension(path)
  const audioFormat = audioFormatFromExtension(ext)
  if (audioFormat) {
    const status = audioPlaybackStatus(audioFormat)
    if (status === 'unsupported') {
      return { kind: 'audio', status: 'unsupported', audioFormat, reason: `${ext.toUpperCase()} cannot be played by Readmate` }
    }
    return { kind: 'audio', status: 'ok', audioFormat }
  }
  if (COVER_EXTENSIONS.has(ext)) return { kind: 'image', status: 'ignored' }
  if (ext === 'svg' || ext === 'bmp' || ext === 'tif' || ext === 'tiff' || ext === 'heic') {
    return { kind: 'image', status: 'ignored', reason: 'Image format not usable as a cover' }
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) return { kind: 'archive', status: 'ignored', reason: 'Nested archives are not imported' }
  if (DOCUMENT_EXTENSIONS.has(ext)) return { kind: 'document', status: 'ignored', reason: 'Not an audio file' }
  if (METADATA_EXTENSIONS.has(ext)) return { kind: 'metadata', status: 'ignored', reason: 'Descriptive file, not a chapter' }
  return { kind: 'other', status: 'ignored', reason: 'Not an audio file' }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Natural comparison: `2` < `10`, case-insensitive; ties fall back to code-unit order so the result is total. */
export function naturalCompare(a: string, b: string): number {
  const c = collator.compare(a, b)
  if (c !== 0) return c
  return a < b ? -1 : a > b ? 1 : 0
}

/** Natural order over archive paths, folder by folder (so `CD2/..` follows `CD1/..` and `CD10` follows `CD2`). */
export function compareArchivePaths(a: string, b: string): number {
  const as = a.split('/')
  const bs = b.split('/')
  const n = Math.min(as.length, bs.length)
  for (let i = 0; i < n; i += 1) {
    const aLast = i === as.length - 1
    const bLast = i === bs.length - 1
    // Files in a folder come before its sub-folders.
    if (aLast !== bLast) return aLast ? -1 : 1
    const c = naturalCompare(as[i] as string, bs[i] as string)
    if (c !== 0) return c
  }
  return as.length - bs.length
}

export type OrderWarningCode = 'no_numbering' | 'partial_numbering' | 'duplicate_numbers'

export interface ZipWarning {
  code: OrderWarningCode | 'no_cover' | 'multiple_covers'
  message: string
}

function leadingNumber(path: string): number | null {
  const m = /^\D{0,3}(\d{1,6})/.exec(archiveBasename(path))
  return m ? Number(m[1]) : null
}

/** Warn when the playback order is a guess rather than evident from numbered file names. */
export function orderWarnings(trackPaths: readonly string[]): ZipWarning[] {
  if (trackPaths.length < 2) return []
  const nums = trackPaths.map(leadingNumber)
  const numbered = nums.filter((n) => n !== null).length
  if (numbered === 0) {
    return [{ code: 'no_numbering', message: 'File names are not numbered, so the chapter order is alphabetical. Check it before importing.' }]
  }
  if (numbered < trackPaths.length) {
    return [{ code: 'partial_numbering', message: 'Only some file names start with a number, so the chapter order may not be what you expect.' }]
  }
  const seen = new Set<string>()
  for (let i = 0; i < trackPaths.length; i += 1) {
    const dir = trackPaths[i]!.slice(0, trackPaths[i]!.lastIndexOf('/') + 1)
    const key = `${dir}\u0000${nums[i]}`
    if (seen.has(key)) {
      return [{ code: 'duplicate_numbers', message: 'Two files in the same folder share a track number, so their relative order is a guess.' }]
    }
    seen.add(key)
  }
  return []
}

const COVER_NAMES: ReadonlySet<string> = new Set(['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'artwork'])

function coverScore(path: string): number {
  const base = archiveBasename(path)
  const stem = base.slice(0, base.lastIndexOf('.')).toLowerCase()
  const inRoot = !path.includes('/')
  const named = COVER_NAMES.has(stem)
  if (named && inRoot) return 0
  if (named) return 1
  if (inRoot) return 2
  return 3
}

/** Cover candidates, best first: conventional name in root, conventional name elsewhere, any root image, others. */
export function rankCoverCandidates<T extends { path: string }>(images: readonly T[]): T[] {
  return [...images].sort((a, b) => coverScore(a.path) - coverScore(b.path) || compareArchivePaths(a.path, b.path))
}

// ---------------------------------------------------------------- preview model

export interface ZipPreviewEntry {
  /** Stable id within the preview (`e<index>`); the only handle the renderer uses. */
  id: string
  /** Safe, normalised relative path. */
  path: string
  name: string
  kind: ZipEntryKind
  size: number
  status: ZipEntryStatus
  /** True for audio entries that passed validation and can be a chapter. */
  eligible: boolean
  reason?: string
  durationSeconds?: number
}

export interface ZipImportPreview {
  sessionId: string
  archiveName: string
  entries: ZipPreviewEntry[]
  /** Eligible track ids in proposed playback order. */
  trackOrder: string[]
  /** Valid cover image ids, best first. */
  coverCandidates: string[]
  defaultCoverId: string | null
  warnings: ZipWarning[]
}

export interface ZipImportSelection {
  trackIds: string[]
  coverId: string | null
}

/** Initial selection: every eligible track in order, best cover candidate. */
export function initialSelection(preview: ZipImportPreview): ZipImportSelection {
  return { trackIds: [...preview.trackOrder], coverId: preview.defaultCoverId }
}

export function toggleTrack(preview: ZipImportPreview, selection: ZipImportSelection, id: string): ZipImportSelection {
  if (!preview.trackOrder.includes(id)) return selection
  const on = new Set(selection.trackIds)
  if (on.has(id)) on.delete(id)
  else on.add(id)
  return { ...selection, trackIds: preview.trackOrder.filter((t) => on.has(t)) }
}

export function selectAllTracks(preview: ZipImportPreview, selection: ZipImportSelection): ZipImportSelection {
  return { ...selection, trackIds: [...preview.trackOrder] }
}

export function deselectAllTracks(selection: ZipImportSelection): ZipImportSelection {
  return { ...selection, trackIds: [] }
}

export function setCover(preview: ZipImportPreview, selection: ZipImportSelection, id: string | null): ZipImportSelection {
  if (id !== null && !preview.coverCandidates.includes(id)) return selection
  return { ...selection, coverId: id }
}

export function canConfirmSelection(selection: ZipImportSelection): boolean {
  return selection.trackIds.length > 0
}

/**
 * How a selection will be imported. One track goes through the ordinary single-file import (so it behaves exactly
 * like a standalone audio file); two or more become one multi-chapter audiobook.
 */
export type ZipImportMode = 'none' | 'single-file' | 'multi-chapter'

export function importModeForSelection(selection: ZipImportSelection): ZipImportMode {
  const n = selection.trackIds.length
  return n === 0 ? 'none' : n === 1 ? 'single-file' : 'multi-chapter'
}

/** What the preview must tell the user BEFORE confirming a one-track import (the cover chosen here is not applied). */
export function singleFileImportNotes(selection: ZipImportSelection): { cover: string | null; title: string | null } {
  if (importModeForSelection(selection) !== 'single-file') return { cover: null, title: null }
  return {
    cover:
      selection.coverId !== null
        ? "With one track this is imported as a single audio file. The cover selected here won't be used; the track's own cover (or a generated one) is used instead."
        : null,
    title: "The title comes from the track's own tags or file name, not from the ZIP name.",
  }
}

export type SelectionCheck = { ok: true } | { ok: false; reason: string }

/** Re-checks a selection against the preview (Main runs this again at confirmation; the renderer is not trusted). */
export function validateZipSelection(preview: ZipImportPreview, input: unknown): SelectionCheck {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'No selection.' }
  const { trackIds, coverId } = input as { trackIds?: unknown; coverId?: unknown }
  if (!Array.isArray(trackIds) || trackIds.length === 0) return { ok: false, reason: 'Select at least one audio track.' }
  if (trackIds.length > preview.trackOrder.length) return { ok: false, reason: 'Too many tracks selected.' }
  const seen = new Set<string>()
  for (const id of trackIds) {
    if (typeof id !== 'string' || seen.has(id)) return { ok: false, reason: 'Invalid track selection.' }
    if (!preview.trackOrder.includes(id)) return { ok: false, reason: 'A selected file is not a valid audio track.' }
    seen.add(id)
  }
  if (coverId !== null && coverId !== undefined) {
    if (typeof coverId !== 'string' || !preview.coverCandidates.includes(coverId)) {
      return { ok: false, reason: 'The selected cover image is not valid.' }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- tree

export interface ZipTreeNode {
  /** Folder path, or the entry id for files. */
  key: string
  name: string
  path: string
  isFolder: boolean
  entry?: ZipPreviewEntry
  children: ZipTreeNode[]
}

/** Archive structure as a tree (folders first, natural order). Implicit parent folders are created. */
export function buildZipTree(entries: readonly ZipPreviewEntry[]): ZipTreeNode[] {
  const root: ZipTreeNode = { key: '', name: '', path: '', isFolder: true, children: [] }
  const folders = new Map<string, ZipTreeNode>([['', root]])
  const folder = (path: string): ZipTreeNode => {
    const hit = folders.get(path)
    if (hit) return hit
    const cut = path.lastIndexOf('/')
    const parent = folder(cut < 0 ? '' : path.slice(0, cut))
    const node: ZipTreeNode = { key: path, name: path.slice(cut + 1), path, isFolder: true, children: [] }
    parent.children.push(node)
    folders.set(path, node)
    return node
  }
  for (const entry of entries) {
    if (entry.kind === 'folder') {
      folder(entry.path)
      continue
    }
    const cut = entry.path.lastIndexOf('/')
    folder(cut < 0 ? '' : entry.path.slice(0, cut)).children.push({
      key: entry.id,
      name: entry.name,
      path: entry.path,
      isFolder: false,
      entry,
      children: [],
    })
  }
  const sort = (node: ZipTreeNode): void => {
    node.children.sort((a, b) => (a.isFolder === b.isFolder ? naturalCompare(a.name, b.name) : a.isFolder ? -1 : 1))
    node.children.forEach(sort)
  }
  sort(root)
  return root.children
}

export interface ZipTreeRow {
  node: ZipTreeNode
  depth: number
  expanded: boolean
}

/** Visible rows for rendering; collapsed folders (by `path`) hide their descendants. */
export function flattenZipTree(nodes: readonly ZipTreeNode[], collapsed: ReadonlySet<string>): ZipTreeRow[] {
  const rows: ZipTreeRow[] = []
  const walk = (list: readonly ZipTreeNode[], depth: number): void => {
    for (const node of list) {
      const expanded = node.isFolder && !collapsed.has(node.path)
      rows.push({ node, depth, expanded })
      if (expanded) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
