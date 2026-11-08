// Spec 010 T048 — rewriteRoot / isInsideRoot (Windows path rules).
import { describe, expect, it } from 'vitest'
import { isInsideRoot, rewriteRoot } from '../../src/store-import/index.js'

const FROM = 'C:\\Users\\a\\AppData\\Roaming\\reading-book-desktop'
const TO = 'C:\\Users\\a\\AppData\\Roaming\\Readmate Reader Store'

describe('rewriteRoot', () => {
  it('re-roots a managed book path', () => {
    expect(rewriteRoot(`${FROM}\\books\\x\\file`, FROM, TO)).toBe(`${TO}\\books\\x\\file`)
  })
  it('is case-insensitive and keeps the spelling after the root', () => {
    expect(rewriteRoot('c:\\users\\A\\appdata\\roaming\\READING-BOOK-DESKTOP\\Covers\\Id.JPG', FROM, TO)).toBe(`${TO}\\Covers\\Id.JPG`)
  })
  it('treats / and \\ as equal, and keeps an all-forward-slash value forward-slashed', () => {
    expect(rewriteRoot('C:/Users/a/AppData/Roaming/reading-book-desktop/books/x/file', FROM, TO)).toBe(
      'C:/Users/a/AppData/Roaming/Readmate Reader Store/books/x/file',
    )
    expect(rewriteRoot('C:\\Users\\a/AppData\\Roaming/reading-book-desktop\\books', FROM, TO)).toBe(`${TO}\\books`)
  })
  it('only matches whole path segments', () => {
    expect(rewriteRoot(`${FROM}2\\x`, FROM, TO)).toBeNull()
    expect(rewriteRoot('C:\\Users\\a\\AppData\\Roaming\\reading-book', FROM, TO)).toBeNull()
  })
  it('maps the root itself to the new root (trailing separators ignored)', () => {
    expect(rewriteRoot(FROM, FROM, TO)).toBe(TO)
    expect(rewriteRoot(`${FROM}\\`, `${FROM}\\`, `${TO}\\`)).toBe(TO)
  })
  it('leaves the user’s own files alone', () => {
    expect(rewriteRoot('D:\\Books\\a.pdf', FROM, TO)).toBeNull()
    expect(rewriteRoot('C:\\Users\\a\\Documents\\reading-book-desktop\\b.epub', FROM, TO)).toBeNull()
  })
  it('answers null for empty or missing values', () => {
    expect(rewriteRoot('', FROM, TO)).toBeNull()
    expect(rewriteRoot('   ', FROM, TO)).toBeNull()
    expect(rewriteRoot(null, FROM, TO)).toBeNull()
    expect(rewriteRoot(undefined, FROM, TO)).toBeNull()
  })
})

describe('isInsideRoot', () => {
  it('agrees with rewriteRoot', () => {
    expect(isInsideRoot(`${FROM}\\books`, FROM)).toBe(true)
    expect(isInsideRoot(`${FROM}2`, FROM)).toBe(false)
    expect(isInsideRoot('relative\\path', FROM)).toBe(false)
  })
})
