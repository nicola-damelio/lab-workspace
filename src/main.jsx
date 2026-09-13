import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import './index.css'
import { applyStoredUiScale } from './utils/uiScale'

// Display scale (Settings → “Display scale”): set the root character size the
// whole program is computed from BEFORE the first paint, otherwise the first
// frame would show the pages at the wrong size. See src/utils/uiScale.js.
applyStoredUiScale()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
