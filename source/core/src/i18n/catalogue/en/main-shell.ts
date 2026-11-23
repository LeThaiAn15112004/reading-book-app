/** English texts of area `main.shell` (spec 012): tray menu, native dialogs, desktop notifications — built in Main. */
export const en = {
  tray: {
    tooltip: 'Readmate Reader',
    open: 'Open {app}',
    quit: 'Quit {app}',
    audiobookPlay: '▶  Play “{title}”',
    audiobookPause: '⏸  Pause “{title}”',
  },
  dialogs: {
    exportReadable: 'Export readable copy',
    exportAnnotations: 'Export annotations',
    importAnnotations: 'Import annotations',
    markdownFilter: 'Markdown (*.md)',
    annotationsFilter: 'Readmate annotations (*.readmate-notes.json)',
    annotationFilesFilter: 'Annotation files (*.readmate-notes.json)',
    allFiles: 'All files',
    saveAttachment: 'Save attachment',
    attachFile: 'Attach a file to this page',
    documents: 'Documents',
    audiobookZip: 'Audiobook ZIP',
    locateBook: 'Locate “{title}”',
    exportPdf: 'Export PDF with annotations',
    exportTranscript: 'Export transcript',
    textFilter: 'Text',
  },
  reminder: {
    title: '📚 Time to read',
    continue: 'Continue reading {title}?',
    pick: 'Pick a book from the library and read a few pages?',
  },
} as const
