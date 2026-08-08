import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
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
  cloneEditorRange,
  restoreEditorRange,
} from './typewriterSelection'

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
}

function queryCommandState(command: string): boolean {
  try {
    return document.queryCommandState(command)
  } catch {
    return false
  }
}

function runCommand(command: string, value?: string): void {
  try {
    document.execCommand(command, false, value)
  } catch {
    /* ignore unsupported command */
  }
}

function caretColorFromSelection(): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.focusNode
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement
  while (node && node instanceof HTMLElement) {
    const color = node.style?.color?.trim()
    if (color) return normalizeTypewriterColorHex(color)
    if (node.isContentEditable) break
    node = node.parentElement
  }
  return null
}

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
}: TypewriterRichEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const localEditorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const focusedRef = useRef(false)

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

  const emitHtml = () => {
    const el = localEditorRef.current
    if (!el) return
    onChange(serializeTypewriterEditorHtml(el))
  }

  const refreshFormatState = () => {
    const inlineColor = caretColorFromSelection()
    setFormat({
      bold: queryCommandState('bold'),
      italic: queryCommandState('italic'),
      underline: queryCommandState('underline'),
      colorHex: inlineColor ?? resolvedColor,
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
    if (!autoFocus) return
    const el = localEditorRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [autoFocus])

  useEffect(() => {
    function onSelectionChange() {
      if (!focusedRef.current) return
      const el = localEditorRef.current
      const sel = window.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      if (!el.contains(sel.anchorNode)) return
      refreshFormatState()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  })

  const focusStillInside = () => {
    const active = document.activeElement
    return (
      !!active &&
      (!!localEditorRef.current?.contains(active) ||
        !!toolbarRef.current?.contains(active) ||
        !!rootRef.current?.contains(active))
    )
  }

  const handleBlur = () => {
    focusedRef.current = false
    window.setTimeout(() => {
      if (focusStillInside()) {
        focusedRef.current = true
        return
      }
      emitHtml()
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
    runCommand(command)
    savedRangeRef.current = cloneEditorRange(el)
    emitHtml()
    refreshFormatState()
  }

  const applyTextColor = (next: string) => {
    const normalized = normalizeTypewriterColorHex(next)
    const el = localEditorRef.current
    if (!normalized || !el) return

    el.focus()
    restoreEditorRange(savedRangeRef.current, el)

    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      if (!range.collapsed) {
        applyInlineTextColor(range.cloneRange(), normalized)
      } else {
        // Caret only — color for newly typed characters.
        runCommand('styleWithCSS', 'true')
        runCommand('foreColor', normalized)
      }
    }

    onStyleChange?.({ colorHex: normalized })
    setFormat((prev) => ({ ...prev, colorHex: normalized }))
    savedRangeRef.current = cloneEditorRange(el)
    emitHtml()
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

  const empty = typewriterContentIsEmpty(value)

  return (
    <div ref={rootRef} className={`rb-tw-editor-root relative ${className}`}>
      <div className="rb-tw-toolbar-anchor">
        <TypewriterFormatToolbar
          toolbarRef={toolbarRef}
          state={format}
          onSaveSelection={saveEditorSelection}
          onBold={() => applyInline('bold')}
          onItalic={() => applyInline('italic')}
          onUnderline={() => applyInline('underline')}
          onTextColor={applyTextColor}
          onFontSize={applyFontSize}
        />
      </div>
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
        }}
        onMouseUp={saveEditorSelection}
        onKeyUp={saveEditorSelection}
        onBlur={handleBlur}
        onInput={emitHtml}
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
