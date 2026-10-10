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
 * Which surface renders a format. Only EPUB has a real renderer today; every other format shows the
 * placeholder `ReadingCanvas`. A future `renderers/pdf` adds `'pdf'` here with its own set.
 */
export type ReaderSurface = 'epub' | 'placeholder'

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
  placeholder: ['interaction', 'snapshot', 'wordCount', 'readingSettings'],
}

export function readerSurfaceForFormat(format: string | null | undefined): ReaderSurface {
  return format === 'epub' ? 'epub' : 'placeholder'
}

export function getReaderCapabilities(format: string | null | undefined): ReadonlySet<ReaderCapability> {
  return new Set(SURFACE_CAPABILITIES[readerSurfaceForFormat(format)])
}
