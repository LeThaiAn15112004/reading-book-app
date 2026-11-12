/** English texts of area `reader.logic` (spec 012): Reader screen wiring, hooks and stores. */
export const en = {
  page: 'Page {page}',
  text: 'Text',
  toast: {
    copied: 'Copied.',
    translateHint: 'Translate: select text to translate it — Esc to exit.',
    shareStub: 'Share — not available yet.',
    favoritesStub: 'Added to Favorites (local stub).',
    goToPageScroll: 'Go to Page isn’t available in scroll view.',
    goToPageNotReady: 'Page numbers aren’t ready yet.',
    aiSoon: 'AI Ask — coming soon.',
    trashStub: 'Trash confirm — delete wiring comes later.',
    sectionNotFound: 'That section was not found in this document.',
    linkFailed: 'That link could not be opened.',
    endUnreachable: 'Couldn’t reach the end of the book.',
    snapshotCopied: 'Copied the selected area to the clipboard.',
    snapshotFailed: 'Could not capture the selected area.',
  },
  insertPopup: {
    placeholder: 'Text to insert…',
    aria: 'Insert text',
  },
  bookmarks: {
    loadFailed: 'Could not load bookmarks.',
    deleteFailed: 'Could not delete bookmark.',
    notYet: 'Could not bookmark this place yet.',
    removed: 'Bookmark removed.',
    added: 'Bookmark added.',
    saveFailed: 'Could not save bookmark.',
    locationNotFound: 'Could not find this bookmark’s location in the book.',
  },
  markup: {
    done: '{action} — Ctrl+Z to undo',
    highlight: 'Highlighted',
    underline: 'Underlined',
    squiggly: 'Squiggly underlined',
    strikethrough: 'Struck through',
    replace: 'Marked for replacement — add the new text as a note',
    insert: 'Marked for insertion — add the text to insert as a note',
  },
  relink: {
    failed: 'Could not link that file to this book.',
  },
  open: {
    failed: 'Could not open this book file.',
  },
} as const
