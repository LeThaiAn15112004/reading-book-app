/** English texts of area `exports` (spec 012 FR-012): the words of the readable `.md` copy of a book's annotations. */
export const en = {
  exported: 'Exported {date}',
  annotationCount: { one: ' · {count} annotation', other: ' · {count} annotations' },
  attachmentCount: { one: ' · {count} file attachment', other: ' · {count} file attachments' },
  headings: {
    page: 'Page {n}',
    chapter: 'Chapter {n}',
    section: 'Section {n}',
    annotations: 'Annotations',
  },
  place: {
    onPage: ' on page {n}',
    inChapter: ' in chapter {n}',
  },
  kinds: {
    highlight: 'Highlight',
    underline: 'Underline',
    squiggly: 'Squiggly underline',
    strikethrough: 'Strikethrough',
    replace: 'Replace text',
    insert: 'Insert text',
    textbox: 'Text box',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    arrow: 'Arrow',
    typewriter: 'Typewriter note',
  },
  note: 'Note: {text}',
  attachment: '📎 {name} ({size}), page {page}',
} as const
