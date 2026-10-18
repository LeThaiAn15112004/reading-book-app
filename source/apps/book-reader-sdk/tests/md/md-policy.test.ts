import { describe, expect, it } from 'vitest'
import {
  MD_MAX_FILE_BYTES,
  checkMdFileSize,
  classifyMdImageSrc,
  classifyMdLink,
  isSafeExternalUrl,
  findHeadingForAnchor,
  slugifyHeading,
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
