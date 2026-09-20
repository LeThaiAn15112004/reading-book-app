/**
 * Electron RENDERER — `ReaderSurface` adapter over the desktop's imperative epub.js handle
 * (`EpubRendererApi` in `src/reader/renderers/epub`). The SDK stores decide WHAT to paint; this
 * file is the only place that knows HOW epub.js wants it.
 */
import { isTrivialSectionStartCfi, type Location, type MarkupKind, type ReaderSurface } from '../../../dist/index.mjs'

/** Structural subset of `EpubjsHandle` — no import from the app needed. */
export interface EpubHandleLike<EngineLocation> {
  applyHighlight(params: { id: string; cfiRange: string; styleKind: MarkupKind; colorHex: string }): void
  removeHighlight(cfiRange: string, styleKind: MarkupKind): void
  flashHighlight?(cfiRange: string, styleKind: MarkupKind): void
  setFocusedHighlight(id: string | null): void
  clearSelection(): void
  goToLocation(location: EngineLocation): Promise<void>
  goToSpineIndex(index: number): Promise<void>
}

/**
 * @param getHandle   read lazily — epub.js is created after mount and replaced per book
 * @param toEngineCfi the app's own `(cfi) => new CfiLocation(cfi)`: the desktop handle still
 *                    takes the `@reading-book/domain` class, the SDK only deals in plain data
 */
export function createEpubSurface<EngineLocation>(
  getHandle: () => EpubHandleLike<EngineLocation> | null,
  toEngineCfi: (cfi: string) => EngineLocation,
): ReaderSurface {
  return {
    paintMarkup(markup) {
      if (markup.location.kind !== 'cfi') return // PDF/TXT markups belong to other renderers
      getHandle()?.applyHighlight({
        id: markup.id,
        cfiRange: markup.location.cfi,
        styleKind: markup.kind,
        colorHex: markup.colorHex,
      })
    },
    unpaintMarkup(markup) {
      if (markup.location.kind === 'cfi') getHandle()?.removeHighlight(markup.location.cfi, markup.kind)
    },
    flashMarkup(markup) {
      if (markup.location.kind !== 'cfi') return
      const cfi = markup.location.cfi
      // Let the new section's marks lay out before measuring them.
      requestAnimationFrame(() => requestAnimationFrame(() => getHandle()?.flashHighlight?.(cfi, markup.kind)))
    },
    setFocusedMarkup: (id) => getHandle()?.setFocusedHighlight(id),
    clearSelection: () => getHandle()?.clearSelection(),

    async goTo(location: Location, options) {
      const handle = getHandle()
      if (!handle) throw new Error('EPUB renderer is not mounted')
      if (location.kind === 'cfi' && !isTrivialSectionStartCfi(location.cfi)) {
        await handle.goToLocation(toEngineCfi(location.cfi))
        return
      }
      // epub.js cannot resolve shallow section-start CFIs; chapter fallback for everything else.
      await handle.goToSpineIndex(options?.chapterIndex ?? 0)
    },
  }
}
