/** Save / restore contenteditable selection across toolbar interactions. */

export function cloneEditorRange(editor: HTMLElement | null): Range | null {
  const sel = window.getSelection()
  if (!editor || !sel || sel.rangeCount === 0) return null
  if (!sel.anchorNode || !editor.contains(sel.anchorNode)) return null
  return sel.getRangeAt(0).cloneRange()
}

export function restoreEditorRange(range: Range | null, editor: HTMLElement | null): boolean {
  if (!range || !editor) return false
  const sel = window.getSelection()
  if (!sel) return false
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return false
  }
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

/** Apply inline color via span wrap when execCommand is unreliable. */
export function applyInlineTextColor(range: Range, colorHex: string): void {
  const span = document.createElement('span')
  span.style.color = colorHex
  const contents = range.extractContents()
  span.appendChild(contents)
  range.insertNode(span)

  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const next = document.createRange()
  next.selectNodeContents(span)
  next.collapse(false)
  sel.addRange(next)
}
