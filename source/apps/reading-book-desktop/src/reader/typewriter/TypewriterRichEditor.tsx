import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import {
  TYPEWRITER_DEFAULT_COLOR_HEX,
  clampTypewriterFontSize,
  normalizeTypewriterColorHex,
  normalizeTypewriterContent,
  serializeTypewriterEditorHtml,
  typewriterContentIsEmpty,
  type TypewriterBoxStyle,
} from '@reading-book/shared/models'
import {
  TypewriterFormatToolbar,
  type TypewriterFormatState,
} from './TypewriterFormatToolbar'
import {
  applyInlineTextColor,
  caretColorFromEditorSelection,
  cloneEditorRange,
  queryEditorCommandState,
  restoreEditorRange,
  runEditorCommand,
} from './typewriterSelection'
import {
  computeTypewriterToolbarPlacement,
  getTopLevelBoundingClientRect,
  type TypewriterToolbarPlacement,
} from './typewriterToolbarPortal'

type TypewriterRichEditorProps = {
  value: string
  onChange: (html: string) => void
  onBlur?: () => void
  onFocus?: () => void
  onStyleChange?: (patch: TypewriterBoxStyle) => void
  onEmptyDelete?: () => void
  onCancel?: () => void
  colorHex?: string
  fontSize?: number
  placeholder?: string
  autoFocus?: boolean
  className?: string
  editorRef?: Ref<HTMLDivElement | null>
  /** Show drag handle slot above the editor (caller renders the handle). */
  dragHandle?: ReactNode
  /** Floating toolbar: open the shared right reader panel. */
  onOpenSidePanel?: () => void
  sidePanelOpen?: boolean
}

const CHANGE_DEBOUNCE_MS = 200

/** Contenteditable typewriter box with a floating mini formatting toolbar. */
export function TypewriterRichEditor({
  value,
  onChange,
  onBlur,
  onFocus,
  onStyleChange,
  onEmptyDelete,
  onCancel,
  colorHex,
  fontSize,
  placeholder = 'Type...',
  autoFocus = false,
  className = '',
  editorRef,
  dragHandle,
  onOpenSidePanel,
  sidePanelOpen,
}: TypewriterRichEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const localEditorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const focusedRef = useRef(false)
  const cancelingRef = useRef(false)
  /** Parent setState from iframe typing can steal focus — restore once. */
  const restoreFocusAfterEmitRef = useRef(false)
  const changeTimerRef = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const resolvedColor =
    normalizeTypewriterColorHex(colorHex) ?? TYPEWRITER_DEFAULT_COLOR_HEX
  const resolvedSize = clampTypewriterFontSize(fontSize)

  const [format, setFormat] = useState<TypewriterFormatState>({
    bold: false,
    italic: false,
    underline: false,
    colorHex: resolvedColor,
    fontSize: resolvedSize,
  })
  const [toolbarPos, setToolbarPos] = useState<TypewriterToolbarPlacement | null>(
    null,
  )
  const [editorEmpty, setEditorEmpty] = useState(() =>
    typewriterContentIsEmpty(value),
  )

  const updateToolbarPos = () => {
    const el = rootRef.current
    if (!el) return
    const next = computeTypewriterToolbarPlacement(
      getTopLevelBoundingClientRect(el),
    )
    setToolbarPos((prev) => {
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.placement === next.placement
      ) {
        return prev
      }
      return next
    })
  }

  const clearChangeTimer = () => {
    if (changeTimerRef.current != null) {
      window.clearTimeout(changeTimerRef.current)
      changeTimerRef.current = null
    }
  }

  const emitHtml = (mode: 'debounce' | 'flush' = 'debounce') => {
    const el = localEditorRef.current
    if (!el) return
    const html = serializeTypewriterEditorHtml(el)
    const push = () => {
      // Parent re-render (portal into iframe) often drops iframe focus.
      if (focusedRef.current) restoreFocusAfterEmitRef.current = true
      onChangeRef.current(html)
    }
    if (mode === 'flush') {
      clearChangeTimer()
      push()
      return
    }
    clearChangeTimer()
    changeTimerRef.current = window.setTimeout(() => {
      changeTimerRef.current = null
      push()
    }, CHANGE_DEBOUNCE_MS)
  }

  const restoreEditorFocus = () => {
    const el = localEditorRef.current
    if (!el || !focusedRef.current) return
    const doc = el.ownerDocument
    if (doc.activeElement === el) return
    const saved = savedRangeRef.current
    el.focus({ preventScroll: true })
    restoreEditorRange(saved, el)
  }

  // Reclaim iframe focus after parent portal re-render from onChange.
  useLayoutEffect(() => {
    if (!restoreFocusAfterEmitRef.current) return
    restoreFocusAfterEmitRef.current = false
    restoreEditorFocus()
    updateToolbarPos()
  })

  // Portal + fixed — escapes zoom transform / overflow clip / tools chrome z-50.
  // Iframe nodes need frameElement offset for top-level fixed coords.
  useLayoutEffect(() => {
    updateToolbarPos()
    const ownerWin = rootRef.current?.ownerDocument?.defaultView
    const topWin = window
    const onReposition = () => updateToolbarPos()
    topWin.addEventListener('resize', onReposition)
    topWin.addEventListener('scroll', onReposition, true)
    ownerWin?.addEventListener('resize', onReposition)
    ownerWin?.addEventListener('scroll', onReposition, true)
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onReposition)
        : null
    if (rootRef.current) ro?.observe(rootRef.current)
    return () => {
      topWin.removeEventListener('resize', onReposition)
      topWin.removeEventListener('scroll', onReposition, true)
      ownerWin?.removeEventListener('resize', onReposition)
      ownerWin?.removeEventListener('scroll', onReposition, true)
      ro?.disconnect()
    }
    // Re-bind when the editor mounts into a (possibly new) iframe document.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rootRef identity is stable
  }, [autoFocus])

  useEffect(() => {
    return () => clearChangeTimer()
  }, [])

  const setEditorNode = (el: HTMLDivElement | null) => {
    localEditorRef.current = el
    if (el && !focusedRef.current) {
      const next = normalizeTypewriterContent(value)
      if (el.innerHTML !== next) el.innerHTML = next
    }
    if (typeof editorRef === 'function') {
      editorRef(el)
    } else if (editorRef && 'current' in editorRef) {
      ;(editorRef as { current: HTMLDivElement | null }).current = el
    }
  }

  const refreshFormatState = () => {
    const el = localEditorRef.current
    const inlineColor = caretColorFromEditorSelection(el)
    setFormat({
      bold: queryEditorCommandState(el, 'bold'),
      italic: queryEditorCommandState(el, 'italic'),
      underline: queryEditorCommandState(el, 'underline'),
      colorHex:
        normalizeTypewriterColorHex(inlineColor ?? undefined) ?? resolvedColor,
      fontSize: resolvedSize,
    })
  }

  // Sync external HTML when not focused (avoid caret jumps while typing).
  useEffect(() => {
    const el = localEditorRef.current
    if (!el || focusedRef.current) return
    const next = normalizeTypewriterContent(value)
    if (el.innerHTML !== next) {
      el.innerHTML = next
    }
  }, [value])

  useEffect(() => {
    setFormat((prev) => ({
      ...prev,
      colorHex: resolvedColor,
      fontSize: resolvedSize,
    }))
  }, [resolvedColor, resolvedSize])

  useEffect(() => {
    if (!focusedRef.current) {
      setEditorEmpty(typewriterContentIsEmpty(value))
    }
  }, [value])

  useEffect(() => {
    if (!autoFocus) return
    let cancelled = false

    const focusEditor = () => {
      const el = localEditorRef.current
      if (!el || cancelled) return false
      const doc = el.ownerDocument
      const win = doc.defaultView
      focusedRef.current = true
      el.focus({ preventScroll: true })

      if (typewriterContentIsEmpty(el.innerHTML)) {
        const sel = win?.getSelection()
        if (sel) {
          const range = doc.createRange()
          range.selectNodeContents(el)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }
      }
      updateToolbarPos()
      return doc.activeElement === el
    }

    // EPUB placement clicks inside an iframe — retry focus after the draft mounts.
    focusEditor()
    const raf = requestAnimationFrame(() => {
      focusEditor()
      window.setTimeout(focusEditor, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [autoFocus])

  useEffect(() => {
    function onSelectionChange() {
      if (!focusedRef.current) return
      const el = localEditorRef.current
      const win = el?.ownerDocument?.defaultView
      const sel = win?.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      if (!el.contains(sel.anchorNode)) return
      refreshFormatState()
      updateToolbarPos()
    }
    const doc = localEditorRef.current?.ownerDocument ?? document
    doc.addEventListener('selectionchange', onSelectionChange)
    return () => doc.removeEventListener('selectionchange', onSelectionChange)
  })

  const focusStillInside = () => {
    const editor = localEditorRef.current
    const editorDoc = editor?.ownerDocument
    const editorActive = editorDoc?.activeElement ?? null
    const hostActive = document.activeElement
    if (toolbarRef.current?.contains(hostActive)) return true
    if (editor && editorActive && editor.contains(editorActive)) return true
    if (rootRef.current && editorActive && rootRef.current.contains(editorActive)) {
      return true
    }
    return false
  }

  const handleBlur = () => {
    window.setTimeout(() => {
      if (cancelingRef.current) {
        cancelingRef.current = false
        return
      }
      if (focusStillInside()) {
        return
      }
      // Spurious blur from parent portal re-render — reclaim focus.
      if (restoreFocusAfterEmitRef.current) {
        restoreFocusAfterEmitRef.current = false
        restoreEditorFocus()
        return
      }
      emitHtml('flush')
      focusedRef.current = false
      onBlur?.()
    }, 0)
  }

  const saveEditorSelection = () => {
    savedRangeRef.current = cloneEditorRange(localEditorRef.current)
  }

  const applyInline = (command: 'bold' | 'italic' | 'underline') => {
    const el = localEditorRef.current
    if (!el) return
    el.focus()
    restoreEditorRange(savedRangeRef.current, el)
    runEditorCommand(el, command)
    savedRangeRef.current = cloneEditorRange(el)
    emitHtml('flush')
    refreshFormatState()
  }

  const applyTextColor = (next: string) => {
    const normalized = normalizeTypewriterColorHex(next)
    const el = localEditorRef.current
    if (!normalized || !el) return

    el.focus()
    restoreEditorRange(savedRangeRef.current, el)

    const win = el.ownerDocument.defaultView
    const sel = win?.getSelection()
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      if (!range.collapsed) {
        applyInlineTextColor(range.cloneRange(), normalized)
      } else {
        // Caret only — color for newly typed characters.
        runEditorCommand(el, 'styleWithCSS', 'true')
        runEditorCommand(el, 'foreColor', normalized)
      }
    }

    onStyleChange?.({ colorHex: normalized })
    setFormat((prev) => ({ ...prev, colorHex: normalized }))
    savedRangeRef.current = cloneEditorRange(el)
    emitHtml('flush')
    refreshFormatState()
  }

  const applyFontSize = (next: number) => {
    const size = clampTypewriterFontSize(next)
    onStyleChange?.({ fontSize: size })
    setFormat((prev) => ({ ...prev, fontSize: size }))
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelingRef.current = true
      clearChangeTimer()
      if (onCancel) {
        onCancel()
        return
      }
      ;(e.currentTarget as HTMLDivElement).blur()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLDivElement).blur()
      return
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && onEmptyDelete) {
      const el = localEditorRef.current
      if (el && typewriterContentIsEmpty(el.innerHTML)) {
        e.preventDefault()
        e.stopPropagation()
        clearChangeTimer()
        onEmptyDelete()
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        applyInline('bold')
      } else if (key === 'i') {
        e.preventDefault()
        applyInline('italic')
      } else if (key === 'u') {
        e.preventDefault()
        applyInline('underline')
      }
    }
  }

  const empty = editorEmpty

  const toolbar =
    toolbarPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="rb-tw-toolbar-portal"
            style={{ top: toolbarPos.top, left: toolbarPos.left }}
            data-rb-tw-toolbar=""
          >
            <TypewriterFormatToolbar
              toolbarRef={toolbarRef}
              state={format}
              onSaveSelection={saveEditorSelection}
              onBold={() => applyInline('bold')}
              onItalic={() => applyInline('italic')}
              onUnderline={() => applyInline('underline')}
              onTextColor={applyTextColor}
              onFontSize={applyFontSize}
              onOpenSidePanel={onOpenSidePanel}
              sidePanelOpen={sidePanelOpen}
            />
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={`rb-tw-editor-root relative ${className}`}>
      {toolbar}
      {dragHandle}
      <div
        ref={setEditorNode}
        role="textbox"
        aria-multiline="true"
        aria-label="Edit typewriter text"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-empty={empty ? 'true' : 'false'}
        className="rb-typewriter-edit rb-typewriter-richedit"
        style={{ color: resolvedColor, fontSize: resolvedSize }}
        onFocus={() => {
          focusedRef.current = true
          onFocus?.()
          refreshFormatState()
          saveEditorSelection()
          updateToolbarPos()
        }}
        onMouseUp={saveEditorSelection}
        onKeyUp={saveEditorSelection}
        onBlur={handleBlur}
        onInput={() => {
          const el = localEditorRef.current
          if (el) {
            setEditorEmpty(
              typewriterContentIsEmpty(serializeTypewriterEditorHtml(el)),
            )
          }
          saveEditorSelection()
          emitHtml('debounce')
          updateToolbarPos()
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

/** Read-only sanitized HTML for committed typewriter notes. */
export function TypewriterStaticHtml({
  html,
  colorHex,
  fontSize,
  className = '',
}: {
  html: string
  colorHex?: string
  fontSize?: number
  className?: string
}) {
  const safe = normalizeTypewriterContent(html)
  const color =
    normalizeTypewriterColorHex(colorHex) ?? TYPEWRITER_DEFAULT_COLOR_HEX
  const size = clampTypewriterFontSize(fontSize)

  if (typewriterContentIsEmpty(html)) {
    return (
      <span className={className} style={{ color, fontSize: size }}>
        …
      </span>
    )
  }

  return (
    <span
      className={`rb-typewriter-html ${className}`}
      style={{ color, fontSize: size }}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
