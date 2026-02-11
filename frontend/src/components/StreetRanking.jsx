import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const DIMENSIONS = [
  { id: 'walkability', label: 'Walkability' },
  { id: 'safety', label: 'Safety' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'comfort', label: 'Comfort' },
]

function scoreColor(score) {
  if (score >= 5.5) return 'var(--accent-green)'
  if (score >= 4.5) return 'var(--accent-gold)'
  return 'var(--accent-orange)'
}

export default function StreetRanking() {
  const [dim, setDim] = useState('walkability')
  const [mode, setMode] = useState('top') // 'top' or 'bottom'
  const [streets, setStreets] = useState([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    const order = mode === 'top' ? 'desc' : 'asc'
    fetch(`/api/streets?sort=${dim}&order=${order}&limit=10&min_points=10`)
      .then(r => r.json())
      .then(data => {
        setStreets(data.streets || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [dim, mode])

  return (
    <div>
      {/* Dimension selector */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        marginBottom: '10px',
      }}>
        {DIMENSIONS.map(d => (
          <button
            key={d.id}
            onClick={() => setDim(d.id)}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontFamily: 'inherit',
              background: dim === d.id ? 'rgba(245, 240, 232, 0.12)' : 'transparent',
              border: `1px solid ${dim === d.id ? 'rgba(245, 240, 232, 0.25)' : 'rgba(245, 240, 232, 0.08)'}`,
              color: dim === d.id ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Top / Bottom toggle */}
      <div style={{
        display: 'flex',
        gap: '0',
        marginBottom: '12px',
      }}>
        {[
          { id: 'top', label: 'Top 10', icon: '▲' },
          { id: 'bottom', label: 'Bottom 10', icon: '▼' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: '10px',
              fontFamily: 'inherit',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: mode === m.id
                ? (m.id === 'top' ? 'rgba(61, 187, 120, 0.15)' : 'rgba(232, 115, 74, 0.15)')
                : 'transparent',
              border: `1px solid ${mode === m.id ? 'rgba(245, 240, 232, 0.2)' : 'rgba(245, 240, 232, 0.06)'}`,
              color: mode === m.id
                ? (m.id === 'top' ? 'var(--accent-green)' : 'var(--accent-orange)')
                : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Street list */}
      <div style={{
        maxHeight: '320px',
        overflowY: 'auto',
      }}>
        {loading ? (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            padding: '12px 0',
            textAlign: 'center',
            letterSpacing: '0.1em',
          }}>Loading...</div>
        ) : (
          streets.map((street, i) => (
            <div
              key={street.name}
              onClick={() => navigate(`/tour/${encodeURIComponent(street.name)}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 8px',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(245, 240, 232, 0.04)',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(245, 240, 232, 0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Rank number */}
              <div style={{
                width: '22px',
                fontSize: '11px',
                fontWeight: 700,
                color: mode === 'top'
                  ? (i < 3 ? 'var(--accent-green)' : 'var(--text-muted)')
                  : (i < 3 ? 'var(--accent-orange)' : 'var(--text-muted)'),
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {i + 1}
              </div>

              {/* Street name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {street.name}
                </div>
                <div style={{
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  marginTop: '1px',
                }}>
                  {street.segments} seg / {street.points} pts
                </div>
              </div>

              {/* Score */}
              <div style={{
                fontSize: '16px',
                fontWeight: 700,
                color: scoreColor(street[dim]),
                flexShrink: 0,
              }}>
                {(street[dim] || 0).toFixed(1)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
