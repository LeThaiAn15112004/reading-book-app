/**
 * Thin, typed access to epub.js internals the public API does not expose (view manager, task
 * queue, EpubCFI constructor shape) plus the Vite/CJS interop for the `ePub` factory.
 */
import ePubImport, { EpubCFI, type Rendition } from 'epubjs'

type EpubjsManagerLike = Record<string, unknown>

export function renditionManager(rendition: Rendition): EpubjsManagerLike | undefined {
  return (rendition as unknown as { manager?: EpubjsManagerLike }).manager
}

/**
 * Document of the currently displayed section, via `Rendition.getContents()` — the public,
 * documented accessor (`rendition.js` -> `manager.getContents()`), not a reimplementation
 * against `.manager.views` internals. epubjs's own `.d.ts` types `getContents()` as returning a
 * single `Contents`; the real implementation (`managers/default/index.js`) returns an array —
 * one entry per section view the manager currently keeps mounted (just the active section for
 * the 'default' paginated manager used here, since `display()` clears prior views before
 * appending the new one). A prior version of this walked `manager.views.current()`/`displayed()`
 * directly — `current()` doesn't exist on epubjs's `Views` class, and `displayed()` filters on a
 * view-internal `displayed` flag that isn't reliable here — which is why `getCurrentExcerpt()`
 * silently returned `undefined` for every bookmark instead of throwing.
 */
export function currentSectionDocument(rendition: Rendition): Document | null {
  const contents = rendition.getContents() as unknown as
    | Array<{ document?: Document }>
    | undefined
  return contents?.[0]?.document ?? null
}

/** Vite/CJS interop: default may be the ePub fn or a module namespace. */
export const ePub =
  typeof ePubImport === 'function'
    ? ePubImport
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ePubImport as any).default

/** Runtime shape of an `EpubCFI` instance, covering both the string-input and Range-input forms. */
type EpubCFIHandle = { toRange(doc: Document): Range | null; toString(): string }

/**
 * `EpubCFI` export typed for the constructor shape it's used with at runtime:
 * `new EpubCFI(cfiString)`, whose `.toRange(doc)` resolves the CFI against a document without
 * touching the rendition — used by `debugResolveCfiRect`.
 */
export function getEpubCFIConstructor():
  | (new (cfiFrom: string | Range, base?: string, ignoreClass?: string) => EpubCFIHandle)
  | null {
  return EpubCFI as unknown as new (
    cfiFrom: string | Range,
    base?: string,
    ignoreClass?: string,
  ) => EpubCFIHandle
}

export function getRenditionLayoutDelta(rendition: Rendition): number {
  const manager = renditionManager(rendition) as
    | {
        layout?: { delta?: number; pageWidth?: number; width?: number }
        container?: HTMLElement
      }
    | undefined
  const delta =
    manager?.layout?.delta ||
    manager?.layout?.pageWidth ||
    manager?.layout?.width
  if (typeof delta === 'number' && Number.isFinite(delta) && delta > 0) {
    return delta
  }
  const clientW = manager?.container?.clientWidth
  if (typeof clientW === 'number' && Number.isFinite(clientW) && clientW > 0) {
    return clientW
  }
  return 0
}

/**
 * Scroll mode (`flow: 'scrolled-doc'`) keeps the `default` manager's own
 * `container` element as the actual scrolling box — this reads its
 * scrollTop/scrollHeight directly rather than duplicating epub.js's internal
 * axis bookkeeping. A couple of px of tolerance absorbs sub-pixel rounding so
 * a wheel event at the true edge isn't missed by a fraction of a pixel.
 */
const SCROLL_BOUNDARY_EPSILON_PX = 2

export function isAtVerticalScrollBoundary(
  rendition: Rendition,
  direction: 'down' | 'up',
): boolean {
  const manager = renditionManager(rendition) as
    | { container?: HTMLElement }
    | undefined
  const container = manager?.container
  if (!container) return false
  if (direction === 'down') {
    return (
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - SCROLL_BOUNDARY_EPSILON_PX
    )
  }
  return container.scrollTop <= SCROLL_BOUNDARY_EPSILON_PX
}

/**
 * epubjs Rendition.destroy() leaves the task queue running (q.clear is commented
 * out upstream). After StrictMode remount / abort, queued `start()` then hits
 * `this.book.package` on a destroyed book → blank reader + console TypeError.
 */
export function stopRenditionQueue(rendition: Rendition | null | undefined): void {
  if (!rendition) return
  const q = (
    rendition as unknown as {
      q?: { stop?: () => void; clear?: () => void; pause?: () => void }
    }
  ).q
  try {
    q?.stop?.()
  } catch {
    try {
      q?.clear?.()
      q?.pause?.()
    } catch {
      /* ignore */
    }
  }
}
