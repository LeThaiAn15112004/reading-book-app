/**
 * What the reader surface for the open book can actually do. The toolbar shows a tool only when the
 * surface has every capability the tool `requires` (hidden, never disabled) — a new renderer declares
 * its capabilities here instead of the toolbar growing "if format" checks.
 * See docs/implementation_plan/reader_toolbar.md.
 */
export type ReaderCapability =
  /** Hand / Select interaction tools on the reading surface. */
  | 'interaction'
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
 * Which surface renders a format: EPUB (`renderers/epub`), PDF (`renderers/pdf`); every other format
 * shows the placeholder `ReadingCanvas`.
 */
export type ReaderSurface = 'epub' | 'pdf' | 'placeholder'

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
  placeholder: ['interaction', 'snapshot', 'wordCount', 'readingSettings', 'pageLayout'],
}

export function readerSurfaceForFormat(format: string | null | undefined): ReaderSurface {
  if (format === 'epub') return 'epub'
  if (format === 'pdf') return 'pdf'
  return 'placeholder'
}

export function getReaderCapabilities(format: string | null | undefined): ReadonlySet<ReaderCapability> {
  return new Set(SURFACE_CAPABILITIES[readerSurfaceForFormat(format)])
}
