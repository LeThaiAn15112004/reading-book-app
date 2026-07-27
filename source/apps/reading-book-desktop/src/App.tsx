import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import {
  AppMenubar,
  AppNavProvider,
  AppTitlebar,
  AppTitleProvider,
  GlobalReadingPrefsProvider,
  OpenReadingProvider,
} from './chrome'
import { LibraryScreen } from './screens/Library/LibraryScreen'
import { ReaderScreen } from './screens/Reader/ReaderScreen'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { SplashScreen } from './screens/Splash/SplashScreen'
import { SpikeEpubScreen } from './spikes/epub-engine/SpikeEpubScreen'

function App() {
  return (
    <HashRouter>
      <AppTitleProvider>
        <AppNavProvider>
          <GlobalReadingPrefsProvider>
            <OpenReadingProvider>
              <div className="flex h-screen flex-col overflow-hidden">
                <AppTitlebar />
                <AppMenubar />
                <div className="min-h-0 flex-1 overflow-hidden">
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
                </div>
              </div>
            </OpenReadingProvider>
          </GlobalReadingPrefsProvider>
        </AppNavProvider>
      </AppTitleProvider>
    </HashRouter>
  )
}

export default App
