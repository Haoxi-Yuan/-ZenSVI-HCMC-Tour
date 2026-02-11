import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import RadarChart from '../components/RadarChart'
import Sparkline from '../components/Sparkline'
import ScatterPlot from '../components/ScatterPlot'
import { useStreetData, useStreetPoints } from '../hooks/useStreetData'

const PERCEPTION_DIMS = ['safer', 'livelier', 'wealthier', 'more_beautiful', 'more_boring', 'more_depressing']
const PERCEPTION_LABELS = ['Safer', 'Livelier', 'Wealthier', 'Beautiful', 'Boring', 'Depressing']

export default function TourSummary() {
  const { streetName } = useParams()
  const decodedName = decodeURIComponent(streetName)
  const { street, loading: streetLoading } = useStreetData(decodedName)
  const { points, loading: pointsLoading } = useStreetPoints(decodedName)

  const loading = streetLoading || pointsLoading

  // Compute averages across all points
  const avgPerception = useMemo(() => {
    if (!points || points.length === 0) return PERCEPTION_DIMS.map(() => 0)
    return PERCEPTION_DIMS.map(dim => {
      const vals = points.map(p => p.perception?.[dim] || 0).filter(v => v > 0)
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    })
  }, [points])

  const perceptionRadarData = PERCEPTION_DIMS.map((dim, i) => ({
    axis: PERCEPTION_LABELS[i],
    value: avgPerception[i],
  }))

  // Walkability from pre-computed street data
  const walkScores = useMemo(() => ({
    safety: street?.avg_scores?.safety_score || 0,
    accessibility: street?.avg_scores?.accessibility_score || 0,
    comfort: street?.avg_scores?.comfort_score || 0,
    overall: street?.avg_scores?.walkability_score || 0,
  }), [street])

  const walkRadarData = [
    { axis: 'Safety', value: walkScores.safety },
    { axis: 'Access.', value: walkScores.accessibility },
    { axis: 'Comfort', value: walkScores.comfort },
  ]

  // Build point ID -> segment scores lookup
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

  // Sparkline data (all points)
  const sparklines = useMemo(() => {
    if (!points || points.length === 0) return {}
    const data = {}
    PERCEPTION_DIMS.forEach(dim => {
      data[dim] = points.map(p => p.perception?.[dim] || 0)
    })

    // Environment trajectories from segment scores
    if (Object.keys(segmentScoresByPoint).length > 0) {
      data.lst = points.map(p => segmentScoresByPoint[p.id]?.lst_avg || 0)
      data.building_height = points.map(p => segmentScoresByPoint[p.id]?.avg_building_height || 0)
    }

    return data
  }, [points, segmentScoresByPoint])

  // Preview images: sample 6 evenly-spaced points along the street
  const [previewImages, setPreviewImages] = useState([])
  useEffect(() => {
    if (!points || points.length === 0) return
    const count = Math.min(6, points.length)
    const indices = Array.from({ length: count }, (_, i) =>
      Math.round(i * (points.length - 1) / (count - 1 || 1))
    )
    const sampled = [...new Set(indices)].map(i => points[i])

    Promise.all(
      sampled.map(p =>
        fetch(`/api/images/by-point/${encodeURIComponent(p.id)}`)
          .then(r => r.json())
          .then(data => ({ pointId: p.id, url: data.images?.[0] || null }))
          .catch(() => ({ pointId: p.id, url: null }))
      )
    ).then(results => setPreviewImages(results.filter(r => r.url)))
  }, [points])

  if (loading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
      }}>
        <div style={{ fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-green)' }}>
          Computing Summary...
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', padding: '80px 48px' }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <Link to="/" style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '32px',
          transition: 'color 0.3s',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" />
          </svg>
          Back to Map
        </Link>

        <div className="section-label">Tour Summary</div>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 'clamp(36px, 5vw, 56px)',
          fontWeight: 700,
          marginBottom: '8px',
        }}>{decodedName}</h1>
        <p style={{
          fontSize: '16px',
          color: 'var(--text-secondary)',
          fontWeight: 300,
          marginBottom: '64px',
        }}>
          {street?.segment_count || 0} segments / {points.length} sampling points analyzed
        </p>

        {/* Street Preview Gallery */}
        {previewImages.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${previewImages.length}, 1fr)`,
            gap: '4px',
            marginBottom: '64px',
          }}>
            {previewImages.map((img, i) => (
              <div key={i} style={{
                aspectRatio: '16 / 9',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <img
                  src={img.url}
                  alt={`Street view ${i + 1}`}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    filter: 'brightness(0.85)',
                    transition: 'filter 0.3s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'brightness(0.85)'}
                />
                {i === 0 && (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    left: '8px',
                    fontSize: '9px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(245, 240, 232, 0.7)',
                    background: 'rgba(15, 13, 10, 0.6)',
                    padding: '3px 8px',
                  }}>Start</div>
                )}
                {i === previewImages.length - 1 && previewImages.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    fontSize: '9px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(245, 240, 232, 0.7)',
                    background: 'rgba(15, 13, 10, 0.6)',
                    padding: '3px 8px',
                  }}>End</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Overall Score */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '48px',
          marginBottom: '64px',
          paddingBottom: '48px',
          borderBottom: '1px solid rgba(245, 240, 232, 0.06)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: '72px',
              fontWeight: 700,
              color: walkScores.overall >= 5.5 ? 'var(--accent-green)' : walkScores.overall >= 4.5 ? 'var(--accent-gold)' : 'var(--accent-orange)',
              lineHeight: 1,
            }}>
              {walkScores.overall.toFixed(1)}
            </div>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginTop: '8px',
            }}>Overall Walkability</div>
          </div>

          <div style={{ display: 'flex', gap: '32px' }}>
            {[
              { label: 'Safety', value: walkScores.safety },
              { label: 'Accessibility', value: walkScores.accessibility },
              { label: 'Comfort', value: walkScores.comfort },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  color: value >= 5.5 ? 'var(--accent-green)' : value >= 4.5 ? 'var(--accent-gold)' : 'var(--accent-orange)',
                }}>
                  {value.toFixed(1)}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginTop: '4px',
                }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Radar Charts Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '48px',
          marginBottom: '64px',
        }}>
          <div className="card" style={{ padding: '28px' }}>
            <RadarChart data={walkRadarData} maxValue={10} size={250} title="Walkability Dimensions" color="#3DBB78" />
          </div>
          <div className="card" style={{ padding: '28px' }}>
            <RadarChart data={perceptionRadarData} maxValue={10} size={250} title="Perception Profile" color="#D4A855" />
          </div>
        </div>

        {/* Full Journey Sparklines */}
        <div style={{ marginBottom: '64px' }}>
          <div className="section-label">Journey Overview</div>
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: '28px',
            fontWeight: 700,
            marginBottom: '32px',
          }}>How scores changed along the street</h2>

          <div className="card" style={{ padding: '28px' }}>
            {PERCEPTION_DIMS.map((dim, i) => (
              <div key={dim} style={{ marginBottom: '16px' }}>
                <Sparkline
                  values={sparklines[dim] || []}
                  label={PERCEPTION_LABELS[i]}
                  width={700}
                  height={40}
                  color="var(--accent-gold)"
                  pointIds={points.map(p => p.id)}
                />
              </div>
            ))}

            {/* Environment trajectories */}
            {sparklines.lst && sparklines.lst.some(v => v > 0) && (
              <>
                <div style={{
                  fontSize: '11px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginTop: '24px',
                  marginBottom: '12px',
                  fontWeight: 500,
                }}>Environment</div>
                <div style={{ marginBottom: '16px' }}>
                  <Sparkline
                    values={sparklines.lst}
                    label="Land Surface Temp (°C)"
                    width={700}
                    height={40}
                    color="var(--accent-orange)"
                    pointIds={points.map(p => p.id)}
                  />
                </div>
                {sparklines.building_height && sparklines.building_height.some(v => v > 0) && (
                  <div style={{ marginBottom: '16px' }}>
                    <Sparkline
                      values={sparklines.building_height}
                      label="Building Height (m)"
                      width={700}
                      height={40}
                      color="#5B9BD5"
                      pointIds={points.map(p => p.id)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Scatter Plots */}
        <div style={{ marginBottom: '64px' }}>
          <div className="section-label">City Context</div>
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: '28px',
            fontWeight: 700,
            marginBottom: '32px',
          }}>Where this street ranks city-wide</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {['walkability', 'safety', 'accessibility', 'comfort'].map(dim => (
              <div key={dim} className="card" style={{ padding: '24px' }}>
                <ScatterPlot
                  dimension={dim}
                  highlightStreet={decodedName}
                  highlightValue={walkScores[dim === 'walkability' ? 'overall' : dim]}
                  width={400}
                  height={200}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Return button */}
        <div style={{ textAlign: 'center', paddingTop: '32px' }}>
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 32px',
              border: '1px solid rgba(245, 240, 232, 0.2)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              transition: 'all 0.3s',
            }}
          >
            Explore Another Street
          </Link>
        </div>
      </div>
    </div>
  )
}
