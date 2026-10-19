import { describe, expect, it } from 'vitest'
import {
  MD_MAX_FILE_BYTES,
  checkMdFileSize,
  classifyMdImageSrc,
  classifyMdLink,
  isSafeExternalUrl,
  findHeadingForAnchor,
  slugifyHeading,
  splitMdSource,
  buildMdOutline,
  collectMdReferenceDefinitions,
} from '../../src/md/index.js'

describe('checkMdFileSize', () => {
  it('accepts empty, small and exactly-5-MB files; refuses one byte more', () => {
    expect(checkMdFileSize(0).ok).toBe(true)
    expect(checkMdFileSize(1234).ok).toBe(true)
    expect(checkMdFileSize(MD_MAX_FILE_BYTES).ok).toBe(true)
    expect(checkMdFileSize(MD_MAX_FILE_BYTES + 1)).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('classifyMdLink', () => {
  it('keeps in-document anchors, http(s) and mailto', () => {
    expect(classifyMdLink('#intro')).toEqual({ kind: 'anchor', id: 'intro' })
    expect(classifyMdLink('https://example.com/a?b=1#c')).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1#c',
    })
    expect(classifyMdLink('HTTP://example.com').kind).toBe('external')
    expect(classifyMdLink('mailto:a@b.co').kind).toBe('external')
  })

  it('blocks everything that could run code or reach the disk', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///C:/Windows/win.ini',
      'vbscript:x',
      'readmate-reader://oauth',
      'rb-md-asset://local/x/y.png',
      './other.md',
      '../secret.txt',
      'C:\\Windows\\win.ini',
      '#',
      '',
      'https://',
      'mailto:',
    ]) {
      expect(classifyMdLink(href), href).toEqual({ kind: 'blocked' })
    }
    expect(classifyMdLink(undefined)).toEqual({ kind: 'blocked' })
  })
})

describe('isSafeExternalUrl', () => {
  it('rejects non-strings, whitespace/control characters and over-long URLs', () => {
    expect(isSafeExternalUrl(42)).toBe(false)
    expect(isSafeExternalUrl('https://a.b/c d')).toBe(false)
    expect(isSafeExternalUrl('https://a.b/\u0000')).toBe(false)
    expect(isSafeExternalUrl(`https://a.b/${'x'.repeat(3000)}`)).toBe(false)
    expect(isSafeExternalUrl('https://a.b/ok')).toBe(true)
  })
})

describe('classifyMdImageSrc', () => {
  it('accepts relative image paths and normalises them', () => {
    expect(classifyMdImageSrc('pic.png')).toEqual({ kind: 'relative', path: 'pic.png' })
    expect(classifyMdImageSrc('./img/a%20b.JPG?x=1#y')).toEqual({ kind: 'relative', path: 'img/a b.JPG' })
    expect(classifyMdImageSrc('img\\sub\\c.webp')).toEqual({ kind: 'relative', path: 'img/sub/c.webp' })
    expect(classifyMdImageSrc('a//b/./c.svg')).toEqual({ kind: 'relative', path: 'a/b/c.svg' })
    expect(classifyMdImageSrc('ảnh/bìa 🙂.png')).toEqual({ kind: 'relative', path: 'ảnh/bìa 🙂.png' })
  })

  it('blocks remote images', () => {
    for (const src of ['http://x.com/a.png', 'https://x.com/a.png', '//x.com/a.png', 'ftp://x/a.png']) {
      expect(classifyMdImageSrc(src), src).toEqual({ kind: 'blocked', reason: 'remote' })
    }
  })

  it('blocks absolute, drive, file:, data: and traversal paths', () => {
    expect(classifyMdImageSrc('/etc/a.png')).toMatchObject({ kind: 'blocked', reason: 'absolute' })
    expect(classifyMdImageSrc('C:\\x\\a.png')).toMatchObject({ kind: 'blocked', reason: 'absolute' })
    expect(classifyMdImageSrc('file:///C:/a.png')).toMatchObject({ kind: 'blocked', reason: 'unsupported' })
    expect(classifyMdImageSrc('data:image/png;base64,AAAA')).toMatchObject({ kind: 'blocked', reason: 'unsupported' })
    expect(classifyMdImageSrc('../a.png')).toMatchObject({ kind: 'blocked', reason: 'traversal' })
    expect(classifyMdImageSrc('a/../../b.png')).toMatchObject({ kind: 'blocked', reason: 'traversal' })
    expect(classifyMdImageSrc('%2e%2e/a.png')).toMatchObject({ kind: 'blocked', reason: 'traversal' })
    expect(classifyMdImageSrc('a/%2E%2E/b.png')).toMatchObject({ kind: 'blocked', reason: 'traversal' })
    expect(classifyMdImageSrc('..%5Ca.png')).toMatchObject({ kind: 'blocked', reason: 'traversal' })
  })

  it('blocks non-image extensions, NUL bytes, bad escapes, streams and empty input', () => {
    expect(classifyMdImageSrc('notes.md')).toMatchObject({ reason: 'unsupported' })
    expect(classifyMdImageSrc('noext')).toMatchObject({ reason: 'unsupported' })
    expect(classifyMdImageSrc('a%00.png')).toMatchObject({ reason: 'invalid' })
    expect(classifyMdImageSrc('%E0%A4%A.png')).toMatchObject({ reason: 'invalid' })
    expect(classifyMdImageSrc('stream.png:evil').kind).toBe('blocked')
    expect(classifyMdImageSrc('')).toMatchObject({ reason: 'invalid' })
    expect(classifyMdImageSrc(undefined)).toMatchObject({ reason: 'invalid' })
    expect(classifyMdImageSrc('./')).toMatchObject({ reason: 'invalid' })
  })
})

describe('heading anchors', () => {
  it('slugifies like GitHub and keeps Vietnamese letters', () => {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world')
    expect(slugifyHeading('Tiếng Việt  là gì?')).toBe('tiếng-việt--là-gì')
    expect(slugifyHeading('  C++ & C# ')).toBe('c--c')
  })

  it('finds a heading, numbering repeats, and decodes the anchor', () => {
    const heads = ['Intro', 'Usage', 'Usage', 'Tiếng Việt']
    expect(findHeadingForAnchor(heads, 'intro')).toBe(0)
    expect(findHeadingForAnchor(heads, 'usage')).toBe(1)
    expect(findHeadingForAnchor(heads, 'usage-1')).toBe(2)
    expect(findHeadingForAnchor(heads, 'ti%E1%BA%BFng-vi%E1%BB%87t')).toBe(3)
    expect(findHeadingForAnchor(heads, 'INTRO')).toBe(0)
    expect(findHeadingForAnchor(heads, 'missing')).toBe(-1)
    expect(findHeadingForAnchor(heads, '%E0%A4%A')).toBe(-1)
  })
})

describe('splitMdSource', () => {
  const para = (n: number) => `Paragraph ${n} with some words in it.\n\n`
  const long = (count: number) => Array.from({ length: count }, (_, i) => para(i)).join('')

  it('keeps a short document whole, exactly as written', () => {
    expect(splitMdSource('# a\n\nb\n')).toEqual(['# a\n\nb\n'])
    expect(splitMdSource('')).toEqual([''])
  })

  it('splits a long document into pieces that join back to the original', () => {
    const text = long(5000)
    const pieces = splitMdSource(text)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(text)
    for (const piece of pieces.slice(0, -1)) expect(piece.length).toBeGreaterThanOrEqual(40_000)
  })

  it('cuts before headings and paragraphs only, after a blank line', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `## Heading ${i}\n\nText ${i} here.\n\n`).join('')
    const pieces = splitMdSource(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces.slice(0, -1)) expect(piece.endsWith('\n\n')).toBe(true)
    for (const piece of pieces) expect(/^(## Heading|Text)/.test(piece)).toBe(true)
    expect(pieces.join('')).toBe(text)
  })

  it('never cuts inside a fenced code block, even one with blank lines and headings', () => {
    const code = '```\n' + Array.from({ length: 4000 }, (_, i) => `\n# not a heading ${i}\n\nword ${i}\n`).join('') + '```\n\n'
    const text = para(0) + code + long(3000)
    const pieces = splitMdSource(text)
    expect(pieces.join('')).toBe(text)
    const codeStart = text.indexOf('```')
    const codeEnd = codeStart + code.trimEnd().length
    let offset = 0
    for (const piece of pieces) {
      offset += piece.length
      expect(offset > codeStart && offset < codeEnd, `cut at ${offset} is inside the fence`).toBe(false)
    }
  })

  it('handles ~~~ fences and longer closing fences', () => {
    const body = Array.from({ length: 3000 }, (_, i) => `\n## fake ${i}\n\nline ${i}\n`).join('')
    const text = '~~~~\n' + body + '~~~~~\n\nafter\n\n' + long(3000)
    const pieces = splitMdSource(text)
    expect(pieces.join('')).toBe(text)
    const fenceEnd = text.indexOf('~~~~~\n') + 6
    let offset = 0
    for (const piece of pieces) {
      offset += piece.length
      expect(offset > 0 && offset < fenceEnd, `cut at ${offset} is inside the fence`).toBe(false)
    }
  })

  it('does not cut inside lists, quotes, tables or indented blocks', () => {
    const block = (s: string) => Array.from({ length: 4000 }, (_, i) => `${s.replace('#', String(i))}\n\n`).join('')
    for (const line of ['- item #', '1. item #', '> quote #', '| a | b #', '    code #', '<div>#']) {
      const text = block(line)
      expect(splitMdSource(text), line).toEqual([text])
    }
  })

  it('splits a long document without safe cut points as one piece (no wrong cut)', () => {
    const text = 'x'.repeat(200_000)
    expect(splitMdSource(text)).toEqual([text])
  })
})

describe('collectMdReferenceDefinitions', () => {
  it('collects reference definitions, not footnotes or ordinary text', () => {
    const text = 'Intro [a][1]\n\n[1]: https://example.com "t"\n  [two]: <https://x.y>\n[^n]: footnote\n[not a def] text\n'
    expect(collectMdReferenceDefinitions(text)).toBe('[1]: https://example.com "t"\n  [two]: <https://x.y>')
  })

  it('is bounded', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `[r${i}]: https://e.com/${i}`).join('\n')
    expect(collectMdReferenceDefinitions(text).split('\n').length).toBe(300)
  })
})

describe('buildMdOutline', () => {
  const h = (level: number, text: string) => ({ level, text })

  it('nests by heading level and keeps document indexes', () => {
    const outline = buildMdOutline([h(1, 'A'), h(2, 'A1'), h(3, 'A1a'), h(2, 'A2'), h(1, 'B')])
    expect(outline.map((n) => [n.index, n.label, n.level])).toEqual([[0, 'A', 0], [4, 'B', 0]])
    expect(outline[0]!.children.map((n) => [n.index, n.label, n.level])).toEqual([[1, 'A1', 1], [3, 'A2', 1]])
    expect(outline[0]!.children[0]!.children.map((n) => [n.index, n.level])).toEqual([[2, 2]])
  })

  it('does not leave gaps when a level is skipped or the document starts below H1', () => {
    const outline = buildMdOutline([h(3, 'deep start'), h(5, 'skipped'), h(2, 'up'), h(6, 'six')])
    expect(outline.map((n) => [n.label, n.level])).toEqual([['deep start', 0], ['up', 0]])
    expect(outline[0]!.children.map((n) => [n.label, n.level])).toEqual([['skipped', 1]])
    expect(outline[1]!.children.map((n) => [n.label, n.level])).toEqual([['six', 1]])
  })

  it('skips empty headings but still counts them in the index; collapses whitespace; bounds labels', () => {
    const outline = buildMdOutline([h(1, '   '), h(1, ' Tiếng \n Việt 🌳 '), h(2, 'x'.repeat(500))])
    expect(outline.map((n) => [n.index, n.label])).toEqual([[1, 'Tiếng Việt 🌳']])
    expect(outline[0]!.children[0]!.index).toBe(2)
    expect(outline[0]!.children[0]!.label.length).toBe(200)
  })

  it('tolerates odd levels and an empty document', () => {
    expect(buildMdOutline([])).toEqual([])
    expect(buildMdOutline([h(0, 'z'), h(99, 'y'), h(Number.NaN, 'n')]).map((n) => n.label)).toEqual(['z', 'n'])
  })
})
