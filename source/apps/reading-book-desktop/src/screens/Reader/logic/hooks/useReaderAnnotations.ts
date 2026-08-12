import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'
import { CfiLocation, Location } from '@reading-book/domain'
import {
  HIGHLIGHT_COLOR_HEX,
  DEFAULT_DRAW_SETTINGS,
  annotationAdd,
  annotationRemove,
  annotationReplace,
  applyAnnotationHistoryStep,
  blocksSelectionContextMenu,
  createAnnotationHistory,
  epubJumpCfi,
  findOverlappingHighlight,
  highlightColorFromHex,
  nextReaderOverlayId,
  normalizeHighlightColorHex,
  findReaderBookmarksAtLocation,
  packReaderBookmarkLocation,
  readerBookmarkJumpLocation,
  resolveCurrentReaderBookmarkLocation,
  readerHighlightToAnnotationInput,
  readerTypewriterToAnnotationInput,
  epubTypewriterJumpCfi,
  parseTypewriterLocation,
  serializeTypewriterLocation,
  selectionHasHighlight,
  TYPEWRITER_DEFAULT_COLOR_HEX,
  TYPEWRITER_DEFAULT_FONT_SIZE,
  clampTypewriterFontSize,
  normalizeTypewriterColorHex,
  normalizeTypewriterContent,
  typewriterContentIsEmpty,
  readerFreehandToAnnotationInput,
  serializeFreehandPoints,
  type AnnotateTool,
  type AnnotationUndoHandlers,
  type DrawToolSettings,
  type ESignStamp,
  type FreehandDraftStroke,
  type FreehandPoint,
  type HighlightHandleRect,
  type PendingSelection,
  type ReaderAnnotationStatus,
  type ReaderBookmark,
  type ReaderHighlight,
  type ReaderShapeAnnotation,
  type ReaderTypewriterNote,
  type TypewriterBoxStyle,
  type TypewriterDraft,
  type TypewriterMovePayload,
  type TypewriterPlacePayload,
} from '@reading-book/shared/models'
import { overlayApi } from '../../../../bridge'
import {
  focusAnnotationInDocument,
  waitForAnnotationLayoutSettle,
} from '../../../../reader/annotationJump'
import type { EpubRendererApi, EpubNavState } from '../../../../reader/renderers/epub'
import { blurReaderSidebarFocus } from '../../../../reader/readerChromeInteraction'
import type {
  CompanionTool,
  HighlightEditTarget,
  ModeTool,
  SelectionMenuAnchor,
} from '../../components'
import { anchorFromSelectionRect } from '../selection/selectionAnchor'
export type SelectionMenuState = {
  selection: PendingSelection
  anchor: SelectionMenuAnchor
}

type UseReaderAnnotationsOptions = {
  bookId: string | undefined
  /** Updated each render by ReaderScreen (book open may finish after this hook). */
  isEpubSurfaceRef: MutableRefObject<boolean>
  bookFormatRef: MutableRefObject<string | null>
  epubApiRef: RefObject<EpubRendererApi | null>
  epubNavRef: MutableRefObject<EpubNavState | null>
  chapterTitleRef: MutableRefObject<string>
  bookmarkChapterIndexRef: MutableRefObject<number>
  closeFloating: () => void
  setChromeHidden: Dispatch<SetStateAction<boolean>>
  setToast: Dispatch<SetStateAction<string | null>>
  goChapterRef: MutableRefObject<(index: number) => void>
  goToPageRef: MutableRefObject<(page: number) => void>
  clearHighlightHandlesRef: MutableRefObject<() => void>
}

export function useReaderAnnotations({
  bookId,
  isEpubSurfaceRef,
  bookFormatRef,
  epubApiRef,
  epubNavRef,
  chapterTitleRef,
  bookmarkChapterIndexRef,
  closeFloating,
  setChromeHidden,
  setToast,
  goChapterRef,
  goToPageRef,
  clearHighlightHandlesRef,
}: UseReaderAnnotationsOptions) {
  const handleFlashTimerRef = useRef<number | null>(null)
  const activeToolRef = useRef<AnnotateTool>('hand')
  const highlightsRef = useRef<ReaderHighlight[]>([])
  const highlightEditRef = useRef<HighlightEditTarget | null>(null)
  const annotationHistoryRef = useRef(createAnnotationHistory())
  const annotationShortcutsRef = useRef({
    undo: () => {},
    redo: () => {},
    deleteFocused: () => {},
  })
  const noteEditBaselineRef = useRef<ReaderHighlight | null>(null)
  /** Debounced content saves for typewriter textboxes (id → timer). */
  const typewriterContentTimersRef = useRef<Map<string, number>>(new Map())
  /** Content at focus time — used for undo on blur flush. */
  const typewriterContentBaselineRef = useRef<Map<string, string>>(new Map())

  const [activeTool, setActiveTool] = useState<AnnotateTool>('hand')
  activeToolRef.current = activeTool
  const [drawSettings, setDrawSettings] =
    useState<DrawToolSettings>(DEFAULT_DRAW_SETTINGS)
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(
    null,
  )
  const pendingSelection = selectionMenu?.selection ?? null
  const [highlightEdit, setHighlightEdit] = useState<HighlightEditTarget | null>(
    null,
  )
  highlightEditRef.current = highlightEdit
  const [handleRect, setHandleRect] = useState<HighlightHandleRect | null>(null)
  const [handleFlash, setHandleFlash] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteEditTarget, setNoteEditTarget] = useState<ReaderHighlight | null>(
    null,
  )

  const [highlights, setHighlights] = useState<ReaderHighlight[]>([])
  highlightsRef.current = highlights

  /** Close color-edit panel and clear focused handles. */
  function dismissHighlightEditPanel() {
    setHighlightEdit(null)
    setHandleRect(null)
    setHandleFlash(false)
  }

  function clearHighlightHandles() {
    setHighlightEdit(null)
    setHandleRect(null)
    setHandleFlash(false)
  }
  clearHighlightHandlesRef.current = clearHighlightHandles

  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([])
  const [typewriterNotes, setTypewriterNotes] = useState<ReaderTypewriterNote[]>([])
  const typewriterNotesRef = useRef(typewriterNotes)
  typewriterNotesRef.current = typewriterNotes
  const [typewriterDraft, setTypewriterDraft] = useState<TypewriterDraft | null>(
    null,
  )
  const typewriterDraftRef = useRef(typewriterDraft)
  typewriterDraftRef.current = typewriterDraft
  const [eSignStamps, setESignStamps] = useState<ESignStamp[]>([])
  /** Freehand strokes (T5.11b draw + T5.11e SQLite persist). */
  const [freehandStrokes, setFreehandStrokes] = useState<ReaderShapeAnnotation[]>(
    [],
  )
  const drawSettingsRef = useRef(drawSettings)
  drawSettingsRef.current = drawSettings

  // Reset in-memory overlays when switching books.
  useEffect(() => {
    setHighlights([])
    annotationHistoryRef.current.clear()
    setBookmarks([])
    for (const timer of typewriterContentTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    typewriterContentTimersRef.current.clear()
    typewriterContentBaselineRef.current.clear()
    setTypewriterNotes([])
    setTypewriterDraft(null)
    setESignStamps([])
    setFreehandStrokes([])
    setActiveTool('hand')
    setSelectionMenu(null)
    clearHighlightHandles()
    setNoteModalOpen(false)
    setNoteEditTarget(null)
    setDrawSettings(DEFAULT_DRAW_SETTINGS)
  }, [bookId])

  useEffect(() => {
    return () => {
      if (handleFlashTimerRef.current != null) {
        window.clearTimeout(handleFlashTimerRef.current)
      }
    }
  }, [])

  function selectTool(tool: ModeTool) {
    closeFloating()
    const toggleOff =
      (tool === 'highlight' && activeToolRef.current === 'highlight') ||
      (tool === 'typewriter' && activeToolRef.current === 'typewriter') ||
      (tool === 'pencil' && activeToolRef.current === 'pencil') ||
      (tool === 'shape' && activeToolRef.current === 'shape') ||
      (tool === 'eraser' && activeToolRef.current === 'eraser')
    const next: AnnotateTool = toggleOff ? 'hand' : tool
    // Leaving typewriter: persist non-empty draft, then clear virtual box.
    if (
      activeToolRef.current === 'typewriter' &&
      next !== 'typewriter' &&
      typewriterDraftRef.current
    ) {
      saveDraftAsTypewriterNote(typewriterDraftRef.current)
      setTypewriterDraft(null)
    }
    // Toolbar is the only place that mutates activeTool (plus Escape / book switch).
    setActiveTool(next)
    setSelectionMenu(null)
    clearHighlightHandles()
    blurReaderSidebarFocus()
  }

  function onCompanionTool(tool: CompanionTool) {
    closeFloating()
    if (tool === 'search') {
      setToast('Search in book — coming soon.')
      return
    }
    if (tool === 'speech') {
      setToast('Speech (text-to-speech) — coming soon.')
      return
    }
    setToast('Translate — coming soon.')
  }

  function flashHandleAt(rect: HighlightHandleRect | null) {
    if (!rect) return
    setHandleRect(rect)
    setHandleFlash(true)
    if (handleFlashTimerRef.current != null) {
      window.clearTimeout(handleFlashTimerRef.current)
    }
    handleFlashTimerRef.current = window.setTimeout(() => {
      setHandleFlash(false)
      handleFlashTimerRef.current = null
    }, 500)
  }

  /** Right-click on the active selection → floating toolbar (no mouseup auto-popup). */
  function openSelectionMenu(
    selection: PendingSelection,
    anchor: SelectionMenuAnchor,
  ) {
    if (blocksSelectionContextMenu(activeTool)) {
      // Annotate modes auto-apply or use crosshair — no selection context menu.
      return
    }
    clearHighlightHandles()
    setSelectionMenu({
      selection,
      anchor: anchorFromSelectionRect(selection, anchor),
    })
    setChromeHidden(false)
  }

  function closeSelectionMenu() {
    setSelectionMenu(null)
  }

  function clearActiveSelection() {
    if (isEpubSurfaceRef.current) {
      epubApiRef.current?.clearSelection()
    } else {
      window.getSelection()?.removeAllRanges()
    }
  }

  function dismissPendingSelection() {
    clearActiveSelection()
    closeSelectionMenu()
  }

  function handleSelectionDismiss() {
    if (highlightEdit) {
      dismissHighlightEditPanel()
      return
    }
    if (!selectionMenu) return
    dismissPendingSelection()
  }

  function rejectOverlappingHighlight(selection: PendingSelection) {
    const existing = findOverlappingHighlight(selection, highlights)
    clearActiveSelection()
    closeSelectionMenu()
    if (existing) {
      // Focus the existing mark instead of creating a duplicate/partial overlap.
      setHighlightEdit({
        id: existing.id,
        colorHex: existing.colorHex,
        selectedText: existing.selectedText,
        hasNote: Boolean(existing.note?.trim()),
        rect: selection.rect,
      })
      setHandleRect(selection.rect)
      setHandleFlash(false)
      setChromeHidden(false)
      setToast('This passage is already highlighted.')
      return
    }
    flashHandleAt(selection.rect)
    setToast('This passage is already highlighted.')
  }

  function persistHighlight(h: ReaderHighlight) {
    if (!bookId) return
    void overlayApi
      .saveAnnotation(readerHighlightToAnnotationInput(bookId, h))
      .catch(() => {
        setToast('Could not save highlight.')
      })
  }

  function persistHighlightNote(id: string, note: string) {
    if (!bookId) return
    void overlayApi
      .updateAnnotation({ bookId, id, style: { note } })
      .then((result) => {
        if (!result.ok) setToast('Could not save note.')
      })
      .catch(() => setToast('Could not save note.'))
  }

  function persistDeleteHighlight(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteAnnotation({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete highlight.')
      })
      .catch(() => setToast('Could not delete highlight.'))
  }

  /** Re-apply a highlight into memory + SQLite without touching undo history. */
  function restoreHighlightQuiet(h: ReaderHighlight) {
    setHighlights((list) => [...list.filter((x) => x.id !== h.id), h])
    persistHighlight(h)
  }

  function removeHighlightQuiet(highlightId: string) {
    setHighlights((list) => list.filter((h) => h.id !== highlightId))
    if (highlightEditRef.current?.id === highlightId) {
      clearHighlightHandles()
    }
    setNoteEditTarget((prev) => {
      if (prev?.id === highlightId) {
        setNoteModalOpen(false)
        return null
      }
      return prev
    })
    persistDeleteHighlight(highlightId)
  }

  function restoreTypewriterQuiet(note: ReaderTypewriterNote) {
    setTypewriterNotes((list) => [...list.filter((n) => n.id !== note.id), note])
    persistSaveTypewriter(note)
  }

  function removeTypewriterQuiet(id: string) {
    const timers = typewriterContentTimersRef.current
    const pending = timers.get(id)
    if (pending != null) {
      window.clearTimeout(pending)
      timers.delete(id)
    }
    typewriterContentBaselineRef.current.delete(id)
    setTypewriterNotes((list) => list.filter((n) => n.id !== id))
    persistDeleteTypewriter(id)
  }

  function restoreBookmarkQuiet(bookmark: ReaderBookmark) {
    setBookmarks((list) => [...list.filter((b) => b.id !== bookmark.id), bookmark])
    persistSaveBookmark(bookmark)
  }

  function removeBookmarkQuiet(id: string) {
    setBookmarks((list) => list.filter((b) => b.id !== id))
    persistDeleteBookmark(id)
  }

  function buildAnnotationUndoHandlers(): AnnotationUndoHandlers {
    return {
      restoreHighlight: restoreHighlightQuiet,
      removeHighlight: removeHighlightQuiet,
      restoreTypewriter: restoreTypewriterQuiet,
      removeTypewriter: removeTypewriterQuiet,
      restoreBookmark: restoreBookmarkQuiet,
      removeBookmark: removeBookmarkQuiet,
      onHighlightReplaced: (h: ReaderHighlight) => {
        if (highlightEditRef.current?.id === h.id) {
          setHighlightEdit((prev) =>
            prev
              ? {
                  ...prev,
                  colorHex: h.colorHex,
                  selectedText: h.selectedText,
                  hasNote: Boolean(h.note?.trim()),
                }
              : prev,
          )
        }
      },
    }
  }

  function undoAnnotation() {
    const action = annotationHistoryRef.current.undo()
    if (!action) return
    applyAnnotationHistoryStep(action, 'undo', buildAnnotationUndoHandlers())
  }

  function redoAnnotation() {
    const action = annotationHistoryRef.current.redo()
    if (!action) return
    applyAnnotationHistoryStep(action, 'redo', buildAnnotationUndoHandlers())
  }

  function applyHighlight(
    colorHex: string,
    selection: PendingSelection | null = pendingSelection,
    options?: { fromTool?: boolean; note?: string },
  ) {
    if (!selection) return

    // Never create a duplicate / partial / full overlap on the same text.
    if (selectionHasHighlight(selection, highlightsRef.current)) {
      rejectOverlappingHighlight(selection)
      return
    }

    const normalized =
      normalizeHighlightColorHex(colorHex) ?? HIGHLIGHT_COLOR_HEX.yellow
    const color = highlightColorFromHex(normalized)
    const highlightId = nextReaderOverlayId('hl')
    const now = new Date().toISOString()
    const note = options?.note?.trim() || undefined

    let created: ReaderHighlight
    if (selection.source === 'epub') {
      created = {
        source: 'epub',
        id: highlightId,
        cfiRange: selection.cfiRange,
        locationStart: selection.locationStart,
        locationEnd: selection.locationEnd,
        selectedText: selection.selectedText,
        color,
        colorHex: normalized,
        chapterIndex: selection.chapterIndex,
        note,
        status: 'None',
        isChecked: false,
        createdAt: now,
        updatedAt: now,
      }
    } else {
      created = {
        source: 'fake',
        id: highlightId,
        chapterIndex: selection.chapterIndex,
        paragraphIndex: selection.paragraphIndex,
        selectedText: selection.selectedText,
        color,
        colorHex: normalized,
        note,
        status: 'None',
        isChecked: false,
        createdAt: now,
        updatedAt: now,
      }
    }

    annotationHistoryRef.current.push(
      annotationAdd({ entity: 'highlight', value: created }),
    )
    setHighlights((list) => [...list, created])
    persistHighlight(created)
    clearActiveSelection()
    closeSelectionMenu()

    // Highlight tool: one shot → Hand (no accidental chain highlights).
    if (options?.fromTool) {
      setActiveTool('hand')
      clearHighlightHandles()
      return
    }

    // Selection-menu path: keep the mark focused for color/note tweaks.
    setHandleRect(selection.rect)
    setHandleFlash(false)
    setHighlightEdit({
      id: highlightId,
      colorHex: normalized,
      selectedText: selection.selectedText,
      hasNote: Boolean(options?.note?.trim()),
      rect: selection.rect,
    })
    setChromeHidden(false)
  }

  /**
   * Mouseup after a drag selection — no floating toolbar (right-click only).
   * Highlight tool still applies immediately on release.
   */
  function handleTextSelected(selection: PendingSelection) {
    const tool = activeToolRef.current
    if (tool === 'select') return
    if (tool !== 'highlight') return
    if (selectionHasHighlight(selection, highlightsRef.current)) {
      rejectOverlappingHighlight(selection)
      return
    }
    applyHighlight(HIGHLIGHT_COLOR_HEX.yellow, selection, { fromTool: true })
  }

  function handleHighlightMarkClick(mark: {
    id: string
    cfiRange: string
    colorHex: string
    rect: HighlightHandleRect
    click?: { x: number; y: number }
  }) {
    // Hand browses + edits existing marks; Highlight tool also focuses on tap.
    const tool = activeToolRef.current
    if (tool !== 'hand' && tool !== 'highlight') return
    const existing = highlightsRef.current.find((h) => h.id === mark.id)
    setSelectionMenu(null)
    setHighlightEdit({
      id: mark.id,
      colorHex: existing?.colorHex ?? mark.colorHex,
      selectedText: existing?.selectedText ?? '',
      hasNote: Boolean(existing?.note?.trim()),
      rect: mark.rect,
      click: mark.click,
    })
    setHandleRect(mark.rect)
    setHandleFlash(false)
    setChromeHidden(false)
  }

  function changeHighlightColor(highlightId: string, colorHex: string) {
    const normalized =
      normalizeHighlightColorHex(colorHex) ?? HIGHLIGHT_COLOR_HEX.yellow
    const color = highlightColorFromHex(normalized)
    const now = new Date().toISOString()
    const before = highlightsRef.current.find((h) => h.id === highlightId)
    if (!before) return
    const after = { ...before, color, colorHex: normalized, updatedAt: now }
    annotationHistoryRef.current.push(
      annotationReplace(
        { entity: 'highlight', value: before },
        { entity: 'highlight', value: after },
      ),
    )
    setHighlights((list) =>
      list.map((h) => (h.id === highlightId ? after : h)),
    )
    persistHighlight(after)
    setHighlightEdit((prev) =>
      prev && prev.id === highlightId
        ? { ...prev, colorHex: normalized }
        : prev,
    )
  }

  function deleteHighlightById(highlightId: string) {
    const existing = highlightsRef.current.find((h) => h.id === highlightId)
    if (!existing) return
    annotationHistoryRef.current.push(
      annotationRemove({ entity: 'highlight', value: existing }),
    )
    setHighlights((list) => list.filter((h) => h.id !== highlightId))
    if (highlightEditRef.current?.id === highlightId) {
      clearHighlightHandles()
    } else {
      setHandleRect(null)
      setHandleFlash(false)
    }
    if (noteEditTarget?.id === highlightId) {
      setNoteEditTarget(null)
      setNoteModalOpen(false)
    }
    persistDeleteHighlight(highlightId)
  }

  async function jumpToHighlight(h: ReaderHighlight) {
    setChromeHidden(true)
    clearHighlightHandles()
    closeSelectionMenu()
    blurReaderSidebarFocus()
    const epub = epubApiRef.current
    epub?.setJumpViewportHidden(true)
    try {
      if (h.source === 'epub') {
        const cfi = epubJumpCfi(h)
        if (!cfi) {
          setToast('Could not jump to highlight.')
          return
        }
        await epub?.goToLocation(new CfiLocation(cfi))
        // Wait for chrome resize so center math uses the final viewport.
        await waitForAnnotationLayoutSettle(true)
        const focused = await epub?.focusAnnotation({
          kind: 'highlight',
          id: h.id,
        })
        if (!focused) {
          // Location opened; mark may still be painting — one more settle pass.
          await waitForAnnotationLayoutSettle(false)
          await epub?.focusAnnotation({
            kind: 'highlight',
            id: h.id,
          })
        }
        return
      }
      goChapterRef.current(h.chapterIndex)
      await waitForAnnotationLayoutSettle(true)
      await focusAnnotationInDocument(document, {
        kind: 'highlight',
        id: h.id,
      })
    } catch {
      setToast('Could not jump to highlight.')
    } finally {
      epub?.setJumpViewportHidden(false)
    }
  }

  function copyHighlightText(h: ReaderHighlight) {
    void navigator.clipboard
      ?.writeText(h.selectedText)
      .then(() => setToast('Copied.'))
      .catch(() => setToast('Could not copy.'))
  }

  function openHighlightNoteEditor(h: ReaderHighlight) {
    noteEditBaselineRef.current = h
    setNoteEditTarget(h)
    setNoteModalOpen(true)
    setChromeHidden(false)
  }

  /** Silent autosave for note text — does not close the modal or push undo. */
  function autosaveHighlightNote(content: string) {
    if (noteEditTarget) {
      const now = new Date().toISOString()
      const note = content.trim() || undefined
      const before = highlightsRef.current.find((h) => h.id === noteEditTarget.id)
      if (!before) return
      if ((before.note ?? '') === (note ?? '')) return
      const after = { ...before, note, updatedAt: now }
      setHighlights((list) =>
        list.map((h) => (h.id === noteEditTarget.id ? after : h)),
      )
      setNoteEditTarget(after)
      setHighlightEdit((prev) =>
        prev && prev.id === after.id
          ? { ...prev, hasNote: Boolean(note) }
          : prev,
      )
      persistHighlightNote(after.id, note ?? '')
      return
    }

    // Selection → create highlight with inline note (once).
    if (!pendingSelection) return
    applyHighlight(HIGHLIGHT_COLOR_HEX.yellow, pendingSelection, {
      note: content,
    })
    setNoteModalOpen(false)
  }

  function closeNoteModal() {
    const baseline = noteEditBaselineRef.current
    const current =
      baseline &&
      highlightsRef.current.find((h) => h.id === baseline.id)
    if (
      baseline &&
      current &&
      (baseline.note ?? '') !== (current.note ?? '')
    ) {
      annotationHistoryRef.current.push(
        annotationReplace(
          { entity: 'highlight', value: baseline },
          { entity: 'highlight', value: current },
        ),
      )
    }
    noteEditBaselineRef.current = null
    setNoteModalOpen(false)
    setNoteEditTarget(null)
  }

  function removeHighlightForSelection() {
    if (!pendingSelection) return
    const existing = findOverlappingHighlight(pendingSelection, highlights)
    if (existing) {
      deleteHighlightById(existing.id)
    }
    setHandleRect(null)
    clearActiveSelection()
    closeSelectionMenu()
  }

  function stubSelectionAction(label: string) {
    closeSelectionMenu()
    setToast(`${label} — coming soon.`)
  }

  function openNoteFromSelection() {
    if (!pendingSelection) return
    const existing = findOverlappingHighlight(pendingSelection, highlights)
    if (existing) {
      openHighlightNoteEditor(existing)
      return
    }
    noteEditBaselineRef.current = null
    setNoteEditTarget(null)
    setNoteModalOpen(true)
  }

  annotationShortcutsRef.current = {
    undo: undoAnnotation,
    redo: redoAnnotation,
    deleteFocused: () => {
      const focused = highlightEditRef.current
      if (!focused || activeToolRef.current !== 'highlight') return
      deleteHighlightById(focused.id)
    },
  }

  function copySelection() {
    if (!pendingSelection) return
    void navigator.clipboard?.writeText(pendingSelection.selectedText)
    setToast('Copied.')
    clearActiveSelection()
    closeSelectionMenu()
  }

  function persistSaveBookmark(b: ReaderBookmark) {
    if (!bookId) return
    void overlayApi
      .saveBookmark({
        bookId,
        id: b.id,
        locationRef: b.locationRef,
        label: b.label,
        createdAt: b.createdAt,
      })
      .then((result) => {
        if (!result.ok) setToast('Could not save bookmark.')
      })
      .catch(() => setToast('Could not save bookmark.'))
  }

  function persistDeleteBookmark(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteBookmark({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete bookmark.')
      })
      .catch(() => setToast('Could not delete bookmark.'))
  }

  function deleteBookmarkById(id: string) {
    const existing = bookmarks.find((b) => b.id === id)
    if (!existing) return
    annotationHistoryRef.current.push(
      annotationRemove({ entity: 'bookmark', value: existing }),
    )
    setBookmarks((list) => list.filter((b) => b.id !== id))
    persistDeleteBookmark(id)
  }

  async function jumpToBookmark(bookmark: ReaderBookmark) {
    setChromeHidden(true)
    clearHighlightHandles()
    closeSelectionMenu()
    blurReaderSidebarFocus()
    const epub = epubApiRef.current
    epub?.setJumpViewportHidden(true)
    try {
      const location = readerBookmarkJumpLocation(bookmark)
      if (location instanceof CfiLocation) {
        await epub?.goToLocation(location)
        // Bookmarks have no painted mark — settle layout after chrome hide so
        // epubjs resize does not yank the view back to the section start.
        await waitForAnnotationLayoutSettle(true)
        epub?.resize()
        return
      }
      goChapterRef.current(bookmark.chapterIndex)
      await waitForAnnotationLayoutSettle(true)
    } catch {
      setToast('Could not jump to bookmark.')
    } finally {
      epub?.setJumpViewportHidden(false)
    }
  }

  function resolveCurrentBookmarkLocation(): Location | undefined {
    return resolveCurrentReaderBookmarkLocation({
      isEpubSurface: isEpubSurfaceRef.current,
      chapterIndex: bookmarkChapterIndexRef.current,
      epubLocation: epubApiRef.current?.getCurrentLocation(),
    })
  }

  function toggleBookmark() {
    const placeIndex = bookmarkChapterIndexRef.current
    const currentLocation = resolveCurrentBookmarkLocation()
    if (!currentLocation) {
      setToast('Could not bookmark this place yet.')
      return
    }

    const existing = findReaderBookmarksAtLocation(bookmarks, currentLocation)
    if (existing.length > 0) {
      for (const b of existing) {
        annotationHistoryRef.current.push(
          annotationRemove({ entity: 'bookmark', value: b }),
        )
      }
      const removeIds = new Set(existing.map((b) => b.id))
      setBookmarks((list) => list.filter((b) => !removeIds.has(b.id)))
      for (const b of existing) {
        persistDeleteBookmark(b.id)
      }
      setToast('Bookmark removed.')
      return
    }

    const location = currentLocation
    const createdAt = new Date().toISOString()
    const label =
      epubNavRef.current?.label?.trim() ||
      chapterTitleRef.current?.trim() ||
      'Bookmark'
    const bookmark: ReaderBookmark = {
      id: nextReaderOverlayId('bm'),
      locationRef: packReaderBookmarkLocation(location, placeIndex),
      chapterIndex: placeIndex,
      label,
      createdAt,
    }
    annotationHistoryRef.current.push(
      annotationAdd({ entity: 'bookmark', value: bookmark }),
    )
    setBookmarks((list) => [...list, bookmark])
    persistSaveBookmark(bookmark)
    setToast('Bookmark added.')
  }

  function buildTypewriterPositionData(input: {
    source: 'fake' | 'epub'
    xPct: number
    yPct: number
    cfi?: string
    offsetPx?: { x: number; y: number }
  }): string {
    if (
      input.source === 'epub' &&
      input.cfi?.trim() &&
      input.offsetPx
    ) {
      return serializeTypewriterLocation({
        v: 2,
        anchor: 'cfi-offset',
        cfi: input.cfi.trim(),
        offsetPx: input.offsetPx,
        xPct: input.xPct,
        yPct: input.yPct,
      })
    }
    return serializeTypewriterLocation({
      v: 2,
      anchor: 'fake-pct',
      xPct: input.xPct,
      yPct: input.yPct,
    })
  }

  function placeTypewriter(
    targetChapterIndex: number,
    xPct: number,
    yPct: number,
  ): string {
    if (bookFormatRef.current === 'pdf') {
      setToast('Typewriter on PDF — coming in a later release.')
      return ''
    }
    const now = new Date().toISOString()
    const positionData = buildTypewriterPositionData({
      source: 'fake',
      xPct,
      yPct,
    })
    const newNote: ReaderTypewriterNote = {
      id: nextReaderOverlayId('tw'),
      type: 'textbox',
      chapterIndex: targetChapterIndex,
      positionData,
      source: 'fake',
      colorHex: TYPEWRITER_DEFAULT_COLOR_HEX,
      fontSize: TYPEWRITER_DEFAULT_FONT_SIZE,
      content: '',
      status: 'None',
      isChecked: false,
      createdAt: now,
      updatedAt: now,
    }

    setTypewriterNotes((list) => [...list, newNote])
    annotationHistoryRef.current.push(
      annotationAdd({ entity: 'typewriter', value: newNote }),
    )
    persistSaveTypewriter(newNote)
    return newNote.id
  }

  /** Persist a finished draft as a textbox annotation (non-empty only). */
  function saveDraftAsTypewriterNote(draft: TypewriterDraft) {
    const content = normalizeTypewriterContent(draft.content)
    if (typewriterContentIsEmpty(content)) return
    const now = new Date().toISOString()
    const isEpub = isEpubSurfaceRef.current
    const positionData = buildTypewriterPositionData({
      source: isEpub ? 'epub' : 'fake',
      xPct: draft.xPct,
      yPct: draft.yPct,
      cfi: draft.cfi,
      offsetPx: draft.offsetPx,
    })
    const colorHex =
      normalizeTypewriterColorHex(draft.colorHex) ?? TYPEWRITER_DEFAULT_COLOR_HEX
    const fontSize = clampTypewriterFontSize(draft.fontSize)
    const newNote: ReaderTypewriterNote = {
      id: nextReaderOverlayId('tw'),
      type: 'textbox',
      chapterIndex: draft.chapterIndex,
      positionData,
      source: isEpub ? 'epub' : 'fake',
      ...(isEpub && draft.cfi?.trim() ? { cfi: draft.cfi.trim() } : {}),
      colorHex,
      fontSize,
      content,
      status: 'None',
      isChecked: false,
      createdAt: now,
      updatedAt: now,
    }
    setTypewriterNotes((list) => [...list, newNote])
    annotationHistoryRef.current.push(
      annotationAdd({ entity: 'typewriter', value: newNote }),
    )
    persistSaveTypewriter(newNote)
  }

  function commitTypewriterDraft(draftId: string) {
    const draft = typewriterDraftRef.current
    if (!draft || draft.id !== draftId) return
    saveDraftAsTypewriterNote(draft)
    setTypewriterDraft(null)
  }

  function cancelTypewriterDraft(draftId: string) {
    const draft = typewriterDraftRef.current
    if (!draft || draft.id !== draftId) return
    setTypewriterDraft(null)
  }

  /** ESC while editing a committed note — revert to focus baseline without saving. */
  function cancelTypewriterContentEdit(id: string) {
    const timers = typewriterContentTimersRef.current
    const pending = timers.get(id)
    if (pending != null) {
      window.clearTimeout(pending)
      timers.delete(id)
    }
    const baseline = typewriterContentBaselineRef.current.get(id)
    const note = typewriterNotesRef.current.find((n) => n.id === id)
    typewriterContentBaselineRef.current.delete(id)
    if (baseline === undefined || !note) return
    if (typewriterContentIsEmpty(baseline)) {
      deleteTypewriterById(id)
      return
    }
    setTypewriterNotes((list) =>
      list.map((n) => (n.id === id ? { ...n, content: baseline } : n)),
    )
  }

  function handleTypewriterPlace(payload: TypewriterPlacePayload) {
    if (bookFormatRef.current === 'pdf') {
      setToast('Typewriter on PDF — coming in a later release.')
      return
    }
    const prev = typewriterDraftRef.current
    if (prev) {
      saveDraftAsTypewriterNote(prev)
    }
    setTypewriterDraft({
      id: nextReaderOverlayId('twd'),
      chapterIndex: payload.chapterIndex,
      xPct: payload.xPct,
      yPct: payload.yPct,
      content: '',
      colorHex: TYPEWRITER_DEFAULT_COLOR_HEX,
      fontSize: TYPEWRITER_DEFAULT_FONT_SIZE,
      hostX: payload.hostX,
      hostY: payload.hostY,
      ...(payload.cfi?.trim()
        ? { cfi: payload.cfi.trim(), offsetPx: payload.offsetPx }
        : {}),
    })
  }

  function handleTypewriterDraftChange(content: string) {
    setTypewriterDraft((d) => {
      if (!d) return d
      // Sync ref immediately so blur-commit does not race React render.
      const next = { ...d, content: normalizeTypewriterContent(content) }
      typewriterDraftRef.current = next
      return next
    })
  }

  function handleTypewriterDraftStyleChange(patch: TypewriterBoxStyle) {
    setTypewriterDraft((d) => {
      if (!d) return d
      const next = { ...d }
      if (patch.colorHex !== undefined) {
        const color = normalizeTypewriterColorHex(patch.colorHex)
        if (color) next.colorHex = color
      }
      if (patch.fontSize !== undefined) {
        next.fontSize = clampTypewriterFontSize(patch.fontSize)
      }
      return next
    })
  }

  function persistSaveTypewriter(note: ReaderTypewriterNote) {
    if (!bookId) return
    void overlayApi
      .saveAnnotation(readerTypewriterToAnnotationInput(bookId, note))
      .catch(() => {
        setToast('Could not save typewriter note.')
      })
  }

  function persistTypewriterContent(id: string, content: string) {
    if (!bookId) return
    void overlayApi
      .updateAnnotation({ bookId, id, content })
      .then((result) => {
        if (!result.ok) setToast('Could not save typewriter note.')
      })
      .catch(() => setToast('Could not save typewriter note.'))
  }

  function persistTypewriterLocation(id: string, locationData: string) {
    if (!bookId) return
    void overlayApi
      .updateAnnotation({ bookId, id, locationData })
      .then((result) => {
        if (!result.ok) setToast('Could not move typewriter note.')
      })
      .catch(() => setToast('Could not move typewriter note.'))
  }

  /** Reposition a committed textbox; persists location_data (CFI or pct). */
  function moveTypewriter(id: string, payload: TypewriterMovePayload) {
    const existing = typewriterNotesRef.current.find((n) => n.id === id)
    if (!existing) return
    const isEpub =
      isEpubSurfaceRef.current &&
      (existing.source === 'epub' ||
        Boolean(existing.cfi) ||
        Boolean(payload.cfi?.trim()))
    const positionData = buildTypewriterPositionData({
      source: isEpub ? 'epub' : 'fake',
      xPct: payload.xPct,
      yPct: payload.yPct,
      cfi: payload.cfi ?? existing.cfi,
      offsetPx: payload.offsetPx,
    })
    if (positionData === existing.positionData) return
    const now = new Date().toISOString()
    const after: ReaderTypewriterNote = {
      ...existing,
      positionData,
      ...(isEpub && (payload.cfi ?? existing.cfi)?.trim()
        ? { cfi: (payload.cfi ?? existing.cfi)!.trim(), source: 'epub' as const }
        : {}),
      updatedAt: now,
    }
    annotationHistoryRef.current.push(
      annotationReplace(
        { entity: 'typewriter', value: existing },
        { entity: 'typewriter', value: after },
      ),
    )
    setTypewriterNotes((list) =>
      list.map((n) => (n.id === id ? after : n)),
    )
    persistTypewriterLocation(id, positionData)
  }

  async function jumpToTypewriterNote(note: ReaderTypewriterNote) {
    setChromeHidden(true)
    clearHighlightHandles()
    closeSelectionMenu()
    blurReaderSidebarFocus()
    const epub = epubApiRef.current
    epub?.setJumpViewportHidden(true)
    try {
      const loc = parseTypewriterLocation(note.positionData)
      if (note.source === 'epub' || isEpubSurfaceRef.current) {
        const cfi = epubTypewriterJumpCfi(note)
        if (cfi) {
          await epub?.goToLocation(new CfiLocation(cfi))
        } else if (loc?.anchor === 'page-rect') {
          goToPageRef.current(loc.page)
        } else {
          goChapterRef.current(note.chapterIndex)
        }
        await waitForAnnotationLayoutSettle(true)
        const focused = await epub?.focusAnnotation({
          kind: 'typewriter',
          id: note.id,
        })
        if (!focused) {
          await waitForAnnotationLayoutSettle(false)
          await epub?.focusAnnotation({
            kind: 'typewriter',
            id: note.id,
          })
        }
        return
      }
      if (loc?.anchor === 'page-rect') {
        goToPageRef.current(loc.page)
      } else {
        goChapterRef.current(note.chapterIndex)
      }
      await waitForAnnotationLayoutSettle(true)
      await focusAnnotationInDocument(document, {
        kind: 'typewriter',
        id: note.id,
      })
    } catch {
      setToast('Could not jump to typewriter note.')
    } finally {
      epub?.setJumpViewportHidden(false)
    }
  }

  function persistAnnotationFlags(
    id: string,
    patch: { isChecked?: boolean; status?: ReaderAnnotationStatus },
  ) {
    if (!bookId) return
    void overlayApi
      .updateAnnotation({ bookId, id, ...patch })
      .then((result) => {
        if (!result.ok) setToast('Could not update annotation.')
      })
      .catch(() => setToast('Could not update annotation.'))
  }

  function toggleAnnotationChecked(id: string, isChecked: boolean) {
    const now = new Date().toISOString()
    const inHighlights = highlights.some((h) => h.id === id)
    const inTypewriter = typewriterNotes.some((n) => n.id === id)
    if (!inHighlights && !inTypewriter) return

    if (inHighlights) {
      setHighlights((list) =>
        list.map((h) =>
          h.id === id ? { ...h, isChecked, updatedAt: now } : h,
        ),
      )
    }
    if (inTypewriter) {
      setTypewriterNotes((list) =>
        list.map((n) =>
          n.id === id ? { ...n, isChecked, updatedAt: now } : n,
        ),
      )
    }
    persistAnnotationFlags(id, { isChecked })
  }

  function setAnnotationStatus(id: string, status: ReaderAnnotationStatus) {
    const highlight = highlights.find((h) => h.id === id)
    const typewriter = typewriterNotes.find((n) => n.id === id)
    if (!highlight && !typewriter) return
    const now = new Date().toISOString()

    if (highlight) {
      setHighlights((list) =>
        list.map((h) =>
          h.id === id ? { ...h, status, updatedAt: now } : h,
        ),
      )
    }
    if (typewriter) {
      setTypewriterNotes((list) =>
        list.map((n) =>
          n.id === id ? { ...n, status, updatedAt: now } : n,
        ),
      )
    }
    persistAnnotationFlags(id, { status })
  }

  function cycleAnnotationStatus(id: string) {
    const nextOf = (status: ReaderAnnotationStatus): ReaderAnnotationStatus =>
      status === 'None' ? 'Review' : status === 'Review' ? 'Done' : 'None'
    const highlight = highlights.find((h) => h.id === id)
    const typewriter = typewriterNotes.find((n) => n.id === id)
    const current = highlight?.status ?? typewriter?.status
    if (!highlight && !typewriter) return
    setAnnotationStatus(id, nextOf(current ?? 'None'))
  }

  function changeAnnotationColor(id: string, colorHex: string) {
    const highlight = highlights.find((h) => h.id === id)
    if (highlight) {
      changeHighlightColor(id, colorHex)
      return
    }
    const typewriter = typewriterNotes.find((n) => n.id === id)
    if (!typewriter) return
    const normalized =
      normalizeTypewriterColorHex(colorHex) ??
      normalizeHighlightColorHex(colorHex) ??
      TYPEWRITER_DEFAULT_COLOR_HEX
    handleTypewriterStyleChange(id, { colorHex: normalized })
  }

  function persistDeleteTypewriter(id: string) {
    if (!bookId) return
    void overlayApi
      .deleteAnnotation({ bookId, id })
      .then((result) => {
        if (!result.ok) setToast('Could not delete typewriter note.')
      })
      .catch(() => setToast('Could not delete typewriter note.'))
  }

  function handleTypewriterContentChange(id: string, text: string) {
    const html = normalizeTypewriterContent(text)
    setTypewriterNotes((list) => {
      const next = list.map((m) =>
        m.id === id
          ? { ...m, content: html, updatedAt: new Date().toISOString() }
          : m,
      )
      typewriterNotesRef.current = next
      return next
    })
    const timers = typewriterContentTimersRef.current
    const existing = timers.get(id)
    if (existing != null) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      timers.delete(id)
      persistTypewriterContent(id, html)
    }, 450)
    timers.set(id, timer)
  }

  /** Box-level defaults → `style_properties` (font size / default text color). */
  function handleTypewriterStyleChange(id: string, patch: TypewriterBoxStyle) {
    const existing = typewriterNotesRef.current.find((n) => n.id === id)
    if (!existing) return
    const style: TypewriterBoxStyle = {}
    const next: ReaderTypewriterNote = { ...existing }
    if (patch.colorHex !== undefined) {
      const color = normalizeTypewriterColorHex(patch.colorHex)
      if (color) {
        next.colorHex = color
        style.colorHex = color
      }
    }
    if (patch.fontSize !== undefined) {
      const fontSize = clampTypewriterFontSize(patch.fontSize)
      next.fontSize = fontSize
      style.fontSize = fontSize
    }
    if (!style.colorHex && style.fontSize == null) return
    next.updatedAt = new Date().toISOString()
    setTypewriterNotes((list) =>
      list.map((n) => (n.id === id ? next : n)),
    )
    if (!bookId) return
    void overlayApi
      .updateAnnotation({ bookId, id, style })
      .then((result) => {
        if (!result.ok) setToast('Could not update typewriter style.')
      })
      .catch(() => setToast('Could not update typewriter style.'))
  }

  /** Immediate content replace from sidebar (no debounce). */
  function setTypewriterContent(id: string, content: string) {
    const existing = typewriterNotesRef.current.find((n) => n.id === id)
    if (!existing) return
    const next = normalizeTypewriterContent(content)
    const now = new Date().toISOString()
    const timers = typewriterContentTimersRef.current
    const pending = timers.get(id)
    if (pending != null) {
      window.clearTimeout(pending)
      timers.delete(id)
    }
    if (typewriterContentIsEmpty(next)) {
      deleteTypewriterById(id)
      return
    }
    const after = { ...existing, content: next, updatedAt: now }
    annotationHistoryRef.current.push(
      annotationReplace(
        { entity: 'typewriter', value: existing },
        { entity: 'typewriter', value: after },
      ),
    )
    setTypewriterNotes((list) =>
      list.map((n) => (n.id === id ? after : n)),
    )
    persistTypewriterContent(id, next)
  }

  function handleTypewriterContentFocus(id: string) {
    const note = typewriterNotesRef.current.find((n) => n.id === id)
    if (note) {
      typewriterContentBaselineRef.current.set(id, note.content)
    }
  }

  function flushTypewriterContent(id: string) {
    const timers = typewriterContentTimersRef.current
    const pending = timers.get(id)
    if (pending != null) {
      window.clearTimeout(pending)
      timers.delete(id)
    }
    const note = typewriterNotesRef.current.find((n) => n.id === id)
    if (!note) return
    // Empty committed boxes are discarded so the page stays clean.
    if (typewriterContentIsEmpty(note.content)) {
      typewriterContentBaselineRef.current.delete(id)
      deleteTypewriterById(id)
      return
    }
    const baseline = typewriterContentBaselineRef.current.get(id)
    if (baseline !== undefined && baseline !== note.content) {
      const before: ReaderTypewriterNote = {
        ...note,
        content: baseline,
        updatedAt: note.updatedAt,
      }
      annotationHistoryRef.current.push(
        annotationReplace(
          { entity: 'typewriter', value: before },
          { entity: 'typewriter', value: note },
        ),
      )
    }
    typewriterContentBaselineRef.current.delete(id)
    persistTypewriterContent(id, note.content)
  }

  function deleteTypewriterById(id: string) {
    const existing = typewriterNotesRef.current.find((n) => n.id === id)
    if (!existing) return
    annotationHistoryRef.current.push(
      annotationRemove({ entity: 'typewriter', value: existing }),
    )
    const timers = typewriterContentTimersRef.current
    const pending = timers.get(id)
    if (pending != null) {
      window.clearTimeout(pending)
      timers.delete(id)
    }
    typewriterContentBaselineRef.current.delete(id)
    setTypewriterNotes((list) => list.filter((m) => m.id !== id))
    persistDeleteTypewriter(id)
  }

  function placeESign(targetChapterIndex: number, xPct: number, yPct: number) {
    setESignStamps((list) => [
      ...list,
      {
        id: nextReaderOverlayId('es'),
        chapterIndex: targetChapterIndex,
        xPct,
        yPct,
        label: 'eSign',
      },
    ])
    setToast('eSign stamp placed.')
  }

  function persistFreehand(stroke: ReaderShapeAnnotation) {
    if (!bookId) return
    void overlayApi
      .saveAnnotation(readerFreehandToAnnotationInput(bookId, stroke))
      .catch(() => {
        setToast('Could not save pencil stroke.')
      })
  }

  /**
   * Commit a finished pencil stroke into session state + SQLite (T5.11e).
   * Accepts either a draft payload or raw points + chapter.
   */
  function handleFreehandStrokeComplete(
    input:
      | FreehandDraftStroke
      | { chapterIndex: number; points: FreehandPoint[] },
  ) {
    const points = input.points
    if (points.length === 0) return
    const settings = drawSettingsRef.current
    const colorHex =
      'colorHex' in input && input.colorHex
        ? input.colorHex
        : settings.colorHex
    const strokeWidth =
      'strokeWidth' in input && typeof input.strokeWidth === 'number'
        ? input.strokeWidth
        : settings.strokeWidth
    const now = new Date().toISOString()
    const stroke: ReaderShapeAnnotation = {
      id: nextReaderOverlayId('ink'),
      type: 'freehand',
      chapterIndex: input.chapterIndex,
      locationData: serializeFreehandPoints(points),
      points,
      colorHex,
      strokeWidth,
      status: 'None',
      isChecked: false,
      createdAt: now,
      updatedAt: now,
    }
    setFreehandStrokes((list) => [...list, stroke])
    persistFreehand(stroke)
  }

  function leaveAnnotateToolViaEscape() {
    const draft = typewriterDraftRef.current
    if (draft) {
      cancelTypewriterDraft(draft.id)
    }
    setActiveTool('hand')
    clearHighlightHandles()
  }

  return {
    activeTool,
    activeToolRef,
    drawSettings,
    setDrawSettings,
    selectionMenu,
    setSelectionMenu,
    pendingSelection,
    highlightEdit,
    handleRect,
    handleFlash,
    noteModalOpen,
    noteEditTarget,
    highlights,
    setHighlights,
    bookmarks,
    setBookmarks,
    typewriterNotes,
    setTypewriterNotes,
    typewriterNotesRef,
    typewriterDraft,
    typewriterDraftRef,
    typewriterContentTimersRef,
    eSignStamps,
    freehandStrokes,
    setFreehandStrokes,
    annotationShortcutsRef,
    highlightEditRef,
    selectTool,
    onCompanionTool,
    openSelectionMenu,
    closeSelectionMenu,
    dismissHighlightEditPanel,
    clearHighlightHandles,
    handleSelectionDismiss,
    handleTextSelected,
    handleHighlightMarkClick,
    applyHighlight,
    changeHighlightColor,
    deleteHighlightById,
    jumpToHighlight,
    copyHighlightText,
    openHighlightNoteEditor,
    autosaveHighlightNote,
    closeNoteModal,
    removeHighlightForSelection,
    stubSelectionAction,
    openNoteFromSelection,
    copySelection,
    deleteBookmarkById,
    jumpToBookmark,
    resolveCurrentBookmarkLocation,
    toggleBookmark,
    placeTypewriter,
    saveDraftAsTypewriterNote,
    commitTypewriterDraft,
    cancelTypewriterDraft,
    handleTypewriterPlace,
    handleTypewriterDraftChange,
    handleTypewriterDraftStyleChange,
    handleTypewriterContentChange,
    handleTypewriterStyleChange,
    setTypewriterContent,
    handleTypewriterContentFocus,
    cancelTypewriterContentEdit,
    flushTypewriterContent,
    moveTypewriter,
    jumpToTypewriterNote,
    deleteTypewriterById,
    toggleAnnotationChecked,
    setAnnotationStatus,
    cycleAnnotationStatus,
    changeAnnotationColor,
    placeESign,
    handleFreehandStrokeComplete,
    leaveAnnotateToolViaEscape,
    dismissPendingSelection,
  }
}
