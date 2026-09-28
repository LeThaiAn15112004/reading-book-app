import { useCallback, useLayoutEffect, useRef } from 'react'
import { findTranslationLanguage } from '@reading-book/book-reader-sdk'
import { useDismissOnOutsideOrEscape, type DismissReason } from '../../logic/highlights/useDismissOnOutsideOrEscape'
import { useDraggableTranslationPanel } from '../../logic/translation/useDraggableTranslationPanel'
import { useResizableTranslationPanel } from '../../logic/translation/useResizableTranslationPanel'
import { clampPanelPosition } from '../../logic/floatingPanel/panelGeometry'
import {
  useTranslationStore,
  type TranslationLoadProgressState,
} from '../../logic/translation/translationStore'
import type { TranslationErrorCode } from '../../../../bridge'
import { LanguageCombobox } from './LanguageCombobox'

const iconBtn =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-bg-mid/60 hover:text-lib-text-strong focus-visible:bg-lib-bg-mid/60 focus-visible:outline-none disabled:cursor-default disabled:opacity-40'

const actionBtn =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-lib-border bg-lib-bg-mid/40 px-3 text-[12px] font-semibold text-lib-text transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-text-strong focus-visible:border-lib-accent focus-visible:outline-none'

function errorText(code: TranslationErrorCode, message: string): string {
  switch (code) {
    case 'NETWORK_UNAVAILABLE':
      return 'Couldn’t download the translation model. Check your internet connection — after the first download, translation works offline.'
    case 'MODEL_LOAD_FAILED':
      return 'The translation model failed to load. Try again, or pick another language.'
    case 'UNSUPPORTED_LANGUAGE':
      return 'This language pair isn’t supported yet.'
    case 'SAME_LANGUAGE':
      return 'Source and target are the same language — pick a different one.'
    case 'INVALID_ARGUMENT':
      return message
    case 'WORKER_FAILED':
      return 'The translation engine stopped unexpectedly. Try again.'
    default:
      return 'Translation failed. Try again.'
  }
}

function formatMb(bytes: number | null): string | null {
  return bytes === null ? null : `${Math.round(bytes / 1_000_000)} MB`
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-lib-border border-t-lib-accent"
    />
  )
}

/** Drag-grip glyph on the header — visual affordance that the title bar is grabbable. Same glyph
 *  as `ReaderSearchPanel`/`WordCountPanel`. */
function GripIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3.5 shrink-0 text-lib-muted"
      aria-hidden
    >
      <circle cx="8" cy="6" r="1.4" />
      <circle cx="8" cy="12" r="1.4" />
      <circle cx="8" cy="18" r="1.4" />
      <circle cx="16" cy="6" r="1.4" />
      <circle cx="16" cy="12" r="1.4" />
      <circle cx="16" cy="18" r="1.4" />
    </svg>
  )
}

/** Diagonal resize-grip glyph on the bottom-right corner handle. */
function ResizeHandleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3 shrink-0 text-lib-muted"
      aria-hidden
    >
      <circle cx="19" cy="19" r="1.4" />
      <circle cx="19" cy="13" r="1.4" />
      <circle cx="13" cy="19" r="1.4" />
    </svg>
  )
}

function ModelProgress({ progress, multilingual }: { progress: TranslationLoadProgressState | null; multilingual: boolean }) {
  const percent = progress?.percent ?? null
  const loaded = formatMb(progress?.loadedBytes ?? null)
  const total = formatMb(progress?.totalBytes ?? null)
  const downloading = progress?.downloading ?? false
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-lib-text">
        <Spinner />
        <span>{downloading ? 'Downloading translation model…' : 'Loading translation model…'}</span>
        {percent !== null ? <span className="ml-auto tabular-nums text-lib-muted">{Math.floor(percent)}%</span> : null}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-lib-bg-mid"
        role="progressbar"
        aria-label="Model download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent !== null ? Math.floor(percent) : undefined}
      >
        <div
          className={`h-full rounded-full bg-lib-accent transition-[width] duration-200 ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent !== null ? { width: `${Math.max(2, percent)}%` } : undefined}
        />
      </div>
      <p className="text-[11px] leading-snug text-lib-muted">
        {downloading
          ? `One-time download${loaded && total ? ` (${loaded} of ${total})` : ''} — works offline afterwards.`
          : 'Preparing the model from the local cache.'}
        {downloading && multilingual ? ' This language pair uses a larger multilingual model.' : ''}
      </p>
    </div>
  )
}

/**
 * Floating translation card for a text selection — opened by Translate mode's drag-to-select (see
 * `EpubRenderer`'s `onTranslateDragEnd`) or the selection context menu. Reads/writes
 * `useTranslationStore` directly; `ReaderScreen` only mounts it while a popover is open.
 *
 * Floats over the reader exactly like `ReaderSearchPanel`/`WordCountPanel`: centered the first
 * time it ever opens, draggable by its header, resizable from any edge/corner afterward — not
 * anchored to the selection any more (see `useDraggableTranslationPanel`/
 * `useResizableTranslationPanel`).
 */
export function TranslationPopover() {
  const popover = useTranslationStore((s) => s.popover)
  const sourceLang = useTranslationStore((s) => s.sourceLang)
  const targetLang = useTranslationStore((s) => s.targetLang)
  const recentTargets = useTranslationStore((s) => s.recentTargets)
  const status = useTranslationStore((s) => s.status)
  const progress = useTranslationStore((s) => s.progress)
  const multilingual = useTranslationStore((s) => s.multilingual)
  const result = useTranslationStore((s) => s.result)
  const error = useTranslationStore((s) => s.error)
  const speaking = useTranslationStore((s) => s.speaking)
  const close = useTranslationStore((s) => s.close)
  const setSourceLang = useTranslationStore((s) => s.setSourceLang)
  const setTargetLang = useTranslationStore((s) => s.setTargetLang)
  const swapLanguages = useTranslationStore((s) => s.swapLanguages)
  const retry = useTranslationStore((s) => s.retry)
  const copyResult = useTranslationStore((s) => s.copyResult)
  const toggleSpeak = useTranslationStore((s) => s.toggleSpeak)
  const panelPosition = useTranslationStore((s) => s.panelPosition)
  const setPanelPosition = useTranslationStore((s) => s.setPanelPosition)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const drag = useDraggableTranslationPanel(panelRef, true)
  const resize = useResizableTranslationPanel(panelRef)
  /** How many language lists are open — Escape then closes the list, not the popover. */
  const openListsRef = useRef(0)

  // First-ever open (no remembered position yet): center the panel in the reader view, exactly
  // once — from then on `panelPosition` is set and this never runs again, same convention as
  // `useResizablePanel` pinning a position the first time a resize starts.
  useLayoutEffect(() => {
    if (panelPosition) return
    const panel = panelRef.current
    const container = panel?.offsetParent as HTMLElement | null
    if (!panel || !container) return
    const panelSize = { width: panel.offsetWidth, height: panel.offsetHeight }
    const containerSize = { width: container.clientWidth, height: container.clientHeight }
    setPanelPosition(
      clampPanelPosition(
        {
          left: (containerSize.width - panelSize.width) / 2,
          top: (containerSize.height - panelSize.height) / 2,
        },
        panelSize,
        containerSize,
      ),
    )
  }, [panelPosition, setPanelPosition])

  const onDismiss = useCallback(
    (reason: DismissReason) => {
      if (reason === 'escape' && openListsRef.current > 0) return
      close()
    },
    [close],
  )
  useDismissOnOutsideOrEscape(panelRef, onDismiss, { consumeEscape: true })

  const onListOpenChange = useCallback((open: boolean) => {
    openListsRef.current = Math.max(0, openListsRef.current + (open ? 1 : -1))
  }, [])

  if (!popover) return null

  const targetName = findTranslationLanguage(targetLang)?.name ?? targetLang

  return (
    <div
      ref={panelRef}
      // Same anchoring convention as `ReaderSearchPanel`/`WordCountPanel`: `absolute` against
      // ReaderShell's own box, not `fixed` — plain container-relative top/left math keeps it
      // bounded to the application view. The default top-4/left-4 corner is only ever visible for
      // one layout pass before the centering effect above overrides it on first open.
      className="absolute top-4 left-4 z-[420] flex w-[min(380px,calc(100vw-24px))] flex-col rounded-2xl border border-lib-border bg-lib-surface-strong shadow-2xl"
      style={{ ...drag.style, ...resize.style, maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-label="Translation"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[15px]">
        <div
          onPointerDown={drag.onHeaderPointerDown}
          className={`flex select-none items-center gap-2 px-3.5 pt-3 pb-2 ${
            drag.dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <GripIcon />
          <svg className="size-4 shrink-0 text-lib-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.7 3.75-5.7 3.75-9S14.5 5.7 12 3m0 18c-2.5-2.7-3.75-5.7-3.75-9S9.5 5.7 12 3M3.75 9.75h16.5M3.75 14.25h16.5" />
          </svg>
          <span className="text-[13px] font-bold text-lib-text-strong">Translate</span>
          <span className="ml-auto text-[10px] font-semibold tracking-wide text-lib-faint uppercase">Offline</span>
          <button type="button" className={iconBtn} aria-label="Close translation" data-no-drag onClick={close}>
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-3.5 pb-2.5">
          <LanguageCombobox label="Translate from" value={sourceLang} onChange={setSourceLang} onOpenChange={onListOpenChange} />
          <button type="button" className={iconBtn} aria-label="Swap languages" title="Swap languages" onClick={swapLanguages}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </button>
          <LanguageCombobox
            label="Translate to"
            value={targetLang}
            onChange={setTargetLang}
            recentCodes={recentTargets}
            onOpenChange={onListOpenChange}
            align="right"
          />
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto border-t border-lib-border-soft"
          // Bounds the panel's own default (unresized) height so a long selection/translation
          // can't grow it past the viewport — same convention as `ReaderSearchPanel`'s results
          // list. Once the user resizes, the panel's explicit height (`resize.style`) already
          // constrains this region via `flex-1`/`min-h-0`, so the cap is dropped.
          style={resize.style ? undefined : { maxHeight: 'min(60vh, 420px)' }}
        >
          <p
            className="max-h-[96px] overflow-y-auto px-3.5 pt-2.5 pb-2 text-[12px] leading-relaxed whitespace-pre-line text-lib-muted"
            lang={sourceLang}
            dir="auto"
          >
            {popover.sourceText}
          </p>

          <div className="px-3.5 pt-1 pb-3" aria-live="polite" aria-busy={status === 'translating' || status === 'loading-model'}>
            {status === 'loading-model' ? <ModelProgress progress={progress} multilingual={multilingual} /> : null}

            {status === 'translating' ? (
              <div className="flex items-center gap-2 py-1 text-[12px] font-semibold text-lib-muted">
                <Spinner />
                <span>Translating to {targetName}…</span>
              </div>
            ) : null}

            {status === 'done' && result !== null ? (
              <p
                className="text-[14px] leading-relaxed whitespace-pre-line text-lib-text-strong select-text"
                lang={targetLang}
                dir="auto"
              >
                {result || '—'}
              </p>
            ) : null}

            {status === 'error' && error ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[12px] leading-snug text-lib-text" role="alert">
                  {errorText(error.code, error.message)}
                </p>
                {error.code !== 'SAME_LANGUAGE' && error.code !== 'UNSUPPORTED_LANGUAGE' ? (
                  <button type="button" className={actionBtn} onClick={retry}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {status === 'done' && result ? (
          <div className="flex items-center gap-1.5 border-t border-lib-border-soft px-3.5 py-2.5">
            <button type="button" className={actionBtn} onClick={copyResult}>
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
              </svg>
              Copy
            </button>
            <button type="button" className={actionBtn} aria-pressed={speaking} onClick={toggleSpeak}>
              {speaking ? (
                <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M5.75 4.5a1.25 1.25 0 0 0-1.25 1.25v8.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-8.5c0-.69-.56-1.25-1.25-1.25h-8.5Z" />
                </svg>
              ) : (
                <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.75h3.4l4.2-3.6a.6.6 0 0 1 1 .46v10.78a.6.6 0 0 1-1 .46l-4.2-3.6H4a.75.75 0 0 1-.75-.75v-3a.75.75 0 0 1 .75-.75Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 9c1 .9 1 5.1 0 6M18.3 6.7c2.2 2.2 2.2 8.4 0 10.6" />
                </svg>
              )}
              {speaking ? 'Stop' : 'Listen'}
            </button>
          </div>
        ) : null}
      </div>

      {/* Window-style resize hit-zones — invisible, straddling the panel's border on all four
          edges and corners, same as `ReaderSearchPanel`/`WordCountPanel`. Corners render after
          (so they win on overlap) and are given a larger zone. */}
      <div
        onPointerDown={(e) => resize.onResizePointerDown('n', e)}
        className="absolute inset-x-3 -top-1 h-2 cursor-ns-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('s', e)}
        className="absolute inset-x-3 -bottom-1 h-2 cursor-ns-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('w', e)}
        className="absolute inset-y-3 -left-1 w-2 cursor-ew-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('e', e)}
        className="absolute inset-y-3 -right-1 w-2 cursor-ew-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('nw', e)}
        className="absolute -top-1 -left-1 size-3 cursor-nwse-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('ne', e)}
        className="absolute -top-1 -right-1 size-3 cursor-nesw-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('sw', e)}
        className="absolute -bottom-1 -left-1 size-3 cursor-nesw-resize touch-none"
        aria-hidden
      />
      <div
        onPointerDown={(e) => resize.onResizePointerDown('se', e)}
        title="Drag to resize"
        className="absolute -right-1 -bottom-1 flex size-4 touch-none cursor-nwse-resize items-end justify-end p-0.5"
      >
        <ResizeHandleIcon />
      </div>
    </div>
  )
}
