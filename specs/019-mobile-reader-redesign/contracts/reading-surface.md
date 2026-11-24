# Contract: `ReadingSurface` (phone reader, FR-020 – FR-023)

`screens/Reader/phone/logic/useReadingSurface.ts` returns ONE object for the open format. The phone screen, its bars
and sheets use only this object for anything format-specific (SC-009: the per-format choice is made here and nowhere
else in `screens/Reader/phone/**`).

```ts
type SurfaceFormat = 'epub' | 'pdf' | 'md' | 'txt'
type MarkKind = 'highlight' | 'underline' | 'strikethrough'

interface ReadingSurface {
  format: SurfaceFormat
  view: 'page' | 'scroll'                 // EPUB / PDF from book.prefs.viewMode; MD / TXT always 'scroll'
  setView?(view: 'page' | 'scroll'): void // EPUB / PDF only (FR-013, FR-013a); keeps the position

  // Place and moving (FR-010a, FR-018)
  place: Place                            // core reader-place.ts
  progress: number                        // 0..1
  goToProgress(fraction: number): void
  turn?(direction: 'next' | 'prev'): void // Page view only
  toc: readonly SurfaceTocItem[]          // [] → Contents button hidden (TXT)
  activeTocId: string | null
  goToToc(item: SurfaceTocItem): void

  // Bookmarks (FR-019) — absent for TXT
  bookmarks?: { list; isHere: boolean; toggle(): void; jump(id): void; remove(id): void }

  // Marks (FR-015, FR-015a, FR-023)
  marks: readonly ReaderHighlightBase[]   // PDF: text markup only
  openMark(id: string): void              // by identity, no on-screen position
  jumpToMark(id: string): void
  activeMark: ActiveMark | null           // { highlight, setColor, setStyle, setNote, remove, close }

  // Selection (FR-015)
  selection: { text: string; mark(kind: MarkKind, colorHex: string): void; close(): void } | null
  lastColorHex: string
}
```

Rules:

- Built from the hooks the screen already runs (`useReaderCore`, `useReaderAnnotations`, `useReaderTxt`,
  `usePdfSelectionMenu`, Markdown heading state); it adds no store of its own except the chrome store (R8).
- `openMark` calls each format store's rect-less open (`openHighlight(id)`; EPUB `openHighlightById(id)`); no
  `new DOMRect(0, 0, 0, 0)` anywhere in the phone reader (FR-023).
- The screen passes NO stand-in callback to a renderer (`() => {}`, `NO_SHORTCUTS`, `translateModeActive={false}`,
  `editable`-related handlers): those renderer props are optional and omitted (FR-022).
- Desktop's `ReaderScreen` does not use this object (out of scope); the renderers' optional props keep Desktop's calls
  valid and behaviour identical.
