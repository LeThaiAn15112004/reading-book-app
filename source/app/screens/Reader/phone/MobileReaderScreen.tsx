/**
 * The phone reader (spec 008 T102 / T103; rebuilt by spec 019 — `specs/019-mobile-reader-redesign/`).
 *
 * Chosen by `ReaderRoute` only when `isMobileHost()` is true and loaded with `React.lazy`, so Electron never loads
 * this file. Everything format-specific comes from ONE reading surface (`useReadingSurface`: the same core hooks,
 * stores and renderers as Desktop's `ReaderScreen`); everything about the chrome — bars, the stack of open layers, the
 * idle timer, the toast — lives in ONE store (`phoneReaderChromeStore`, rules in core `reduceChrome`). This screen only
 * composes them:
 *
 *   - Back closes the innermost layer first (each layer registers `useBackClose`), then leaves the book (FR-001).
 *   - The book opens with the bars hidden; a tap in the middle (anywhere in a scrolling book) toggles them; a page turn,
 *     a scroll or 4 s without interaction hides them (FR-008). They fade and never move the text (FR-009).
 *   - Page view (EPUB / PDF): swipes and edge taps turn pages through the core gesture classifier (FR-003 – FR-005).
 *   - A finished selection shows the colour bar at once (FR-015).
 *
 * Not here (first-release scope): TXT editing, ink, shapes, typewriter, attachments, search, read aloud, translation,
 * snapshot, word count, export, annotation transfer, relink, keyboard shortcuts, audiobooks.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ReaderOpeningScreen } from '../../../components/reader/ReaderOpeningScreen'
import { useT } from '../../../i18n'
import { MobileAppearanceSheet } from './components/MobileAppearanceSheet'
import { MobileMarkSheet } from './components/MobileMarkSheet'
import { MobileMarksSheet } from './components/MobileMarksSheet'
import { MobileReaderBottomBar, MobileReaderTopBar } from './components/MobileReaderBars'
import { MobileSelectionBar } from './components/MobileSelectionBar'
import { MobileTocSheet } from './components/MobileTocSheet'
import { phoneChrome, usePhoneReaderChromeStore } from './logic/phoneReaderChromeStore'
import { usePhonePageGestures } from './logic/usePhonePageGestures'
import { useReadingSurface, type SurfacePageEvents } from './logic/useReadingSurface'
import type { ReadingSurface, SurfaceView } from './logic/readingSurface'

/** A scroll this soon after the slider let go is the jump, not reading on. */
const SLIDER_SCROLL_GRACE_MS = 800

export default function MobileReaderScreen() {
  const t = useT()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const moverRef = useRef<HTMLDivElement | null>(null)

  const barsVisible = usePhoneReaderChromeStore((s) => s.barsVisible)
  const layers = usePhoneReaderChromeStore((s) => s.layers)
  const toast = usePhoneReaderChromeStore((s) => s.toast)
  const topInsetPx = usePhoneReaderChromeStore((s) => s.topInsetPx)
  const sliderDragging = usePhoneReaderChromeStore((s) => s.sliderDragging)
  const dispatch = usePhoneReaderChromeStore((s) => s.dispatch)
  const openLayer = usePhoneReaderChromeStore((s) => s.openLayer)
  const closeLayer = usePhoneReaderChromeStore((s) => s.closeLayer)
  const showToast = usePhoneReaderChromeStore((s) => s.showToast)
  const resetFor = usePhoneReaderChromeStore((s) => s.resetFor)
  const poke = usePhoneReaderChromeStore((s) => s.poke)

  // The page's events reach the gestures and the chrome through refs, so the surface gets one stable object.
  const surfaceNowRef = useRef<ReadingSurface | null>(null)
  const viewRef = useRef<SurfaceView>('scroll')
  const gesturesRef = useRef<ReturnType<typeof usePhonePageGestures> | null>(null)
  const sliderReleasedAtRef = useRef(0)
  const handleScrolled = useCallback(() => {
    if (phoneChrome.get().sliderDragging) return
    if (performance.now() - sliderReleasedAtRef.current < SLIDER_SCROLL_GRACE_MS) return
    // Page view: only a scroll the finger drives (panning a zoomed PDF page) is reading on. epub.js scrolls its own
    // frames a moment after a turn; counting that hid the bars the next tap had just shown (two taps needed).
    if (viewRef.current === 'page' && !gesturesRef.current?.isUserScroll()) return
    dispatch({ type: 'scrolled' })
  }, [dispatch])
  const events = useMemo<SurfacePageEvents>(
    () => ({
      onBlankTap: () => {
        // Page view: the page gestures decide every tap themselves (one tap rule, `recognizeTap`); the renderer's blank
        // click has already closed its own UI and means nothing more here.
        if (viewRef.current === 'page') return
        // A tap beside a selection only drops it.
        if (surfaceNowRef.current?.selection) {
          surfaceNowRef.current.clearSelection()
          return
        }
        dispatch({ type: 'tap-middle' })
      },
      onScrolled: handleScrolled,
      onEpubPointer: (event) => gesturesRef.current?.onEpubPointer(event),
      onChromeHidden: (hidden) => dispatch(hidden ? { type: 'page-turned' } : { type: 'show-bars' }),
    }),
    [dispatch, handleScrolled],
  )

  const reader = useReadingSurface({ events, surfaceRef, layersOpen: layers.length > 0 })
  const { surface, opening } = reader
  surfaceNowRef.current = surface
  const view: SurfaceView = surface?.view ?? 'scroll'
  viewRef.current = view

  // A new book: chrome back to its opening state (bars hidden, nothing open).
  useEffect(() => {
    resetFor(reader.bookId ?? null)
    return () => resetFor(null)
  }, [reader.bookId, resetFor])

  // Any touch / click anywhere restarts the bars' idle countdown.
  useEffect(() => {
    const onActivity = () => poke()
    window.addEventListener('pointerdown', onActivity, true)
    return () => window.removeEventListener('pointerdown', onActivity, true)
  }, [poke])

  useEffect(() => {
    if (!sliderDragging) sliderReleasedAtRef.current = performance.now()
  }, [sliderDragging])

  const turnPage = useCallback(
    (direction: 'next' | 'prev'): boolean => {
      const turned = surfaceNowRef.current?.turn?.(direction) ?? false
      if (turned) dispatch({ type: 'page-turned' })
      return turned
    },
    [dispatch],
  )

  const gestures = usePhonePageGestures({
    view,
    allowed: () => phoneChrome.swipesAllowed() && !opening.visible,
    moverRef,
    pageRef: surfaceRef,
    turn: turnPage,
    zoomEdge: surface?.zoomEdge,
    isMarkAt: surface?.isMarkAt,
    onTap: (kind) => {
      // A tap beside a selection only drops it (the same rule as a renderer's blank tap).
      if (surfaceNowRef.current?.selection) {
        surfaceNowRef.current.clearSelection()
        return
      }
      if (kind === 'tap-middle') dispatch({ type: 'tap-middle' })
      else turnPage(kind === 'tap-next' ? 'next' : 'prev')
    },
  })
  gesturesRef.current = gestures

  // Main-document touches on the page feed the gestures in every view: Page view swipes / edge taps, and in both views
  // the taps no renderer reports (safe-area bands, the EPUB cover, the space around a page).
  const mountable = opening.mountable
  useEffect(() => {
    gestures.bindRoot(mountable ? surfaceRef.current : null)
    return () => gestures.bindRoot(null)
  }, [gestures, view, mountable])

  // Any scroll inside the page (every format, every view) is "reading on".
  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !mountable) return
    el.addEventListener('scroll', handleScrolled, { capture: true, passive: true })
    return () => el.removeEventListener('scroll', handleScrolled, { capture: true })
  }, [mountable, handleScrolled])

  // The selection bar and a mark's panel are layers too: they follow the surface.
  const hasSelection = Boolean(surface?.selection)
  useEffect(() => {
    if (hasSelection) openLayer('selection')
    else closeLayer('selection')
  }, [hasSelection, openLayer, closeLayer])
  const activeMark = surface?.activeMark ?? null
  const markOpen = activeMark !== null
  useEffect(() => {
    if (markOpen) openLayer('mark')
    else closeLayer('mark')
  }, [markOpen, openLayer, closeLayer])

  const copyText = (text: string | undefined) => {
    if (!text) return
    void navigator.clipboard?.writeText(text).then(
      () => showToast(t('reader.phone.screen.copied')),
      () => showToast(t('reader.phone.screen.copyFailed')),
    )
  }

  const openingScreen = (
    <ReaderOpeningScreen
      visible={opening.visible}
      status={opening.status}
      bookId={reader.bookId ?? ''}
      title={opening.title}
      coverUrl={opening.coverUrl}
      opening={opening.opening}
      message={opening.message}
      onRetry={opening.retry}
      onFromBeginning={opening.fromBeginning}
      onBack={reader.leave}
    />
  )

  if (!mountable || !surface) {
    return (
      <div className="relative h-full overflow-hidden bg-lib-bg-deep text-lib-text" data-mobile-reader="">
        {reader.page ? (
          <>
            {/* A format the phone does not open: its message, and a way back. */}
            <div className="absolute inset-0 pt-16">{reader.page}</div>
            <MobileReaderTopBar visible title={reader.title} onBack={reader.leave} />
          </>
        ) : null}
        {openingScreen}
      </div>
    )
  }

  const has = (layer: (typeof layers)[number]) => layers.includes(layer)

  return (
    <div
      className="relative h-full overflow-hidden bg-lib-bg-deep text-lib-text [--reader-text:var(--lib-text)]"
      style={{ ...reader.readingStyle, ['--phone-reader-top-inset' as string]: `${barsVisible ? topInsetPx : 0}px` }}
      data-mobile-reader=""
    >
      {/* FR-017: first in the reading order while the bars are hidden. */}
      {!barsVisible ? (
        <button type="button" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[700]" onClick={() => dispatch({ type: 'show-bars' })}>
          {t('reader.phone.bars.showControls')}
        </button>
      ) : null}

      <div
        ref={surfaceRef}
        className="absolute inset-0"
        style={{ paddingTop: 'var(--app-safe-top, env(safe-area-inset-top))', paddingBottom: 'var(--app-safe-bottom, env(safe-area-inset-bottom))' }}
      >
        <div ref={moverRef} className="h-full will-change-transform">
          {reader.page}
        </div>
      </div>

      {openingScreen}

      <MobileReaderTopBar visible={barsVisible} title={reader.title} onBack={reader.leave} bookmarks={surface.bookmarks} />
      <MobileReaderBottomBar visible={barsVisible && !hasSelection} surface={surface} onOpen={openLayer} />

      {surface.selection ? (
        <MobileSelectionBar selection={surface.selection} lastColorHex={surface.lastColorHex} onCopy={copyText} />
      ) : null}

      {has('toc') ? (
        <MobileTocSheet
          items={surface.toc}
          activeHref={surface.activeTocHref}
          activeId={surface.activeTocId}
          onSelect={surface.goToToc}
          onClose={() => closeLayer('toc')}
        />
      ) : null}

      {has('marks') ? (
        <MobileMarksSheet
          bookmarks={surface.bookmarks}
          marks={surface.marks}
          onJumpMark={surface.jumpToMark}
          onOpenMark={surface.openMark}
          onClose={() => closeLayer('marks')}
        />
      ) : null}

      {has('appearance') ? (
        <MobileAppearanceSheet surface={surface} prefs={reader.prefs} onChange={reader.setPrefs} onClose={() => closeLayer('appearance')} />
      ) : null}

      {activeMark ? (
        <MobileMarkSheet
          key={activeMark.highlight.id}
          mark={activeMark}
          confirmOpen={has('confirm')}
          onOpenConfirm={() => openLayer('confirm')}
          onCloseConfirm={() => closeLayer('confirm')}
          onCopy={copyText}
          onClose={activeMark.close}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="pointer-events-none fixed left-1/2 z-[999] -translate-x-1/2 rounded-full border border-lib-border bg-lib-surface-strong px-[18px] py-2.5 text-[13px] font-semibold text-lib-text-strong shadow-xl"
          style={{
            top: barsVisible ? 'calc(var(--phone-reader-top-inset) + 8px)' : 'calc(var(--app-safe-top, env(safe-area-inset-top)) + 8px)',
          }}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}
