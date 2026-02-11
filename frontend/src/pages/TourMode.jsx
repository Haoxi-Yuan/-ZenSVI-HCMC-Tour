import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import PanoramaViewer from '../components/PanoramaViewer'
import Dashboard from '../components/Dashboard'
import MiniMap from '../components/MiniMap'
import { useStreetPoints, useStreetData } from '../hooks/useStreetData'

export default function TourMode() {
  const { streetName } = useParams()
  const navigate = useNavigate()
  const decodedName = decodeURIComponent(streetName)
  const { points, loading } = useStreetPoints(decodedName)
  const { street } = useStreetData(decodedName)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [imageUrls, setImageUrls] = useState([])
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false)

  const currentPoint = points[currentIndex] || null
  const prevPoint = currentIndex > 0 ? points[currentIndex - 1] : null
  const nextPoint = currentIndex < points.length - 1 ? points[currentIndex + 1] : null

  // Build point ID -> segment scores lookup from street structure
  const segmentScoresByPoint = useMemo(() => {
    if (!street?.segments) return {}
    const map = {}
    for (const seg of street.segments) {
      for (const pid of (seg.points || [])) {
        map[pid] = seg.scores
      }
    }
    return map
  }, [street])

  // Load images for current point
  useEffect(() => {
    if (!currentPoint) return
    fetch(`/api/images/by-point/${encodeURIComponent(currentPoint.id)}`)
      .then(r => r.json())
      .then(data => setImageUrls(data.images || []))
      .catch(console.error)
  }, [currentPoint])

  const goForward = useCallback(() => {
    if (currentIndex < points.length - 1) {
      setCurrentIndex(i => i + 1)
    } else {
      // Tour complete — go to summary
      navigate(`/summary/${encodeURIComponent(decodedName)}`)
    }
  }, [currentIndex, points.length, navigate, decodedName])

  const goBack = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(i => i - 1)
  }, [currentIndex])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'd') goForward()
      if (e.key === 'ArrowLeft' || e.key === 'a') goBack()
      if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goForward, goBack, navigate])

  if (loading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
      }}>
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--accent-green)',
          marginBottom: '16px',
        }}>Loading Street Data</div>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '32px',
          fontWeight: 700,
        }}>{decodedName}</div>
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
      }}>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '28px',
          marginBottom: '16px',
        }}>No Data Available</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          No sampling points found for "{decodedName}".
        </p>
        <Link to="/" style={{
          padding: '12px 24px',
          border: '1px solid rgba(245, 240, 232, 0.2)',
          fontSize: '13px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>Back to Map</Link>
      </div>
    )
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '56px',
        background: 'rgba(15, 13, 10, 0.75)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        zIndex: 60,
        borderBottom: '1px solid rgba(245, 240, 232, 0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/" style={{
            color: 'var(--text-muted)',
            fontSize: '13px',
            transition: 'color 0.3s',
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 4l-6 6 6 6" />
            </svg>
          </Link>
          <div>
            <div style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: '16px',
              fontWeight: 700,
            }}>{decodedName}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {/* Progress indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '120px',
              height: '3px',
              background: 'rgba(245, 240, 232, 0.08)',
            }}>
              <div style={{
                width: `${((currentIndex + 1) / points.length) * 100}%`,
                height: '100%',
                background: 'var(--accent-green)',
                transition: 'width 0.3s',
              }} />
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {currentIndex + 1} / {points.length}
            </span>
          </div>

          <button
            onClick={() => navigate(`/summary/${encodeURIComponent(decodedName)}`)}
            style={{
              padding: '6px 16px',
              background: 'transparent',
              border: '1px solid rgba(245, 240, 232, 0.15)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '11px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              transition: 'all 0.3s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--text-primary)'
              e.currentTarget.style.color = 'var(--bg-deep)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            End Tour
          </button>
        </div>
      </div>

      {/* Panorama Viewer (full screen) */}
      <PanoramaViewer
        imageUrls={imageUrls}
        onNavigateForward={currentIndex < points.length - 1 ? goForward : null}
        onNavigateBack={currentIndex > 0 ? goBack : null}
        currentPoint={currentPoint}
        nextPoint={nextPoint}
        pointIndex={currentIndex}
        totalPoints={points.length}
      />

      {/* Dashboard Sidebar */}
      <Dashboard
        currentPoint={currentPoint}
        prevPoint={prevPoint}
        allPoints={points}
        currentIndex={currentIndex}
        segmentScores={currentPoint ? segmentScoresByPoint[currentPoint.id] : null}
        prevSegmentScores={prevPoint ? segmentScoresByPoint[prevPoint.id] : null}
        allSegmentScores={segmentScoresByPoint}
        collapsed={dashboardCollapsed}
        onToggle={() => setDashboardCollapsed(c => !c)}
      />

      {/* Mini Map */}
      <MiniMap
        points={points}
        currentIndex={currentIndex}
        onPointClick={(idx) => setCurrentIndex(idx)}
      />
    </div>
  )
}
