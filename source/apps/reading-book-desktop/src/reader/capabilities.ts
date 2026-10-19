/**
 * What the reader surface for the open book can actually do. The toolbar shows a tool only when the
 * surface has every capability the tool `requires` (hidden, never disabled) — a new renderer declares
 * its capabilities here instead of the toolbar growing "if format" checks.
 * See docs/implementation_plan/reader_toolbar.md.
 */
export type ReaderCapability =
  /** Hand / Select interaction tools on the reading surface. */
  | 'interaction'
  /** The text box itself is live: click = caret, typing edits (TXT). */
  | 'textEdit'
  /** Full-text search that can jump to and paint hits in the rendered book. */
  | 'search'
  /** Read aloud (TTS) following the rendered text. */
  | 'readAloud'
  /** Translate a text selection. */
  | 'translate'
  /** Highlight / underline / strikethrough over selected text. */
  | 'markupAnnotations'
  /** Copy an area of the window as an image (Main `capturePage`; renderer-independent). */
  | 'snapshot'
  /** Word statistics from the book's indexed chunks (Main; renderer-independent). */
  | 'wordCount'
  /** Reading settings panel (Aa). */
  | 'readingSettings'
  /**
   * Sidebar "Page layout" panel (page / section cards that jump on click). Not on EPUB: there the
   * Contents (TOC) tab is the navigation surface.
   */
  | 'pageLayout'

/**
 * Which surface renders a format: EPUB (`renderers/epub`), PDF (`renderers/pdf`), TXT
 * (`renderers/txt`), Markdown (`renderers/md`); every other format shows the placeholder `ReadingCanvas`.
 */
export type ReaderSurface = 'epub' | 'pdf' | 'txt' | 'md' | 'placeholder'

const SURFACE_CAPABILITIES: Record<ReaderSurface, readonly ReaderCapability[]> = {
  epub: [
    'interaction',
    'search',
    'readAloud',
    'translate',
    'markupAnnotations',
    'snapshot',
    'wordCount',
    'readingSettings',
  ],
  // PDF: search (Main extracts the text layer, hits paint on the PDF.js text layer — see
  // docs/implementation_plan/pdf_search.md); text markup over the text layer, stored as page +
  // normalized rects (docs/implementation_plan/pdf_text_annotations.md). No `readingSettings`: every
  // Aa option is EPUB reflow (font, size, margins…) and does nothing to a fixed-layout page; zoom
  // lives in the footer.
  pdf: ['interaction', 'search', 'markupAnnotations', 'snapshot', 'wordCount', 'pageLayout'],
  // TXT: one continuous, editable text. No Hand / Select tools (the text box is live: click = caret,
  // drag = selection); the Edit tool is the way back from a markup tool, no page layout (there are no pages), no search painting / read aloud /
  // translate (out of scope). Markup is stored as offsets into the text
  // (docs/implementation_plan/txt_reader.md).
  txt: ['textEdit', 'search', 'translate', 'markupAnnotations', 'snapshot', 'wordCount', 'readingSettings'],
  // Markdown: read-only, one continuous scroll. No annotations, search painting, read aloud or
  // translate yet (docs/implementation_plan/markdown_reader.md); Aa applies font / size / spacing.
  md: ['interaction', 'search', 'translate', 'markupAnnotations', 'snapshot', 'wordCount', 'readingSettings'],
  placeholder: ['interaction', 'snapshot', 'wordCount', 'readingSettings', 'pageLayout'],
}

export function readerSurfaceForFormat(format: string | null | undefined): ReaderSurface {
  if (format === 'epub') return 'epub'
  if (format === 'pdf') return 'pdf'
  if (format === 'txt') return 'txt'
  if (format === 'md') return 'md'
  return 'placeholder'
}

export function getReaderCapabilities(format: string | null | undefined): ReadonlySet<ReaderCapability> {
  return new Set(SURFACE_CAPABILITIES[readerSurfaceForFormat(format)])
}
