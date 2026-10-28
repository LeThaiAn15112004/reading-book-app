/**
 * Stand-in for `@reading-book/book-reader-sdk` in the Reset App Settings checks. Re-exports the real,
 * import-free reading-prefs module; the Library helpers the stores never call at load time are
 * stubbed so the whole SDK does not have to be loaded.
 */
export * from '../../../book-reader-sdk/src/app-models/reading-prefs.ts'

// The PDF pen preferences store validates against these (import-free constants / helper of the real SDK).
// The pen presets are import-free apart from the two width limits (ink-limits.ts).
export * from '../../../book-reader-sdk/src/ink/ink-pen-styles.ts'
export { isValidHexColor } from '../../../book-reader-sdk/src/annotations/colors.ts'

export function filterByNav() {
  throw new Error('filterByNav is not used by the Reset App Settings checks')
}

// The PDF shape preferences store validates against these (import-free pure geometry module of the real SDK).
export * from '../../../book-reader-sdk/src/app-models/pdf-shape.ts'

// The PDF Typewriter preferences store validates against these (import-free pure modules of the real SDK).
export * from '../../../book-reader-sdk/src/typewriter/index.ts'
