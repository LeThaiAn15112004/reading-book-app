/**
 * Annotation import / export (specs/006-annotation-import-export): the `.readmate-notes.json` file shape,
 * its validation and the content key used to recognise an annotation that is already in a book.
 * Pure — no Electron, DOM, SQLite or format engine.
 */
export * from './file-format.js'
export * from './content-key.js'
export * from './export-build.js'
export * from './import-plan.js'
export * from './quote-match.js'
