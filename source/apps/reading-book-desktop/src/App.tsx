import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  AppMenubar,
  AppNavProvider,
  AppTitlebar,
  AppTitleProvider,
  GlobalReadingPrefsProvider,
  ImmersiveReadingProvider,
  OpenReadingProvider,
  ReaderChromeMenuProvider,
  SessionFlushBridge,
  useImmersiveReading,
} from './chrome'
import { LibraryScreen } from './screens/Library/LibraryScreen'
import { ReaderScreen } from './screens/Reader/ReaderScreen'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { SplashScreen } from './screens/Splash/SplashScreen'
import { SpikeEpubScreen } from './spikes/epub-engine/SpikeEpubScreen'

function AppChromeFrame({ children }: { children: ReactNode }) {
  const { immersive } = useImmersiveReading()

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
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
        <AppTitlebar />
        <AppMenubar />
      </div>
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function App() {
  return (
    <HashRouter>
      <AppTitleProvider>
        <AppNavProvider>
          <GlobalReadingPrefsProvider>
            <OpenReadingProvider>
              <ReaderChromeMenuProvider>
                <ImmersiveReadingProvider>
                  <SessionFlushBridge />
                  <AppChromeFrame>
                    <Routes>
                      <Route path="/" element={<SplashScreen />} />
                      <Route path="/library" element={<LibraryScreen />} />
                      <Route path="/reader/:bookId" element={<ReaderScreen />} />
                      <Route path="/settings" element={<SettingsScreen />} />
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
