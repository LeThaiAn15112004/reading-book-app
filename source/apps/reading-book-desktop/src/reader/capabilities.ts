/**
 * What a format's reader can actually do. The toolbar shows a tool only when the active reader has
 * every capability the tool `requires` (hidden, never disabled) — so a new format declares its
 * capabilities here instead of adding "hide these tools" lists to the toolbar.
 */
export type ReaderCapability =
  /** Highlight / underline / strikethrough over selected text. */
  | 'markupAnnotations'
  /** Free-form annotations that are not tied to a text selection (textbox, freehand drawing). */
  | 'freeformAnnotations'

const ALL_CAPABILITIES: readonly ReaderCapability[] = ['markupAnnotations', 'freeformAnnotations']

/** Per-format overrides; a format absent here keeps the full set (the pre-registry behaviour). */
const CAPABILITIES_BY_FORMAT: Record<string, readonly ReaderCapability[]> = {
  epub: ['markupAnnotations'],
}

export function getReaderCapabilities(format: string | null | undefined): ReadonlySet<ReaderCapability> {
  const caps = (format ? CAPABILITIES_BY_FORMAT[format] : undefined) ?? ALL_CAPABILITIES
  return new Set(caps)
}
