import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { ImportQueueCard } from './components/import/ImportQueueCard'
import { MiniPlayerBar } from './components/audio/MiniPlayerBar'
import { startMiniPlayerSync } from './screens/AudioBook/logic/miniPlayerSync'
import { miniPlayerReservedHeight, useMiniPlayerUiStore } from './screens/AudioBook/logic/miniPlayerUiStore'
import { startImportQueue } from './hooks/library/importQueueStore'
import {
  AppAppearanceBridge,
  AppMenubar,
  AppNavProvider,
  AppTitlebar,
  AppTitleProvider,
  GlobalReadingPrefsProvider,
  ImmersiveReadingProvider,
  OpenReadingProvider,
  PhoneNav,
  ReaderChromeMenuProvider,
  ReminderNavigationBridge,
  SessionFlushBridge,
  useImmersiveReading,
} from './components/chrome'
import { isFeatureAvailable } from './platforms/host'
import { LibraryScreen } from './screens/Library/LibraryScreen'
import { ReaderRoute } from './screens/ReaderRoute'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { SplashScreen } from './screens/Splash/SplashScreen'
import { ShortcutsBridge } from './shortcuts'
import { SpikeEpubScreen } from './spikes/epub-engine/SpikeEpubScreen'

function AppChromeFrame({ children }: { children: ReactNode }) {
  const { immersive } = useImmersiveReading()
  // Spec 016: the import queue runs for the whole app session (and restores the phone's saved queue).
  useEffect(() => {
    void startImportQueue()
  }, [])
  // Spec 018: the listening session reaches Main (floating window, tray) for the whole app session — Desktop only.
  useEffect(() => startMiniPlayerSync(), [])
  // FR-020: the mini player bar never covers content. The text reader keeps its own text clear of the bar (above its
  // footer); every other screen is laid out above it here.
  const { pathname } = useLocation()
  const reserved = useMiniPlayerUiStore(miniPlayerReservedHeight)
  const padBottom = pathname.startsWith('/reader/') ? 0 : reserved

  return (
    <div
      className="app-frame flex h-screen flex-col overflow-hidden"
      data-immersive-reading={immersive ? '' : undefined}
    >
      <div
        className={`relative z-[200] shrink-0 overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          immersive
            ? 'pointer-events-none max-h-0 -translate-y-full opacity-0'
            : 'max-h-[200px] translate-y-0 opacity-100'
        }`}
        aria-hidden={immersive || undefined}
      >
        {/* Desktop window chrome; the Mobile host has a bottom tab bar instead (spec 008 T070, spec 013 US5). */}
        {isFeatureAvailable('desktopChrome') ? (
          <>
            <AppTitlebar />
            <AppMenubar />
          </>
        ) : null}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ paddingBottom: padBottom, ['--mini-player-height' as string]: `${reserved}px` }}
      >
        {children}
        <MiniPlayerBar />
        {/* Spec 016: background import progress — above every route, inside the content area (clear of PhoneNav). */}
        <ImportQueueCard />
      </div>
      {/* Phone tab bar: after the content, so it stays fixed at the bottom while the screen scrolls (FR-021). */}
      {isFeatureAvailable('desktopChrome') ? null : <PhoneNav />}
    </div>
  )
}

function App() {
  return (
    <HashRouter>
      <AppTitleProvider>
        <AppNavProvider>
          <GlobalReadingPrefsProvider>
            <AppAppearanceBridge />
            <OpenReadingProvider>
              <ReaderChromeMenuProvider>
                <ImmersiveReadingProvider>
                  <SessionFlushBridge />
                  <ReminderNavigationBridge />
                  <ShortcutsBridge />
                  <AppChromeFrame>
                    <Routes>
                      <Route path="/" element={<SplashScreen />} />
                      <Route path="/library" element={<LibraryScreen />} />
                      <Route path="/reader/:bookId" element={<ReaderRoute />} />
                      <Route path="/settings/:section?" element={<SettingsScreen />} />
                      {/* T3.1 spike harness — not linked from Library → Reader */}
                      <Route path="/spike/epub" element={<SpikeEpubScreen />} />
                      <Route
                        path="*"
                        element={<Navigate to="/library" replace />}
                      />
                    </Routes>
                  </AppChromeFrame>
                </ImmersiveReadingProvider>
              </ReaderChromeMenuProvider>
            </OpenReadingProvider>
          </GlobalReadingPrefsProvider>
        </AppNavProvider>
      </AppTitleProvider>
    </HashRouter>
  )
}

export default App
