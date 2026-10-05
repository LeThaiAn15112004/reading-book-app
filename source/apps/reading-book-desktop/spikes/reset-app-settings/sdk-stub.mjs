/**
 * Stand-in for `@reading-book/book-reader-sdk` in the Reset App Settings checks. Re-exports the real,
 * import-free reading-prefs module; the Library helpers the stores never call at load time are
 * stubbed so the whole SDK does not have to be loaded.
 */
export * from '../../../book-reader-sdk/src/app-models/reading-prefs.ts'

export function filterByNav() {
  throw new Error('filterByNav is not used by the Reset App Settings checks')
}
