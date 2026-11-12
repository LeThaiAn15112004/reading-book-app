/** English texts of area `reader.phone` (spec 012): the Mobile Reader (bars, sheets, selection bar). */
export const en = {
  bars: {
    removeBookmark: 'Remove bookmark',
    addBookmark: 'Add bookmark',
    progress: 'Reading progress',
    contents: 'Contents',
    notes: 'Notes',
    panels: 'Reader panels',
  },
  sheet: {
    close: 'Close',
    contents: 'Contents',
    appearance: 'Appearance',
  },
  marks: {
    bookmarks: 'Bookmarks',
    notes: 'Notes',
    tabLabel: '{label} ({count})',
    removeHere: 'Remove bookmark here',
    addHere: 'Add bookmark here',
    noBookmarks: 'No bookmarks yet.',
    removeBookmark: 'Remove bookmark {label}',
    remove: 'Remove',
    noNotes: 'No notes or highlights yet. Select text to add one.',
    edit: 'Edit',
  },
  mark: {
    note: 'Note',
    highlight: 'Highlight',
    style: 'Style',
    strike: 'Strike',
    placeholder: 'Add a comment…',
    saveNote: 'Save comment',
  },
  selection: {
    aria: 'Selected text',
    mark: 'Mark selection',
  },
  screen: {
    page: 'Page {page}',
    copied: 'Copied.',
    copyFailed: 'Could not copy.',
    anchorNotFound: 'That section was not found in this document.',
    externalLink: 'Links to other sites do not open in this release.',
    formatUnsupported: 'This book’s format does not open on the phone.',
  },
} as const
