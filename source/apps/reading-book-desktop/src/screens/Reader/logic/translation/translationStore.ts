import { create } from 'zustand'
import {
  findTranslationLanguage,
  normalizeTranslationLanguage,
  resolveTranslationRoute,
  type TtsEngine,
} from '@reading-book/book-reader-sdk'
import { translationApi, type TranslationErrorCode, type TranslationProgress } from '../../../../bridge'
import type { EpubSelectionInfo } from '../../../../reader/renderers/epub'
import { createWebSpeechEngine } from '../../../../reader/tts/webSpeechEngine'
import { useReadAloudStore } from '../readAloud/readAloudStore'
import { clampPanelSize, type PanelPosition, type PanelSize } from '../floatingPanel/panelGeometry'

export type TranslationStatus = 'idle' | 'loading-model' | 'translating' | 'done' | 'error'

export type TranslationLoadProgressState = {
  /** 0–100 over all model files, or null until the engine reports a total. */
  percent: number | null
  loadedBytes: number | null
  totalBytes: number | null
  /** True once bytes actually come over the network (vs. a load from the local cache). */
  downloading: boolean
}

export type TranslationPopoverState = {
  sourceText: string
}

const PREFS_STORAGE_KEY = 'reading-book.translation.prefs'
const PANEL_POSITION_STORAGE_KEY = 'reading-book.translationPanelPosition'
const PANEL_SIZE_STORAGE_KEY = 'reading-book.translationPanelSize'

/** Remembers where/how big the user last dragged/resized the panel — same convention as the
 *  search/word-count panels' `panelPosition`/`panelSize`. */
function readStoredPanelPosition(): PanelPosition | null {
  try {
    const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelPosition> | null
    if (typeof parsed?.top === 'number' && typeof parsed.left === 'number') {
      return { top: parsed.top, left: parsed.left }
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelPosition(position: PanelPosition | null): void {
  try {
    if (position) localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position))
    else localStorage.removeItem(PANEL_POSITION_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredPanelSize(): PanelSize | null {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelSize> | null
    if (typeof parsed?.width === 'number' && typeof parsed.height === 'number') {
      return clampPanelSize({ width: parsed.width, height: parsed.height })
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelSize(size: PanelSize | null): void {
  try {
    if (size) localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(size))
    else localStorage.removeItem(PANEL_SIZE_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}
const MAX_RECENT = 4
const FALLBACK_SOURCE = 'en'

type StoredPrefs = { targetLang: string; recentTargets: string[] }

/** The UI language when it isn't English (most books are), otherwise Vietnamese. */
function defaultTarget(): string {
  const ui = normalizeTranslationLanguage(navigator.language)
  return ui && ui !== 'en' ? ui : 'vi'
}

function readStoredPrefs(): StoredPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as Partial<StoredPrefs> | null
    const targetLang =
      typeof parsed?.targetLang === 'string' && findTranslationLanguage(parsed.targetLang)
        ? parsed.targetLang
        : defaultTarget()
    const recentTargets = Array.isArray(parsed?.recentTargets)
      ? parsed.recentTargets.filter((code): code is string => typeof code === 'string' && !!findTranslationLanguage(code))
      : []
    return { targetLang, recentTargets: recentTargets.slice(0, MAX_RECENT) }
  } catch {
    return { targetLang: defaultTarget(), recentTargets: [] }
  }
}

function writeStoredPrefs(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore quota / private mode */
  }
}

/** A target that differs from `source` — the saved one when possible. */
function targetFor(source: string, preferred: string): string {
  if (preferred !== source) return preferred
  return source === 'en' ? 'vi' : 'en'
}

let ttsEngine: TtsEngine | null = null
function tts(): TtsEngine {
  ttsEngine ??= createWebSpeechEngine()
  return ttsEngine
}

type TranslationContext = {
  setToast: (message: string | null) => void
}

type TranslationState = TranslationContext & {
  /** Toolbar "Translate" mode: every finished selection opens the popover. */
  mode: boolean
  popover: TranslationPopoverState | null
  sourceLang: string
  /** The user picked the source by hand — stop overwriting it from each selection's `lang`. */
  sourceLocked: boolean
  targetLang: string
  recentTargets: string[]
  status: TranslationStatus
  progress: TranslationLoadProgressState | null
  /** The route needs the large multilingual model (worth warning about before a big download). */
  multilingual: boolean
  result: string | null
  error: { code: TranslationErrorCode; message: string } | null
  /** Id of the in-flight request; progress/results for any other id are stale and dropped. */
  requestId: string | null
  speaking: boolean
  /** Where the user last dragged the panel to — null = default (centered). Not a per-book value
   *  (a layout preference), so `resetForNewBook` leaves it. */
  panelPosition: PanelPosition | null
  /** True while the header drag handle is being dragged — drives the grabbing cursor. */
  panelDragging: boolean
  /** User-resized panel size — null = default CSS size. Not per-book, like `panelPosition`. */
  panelSize: PanelSize | null
  /** True while a resize handle is being dragged — drives the resize cursor. */
  panelResizing: boolean

  setContext: (context: TranslationContext) => void
  setMode: (on: boolean) => void
  /** Opens the popover for a selection regardless of mode (context menu "Translate"). */
  openForSelection: (info: EpubSelectionInfo) => void
  close: () => void
  setSourceLang: (code: string) => void
  setTargetLang: (code: string) => void
  swapLanguages: () => void
  retry: () => void
  copyResult: () => void
  toggleSpeak: () => void
  handleProgress: (progress: TranslationProgress) => void
  /** Per-book reset: closes the popover and forgets a hand-picked source language. */
  resetForNewBook: () => void
  setPanelPosition: (position: PanelPosition | null) => void
  setPanelDragging: (dragging: boolean) => void
  setPanelSize: (size: PanelSize | null) => void
  setPanelResizing: (resizing: boolean) => void
}

const stored = readStoredPrefs()

/**
 * Selection → translation popover. Owns the popover's state and the request lifecycle (one
 * request at a time; switching language or selection cancels the previous one in the worker).
 * `useReaderTranslation` is the thin React adapter: context sync, the IPC progress subscription,
 * and cleanup on book change / unmount.
 */
export const useTranslationStore = create<TranslationState>()((set, get) => {
  const stopSpeaking = () => {
    if (!get().speaking) return
    tts().cancel()
    set({ speaking: false })
  }

  const cancelInFlight = () => {
    const { requestId } = get()
    if (requestId) void translationApi.cancel(requestId).catch(() => {})
    set({ requestId: null })
  }

  const run = async () => {
    const { popover, sourceLang, targetLang } = get()
    if (!popover) return
    cancelInFlight()
    stopSpeaking()

    const route = resolveTranslationRoute(sourceLang, targetLang)
    const requestId = crypto.randomUUID()
    set({
      requestId,
      status: 'translating',
      progress: null,
      result: null,
      error: null,
      multilingual: route?.multilingual ?? false,
    })

    const result = await translationApi
      .translate({ requestId, text: popover.sourceText, sourceLang, targetLang })
      .catch((err: unknown) => ({
        state: 'error' as const,
        code: 'WORKER_FAILED' as const,
        message: err instanceof Error ? err.message : String(err),
      }))
    // Superseded (new selection, language change, close) while this one was running.
    if (get().requestId !== requestId) return
    if (result.state === 'ok') {
      set({ requestId: null, status: 'done', result: result.text, progress: null })
    } else {
      set({ requestId: null, status: 'error', error: { code: result.code, message: result.message }, progress: null })
    }
  }

  const open = (info: EpubSelectionInfo) => {
    const text = info.text.trim()
    if (!text) return
    const detected = normalizeTranslationLanguage(info.lang) ?? FALLBACK_SOURCE
    const sourceLang = get().sourceLocked ? get().sourceLang : detected
    set({
      popover: { sourceText: text },
      sourceLang,
      targetLang: targetFor(sourceLang, readStoredPrefs().targetLang),
    })
    void run()
  }

  return {
    setToast: () => {},
    mode: false,
    popover: null,
    sourceLang: FALLBACK_SOURCE,
    sourceLocked: false,
    targetLang: stored.targetLang,
    recentTargets: stored.recentTargets,
    status: 'idle',
    progress: null,
    multilingual: false,
    result: null,
    error: null,
    requestId: null,
    speaking: false,
    panelPosition: readStoredPanelPosition(),
    panelDragging: false,
    panelSize: readStoredPanelSize(),
    panelResizing: false,

    setContext: (context) => set(context),

    setMode: (on) => {
      set({ mode: on })
      if (!on) get().close()
    },

    openForSelection: open,

    close: () => {
      cancelInFlight()
      stopSpeaking()
      set({ popover: null, status: 'idle', progress: null, result: null, error: null })
    },

    setSourceLang: (code) => {
      if (!findTranslationLanguage(code) || code === get().sourceLang) return
      set({ sourceLang: code, sourceLocked: true })
      void run()
    },

    setTargetLang: (code) => {
      if (!findTranslationLanguage(code) || code === get().targetLang) return
      const recentTargets = [code, ...get().recentTargets.filter((c) => c !== code)].slice(0, MAX_RECENT)
      set({ targetLang: code, recentTargets })
      writeStoredPrefs({ targetLang: code, recentTargets })
      void run()
    },

    swapLanguages: () => {
      const { sourceLang, targetLang, result } = get()
      set({ sourceLang: targetLang, targetLang: sourceLang, sourceLocked: true })
      // Swapping after a result translates the result back — the useful reading of "swap".
      const popover = get().popover
      if (popover && result) set({ popover: { ...popover, sourceText: result } })
      void run()
    },

    retry: () => {
      void run()
    },

    copyResult: () => {
      const { result, setToast } = get()
      if (!result) return
      navigator.clipboard.writeText(result).then(
        () => setToast('Translation copied.'),
        () => setToast('Could not copy.'),
      )
    },

    toggleSpeak: () => {
      const { result, speaking, targetLang, setToast } = get()
      if (speaking) {
        stopSpeaking()
        return
      }
      if (!result) return
      const engine = tts()
      if (!engine.isSupported()) {
        setToast('Read aloud is not available on this system.')
        return
      }
      // One voice at a time: the book's read-aloud and this share the OS speech engine.
      const readAloud = useReadAloudStore.getState()
      if (readAloud.status !== 'idle') readAloud.stop()
      set({ speaking: true })
      engine.speak(
        { text: result, lang: targetLang, rate: 1, volume: 1 },
        {
          onEnd: () => set({ speaking: false }),
          onError: () => {
            set({ speaking: false })
            setToast('Could not read the translation aloud.')
          },
        },
      )
    },

    handleProgress: (progress) => {
      if (progress.requestId !== get().requestId) return
      if (progress.status === 'ready') {
        set({ status: 'translating', progress: null })
        return
      }
      const previous = get().progress
      const next: TranslationLoadProgressState = {
        percent: previous?.percent ?? null,
        loadedBytes: previous?.loadedBytes ?? null,
        totalBytes: previous?.totalBytes ?? null,
        downloading: (previous?.downloading ?? false) || progress.status === 'download',
      }
      if (progress.status === 'total') {
        next.percent = progress.progress ?? null
        next.loadedBytes = progress.loadedBytes ?? null
        next.totalBytes = progress.totalBytes ?? null
      }
      set({ status: 'loading-model', progress: next })
    },

    resetForNewBook: () => {
      get().close()
      set({ sourceLocked: false })
    },

    setPanelPosition: (position) => {
      set({ panelPosition: position })
      writeStoredPanelPosition(position)
    },

    setPanelDragging: (dragging) => set({ panelDragging: dragging }),

    setPanelSize: (size) => {
      set({ panelSize: size })
      writeStoredPanelSize(size)
    },

    setPanelResizing: (resizing) => set({ panelResizing: resizing }),
  }
})
