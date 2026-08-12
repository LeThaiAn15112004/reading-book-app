/** Save / restore contenteditable selection across toolbar interactions. */

function editorView(editor: HTMLElement | null): Window | null {
  return editor?.ownerDocument?.defaultView ?? null
}

function editorDocument(editor: HTMLElement | null): Document | null {
  return editor?.ownerDocument ?? null
}

export function cloneEditorRange(editor: HTMLElement | null): Range | null {
  const win = editorView(editor)
  const sel = win?.getSelection()
  if (!editor || !sel || sel.rangeCount === 0) return null
  if (!sel.anchorNode || !editor.contains(sel.anchorNode)) return null
  return sel.getRangeAt(0).cloneRange()
}

export function restoreEditorRange(
  range: Range | null,
  editor: HTMLElement | null,
): boolean {
  if (!range || !editor) return false
  const win = editorView(editor)
  const sel = win?.getSelection()
  if (!sel) return false
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return false
  }
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

/** Apply inline color via span wrap when execCommand is unreliable. */
export function applyInlineTextColor(range: Range, colorHex: string): void {
  const doc = range.startContainer.ownerDocument
  if (!doc) return
  const win = doc.defaultView
  const span = doc.createElement('span')
  span.style.color = colorHex
  const contents = range.extractContents()
  span.appendChild(contents)
  range.insertNode(span)

  const sel = win?.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const next = doc.createRange()
  next.selectNodeContents(span)
  next.collapse(false)
  sel.addRange(next)
}

export function queryEditorCommandState(
  editor: HTMLElement | null,
  command: string,
): boolean {
  const doc = editorDocument(editor)
  if (!doc) return false
  try {
    return doc.queryCommandState(command)
  } catch {
    return false
  }
}

export function runEditorCommand(
  editor: HTMLElement | null,
  command: string,
  value?: string,
): void {
  const doc = editorDocument(editor)
  if (!doc) return
  try {
    doc.execCommand(command, false, value)
  } catch {
    /* ignore unsupported command */
  }
}

export function caretColorFromEditorSelection(
  editor: HTMLElement | null,
): string | null {
  const win = editorView(editor)
  const sel = win?.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.focusNode
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement
  while (node && node instanceof HTMLElement) {
    const color = node.style?.color?.trim()
    if (color) return color
    if (node.isContentEditable) break
    node = node.parentElement
  }
  return null
}
