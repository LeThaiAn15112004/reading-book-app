import { describe, expect, it } from 'vitest'
import {
  buildZipTree,
  canConfirmSelection,
  classifyEntry,
  collisionKey,
  compareArchivePaths,
  deselectAllTracks,
  flattenZipTree,
  initialSelection,
  normalizeArchivePath,
  orderWarnings,
  rankCoverCandidates,
  selectAllTracks,
  setCover,
  toggleTrack,
  validateZipSelection,
  ZIP_IMPORT_LIMITS,
  type ZipImportPreview,
  type ZipPreviewEntry,
} from '../../src/audio/audio-zip-import'

describe('normalizeArchivePath', () => {
  it('keeps ordinary nested paths and drops trailing slashes and "." segments', () => {
    expect(normalizeArchivePath('Book/CD1/01.mp3')).toEqual({ ok: true, path: 'Book/CD1/01.mp3' })
    expect(normalizeArchivePath('Book/')).toEqual({ ok: true, path: 'Book' })
    expect(normalizeArchivePath('./a/./b.mp3')).toEqual({ ok: true, path: 'a/b.mp3' })
  })

  it.each([
    ['../evil.mp3'],
    ['a/../../evil.mp3'],
    ['a/..'],
    ['/etc/passwd'],
    ['C:/Windows/x.mp3'],
    ['c:evil.mp3'],
    ['a\\b.mp3'],
    ['\\\\server\\share\\x.mp3'],
    ['a//b.mp3'],
    ['a/\u0000b.mp3'],
    [''],
  ])('rejects %j', (raw) => {
    const r = normalizeArchivePath(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('unsafe_path')
  })

  it('rejects over-deep and over-long paths', () => {
    const deep = Array.from({ length: ZIP_IMPORT_LIMITS.maxPathDepth + 1 }, () => 'd').join('/')
    const r = normalizeArchivePath(deep)
    expect(r.ok === false && r.code).toBe('path_too_deep')
    expect(normalizeArchivePath('x'.repeat(ZIP_IMPORT_LIMITS.maxPathChars + 1)).ok).toBe(false)
  })

  it('collision keys fold case and Unicode form', () => {
    expect(collisionKey('Café/A.mp3')).toBe(collisionKey('cafe\u0301/a.MP3'))
  })
})

describe('classifyEntry', () => {
  it('marks playable audio candidates and records the format', () => {
    expect(classifyEntry('01.mp3', false)).toMatchObject({ kind: 'audio', status: 'ok', audioFormat: 'mp3' })
    expect(classifyEntry('x/Ch.M4B', false)).toMatchObject({ kind: 'audio', status: 'ok', audioFormat: 'm4b' })
  })
  it('flags aiff as unsupported audio with a reason', () => {
    const c = classifyEntry('a.aif', false)
    expect(c).toMatchObject({ kind: 'audio', status: 'unsupported' })
    expect(c.reason).toBeTruthy()
  })
  it('ignores auxiliary files and says why', () => {
    expect(classifyEntry('README.txt', false).kind).toBe('metadata')
    expect(classifyEntry('meta.json', false).kind).toBe('metadata')
    expect(classifyEntry('book.pdf', false).kind).toBe('document')
    expect(classifyEntry('book.epub', false).kind).toBe('document')
    expect(classifyEntry('b.docx', false).kind).toBe('document')
    expect(classifyEntry('inner.zip', false)).toMatchObject({ kind: 'archive', status: 'ignored' })
    expect(classifyEntry('__MACOSX/x/._01.mp3', false).kind).toBe('junk')
    expect(classifyEntry('a/.DS_Store', false).kind).toBe('junk')
    expect(classifyEntry('a/._01.mp3', false).kind).toBe('junk')
    expect(classifyEntry('cover.jpg', false).kind).toBe('image')
    expect(classifyEntry('a', true).kind).toBe('folder')
  })
})

describe('ordering', () => {
  it('sorts 1, 2, 10 naturally, never by raw order', () => {
    const paths = ['10 - Ch.mp3', '2 - Ch.mp3', '1 - Intro.mp3']
    expect([...paths].sort(compareArchivePaths)).toEqual(['1 - Intro.mp3', '2 - Ch.mp3', '10 - Ch.mp3'])
  })
  it('orders folders naturally and puts a folder’s files before its sub-folders', () => {
    const paths = ['CD10/01.mp3', 'CD2/01.mp3', 'CD1/02.mp3', 'CD1/01.mp3', 'intro.mp3']
    expect([...paths].sort(compareArchivePaths)).toEqual(['intro.mp3', 'CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3', 'CD10/01.mp3'])
  })
  it('is deterministic for equal-looking names', () => {
    expect(['B.mp3', 'a.mp3', 'A.mp3'].sort(compareArchivePaths)).toEqual(['A.mp3', 'a.mp3', 'B.mp3'])
  })

  it('warns when order is ambiguous and stays quiet when it is evident', () => {
    expect(orderWarnings(['01 a.mp3', '02 b.mp3', '10 c.mp3'])).toEqual([])
    expect(orderWarnings(['one.mp3']).length).toBe(0)
    expect(orderWarnings(['intro.mp3', 'outro.mp3'])[0]?.code).toBe('no_numbering')
    expect(orderWarnings(['01 a.mp3', 'outro.mp3'])[0]?.code).toBe('partial_numbering')
    expect(orderWarnings(['01 a.mp3', '01 b.mp3'])[0]?.code).toBe('duplicate_numbers')
    expect(orderWarnings(['CD1/01.mp3', 'CD2/01.mp3'])).toEqual([])
  })
})

describe('rankCoverCandidates', () => {
  const rank = (...p: string[]) => rankCoverCandidates(p.map((path) => ({ path }))).map((x) => x.path)
  it('prefers conventional names in the root, then elsewhere, then root images, then the rest', () => {
    expect(rank('art/zzz.png', 'b.png', 'sub/cover.jpg', 'folder.jpg')).toEqual(['folder.jpg', 'sub/cover.jpg', 'b.png', 'art/zzz.png'])
  })
  it('is empty for no images', () => {
    expect(rank()).toEqual([])
  })
})

function entry(id: string, path: string, over: Partial<ZipPreviewEntry> = {}): ZipPreviewEntry {
  return {
    id,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    kind: 'audio',
    size: 10,
    status: 'ok',
    eligible: true,
    ...over,
  }
}

const preview: ZipImportPreview = {
  sessionId: 's',
  archiveName: 'book.zip',
  entries: [
    entry('e0', 'Book', { kind: 'folder', eligible: false, status: 'ignored' }),
    entry('e1', 'Book/01.mp3'),
    entry('e2', 'Book/02.mp3'),
    entry('e3', 'Book/03.aif', { status: 'unsupported', eligible: false }),
    entry('e4', 'Book/cover.jpg', { kind: 'image', status: 'ignored', eligible: false }),
    entry('e5', 'Book/art/other.png', { kind: 'image', status: 'ignored', eligible: false }),
    entry('e6', 'readme.txt', { kind: 'metadata', status: 'ignored', eligible: false }),
  ],
  trackOrder: ['e1', 'e2'],
  coverCandidates: ['e4', 'e5'],
  defaultCoverId: 'e4',
  warnings: [],
}

describe('selection', () => {
  it('preselects eligible tracks and the default cover', () => {
    expect(initialSelection(preview)).toEqual({ trackIds: ['e1', 'e2'], coverId: 'e4' })
  })
  it('toggle keeps playback order and ignores ineligible ids', () => {
    let s = initialSelection(preview)
    s = toggleTrack(preview, s, 'e1')
    expect(s.trackIds).toEqual(['e2'])
    s = toggleTrack(preview, s, 'e1')
    expect(s.trackIds).toEqual(['e1', 'e2'])
    expect(toggleTrack(preview, s, 'e3')).toBe(s)
    expect(toggleTrack(preview, s, 'e4')).toBe(s)
  })
  it('select all / deselect all', () => {
    const none = deselectAllTracks(initialSelection(preview))
    expect(none.trackIds).toEqual([])
    expect(canConfirmSelection(none)).toBe(false)
    expect(selectAllTracks(preview, none).trackIds).toEqual(['e1', 'e2'])
    expect(canConfirmSelection(selectAllTracks(preview, none))).toBe(true)
  })
  it('cover can change, be removed, and only be a candidate', () => {
    const s = initialSelection(preview)
    expect(setCover(preview, s, 'e5').coverId).toBe('e5')
    expect(setCover(preview, s, null).coverId).toBeNull()
    expect(setCover(preview, s, 'e1')).toBe(s)
  })
})

describe('validateZipSelection', () => {
  it('accepts a valid selection', () => {
    expect(validateZipSelection(preview, { trackIds: ['e2', 'e1'], coverId: null })).toEqual({ ok: true })
    expect(validateZipSelection(preview, { trackIds: ['e1'], coverId: 'e5' })).toEqual({ ok: true })
  })
  it.each([
    [null],
    [{ trackIds: [], coverId: null }],
    [{ trackIds: ['e3'], coverId: null }],
    [{ trackIds: ['e1', 'e1'], coverId: null }],
    [{ trackIds: ['nope'], coverId: null }],
    [{ trackIds: [1], coverId: null }],
    [{ trackIds: ['e1'], coverId: 'e2' }],
    [{ trackIds: ['e1'], coverId: 5 }],
    [{ trackIds: 'e1', coverId: null }],
  ])('rejects %j', (input) => {
    expect(validateZipSelection(preview, input).ok).toBe(false)
  })
})

describe('tree', () => {
  it('nests by folder, folders first, natural order, with implicit parents', () => {
    const tree = buildZipTree([
      entry('a', 'z.mp3'),
      entry('b', 'CD10/01.mp3'),
      entry('c', 'CD2/01.mp3'),
      entry('d', 'CD2/sub/deep.mp3'),
      entry('e', 'A.txt', { kind: 'metadata' }),
    ])
    expect(tree.map((n) => n.name)).toEqual(['CD2', 'CD10', 'A.txt', 'z.mp3'])
    expect(tree[0]!.children.map((n) => n.name)).toEqual(['sub', '01.mp3'])
  })
  it('flatten honours collapsed folders and reports depth', () => {
    const tree = buildZipTree([entry('b', 'F/a.mp3'), entry('c', 'F/G/b.mp3')])
    const open = flattenZipTree(tree, new Set())
    expect(open.map((r) => [r.node.name, r.depth])).toEqual([['F', 0], ['G', 1], ['b.mp3', 2], ['a.mp3', 1]])
    expect(flattenZipTree(tree, new Set(['F'])).map((r) => r.node.name)).toEqual(['F'])
    expect(flattenZipTree(tree, new Set(['F/G'])).map((r) => r.node.name)).toEqual(['F', 'G', 'a.mp3'])
  })
})
