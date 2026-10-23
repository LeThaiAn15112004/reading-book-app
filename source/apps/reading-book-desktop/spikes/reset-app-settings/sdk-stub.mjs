/**
 * Stand-in for `@reading-book/book-reader-sdk` in the Reset App Settings checks. Re-exports the real,
 * import-free reading-prefs module; the Library helpers the stores never call at load time are
 * stubbed so the whole SDK does not have to be loaded.
 */
export * from '../../../book-reader-sdk/src/app-models/reading-prefs.ts'

// The PDF pen preferences store validates against these (import-free constants / helper of the real SDK).
export const PDF_INK_MIN_WIDTH = 0.0005 // mirrors src/ink/pdf-ink.ts (that module pulls in the whole domain)
export const PDF_INK_MAX_WIDTH = 0.1
export { isValidHexColor } from '../../../book-reader-sdk/src/annotations/colors.ts'

export function filterByNav() {
  throw new Error('filterByNav is not used by the Reset App Settings checks')
}
