/**
 * In-place editor of a Typewriter note (specs/005-typewriter-note, research D2): a `contenteditable` whose
 * content is ALWAYS rendered from the document model. Edits are intercepted in `beforeinput`, applied with the
 * SDK's `editText`, and the DOM is re-rendered from the result; the browser never changes the text itself.
 * IME composition (Vietnamese Telex / VNI) is the one exception: while composing, the browser owns the DOM and
 * the model is updated once, on `compositionend`, after which the content is rebuilt.
 */
import { useLayoutEffect, useMemo, useRef, type ClipboardEvent, type CompositionEvent, type KeyboardEvent } from 'react'
import { editText, type PdfTypewriterDoc, type TypewriterLayout, type TypewriterTextStyle } from '@reading-book/book-reader-sdk'
import { TypewriterLines } from './PdfTypewriterLayer'
import { layoutNote, noteHeightFraction, type TypewriterNormBox } from './typewriterBox'

export type TypewriterFlag = 'bold' | 'italic' | 'underline' | 'strike'

export type TypewriterEditorValue = {
  text: string
  doc: PdfTypewriterDoc
  selection: { start: number; end: number }
  pending: Partial<TypewriterTextStyle> | null
  epoch: number
}

type Props = {
  box: TypewriterNormBox
  heightRatio: number
  value: TypewriterEditorValue
  truncated: boolean
  onChange: (next: { text: string; doc: PdfTypewriterDoc; selection: { start: number; end: number }; truncated: boolean }) => void
  onSelect: (selection: { start: number; end: number }) => void
  onUndo: () => void
  onRedo: () => void
  /** Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X on the selection (or the caret). */
  onToggleFlag: (flag: TypewriterFlag) => void
  /** Escape. */
  onCommit: () => void
  /** Rebuild the DOM from the model (after an IME composition changed it behind React's back). */
  onRebuild: () => void
}

// ---- DOM position ⇄ text offset (every segment / line carries its start offset) ----------------------------

type DomPoint = { node: Node; offset: number }

function segmentOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement
  return (el?.closest('[data-tw-seg]') as HTMLElement | null) ?? null
}

function offsetFromDom(root: HTMLElement, node: Node, offset: number): number {
  const seg = segmentOf(node)
  if (seg && root.contains(seg)) {
    const start = Number(seg.dataset.start)
    if (node.nodeType === Node.TEXT_NODE) return start + offset
    return start + (offset === 0 ? 0 : (seg.textContent ?? '').length)
  }
  const lineEl = (node instanceof Element ? node : node.parentElement)?.closest('[data-tw-line]') as HTMLElement | null
  if (lineEl && root.contains(lineEl)) return Number(offset === 0 ? lineEl.dataset.start : lineEl.dataset.end)
  // The root itself: `offset` counts line children.
  const lines = [...root.querySelectorAll<HTMLElement>('[data-tw-line]')]
  if (lines.length === 0) return 0
  return offset <= 0 ? Number(lines[0]!.dataset.start) : Number(lines[Math.min(offset, lines.length) - 1]!.dataset.end)
}

/** The spaces hanging after each line (laid out past its content, so no segment holds them). */
function hangingSpaces(text: string, lines: TypewriterLayout['lines']): string[] {
  return lines.map((line, i) => {
    if (line.segments.length === 0) return ''
    let limit = text.indexOf(String.fromCharCode(10), line.end)
    if (limit === -1) limit = text.length
    const next = lines[i + 1]
    if (next && next.start > line.end && next.start <= limit) limit = next.start
    const gap = text.slice(line.end, limit)
    return /^ +$/.test(gap) ? gap : ''
  })
}

function domFromOffset(root: HTMLElement, layout: TypewriterLayout, hanging: readonly string[], offset: number): DomPoint | null {
  const lineEls = [...root.querySelectorAll<HTMLElement>('[data-tw-line]')]
  let best: { el: HTMLElement; at: number; dist: number } | null = null
  layout.lines.forEach((line, i) => {
    const lineEl = lineEls[i]
    if (!lineEl) return
    if (line.segments.length === 0) {
      const dist = Math.abs(line.start - offset)
      if (!best || dist < best.dist) best = { el: lineEl, at: -1, dist }
      return
    }
    const segEls = [...lineEl.querySelectorAll<HTMLElement>('[data-tw-seg]')]
    line.segments.forEach((seg, j) => {
      const el = segEls[j]
      if (!el) return
      const end = seg.end + (j === line.segments.length - 1 ? (hanging[i]?.length ?? 0) : 0)
      const clamped = Math.min(end, Math.max(seg.start, offset))
      const dist = Math.abs(clamped - offset)
      if (!best || dist < best.dist) best = { el, at: clamped - seg.start, dist }
    })
  })
  const found = best as { el: HTMLElement; at: number; dist: number } | null
  if (!found) return null
  if (found.at < 0) return { node: found.el, offset: 0 }
  const text = found.el.firstChild
  return text ? { node: text, offset: Math.min(found.at, text.textContent?.length ?? 0) } : { node: found.el, offset: 0 }
}

function readSelection(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const a = offsetFromDom(root, sel.anchorNode, sel.anchorOffset)
  const b = offsetFromDom(root, sel.focusNode, sel.focusOffset)
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

function writeSelection(root: HTMLElement, layout: TypewriterLayout, hanging: readonly string[], selection: { start: number; end: number }): void {
  const a = domFromOffset(root, layout, hanging, selection.start)
  const b = domFromOffset(root, layout, hanging, selection.end)
  const sel = window.getSelection()
  if (!a || !b || !sel) return
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

const WORD = /[\p{L}\p{N}_]/u

/** Start of the previous / end of the next word from `offset` (Ctrl+Backspace / Ctrl+Delete). */
function wordEdge(text: string, offset: number, dir: -1 | 1): number {
  const ch = (i: number) => (dir === -1 ? text[i - 1] : text[i])
  let i = offset
  const inRange = () => (dir === -1 ? i > 0 : i < text.length)
  while (inRange() && /\s/.test(ch(i)!)) i += dir
  while (inRange() && WORD.test(ch(i)!)) i += dir
  return i
}

function prevBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0
  const lo = text.charCodeAt(offset - 1)
  return lo >= 0xdc00 && lo <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1
}

function nextBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length
  const hi = text.charCodeAt(offset)
  return hi >= 0xd800 && hi <= 0xdbff && offset + 2 <= text.length ? offset + 2 : offset + 1
}

const FLAG_KEYS: Partial<Record<string, TypewriterFlag>> = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' }

export function PdfTypewriterEditor({ box, heightRatio, value, truncated, onChange, onSelect, onUndo, onRedo, onToggleFlag, onCommit, onRebuild }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef<{ start: number; end: number } | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  // Justified text is edited left-aligned (its stretched spaces are not text a caret can stand in); it is drawn justified once saved.
  const layout = useMemo(() => {
    const editDoc = value.doc.align.some((a) => a.align === 'justify') ? { ...value.doc, align: value.doc.align.map((a) => (a.align === 'justify' ? { ...a, align: 'left' as const } : a)) } : value.doc
    return layoutNote(editDoc, value.text, box.width)
  }, [value.doc, value.text, box.width])
  const hanging = useMemo(() => hangingSpaces(value.text, layout.lines), [value.text, layout])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const height = Math.max(box.height, noteHeightFraction(layout, heightRatio))

  // Focus when the session starts or the DOM is rebuilt.
  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [value.epoch])

  // Model → DOM selection after every render (not while the browser composes, and never while focus is elsewhere —
  // e.g. in the Properties sidebar: writing a selection into the editor would pull focus back and the key that
  // is still being handled there (Enter in the HEX field) would land in the text).
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || composingRef.current || !root.contains(document.activeElement)) return
    const current = readSelection(root)
    if (!current || current.start !== value.selection.start || current.end !== value.selection.end) writeSelection(root, layout, hanging, value.selection)
  })

  // The selection stays visible while focus is in the sidebar (a focused-away contenteditable paints none).
  useLayoutEffect(() => {
    const root = rootRef.current
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!registry || !HighlightCtor) return
    const { start, end } = value.selection
    if (!root || start === end || root.contains(document.activeElement)) {
      registry.delete('rb-tw-sel')
      return
    }
    const a = domFromOffset(root, layout, hanging, start)
    const b = domFromOffset(root, layout, hanging, end)
    if (!a || !b) return
    const range = document.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    registry.set('rb-tw-sel', new HighlightCtor(range))
  })
  useLayoutEffect(
    () => () => {
      (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete('rb-tw-sel')
    },
    [],
  )

  // Caret / selection moves made by the user (mouse, arrows) flow back into the model.
  useLayoutEffect(() => {
    const onSelectionChange = () => {
      const root = rootRef.current
      if (!root || composingRef.current) return
      const sel = readSelection(root)
      if (sel) onSelect(sel)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [onSelect])

  const apply = (start: number, end: number, insert: string) => {
    const v = valueRef.current
    const result = editText(v.doc, v.text, { start, end, insert, pending: v.pending ?? undefined })
    const caret = Math.min(result.text.length, start + (result.text.length - (v.text.length - (end - start))))
    onChange({ text: result.text, doc: result.doc, selection: { start: caret, end: caret }, truncated: result.truncated })
  }

  const handleBeforeInput = (ie: InputEvent) => {
    if (composingRef.current || ie.isComposing || ie.inputType === 'insertCompositionText') return
    const root = rootRef.current
    if (!root) return
    ie.preventDefault()
    const v = valueRef.current
    const sel = readSelection(root) ?? v.selection
    let { start, end } = sel
    switch (ie.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        apply(start, end, ie.data ?? ie.dataTransfer?.getData('text/plain') ?? '')
        return
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertFromYank':
        apply(start, end, ie.dataTransfer?.getData('text/plain') ?? ie.data ?? '')
        return
      case 'insertParagraph':
      case 'insertLineBreak':
        apply(start, end, '\n')
        return
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        if (start === end) start = ie.inputType === 'deleteContentBackward' ? prevBoundary(v.text, start) : wordEdge(v.text, start, -1)
        break
      case 'deleteContentForward':
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        if (start === end) end = ie.inputType === 'deleteContentForward' ? nextBoundary(v.text, end) : wordEdge(v.text, end, 1)
        break
      case 'deleteByCut':
      case 'deleteContent':
        break
      case 'historyUndo':
        onUndo()
        return
      case 'historyRedo':
        onRedo()
        return
      default:
        return
    }
    if (start !== end) apply(start, end, '')
  }

  // React's `onBeforeInput` is NOT the native `beforeinput` (it is a `textInput` shim without `inputType`), so listen natively.
  const beforeInputRef = useRef(handleBeforeInput)
  beforeInputRef.current = handleBeforeInput
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const listener = (event: Event) => beforeInputRef.current(event as InputEvent)
    root.addEventListener('beforeinput', listener)
    return () => root.removeEventListener('beforeinput', listener)
  }, [value.epoch])

  // Escape commits the note and must NOT reach the Reader's own Escape (which would disarm the tool): capture it first.
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useLayoutEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const root = rootRef.current
      if (event.key !== 'Escape' || !root || !root.contains(document.activeElement)) return
      event.stopPropagation()
      event.preventDefault()
      commitRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onCompositionStart = () => {
    const root = rootRef.current
    const sel = (root && readSelection(root)) ?? valueRef.current.selection
    composingRef.current = { start: sel.start, end: sel.end }
  }

  const onCompositionEnd = (event: CompositionEvent<HTMLDivElement>) => {
    const range = composingRef.current
    composingRef.current = null
    if (!range) return
    // The browser changed the DOM under us: put the composed text into the model, then rebuild from the model.
    apply(range.start, range.end, event.data ?? '')
    onRebuild()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      onUndo()
    } else if (mod && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault()
      onRedo()
    } else if (mod && !event.altKey) {
      // By physical key, so the shortcuts also work with a non-Latin keyboard layout.
      const flag = event.shiftKey ? (event.code === 'KeyX' ? 'strike' : null) : FLAG_KEYS[event.code]
      if (flag) {
        event.preventDefault()
        onToggleFlag(flag)
      }
    }
  }

  // Paste is plain text only (also intercepted in beforeinput; this keeps formatted clipboards out of the DOM).
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const root = rootRef.current
    const sel = (root && readSelection(root)) ?? valueRef.current.selection
    apply(sel.start, sel.end, event.clipboardData.getData('text/plain'))
  }

  return (
    <div
      data-tw-editor=""
      style={{ position: 'absolute', left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${height * 100}%`, pointerEvents: 'auto', outline: '1px dashed #1E88E5', background: 'rgba(255,255,255,0.01)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        key={value.epoch}
        ref={rootRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label="Typewriter text"
        style={{ position: 'absolute', inset: 0, outline: 'none', caretColor: value.doc.base.color, cursor: 'text', userSelect: 'text' }}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <TypewriterLines layout={layout} hanging={hanging} />
      </div>
      {truncated ? (
        <div role="status" style={{ position: 'absolute', left: 0, top: '100%', fontSize: 11, background: '#333', color: '#fff', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
          Text limit reached (10 000 characters)
        </div>
      ) : null}
    </div>
  )
}
