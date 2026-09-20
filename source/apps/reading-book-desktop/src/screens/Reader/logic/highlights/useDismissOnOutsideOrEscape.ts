import { useEffect, type RefObject } from 'react'

/** Calls `onDismiss` on Escape or a pointerdown outside `ref`'s element. */
export function useDismissOnOutsideOrEscape(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)

    // The book page renders inside an <iframe> (epub.js) — a separate document whose events
    // never bubble up to `document` above, so a pointerdown there was silently missed. Attach
    // the same listeners directly to every reachable iframe document, and watch for iframes
    // being (re)created as epub.js swaps sections/chapters.
    const attached = new Set<Document>()
    function attachToIframeDoc(iframe: HTMLIFrameElement) {
      let doc: Document | null
      try {
        doc = iframe.contentDocument
      } catch {
        return
      }
      if (!doc || attached.has(doc)) return
      doc.addEventListener('pointerdown', handlePointerDown, true)
      doc.addEventListener('keydown', handleKeyDown, true)
      attached.add(doc)
    }
    function scanForIframes(root: ParentNode) {
      root.querySelectorAll('iframe').forEach((frame) => attachToIframeDoc(frame as HTMLIFrameElement))
    }
    scanForIframes(document)

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node instanceof HTMLIFrameElement) {
            attachToIframeDoc(node)
            node.addEventListener('load', () => attachToIframeDoc(node), { once: true })
          } else {
            scanForIframes(node)
          }
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      attached.forEach((doc) => {
        doc.removeEventListener('pointerdown', handlePointerDown, true)
        doc.removeEventListener('keydown', handleKeyDown, true)
      })
      observer.disconnect()
    }
  }, [ref, onDismiss])
}
