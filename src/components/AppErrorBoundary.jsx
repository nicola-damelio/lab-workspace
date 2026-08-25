import React from 'react'

/**
 * Global error boundary: catches render errors anywhere in the app and shows a
 * recoverable message instead of a blank/gray page. See the existing
 * MDSectionErrorBoundary in App.jsx for a section-level variant.
 */
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || String(error) }
  }

  componentDidCatch(error, info) {
    console.error('AppErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', fontFamily: "'Inter', sans-serif", color: '#334155', padding: 24
        }}>
          <div style={{ maxWidth: 520, width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 32, boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 16px' }}>
              An unexpected error occurred while rendering this page.
              Your data is safe — reload to continue.
            </p>
            <pre style={{
              fontSize: 11, background: '#f1f5f9', borderRadius: 8, padding: 12, overflow: 'auto',
              maxHeight: 160, margin: '0 0 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
            }}>{this.state.message}</pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer'
                }}
              >
                Reload app
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '' })}
                style={{
                  background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8,
                  padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default AppErrorBoundary
