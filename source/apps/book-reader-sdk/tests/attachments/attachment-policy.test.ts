import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_BYTES,
  buildAttachmentId,
  checkAttachmentSize,
  classifyAttachment,
  isAttachmentId,
  sanitizeAttachmentFileName,
} from '../../src/attachments/index.js'

const PLAIN = new TextEncoder().encode('hello world')

describe('sanitizeAttachmentFileName', () => {
  it('keeps a normal name and extension', () => {
    expect(sanitizeAttachmentFileName('report 2024.xlsx')).toBe('report 2024.xlsx')
  })

  it('reduces traversal and absolute paths to a basename', () => {
    expect(sanitizeAttachmentFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeAttachmentFileName('..\\..\\Windows\\system32\\calc.exe')).toBe('calc.exe')
    expect(sanitizeAttachmentFileName('C:\\Users\\x\\a.pdf')).toBe('a.pdf')
    expect(sanitizeAttachmentFileName('/abs/path/a.txt')).toBe('a.txt')
  })

  it('falls back for empty, dot-only, non-string and separator-only names', () => {
    for (const raw of ['', '   ', '.', '..', '...', '/', '\\', null, undefined, 42]) {
      expect(sanitizeAttachmentFileName(raw, 'fb')).toBe('fb')
    }
  })

  it('removes control, invisible and bidi-override characters and Windows-illegal characters', () => {
    expect(sanitizeAttachmentFileName('a\u0000b\u001fc.txt')).toBe('abc.txt')
    expect(sanitizeAttachmentFileName('photo\u202egpj.exe')).toBe('photogpj.exe')
    expect(sanitizeAttachmentFileName('a<b>c.txt')).toBe('a_b_c.txt')
  })

  it('removes alternate-data-stream colons and trailing dots / spaces', () => {
    expect(sanitizeAttachmentFileName('a.txt:evil.exe')).toBe('a.txt_evil.exe')
    expect(sanitizeAttachmentFileName('invoice.exe. . ')).toBe('invoice.exe')
  })

  it('prefixes reserved device names', () => {
    expect(sanitizeAttachmentFileName('CON')).toBe('_CON')
    expect(sanitizeAttachmentFileName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeAttachmentFileName('COM1.log')).toBe('_COM1.log')
  })

  it('bounds the length and keeps the extension', () => {
    const name = sanitizeAttachmentFileName(`${'a'.repeat(400)}.pdf`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})

describe('attachment ids', () => {
  it('builds distinct, valid ids for duplicates and for the two sources', () => {
    const a = buildAttachmentId('document', null, 0, 'ABCDEF0123456789')
    const b = buildAttachmentId('document', null, 1, 'abcdef0123456789')
    const c = buildAttachmentId('page', 3, 0, 'abcdef0123456789')
    expect(new Set([a, b, c]).size).toBe(3)
    expect([a, b, c].every(isAttachmentId)).toBe(true)
    expect(a).toBe(buildAttachmentId('document', null, 0, 'abcdef0123456789'))
  })

  it('rejects anything that is not an id', () => {
    for (const bad of ['', 'doc-1', '../x', 'doc-1-zzzzzzzzzzzz', 'doc-1-abcdef0123456', 'page-1-abcdef0123456789', 7, null, {}]) {
      expect(isAttachmentId(bad)).toBe(false)
    }
  })
})

describe('classifyAttachment', () => {
  it('allows ordinary documents and media, and unknown extensions', () => {
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx', 'a.png', 'a.txt', 'a.zip', 'a.custom', 'data.csv']) {
      expect(classifyAttachment(name, PLAIN)).toEqual({ open: true })
    }
  })

  it('blocks executables, scripts, shortcuts, browser content and macro Office files', () => {
    for (const name of ['a.exe', 'a.BAT', 'a.ps1', 'a.vbs', 'a.js', 'a.lnk', 'a.url', 'a.html', 'a.svg', 'a.docm', 'a.msi', 'a.jar', 'a.sh', 'a.iso']) {
      expect(classifyAttachment(name, PLAIN)).toEqual({ open: false, reason: 'prohibited_type' })
    }
  })

  it('judges double extensions by the final one, case-insensitively and ignoring trailing dots', () => {
    expect(classifyAttachment('invoice.pdf.exe', PLAIN).open).toBe(false)
    expect(classifyAttachment('invoice.pdf.EXE.', PLAIN).open).toBe(false)
    expect(classifyAttachment('invoice.exe.pdf', PLAIN).open).toBe(true)
  })

  it('blocks a file with no extension', () => {
    expect(classifyAttachment('README', PLAIN)).toEqual({ open: false, reason: 'no_extension' })
    expect(classifyAttachment('.hidden', PLAIN)).toEqual({ open: false, reason: 'no_extension' })
  })

  it('blocks executable or script content hidden behind a harmless name', () => {
    const pe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00])
    const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46])
    const shebang = new TextEncoder().encode('#!/bin/sh\nrm -rf ~')
    const html = new TextEncoder().encode('\n  <HTML><script>1</script>')
    for (const head of [pe, elf, shebang, html]) {
      expect(classifyAttachment('holiday.jpg', head)).toEqual({ open: false, reason: 'executable_content' })
    }
  })
})

describe('checkAttachmentSize', () => {
  it('refuses empty data and anything over 100 MB, accepts the boundary', () => {
    expect(checkAttachmentSize(0)).toEqual({ ok: false, reason: 'empty' })
    expect(checkAttachmentSize(1)).toEqual({ ok: true })
    expect(checkAttachmentSize(ATTACHMENT_MAX_BYTES)).toEqual({ ok: true })
    expect(checkAttachmentSize(ATTACHMENT_MAX_BYTES + 1)).toEqual({ ok: false, reason: 'too_large' })
  })
})
