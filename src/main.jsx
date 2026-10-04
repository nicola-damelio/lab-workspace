import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import './index.css'
import { applyStoredUiScale } from './utils/uiScale'
import { applyStoredUiSkinForSession } from './utils/uiSkin'

// Display scale (Settings → “Display scale”): set the root character size the
// whole program is computed from BEFORE the first paint, otherwise the first
// frame would show the pages at the wrong size. See src/utils/uiScale.js.
applyStoredUiScale()

// Interface skin (Settings → “Interface skin”): put the palette on <html>
// BEFORE the first paint too — a skin is only CSS variables (see
// src/index.css), so the first frame is already painted with it. The skin
// belongs to the OPERATOR (utils/uiSkin.js), so the one applied here is that of
// the operator remembered in THIS tab's session; App.jsx re-applies it whenever
// the identity changes, and with nobody signed in it is the skin of this
// computer.
applyStoredUiSkinForSession()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
