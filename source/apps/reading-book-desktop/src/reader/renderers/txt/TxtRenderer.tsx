import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  deriveTextEdit,
  segmentTxt,
  txtMarkAt,
  txtReadingLocation,
  type EditHint,
  type TextEdit,
  type TxtReaderHighlight,
  type TxtSelection,
  type MarkupInteractionTool,
} from '@reading-book/book-reader-sdk'
import {
  boxForOffsets,
  lineTopAt,
  offsetAtClientY,
  type ClientBox,
} from './txtGeometry'
import { txtMarkStyle } from './txtMarkStyle'
import './txt.css'

export type TxtMarkupTool = MarkupInteractionTool

type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

/** A range of the text the user selected (offsets into the canonical text). */
export type TxtSelectionInfo = {
  start: number
  end: number
  text: string
  /** Box of the selected text on screen, for anchoring popups. */
  box: ClientBox | null
}

export type TxtHighlightHit = { id: string; box: ClientBox }

/** Ask the surface to put the caret / selection somewhere (after undo / redo). */
export type TxtCaretRequest = { start: number; end: number; token: number }

export type TxtRendererApi = {
  /** Text offset of the first line at the top of the viewport. */
  getReadingOffset: () => number
  getCurrentLocation: () => ReturnType<typeof txtReadingLocation>
  /** 0–1 share of the page scrolled. */
  getProgress: () => number
  scrollToOffset: (offset: number) => void
  scrollToFraction: (fraction: number) => void
  scrollByPage: (direction: 1 | -1) => void
  boxForOffsets: (start: number, end: number) => ClientBox | null
  flashHighlight: (id: string) => void
  getSelection: () => TxtSelectionInfo | null
  clearSelection: () => void
  focus: () => void
}

export type TxtRendererProps = {
  /** The canonical text. Changes that did not come from typing (load, undo, redo) are synced in. */
  text: string
  highlights: readonly TxtReaderHighlight[]
  focusedHighlightId: string | null
  /** False = read and annotate only (file too large to edit). */
  editable: boolean
  /** An armed Highlight / Underline / Strikethrough tool: a drag marks instead of editing. */
  markupTool: TxtMarkupTool | null
  margin: MarginMode
  chromeHidden: boolean
  initialOffset: number
  caretRequest: TxtCaretRequest | null
  /** One user edit (already derived from the input event). */
  onEdit: (edit: TextEdit, selectionBefore: TxtSelection, selectionAfter: TxtSelection) => void
  onUndo: () => void
  onRedo: () => void
  onSaveShortcut: () => void
  onSelectionContextMenu: (selection: TxtSelectionInfo, x: number, y: number) => void
  onMarkupSelection: (selection: TxtSelectionInfo, tool: TxtMarkupTool) => void
  onHighlightClick: (hit: TxtHighlightHit) => void
  onHighlightContextMenu: (hit: TxtHighlightHit) => void
  /** A plain click in the text (no annotation under it, no selection). */
  onBlankClick: () => void
  /** A tap in the margins around the text: toggle the chrome. */
  onMarginClick: () => void
  /** The top-of-viewport offset changed (scroll). */
  onLocation: (offset: number) => void
  /** The page scrolled (a popup anchored to a point on screen should close). */
  onScrolled: () => void
  apiRef?: MutableRefObject<TxtRendererApi | null>
}

const MARGIN: Record<MarginMode, string> = {
  narrow: 'max-w-[580px]',
  normal: 'max-w-[680px]',
  wide: 'max-w-[780px]',
  off: 'max-w-full px-3',
}

const MARGIN_IMMERSIVE: Record<MarginMode, string> = {
  narrow: 'max-w-[min(760px,92vw)]',
  normal: 'max-w-[min(960px,94vw)]',
  wide: 'max-w-[min(1140px,96vw)]',
  off: 'max-w-full px-4 sm:px-6',
}

function pointBox(point: { x: number; y: number }): ClientBox {
  return { top: point.y, bottom: point.y, left: point.x, right: point.x, width: 0, height: 0 }
}

/** A press that moves more than this many px before release was a drag, not a click. */
const CLICK_SLOP_PX = 5
/**
 * Above this many characters the backdrop (marks + measuring layer) catches up with typing after a
 * short pause instead of on every keystroke: laying out a long text twice per key is what makes a big
 * text box laggy (docs/implementation_plan/txt_reader.md §7). Below it, it is always in step.
 */
const BACKDROP_DEFER_MIN_CHARS = 100_000
const BACKDROP_DEFER_MS = 180

/**
 * Plain-text reading surface that is also the editor (docs/implementation_plan/txt_reader.md §6):
 * a real `<textarea>` — so caret, selection, IME and clipboard are the browser's own and offsets
 * are plain UTF-16 string indices — over a same-metrics backdrop that paints the annotation marks.
 * The text is never turned into HTML: it only ever reaches the DOM as a text node or the
 * textarea's value.
 *
 * The textarea is uncontrolled: React never writes its value while the user types (that would move
 * the caret and break composition). Typing is reported as an edit; only changes that did NOT come
 * from the keyboard (load, undo, redo) are written into it.
 */
export function TxtRenderer(props: TxtRendererProps) {
  const {
    text,
    highlights,
    focusedHighlightId,
    editable,
    markupTool,
    margin,
    chromeHidden,
    initialOffset,
    caretRequest,
    apiRef,
  } = props

  const scrollerRef = useRef<HTMLElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Latest props for the native listeners below (attached once).
  const propsRef = useRef(props)
  propsRef.current = props

  /** The text the textarea and the document model currently agree on. */
  const modelTextRef = useRef(text)
  const hintRef = useRef<EditHint | null>(null)
  const composingRef = useRef<{ base: string; hint: EditHint } | null>(null)
  const userScrolledRef = useRef(false)
  const lastReportedRef = useRef<number>(-1)

  // What the backdrop shows. Live for ordinary texts; for a long one it trails typing by a moment.
  const deferBackdrop = text.length > BACKDROP_DEFER_MIN_CHARS
  const [deferred, setDeferred] = useState({ text, highlights })
  const view = deferBackdrop ? deferred : { text, highlights }
  /** The text the backdrop DOM currently holds — every measurement must use this one. */
  const shownTextRef = useRef(view.text)
  /** An offset to scroll into view once the backdrop has caught up with the text. */
  const pendingVisibleRef = useRef<number | null>(null)

  const highlightById = useMemo(() => new Map(view.highlights.map((h) => [h.id, h])), [view.highlights])
  const segments = useMemo(() => segmentTxt(view.text.length, view.highlights), [view.text.length, view.highlights])

  useEffect(() => {
    if (!deferBackdrop) return
    const timer = window.setTimeout(() => setDeferred({ text, highlights }), BACKDROP_DEFER_MS)
    return () => window.clearTimeout(timer)
  }, [deferBackdrop, text, highlights])

  // ---- text sync (changes that did not come from typing) -----------------------------------
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (text !== modelTextRef.current || input.value !== text) {
      input.value = text
      modelTextRef.current = text
    }
  }, [text])

  // ---- autosize fallback for engines without `field-sizing: content` -----------------------
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content'))) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [text, margin, chromeHidden])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.readOnly = !editable || markupTool !== null
  }, [editable, markupTool])

  // ---- geometry ---------------------------------------------------------------------------
  /** The backdrop to measure, only while it holds the same text as the box (null = trailing). */
  const measure = useCallback(() => {
    const backdrop = backdropRef.current
    if (!backdrop || shownTextRef.current !== modelTextRef.current) return null
    return { backdrop }
  }, [])

  const scrollToOffset = useCallback(
    (offset: number) => {
      const scroller = scrollerRef.current
      const m = measure()
      if (!scroller || !m) return
      const top = lineTopAt(m.backdrop, offset, modelTextRef.current)
      if (top === null) return
      scroller.scrollTop += top - scroller.getBoundingClientRect().top
    },
    [measure],
  )

  const ensureVisible = useCallback(
    (offset: number) => {
      const scroller = scrollerRef.current
      const m = measure()
      if (!scroller) return
      if (!m) {
        // The backdrop is still catching up: do it as soon as it has.
        pendingVisibleRef.current = offset
        return
      }
      const top = lineTopAt(m.backdrop, offset, modelTextRef.current)
      if (top === null) return
      const box = scroller.getBoundingClientRect()
      if (top < box.top + 24 || top > box.bottom - 72) {
        scroller.scrollTop += top - box.top - box.height / 3
      }
    },
    [measure],
  )

  // The backdrop just changed: run what was waiting for it.
  useLayoutEffect(() => {
    shownTextRef.current = view.text
    const pending = pendingVisibleRef.current
    if (pending !== null && view.text === modelTextRef.current) {
      pendingVisibleRef.current = null
      ensureVisible(pending)
    }
  }, [view.text, ensureVisible])

  /** Last offset measured while the backdrop was in step — what to report while it is trailing. */
  const lastOffsetRef = useRef(Math.max(0, initialOffset))
  const readingOffset = useCallback((): number => {
    const scroller = scrollerRef.current
    const m = measure()
    if (!scroller || !m) return lastOffsetRef.current
    lastOffsetRef.current = offsetAtClientY(m.backdrop, scroller.getBoundingClientRect().top + 0.5, modelTextRef.current)
    return lastOffsetRef.current
  }, [measure])

  const reportLocation = useCallback(() => {
    if (!measure()) return // the backdrop is trailing a burst of typing; the next scroll reports
    const offset = readingOffset()
    if (offset === lastReportedRef.current) return
    lastReportedRef.current = offset
    propsRef.current.onLocation(offset)
  }, [measure, readingOffset])

  // ---- initial reading position -----------------------------------------------------------
  useLayoutEffect(() => {
    if (initialOffset > 0) scrollToOffset(initialOffset)
    // Fonts arriving late reflow the page: put the saved line back, unless the user already moved.
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (cancelled || userScrolledRef.current) return
      if (initialOffset > 0) scrollToOffset(initialOffset)
    })
    return () => {
      cancelled = true
    }
    // Only the position the book opened at matters; later changes of the prop must not scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- caret requests (undo / redo) -------------------------------------------------------
  useLayoutEffect(() => {
    if (!caretRequest) return
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(caretRequest.start, caretRequest.end)
    // An undo / redo is not typing: bring the backdrop up to date now, then scroll to the caret.
    if (deferBackdrop) setDeferred({ text, highlights })
    ensureVisible(caretRequest.start)
    // Keyed by token: the same range requested twice must still apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretRequest?.token])

  // ---- native input plumbing --------------------------------------------------------------
  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    const selectionOf = (): TxtSelection => ({ start: input.selectionStart, end: input.selectionEnd })

    /** Turn what the browser just did to the box into one edit of the model. */
    const commitDomChange = (before: string, hint: EditHint | null) => {
      const after = input.value
      if (before === after) return
      const edit = deriveTextEdit(before, after, hint ?? undefined)
      modelTextRef.current = after
      if (!edit) return
      const selectionBefore = hint ? { start: hint.selectionStart, end: hint.selectionEnd } : { start: edit.start, end: edit.start + edit.deleteLength }
      propsRef.current.onEdit(edit, selectionBefore, selectionOf())
    }

    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'historyUndo') {
        event.preventDefault()
        propsRef.current.onUndo()
        return
      }
      if (event.inputType === 'historyRedo') {
        event.preventDefault()
        propsRef.current.onRedo()
        return
      }
      hintRef.current = {
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
        inputType: event.inputType,
      }
    }

    const onInput = () => {
      if (composingRef.current) return
      const hint = hintRef.current
      hintRef.current = null
      commitDomChange(modelTextRef.current, hint)
    }

    const onCompositionStart = () => {
      composingRef.current = {
        base: modelTextRef.current,
        hint: { selectionStart: input.selectionStart, selectionEnd: input.selectionEnd, inputType: 'insertCompositionText' },
      }
    }

    const onCompositionEnd = () => {
      const session = composingRef.current
      composingRef.current = null
      hintRef.current = null
      if (!session) return
      commitDomChange(session.base, session.hint)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) propsRef.current.onRedo()
        else propsRef.current.onUndo()
      } else if (key === 'y') {
        event.preventDefault()
        event.stopPropagation()
        propsRef.current.onRedo()
      } else if (key === 's') {
        event.preventDefault()
        propsRef.current.onSaveShortcut()
      }
    }

    input.addEventListener('beforeinput', onBeforeInput)
    input.addEventListener('input', onInput)
    input.addEventListener('compositionstart', onCompositionStart)
    input.addEventListener('compositionend', onCompositionEnd)
    input.addEventListener('keydown', onKeyDown)
    return () => {
      input.removeEventListener('beforeinput', onBeforeInput)
      input.removeEventListener('input', onInput)
      input.removeEventListener('compositionstart', onCompositionStart)
      input.removeEventListener('compositionend', onCompositionEnd)
      input.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // ---- selection / click helpers ----------------------------------------------------------
  const readSelection = useCallback((): TxtSelectionInfo | null => {
    const input = inputRef.current
    if (!input) return null
    const { selectionStart: start, selectionEnd: end } = input
    if (end <= start) return null
    const current = modelTextRef.current
    const m = measure()
    return { start, end, text: current.slice(start, end), box: m ? boxForOffsets(m.backdrop, start, end, current) : null }
  }, [measure])

  /** The annotation under `offset`, anchored at its character — or at the pointer while the backdrop trails. */
  const hitAt = useCallback(
    (offset: number, point: { x: number; y: number }): TxtHighlightHit | null => {
      const mark = txtMarkAt(propsRef.current.highlights, offset)
      if (!mark) return null
      const m = measure()
      const current = modelTextRef.current
      const box =
        (m
          ? (boxForOffsets(m.backdrop, offset, Math.min(offset + 1, mark.endOffset), current) ??
            boxForOffsets(m.backdrop, mark.startOffset, mark.endOffset, current))
          : null) ?? pointBox(point)
      return { id: mark.id, box }
    },
    [measure],
  )

  /** The press ended (wherever the pointer is now): a drag with a tool armed marks, a click opens a mark. */
  const finishPress = (press: { x: number; y: number }, up: PointerEvent) => {
    const input = inputRef.current
    if (!input) return
    const moved = Math.hypot(up.clientX - press.x, up.clientY - press.y) > CLICK_SLOP_PX
    const { markupTool: tool } = propsRef.current

    const selection = readSelection()
    if (selection && tool) {
      propsRef.current.onMarkupSelection(selection, tool)
      input.setSelectionRange(selection.end, selection.end)
      return
    }
    if (selection || moved) return // a drag-select: wait for the context menu / a tool
    const hit = hitAt(input.selectionStart, { x: up.clientX, y: up.clientY })
    if (hit) propsRef.current.onHighlightClick(hit)
    else propsRef.current.onBlankClick()
  }

  // Listening on the window, not the box: a drag that ends over the margin must still count.
  const onPointerDown = (event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (event.button !== 0) return
    const press = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointerup', (up) => finishPress(press, up), { once: true })
  }

  const onContextMenu = (event: ReactMouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const selection = readSelection()
    if (selection) {
      propsRef.current.onSelectionContextMenu(selection, event.clientX, event.clientY)
      return
    }
    const input = inputRef.current
    const hit = input ? hitAt(input.selectionStart, { x: event.clientX, y: event.clientY }) : null
    if (hit) propsRef.current.onHighlightContextMenu(hit)
  }

  const onMainClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.txt-editor')) return
    if (inputRef.current && inputRef.current.selectionEnd > inputRef.current.selectionStart) return
    propsRef.current.onMarginClick()
  }

  // ---- scroll -> reading position ---------------------------------------------------------
  const frameRef = useRef<number | null>(null)
  const onScroll = () => {
    propsRef.current.onScrolled()
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      reportLocation()
    })
  }
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  // ---- imperative API ---------------------------------------------------------------------
  useEffect(() => {
    if (!apiRef) return
    const api: TxtRendererApi = {
      getReadingOffset: readingOffset,
      getCurrentLocation: () => txtReadingLocation(readingOffset(), modelTextRef.current.length),
      getProgress: () => {
        const scroller = scrollerRef.current
        if (!scroller) return 0
        const range = scroller.scrollHeight - scroller.clientHeight
        return range <= 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / range))
      },
      scrollToOffset: (offset) => {
        userScrolledRef.current = true
        scrollToOffset(offset)
        reportLocation()
      },
      scrollToFraction: (fraction) => {
        const scroller = scrollerRef.current
        if (!scroller) return
        userScrolledRef.current = true
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * Math.min(1, Math.max(0, fraction))
      },
      scrollByPage: (direction) => {
        const scroller = scrollerRef.current
        if (!scroller) return
        userScrolledRef.current = true
        scroller.scrollBy({ top: direction * scroller.clientHeight * 0.9 })
      },
      boxForOffsets: (start, end) => {
        const m = measure()
        return m ? boxForOffsets(m.backdrop, start, end, modelTextRef.current) : null
      },
      flashHighlight: (id) => {
        const backdrop = backdropRef.current
        if (!backdrop) return
        const spans = Array.from(backdrop.querySelectorAll<HTMLElement>('[data-ids]')).filter((el) =>
          (el.dataset.ids ?? '').split(' ').includes(id),
        )
        spans.forEach((el) => el.setAttribute('data-flash', 'true'))
        window.setTimeout(() => spans.forEach((el) => el.removeAttribute('data-flash')), 1000)
      },
      getSelection: readSelection,
      clearSelection: () => {
        const input = inputRef.current
        if (input) input.setSelectionRange(input.selectionEnd, input.selectionEnd)
      },
      focus: () => inputRef.current?.focus({ preventScroll: true }),
    }
    apiRef.current = api
    return () => {
      if (apiRef.current === api) apiRef.current = null
    }
  }, [apiRef, measure, readSelection, readingOffset, reportLocation, scrollToOffset])

  // ---- render -----------------------------------------------------------------------------
  const widthClass = (chromeHidden ? MARGIN_IMMERSIVE : MARGIN)[margin]

  return (
    <main
      ref={scrollerRef}
      data-txt-surface=""
      className="app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain"
      onScroll={onScroll}
      onWheel={() => {
        userScrolledRef.current = true
      }}
      onClick={onMainClick}
    >
      <div className={`mx-auto w-full transition-[max-width] duration-300 ${widthClass}`}>
        <div className="txt-editor" data-txt-editor="">
          <div ref={backdropRef} className="txt-backdrop" aria-hidden="true" data-txt-backdrop="">
            {segments.map((segment) => {
              const covering = segment.ids
                .map((id) => highlightById.get(id))
                .filter((h): h is TxtReaderHighlight => h !== undefined)
              const focused = focusedHighlightId !== null && segment.ids.includes(focusedHighlightId)
              return (
                <span
                  key={segment.start}
                  data-start={segment.start}
                  data-end={segment.end}
                  data-ids={segment.ids.length > 0 ? segment.ids.join(' ') : undefined}
                  className={covering.length > 0 ? 'txt-mark' : undefined}
                  data-focused={focused ? 'true' : undefined}
                  style={covering.length > 0 ? txtMarkStyle(covering) : undefined}
                >
                  {view.text.slice(segment.start, segment.end)}
                </span>
              )
            })}
          </div>
          <textarea
            ref={inputRef}
            className="txt-input"
            data-txt-input=""
            aria-label="Book text"
            aria-multiline="true"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            defaultValue={text}
            onPointerDown={onPointerDown}
            onContextMenu={onContextMenu}
          />
        </div>
      </div>
      <div className="min-h-[40vh]" aria-hidden />
    </main>
  )
}
