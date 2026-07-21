import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LibraryScreen } from './screens/Library/LibraryScreen'
import { ReaderScreen } from './screens/Reader/ReaderScreen'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { SplashScreen } from './screens/Splash/SplashScreen'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/library" element={<LibraryScreen />} />
        <Route path="/reader/:bookId" element={<ReaderScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
