import type { InkPenStyle, MessageKey } from '@core'

/** Names of the drawing styles (spec 012); the core presets keep an English `label` for Main / tests only. */
export const INK_STYLE_LABELS: Record<InkPenStyle, MessageKey> = {
  pen: 'reader.chrome.ink.styles.pen',
  pencil: 'reader.chrome.ink.styles.pencil',
  marker: 'reader.chrome.ink.styles.marker',
  brush: 'reader.chrome.ink.styles.brush',
}
