import { Component } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import TourMode from './pages/TourMode'
import TourSummary from './pages/TourSummary'
import PerceptionSphere from './pages/PerceptionSphere'

class ErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('App crash:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100vw', height: '100vh',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-deep)', gap: '16px',
        }}>
          <div style={{
            fontSize: '11px', letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#E85D55',
          }}>
            Something went wrong
          </div>
          <div style={{
            fontSize: '13px', color: 'var(--text-secondary)',
            maxWidth: '400px', textAlign: 'center', lineHeight: 1.6,
          }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <Link to="/" onClick={() => this.setState({ hasError: false, error: null })} style={{
            padding: '10px 24px',
            border: '1px solid rgba(245, 240, 232, 0.2)',
            fontSize: '12px', letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-primary)',
            marginTop: '8px',
          }}>
            Back to Map
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/tour/:streetName" element={<TourMode />} />
        <Route path="/summary/:streetName" element={<TourSummary />} />
        <Route path="/sphere" element={<PerceptionSphere />} />
      </Routes>
    </ErrorBoundary>
  )
}
