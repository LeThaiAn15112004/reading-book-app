/**
 * Host element layout + async lifecycle utilities: abort handling, frame / size / resource waits,
 * and the view-mode / spread settings applied to the host.
 */
import type { EpubPageLayout, EpubViewMode } from './types'

export function abortError(): Error {
  const err = new Error('EPUB open aborted')
  err.name = 'AbortError'
  return err
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** Fresh ArrayBuffer copy (IPC / TypedArray safe). */
export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data))
    return copy.buffer
  }
  const view = data as ArrayBufferView
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy.buffer
}

export function waitForFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => step(left - 1))
    }
    step(count)
  })
}

export function readHostLayoutSize(
  host: HTMLElement,
): { width: number; height: number } {
  return {
    width: Math.floor(host.clientWidth),
    height: Math.floor(host.clientHeight),
  }
}

/**
 * Avoid deciding that a section is exhausted while its intrinsic layout is
 * still changing. A timeout keeps broken remote resources from blocking nav;
 * callers must not cross a spine boundary when this returns false.
 */
export async function waitForSectionResources(
  doc: Document | null,
  timeoutMs = 1200,
): Promise<boolean> {
  if (!doc) return true

  const cleanups: Array<() => void> = []
  const pending: Promise<unknown>[] = []

  doc.querySelectorAll('img').forEach((img) => {
    if (img.complete) return
    pending.push(
      new Promise<void>((resolve) => {
        const settle = () => resolve()
        img.addEventListener('load', settle, { once: true })
        img.addEventListener('error', settle, { once: true })
        cleanups.push(() => {
          img.removeEventListener('load', settle)
          img.removeEventListener('error', settle)
        })
      }),
    )
  })

  if (pending.length === 0) return true

  let timer: number | undefined
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<false>((resolve) => {
        timer = window.setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) window.clearTimeout(timer)
    cleanups.forEach((cleanup) => cleanup())
  }
}

export function waitForHostSize(
  host: HTMLElement,
  signal?: AbortSignal,
  timeoutMs = 4000,
): Promise<{ width: number; height: number }> {
  const read = () => readHostLayoutSize(host)
  const first = read()
  if (first.width > 0 && first.height > 0) return Promise.resolve(first)

  return new Promise((resolve, reject) => {
    const started = Date.now()
    const ro = new ResizeObserver(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
      }
    })
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const timer = window.setInterval(() => {
      const size = read()
      if (size.width > 0 && size.height > 0) {
        cleanup()
        resolve(size)
        return
      }
      if (Date.now() - started > timeoutMs) {
        cleanup()
        resolve({ width: Math.max(size.width, 320), height: Math.max(size.height, 480) })
      }
    }, 50)
    const cleanup = () => {
      ro.disconnect()
      window.clearInterval(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    ro.observe(host)
  })
}

export function flowForViewMode(viewMode: EpubViewMode): 'paginated' | 'scrolled-doc' {
  return viewMode === 'scroll' ? 'scrolled-doc' : 'paginated'
}
export const EPUB_VIEW_MANAGER = 'default'

export function spreadForLayout(layout: EpubPageLayout): 'always' | 'none' {
  return layout === 'dual' ? 'always' : 'none'
}

/** Host + iframe chrome for page spread gutters drawn in React overlay. */
export function applyDualSpreadHost(host: HTMLElement, layout: EpubPageLayout): void {
  host.dataset.epubSpread = layout
}
