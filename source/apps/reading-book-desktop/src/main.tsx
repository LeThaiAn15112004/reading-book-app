import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { applyTheme } from './theme/applyTheme'
import { syncWindowControlsInset } from './theme/syncWindowControlsInset'

applyTheme('day')
syncWindowControlsInset()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
