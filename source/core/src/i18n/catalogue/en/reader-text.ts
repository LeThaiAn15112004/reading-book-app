/** English texts of area `reader.text` (spec 012): EPUB, Markdown and TXT renderers and their stores. */
export const en = {
  epub: {
    cover: 'Cover',
    openFailed: 'Could not open this EPUB.',
    unableToOpen: 'Unable to open this book',
    tryAgain: 'Try again',
    coverAlt: 'Book cover',
  },
  md: {
    remoteBlocked: 'Remote images are blocked.',
    onlyLocal: 'Only images next to the document can be shown.',
    imageNotShown: '[Image not shown]',
    imageNotShownAlt: '[Image not shown: {alt}]',
    imageLoadFailed: 'The image could not be loaded.',
    imageNotFound: '[Image not found]',
    imageNotFoundAlt: '[Image not found: {alt}]',
    plainFallback: 'This part could not be formatted, so it is shown as plain text.',
    empty: 'This Markdown file is empty.',
    lossy: 'This file is not valid UTF-8. Some characters could not be read and are shown as �.',
    loadingRest: 'Loading the rest of the document…',
  },
  txt: {
    bookText: 'Book text',
    workingCopyLost: 'The edited copy could not be read — showing the original file.',
    sourceChanged: 'The original file was changed outside Readmate.',
    legacyEncoding: 'This file is not UTF-8; it was read as Windows-1252, so some characters may look wrong.',
    stale: {
      one: '{count} annotation no longer matches the text and is hidden.',
      other: '{count} annotations no longer match the text and are hidden.',
    },
    tooLarge: 'This file is too large to edit here — it can still be read and annotated.',
    removed: {
      one: '{count} annotation was removed because the text under it changed.',
      other: '{count} annotations were removed because the text under them changed.',
    },
    saveFailed: 'Could not save the changes.',
    readFailed: 'Could not read the book file.',
  },
  toast: {
    markFailed: 'Could not mark this selection.',
    loadFailed: 'Could not load highlights.',
    deleteFailed: 'Could not delete highlight.',
    saveFailed: 'Could not save highlight.',
    updateFailed: 'Could not update highlight.',
    undoFailed: 'Could not undo.',
  },
} as const
