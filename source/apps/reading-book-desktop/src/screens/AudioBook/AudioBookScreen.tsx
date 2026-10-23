import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { chapterIndexAt, timelineView } from '@reading-book/book-reader-sdk'
import { useOpenReading } from '../../chrome'
import { ReaderOpenStatus } from '../Reader/components/chrome'
import { SidebarEdgeRail, useSidebarPanelResize, type SidebarTab } from '../Reader/components/sidebar'
import { SIDEBAR_TABS, sidebarContentInsetLeft } from '../Reader/components/sidebar/sidebarTabs'
import { useBookRelinkStore } from '../Reader/logic/bookRelink/bookRelinkStore'
import { AudioControls } from './components/AudioControls'
import { AudioNoteMenu } from './components/AudioNoteMenu'
import { AudioSidebarPanel } from './components/AudioSidebar'
import { AudioTimeline, ProgressScopeSelector } from './components/AudioTimeline'
import { useAudioPlayerStore } from './logic/audioPlayerStore'

const SIDEBAR_OPEN_KEY = 'readmate.audioSidebarOpen.v1'
/** The text reader's rail, minus Page layout (no pages) and Bookmark (audio's marked positions are its Notes). */
const AUDIO_SIDEBAR_TABS = SIDEBAR_TABS.filter((t) => t.id !== 'layout' && t.id !== 'bookmarks')

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** "4h 11m left" / "12m left" / "under a minute left". */
function formatLeft(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (seconds <= 0) return 'finished'
  if (m < 1) return 'under a minute left'
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`
}

/** Title block: the current chapter (when the file has validated chapters) above the audiobook's title and author. */
function NowPlaying() {
  const title = useAudioPlayerStore((s) => s.title)
  const author = useAudioPlayerStore((s) => s.author)
  const chapters = useAudioPlayerStore((s) => s.chapters)
  const status = useAudioPlayerStore((s) => s.chapterStatus)
  const index = useAudioPlayerStore((s) => chapterIndexAt(s.chapters, s.positionSeconds))
  const chapter = status === 'ok' && index >= 0 ? chapters[index] : undefined
  const meta = [chapter ? title : null, author].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-1.5">
      {chapter ? (
        <div className="text-xs font-semibold tracking-[0.08em] text-lib-accent uppercase">
          Chapter {index + 1} of {chapters.length}
        </div>
      ) : null}
      <h1 className="m-0 text-2xl leading-tight font-bold text-lib-text-strong">{chapter ? chapter.title : title}</h1>
      {meta ? <p className="m-0 text-sm text-lib-muted">{meta}</p> : null}
    </div>
  )
}

/** Whole-book progress, always shown (independent of the timeline scope). */
function BookProgress() {
  const position = useAudioPlayerStore((s) => s.positionSeconds)
  const duration = useAudioPlayerStore((s) => s.durationSeconds)
  const view = useMemo(() => timelineView('book', position, duration, []), [position, duration])
  if (!view) return null
  const pct = Math.round(view.fraction * 100)
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-sm bg-lib-border" aria-hidden>
        <div className="h-full bg-lib-faint" style={{ width: `${view.fraction * 100}%` }} />
      </div>
      <span className="text-xs whitespace-nowrap text-lib-muted">
        {pct}% · {formatLeft(view.remainingSeconds)}
      </span>
    </div>
  )
}

/**
 * Audiobook player (MP3). Mounted by `ReaderRoute` instead of `ReaderScreen` for audio books.
 * The left side is the text reader's own sidebar chrome (`SidebarEdgeRail` icon rail + a resizable
 * panel, same width preference); the player sits to its right and gives way as the panel opens.
 * Leaving to the Library is done from the menu bar, which also flushes the progress.
 */
export function AudioBookScreen({ bookId }: { bookId: string }) {
  const { ensureTab, updateBookTitle } = useOpenReading()
  const navigate = useNavigate()
  const status = useAudioPlayerStore((s) => s.status)
  const title = useAudioPlayerStore((s) => s.title)
  const coverUrl = useAudioPlayerStore((s) => s.coverUrl)
  const errorMessage = useAudioPlayerStore((s) => s.errorMessage)
  const errorCode = useAudioPlayerStore((s) => s.errorCode)
  const load = useAudioPlayerStore((s) => s.load)
  const dispose = useAudioPlayerStore((s) => s.dispose)
  const toggle = useAudioPlayerStore((s) => s.toggle)
  const relink = useBookRelinkStore()
  const sidebarResize = useSidebarPanelResize('left')

  const [open, setOpenState] = useState(readOpen)
  const [tab, setTab] = useState<SidebarTab>('chapters')
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, next ? '1' : '0')
    } catch {
      // The open / closed state is only a convenience.
    }
  }, [])

  useEffect(() => {
    ensureTab(bookId)
    void load(bookId)
    return () => {
      void dispose()
    }
  }, [bookId, ensureTab, load, dispose])

  useEffect(() => {
    if (status === 'ready' && title) updateBookTitle(bookId, title)
  }, [bookId, status, title, updateBookTitle])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const leave = useCallback(async () => {
    await dispose()
    navigate('/library')
  }, [dispose, navigate])
  const retry = useCallback(() => void load(bookId), [load, bookId])

  if (status === 'idle' || status === 'loading') {
    return <ReaderOpenStatus status="loading" onRetry={retry} onBack={() => void leave()} />
  }
  if (status === 'error') {
    return (
      <ReaderOpenStatus
        status="error"
        message={errorMessage}
        onRetry={retry}
        onBack={() => void leave()}
        onLocate={
          errorCode === 'missing_file'
            ? () => {
                void relink.locate(bookId).then((linked) => {
                  if (linked) retry()
                })
              }
            : undefined
        }
        locating={relink.locating}
        locateMessage={relink.notice?.bookId === bookId ? relink.notice.text : null}
      />
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 text-lib-text" data-audio-screen>
      <SidebarEdgeRail
        open={open}
        activeTab={tab}
        tabs={AUDIO_SIDEBAR_TABS}
        panelWidth={sidebarResize.panelWidth}
        isResizing={sidebarResize.isResizing}
        chromeHidden
        bottomInsetPx={0}
        onOpenTab={(next) => {
          setTab(next)
          setOpen(true)
        }}
        onToggle={() => setOpen(!open)}
      />
      <AudioSidebarPanel
        tab={tab}
        open={open}
        panelWidth={sidebarResize.panelWidth}
        isResizing={sidebarResize.isResizing}
        onClose={() => setOpen(false)}
        onResizePointerDown={sidebarResize.onResizePointerDown}
      />

      <main
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-6 py-4 ${
          sidebarResize.isResizing ? '' : 'transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
        }`}
        style={{ paddingLeft: sidebarContentInsetLeft(open, sidebarResize.panelWidth) + 24 }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-7 py-4">
          <div className="flex w-full flex-wrap items-center justify-center gap-6">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-60 w-[180px] shrink-0 rounded-xl border border-lib-border object-cover shadow-xl" />
            ) : (
              <div className="flex h-60 w-[180px] shrink-0 items-center justify-center rounded-xl border border-lib-border bg-lib-surface text-5xl" aria-hidden>
                🎧
              </div>
            )}
            <div className="min-w-60 flex-1">
              <NowPlaying />
              <BookProgress />
            </div>
          </div>

          <div className="flex w-full flex-col gap-3">
            <div className="flex justify-end">
              <ProgressScopeSelector />
            </div>
            <AudioTimeline />
          </div>

          <AudioControls />
        </div>
      </main>
      <AudioNoteMenu />
    </div>
  )
}
