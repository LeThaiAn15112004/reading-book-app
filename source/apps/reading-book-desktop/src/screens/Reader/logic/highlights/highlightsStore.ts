import { create } from 'zustand'
import type { MutableRefObject } from 'react'
import { CfiLocation } from '@reading-book/book-reader-sdk'
import {
  applyHighlightHistoryStep,
  createHighlightHistory,
  highlightAdd,
  highlightDtoToReaderHighlight,
  highlightRemove,
  highlightReplace,
  packHighlightLocator,
  packSelectionTextRef,
  DEFAULT_HIGHLIGHT_COLOR,
  type HighlightHistory,
  type HighlightStyleKind,
  type ReaderHighlight,
} from '@reading-book/book-reader-sdk'
import { overlayApi } from '../../../../bridge'
import type {
  EpubHighlightClickInfo,
  EpubNavState,
  EpubRendererApi,
  EpubSelectionInfo,
  ViewportRectLike,
} from '../../../../reader/renderers/epub'

export type ActiveHighlight = { highlight: ReaderHighlight; rect: ViewportRectLike }

/** The right-click context menu for a fresh (not-yet-highlighted) selection, if open. */
export type SelectionMenuState = {
  selection: EpubSelectionInfo
  point: { x: number; y: number }
}

/** The markup tools that instant-apply on drag-to-select (see `handleTextSelected` below). */
export type AnnotationMarkTool = Extract<HighlightStyleKind, 'highlight' | 'underline' | 'strikethrough'>

/**
 * Inputs `useReaderHighlights` threads in from `ReaderScreen`/React props — the imperative
 * epub.js handle, the route's book id, and a few values/callbacks owned by sibling hooks. None of
 * this is UI state a component ever selects reactively (nothing renders off "what is `bookId`
 * right now" through this store), so keeping it as its own slice rather than folding it into the
 * `highlights`/`selectionMenu`/etc. state above keeps that distinction clear. It still lives in
 * the same zustand store rather than a plain module-level object so every action below has one
 * uniform way (`get()`) to reach both its own state and this context.
 */
type HighlightsContext = {
  epubApiRef: MutableRefObject<EpubRendererApi | null> | null
  bookId: string | undefined
  isEpubSurface: boolean
  epubNav: EpubNavState | null
  activeAnnotationTool: AnnotationMarkTool | null
  onToast: (message: string | null) => void
  onChromeHidden: (hidden: boolean) => void
}

const emptyContext: HighlightsContext = {
  epubApiRef: null,
  bookId: undefined,
  isEpubSurface: false,
  epubNav: null,
  activeAnnotationTool: null,
  onToast: () => {},
  onChromeHidden: () => {},
}

type HighlightsStoreState = HighlightsContext & {
  highlights: ReaderHighlight[]
  /** Latest live text-selection info, tracked continuously — internal bookkeeping only, not
   *  read directly by any component. `openSelectionMenuAtPoint` snapshots it into
   *  `selectionMenu` when a right-click lands inside the selection. */
  pendingSelection: EpubSelectionInfo | null
  /** The right-click context menu for a fresh selection — this is what UI renders. */
  selectionMenu: SelectionMenuState | null
  activeHighlight: ActiveHighlight | null
  /** The highlight/underline a plain click last landed on, in the book — drives the `.rb-hl-focused`
   *  outline on its mark (see `EpubjsHandle.setFocusedHighlight`) and the delete-key shortcut.
   *  Independent of `activeHighlight`: this is "which one am I looking at," that's "which one has
   *  its floating menu open" — right-clicking a mark sets both, a plain click only sets this one. */
  focusedHighlightId: string | null
  /** Default color for the next highlight/underline created from the context menu — updated on
   *  every create/color-change. Session-scoped only (not persisted across app restarts). */
  lastUsedColorHex: string
  /** Flips true once the rendition + its imperative API exist, and stays true — unlike `epubNav`
   *  (a fresh object on every page turn/relocation), so the "paint every highlight" effect below
   *  doesn't re-run on every navigation. Reset to `false` whenever `bookId` changes. */
  renditionReady: boolean
  /** Session-only undo/redo stack — never persisted, a fresh one per book (`resetForNewBook`
   *  clears it). Not itself reactive UI state (nothing renders "the history"), so mutating it
   *  never needs to go through `set()`. */
  history: HighlightHistory

  setContext: (patch: Partial<HighlightsContext>) => void
  setRenditionReady: (ready: boolean) => void
  /** Clears all per-book UI state (list, pending selection, menus, focus) and the undo/redo
   *  stack — called whenever the open book changes. `lastUsedColorHex` is intentionally NOT
   *  reset here: it's an app-session-scoped value that should survive switching books. */
  resetForNewBook: () => void
  loadHighlights: () => Promise<void>
  /** (Re)paints every stored highlight via the epub.js imperative API — idempotent, safe to call
   *  repeatedly (e.g. once per `highlights`/`renditionReady` change). */
  applyAllHighlights: () => void
  /** epub.js's 'selected' event handler — routes a fresh drag-to-select into either an
   *  instant-apply mark (Highlight/Underline/Strikethrough tool armed) or just tracked selection
   *  state for the right-click menu to pick up later. */
  handleTextSelected: (info: EpubSelectionInfo | null) => void
  /** Keeps `focusedHighlightId` and the mark's `.rb-hl-focused` outline (painted by
   *  epub.js/marks-pane, outside React's tree) in lockstep. */
  focusHighlight: (id: string | null) => void
  /** Plain click on a highlight/underline mark — focuses it but does NOT open its floating menu.
   *  A `textbox` note is the exception — its 📝 icon reopens `NoteTextboxPopup` on a plain click. */
  focusHighlightFromClick: (info: EpubHighlightClickInfo) => void
  /** Right-click on a highlight/underline mark — opens its floating menu and focuses it. */
  openHighlightContextMenu: (info: EpubHighlightClickInfo) => void
  closeSelectionMenu: () => void
  /** Reads the *current* live selection and opens the menu there — no-op if the selection was
   *  cleared a frame before the right-click landed. */
  openSelectionMenuAtPoint: (x: number, y: number) => void
  closeEditPopup: () => void
  /** Single choke point for "click on blank page surface" (`EpubRenderer`'s `onSurfaceClick`/
   *  `onCenterTap`) — dismisses every floating annotation UI for Highlight, Underline and
   *  Strikethrough alike: the right-click selection menu, the edit popup (which also drops the
   *  `.rb-hl-focused` outline), and any native text selection epub.js's iframe may still be
   *  holding from the gesture that preceded the click. */
  dismissAnnotationUi: () => void
  createHighlight: (colorHex: string, styleKind: HighlightStyleKind) => void
  updateHighlightColor: (id: string, colorHex: string) => void
  /**
   * epub.js/marks-pane keys a mark by the pair (cfiRange, type) — changing either one means the
   * OLD mark is not simply "restyled" in place, it must be explicitly removed by its OLD key and
   * a fresh one added at the NEW key.
   */
  updateHighlightStyleKind: (id: string, styleKind: HighlightStyleKind) => void
  updateHighlightNote: (id: string, note: string) => void
  updateHighlightTags: (id: string, tags: string[]) => void
  deleteHighlight: (id: string) => void
  /** Jump the reader to a highlight's location (used by the sidebar highlights list), then
   *  pulse the mark so it's obvious which highlight the reader landed on. */
  jumpToHighlight: (highlight: ReaderHighlight) => Promise<void>
  undo: () => void
  redo: () => void
  deleteFocused: () => void
  hasFocusedHighlight: () => boolean
}

/**
 * Highlights/underlines/strikethroughs for the open EPUB — select text, style it, edit or delete
 * it. Owns both the UI state (the list, the floating toolbar's pending selection, the edit popup)
 * and the side effects around it: loading from `overlayApi`, the optimistic-update/persist flow
 * for every CRUD action, undo/redo, and driving epub.js's own `rendition.annotations` API (via
 * the `EpubRendererApi` handle threaded in through `setContext`). `useReaderHighlights` is now a
 * thin React-lifecycle adapter over this store: it wires prop changes and epub.js's imperative
 * event subscriptions into these actions, nothing more — no local `useState`/`useRef` of its own.
 * A single Reader route is mounted at a time (`/reader/:bookId` in App.tsx), so one shared store
 * is safe, mirroring `resetForNewBook`'s per-book-open reset.
 */
export const useHighlightsStore = create<HighlightsStoreState>()((set, get) => ({
  ...emptyContext,
  highlights: [],
  pendingSelection: null,
  selectionMenu: null,
  activeHighlight: null,
  focusedHighlightId: null,
  lastUsedColorHex: DEFAULT_HIGHLIGHT_COLOR,
  renditionReady: false,
  history: createHighlightHistory(),

  setContext: (patch) => set(patch),
  setRenditionReady: (ready) => set({ renditionReady: ready }),

  resetForNewBook: () => {
    get().history.clear()
    set({
      highlights: [],
      pendingSelection: null,
      selectionMenu: null,
      activeHighlight: null,
      focusedHighlightId: null,
      renditionReady: false,
    })
  },

  loadHighlights: async () => {
    const { bookId, onToast } = get()
    if (!bookId) return
    try {
      const rows = await overlayApi.listHighlights(bookId)
      // The open book may have changed again while this request was in flight — a stale
      // response must never clobber the newer book's (already-reset) highlight list.
      if (get().bookId !== bookId) return
      set({
        highlights: rows
          .map(highlightDtoToReaderHighlight)
          .filter((h): h is ReaderHighlight => h != null),
      })
    } catch {
      if (get().bookId === bookId) onToast('Could not load highlights.')
    }
  },

  applyAllHighlights: () => {
    const { epubApiRef, highlights } = get()
    const api = epubApiRef?.current
    if (!api) return
    for (const h of highlights) {
      api.applyHighlight({ id: h.id, cfiRange: h.cfiRange, styleKind: h.styleKind, colorHex: h.colorHex })
    }
  },

  handleTextSelected: (info) => {
    set({ pendingSelection: info, selectionMenu: null })
    if (!info) return
    set({ activeHighlight: null })
    get().focusHighlight(null)
    // Highlight/Underline/Strikethrough tool armed: the drag that just produced this selection
    // *is* the mark-it gesture — apply immediately (last-used color) instead of waiting for a
    // right-click.
    const tool = get().activeAnnotationTool
    if (!tool) return
    get().createHighlight(get().lastUsedColorHex, tool)
    const toastMessage =
      tool === 'highlight'
        ? 'Highlighted — Ctrl+Z to undo'
        : tool === 'underline'
          ? 'Underlined — Ctrl+Z to undo'
          : 'Struck through — Ctrl+Z to undo'
    get().onToast(toastMessage)
  },

  focusHighlight: (id) => {
    set({ focusedHighlightId: id })
    get().epubApiRef?.current?.setFocusedHighlight(id)
  },

  focusHighlightFromClick: (info) => {
    const found = get().highlights.find((h) => h.id === info.id)
    if (!found) return
    get().focusHighlight(info.id)
    set({ pendingSelection: null })
    if (found.styleKind === 'textbox') {
      set({ activeHighlight: { highlight: found, rect: info.rect } })
    }
  },

  openHighlightContextMenu: (info) => {
    const found = get().highlights.find((h) => h.id === info.id)
    if (!found) return
    get().focusHighlight(info.id)
    set({ activeHighlight: { highlight: found, rect: info.rect }, pendingSelection: null })
  },

  closeSelectionMenu: () => set({ selectionMenu: null }),

  openSelectionMenuAtPoint: (x, y) => {
    const selection = get().pendingSelection
    if (!selection) return
    set({ selectionMenu: { selection, point: { x, y } } })
  },

  closeEditPopup: () => {
    set({ activeHighlight: null })
    get().focusHighlight(null)
  },

  dismissAnnotationUi: () => {
    get().closeSelectionMenu()
    get().closeEditPopup()
    get().epubApiRef?.current?.clearSelection()
  },

  createHighlight: (colorHex, styleKind) => {
    const { bookId, pendingSelection, epubNav, epubApiRef, onToast } = get()
    if (!bookId || !pendingSelection) return
    const chapterIndex = epubNav?.spineIndex ?? 0
    const locatorRef = packHighlightLocator(new CfiLocation(pendingSelection.cfiRange), chapterIndex)

    // The store mints the id so the optimistic row is the final row.
    const highlight: ReaderHighlight = {
      id: crypto.randomUUID(),
      locatorRef,
      cfiRange: pendingSelection.cfiRange,
      chapterIndex,
      styleKind,
      colorHex,
      tags: [],
      selectionText: { highlight: pendingSelection.text },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    get().history.push(highlightAdd(highlight))
    set((s) => ({
      highlights: [...s.highlights, highlight],
      pendingSelection: null,
      selectionMenu: null,
    }))
    // `textbox` has no color of its own — `colorHex` just rides along as a harmless placeholder
    // (never rendered, see `epubAnnotationTypeFor` in openEpubjs.ts), so it shouldn't pollute the
    // "last used highlight color" the color picker defaults to next.
    if (styleKind !== 'textbox') set({ lastUsedColorHex: colorHex })
    epubApiRef?.current?.clearSelection()
    // Creation is now a one-shot context-menu action with an implicit default/last-used color —
    // no auto-opened edit popup for highlight/underline/strikethrough; adjust color/note/tags
    // afterward via left-click-to-edit. It does get the `.rb-hl-focused` outline immediately
    // though, as feedback that it landed. A `textbox` note is the opposite: its whole point is
    // the note text, so it opens `NoteTextboxPopup` (via `activeHighlight`) right away instead.
    get().focusHighlight(highlight.id)
    if (styleKind === 'textbox') {
      set({ activeHighlight: { highlight, rect: pendingSelection.rect } })
    }

    void overlayApi
      .saveHighlight({
        bookId,
        id: highlight.id,
        locatorRef: highlight.locatorRef,
        styleKind: highlight.styleKind,
        colorHex: highlight.colorHex,
        tags: highlight.tags,
        selectionTextRef: packSelectionTextRef(highlight.selectionText),
        createdAt: highlight.createdAt,
      })
      .then((saved) => {
        if (saved) return
        removeHighlightRow(set, highlight.id)
        onToast('Could not save highlight.')
      })
      .catch(() => {
        removeHighlightRow(set, highlight.id)
        onToast('Could not save highlight.')
      })
  },

  updateHighlightColor: (id, colorHex) => {
    patchHighlight(get, set, id, { colorHex })
    set({ lastUsedColorHex: colorHex })
  },

  updateHighlightStyleKind: (id, styleKind) => {
    const current = get().highlights.find((h) => h.id === id)
    if (!current || current.styleKind === styleKind) return
    // Remove the OLD mark by its OLD (cfiRange, styleKind) key first.
    get().epubApiRef?.current?.removeHighlight(current.cfiRange, current.styleKind)
    const next = patchHighlight(get, set, id, { styleKind })
    if (!next) return
    // Add the NEW mark — same cfiRange, new styleKind/type.
    get().epubApiRef?.current?.applyHighlight({
      id: next.id,
      cfiRange: next.cfiRange,
      styleKind: next.styleKind,
      colorHex: next.colorHex,
    })
  },

  updateHighlightNote: (id, note) => {
    patchHighlight(get, set, id, { note: note.trim() || undefined })
  },

  updateHighlightTags: (id, tags) => {
    patchHighlight(get, set, id, { tags })
  },

  deleteHighlight: (id) => {
    const { bookId, epubApiRef, onToast } = get()
    if (!bookId) return
    const current = get().highlights.find((h) => h.id === id)
    if (!current) return

    get().history.push(highlightRemove(current))
    removeHighlightRow(set, id)
    epubApiRef?.current?.removeHighlight(current.cfiRange, current.styleKind)

    const restore = () => {
      set((s) => ({ highlights: [...s.highlights, current] }))
      epubApiRef?.current?.applyHighlight({
        id: current.id,
        cfiRange: current.cfiRange,
        styleKind: current.styleKind,
        colorHex: current.colorHex,
      })
      onToast('Could not delete highlight.')
    }

    void overlayApi
      .deleteHighlight({ bookId, id })
      .then((result) => {
        if (!result.ok) restore()
      })
      .catch(restore)
  },

  jumpToHighlight: async (highlight) => {
    const { isEpubSurface, epubApiRef, onChromeHidden, onToast } = get()
    if (!isEpubSurface) return
    try {
      await epubApiRef?.current?.goToLocation(new CfiLocation(highlight.cfiRange))
      onChromeHidden(true)
      // Wait a couple of frames for the new section's layout (and its marks-pane rects, which
      // read live getBoundingClientRect()s) to settle before looking up the mark to flash.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          epubApiRef?.current?.flashHighlight?.(highlight.cfiRange, highlight.styleKind)
        })
      })
    } catch {
      onToast("Could not find this highlight's location in the book.")
    }
  },

  undo: () => {
    const action = get().history.undo()
    if (!action) return
    applyHighlightHistoryStep(action, 'undo', historyHandlers(get, set))
  },

  redo: () => {
    const action = get().history.redo()
    if (!action) return
    applyHighlightHistoryStep(action, 'redo', historyHandlers(get, set))
  },

  deleteFocused: () => {
    const id = get().focusedHighlightId
    if (!id) return
    get().deleteHighlight(id)
  },

  hasFocusedHighlight: () => get().focusedHighlightId != null,
}))

type Get = () => HighlightsStoreState
type Set = (
  partial:
    | Partial<HighlightsStoreState>
    | ((state: HighlightsStoreState) => Partial<HighlightsStoreState>),
) => void

/** Filters `id` out of `highlights` and drops any `activeHighlight`/`focusedHighlightId`
 *  reference to it — every removal path (a real delete, a failed-save rollback, an undo of an
 *  'add') must clear these together, or the edit popup / `.rb-hl-focused` outline can end up
 *  pointing at a row that no longer exists. */
function removeHighlightRow(set: Set, id: string): void {
  set((s) => ({
    highlights: s.highlights.filter((h) => h.id !== id),
    activeHighlight: s.activeHighlight?.highlight.id === id ? null : s.activeHighlight,
    focusedHighlightId: s.focusedHighlightId === id ? null : s.focusedHighlightId,
  }))
}

/** Shared by every "change one field and re-persist" action (color, style kind, note, tags) —
 *  patches the row in state, records it for undo/redo, persists to SQLite, and hands back the
 *  patched row so callers that must also repaint the epub.js mark (style-kind changes) have the
 *  fresh `cfiRange`/`styleKind`/`colorHex` to hand it right away instead of waiting on the "apply
 *  every highlight" effect to notice the state change on its own schedule. */
function patchHighlight(
  get: Get,
  set: Set,
  id: string,
  patch: Partial<ReaderHighlight>,
): ReaderHighlight | undefined {
  const current = get().highlights.find((h) => h.id === id)
  if (!current) return undefined
  const next: ReaderHighlight = { ...current, ...patch, updatedAt: new Date().toISOString() }
  get().history.push(highlightReplace(current, next))
  set((s) => ({
    highlights: s.highlights.map((h) => (h.id === id ? next : h)),
    activeHighlight:
      s.activeHighlight?.highlight.id === id
        ? { ...s.activeHighlight, highlight: next }
        : s.activeHighlight,
  }))
  persistHighlight(get, next)
  return next
}

function persistHighlight(get: Get, next: ReaderHighlight): void {
  const { bookId, onToast } = get()
  if (!bookId) return
  void overlayApi
    .saveHighlight({
      bookId,
      id: next.id,
      locatorRef: next.locatorRef,
      styleKind: next.styleKind,
      colorHex: next.colorHex,
      note: next.note,
      tags: next.tags,
      selectionTextRef: packSelectionTextRef(next.selectionText),
      createdAt: next.createdAt,
    })
    .then((saved) => {
      if (!saved) onToast('Could not update highlight.')
    })
    .catch(() => onToast('Could not update highlight.'))
}

/**
 * Re-apply `h` as the current row for undo/redo — inserts if it doesn't currently exist (covers
 * an 'add' redo or a 'remove' undo) or overwrites in place if it does (covers a 'replace'
 * snapshot), fixing up the epub.js mark either way. Bypasses `patchHighlight`'s own history push
 * (undo/redo must not record itself as a new action) but still re-persists — the DB must reflect
 * the reverted state too, or reloading the book would silently un-revert it.
 */
function historyHandlers(get: Get, set: Set) {
  return {
    restore: (h: ReaderHighlight) => {
      const onScreen = get().highlights.find((x) => x.id === h.id)
      const api = get().epubApiRef?.current
      if (onScreen) {
        if (onScreen.cfiRange !== h.cfiRange || onScreen.styleKind !== h.styleKind) {
          api?.removeHighlight(onScreen.cfiRange, onScreen.styleKind)
        }
        set((s) => ({
          highlights: s.highlights.map((x) => (x.id === h.id ? h : x)),
          activeHighlight:
            s.activeHighlight?.highlight.id === h.id ? { ...s.activeHighlight, highlight: h } : s.activeHighlight,
        }))
      } else {
        set((s) => ({ highlights: [...s.highlights, h] }))
      }
      api?.applyHighlight({ id: h.id, cfiRange: h.cfiRange, styleKind: h.styleKind, colorHex: h.colorHex })
      persistHighlight(get, h)
    },
    remove: (id: string) => {
      const current = get().highlights.find((h) => h.id === id)
      removeHighlightRow(set, id)
      if (current) get().epubApiRef?.current?.removeHighlight(current.cfiRange, current.styleKind)
      const { bookId, onToast } = get()
      if (!bookId) return
      void overlayApi.deleteHighlight({ bookId, id }).catch(() => onToast('Could not undo.'))
    },
  }
}
