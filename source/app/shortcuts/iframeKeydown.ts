/**
 * EPUB pages render inside iframes, and key events there never reach `window`. This attaches
 * `handler` (capture phase) to the window *and* to every same-origin iframe document, following the
 * ones epub.js creates / swaps while the reader is open. Returns the cleanup.
 */
export function listenKeydownInIframes(handler: (event: KeyboardEvent) => void): () => void {
  window.addEventListener('keydown', handler, true)

  const boundDocs = new Set<Document>()
  function bindIframes() {
    document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const doc = iframe.contentDocument
        if (!doc || boundDocs.has(doc)) return
        boundDocs.add(doc)
        doc.addEventListener('keydown', handler, true)
      } catch {
        // Cross-origin frame — nothing to bind.
      }
    })
  }

  bindIframes()
  const observer = new MutationObserver(bindIframes)
  observer.observe(document.body, { childList: true, subtree: true })
  // epub.js swaps the iframe document on page turns without adding a node; poll briefly so the new
  // document gets bound.
  const pollId = window.setInterval(bindIframes, 500)

  return () => {
    window.removeEventListener('keydown', handler, true)
    observer.disconnect()
    window.clearInterval(pollId)
    boundDocs.forEach((doc) => doc.removeEventListener('keydown', handler, true))
    boundDocs.clear()
  }
}

type ElementLike = {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
}

/** A text field (or editable region) — plain keys typed here belong to the field, not a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as ElementLike | null
  const tag = el?.tagName
  if (!tag) return false
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true
}

const INTERACTIVE_ROLES = new Set(['button', 'option', 'menuitem', 'tab', 'checkbox', 'switch', 'link'])

/** A control that already uses Enter / Space itself (buttons, links, list options…). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as ElementLike | null
  const tag = el?.tagName
  if (!tag) return false
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true
  const role = el?.getAttribute?.('role')
  return role != null && INTERACTIVE_ROLES.has(role)
}
