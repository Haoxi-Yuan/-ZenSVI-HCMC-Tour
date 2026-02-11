import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSimilarStreets } from '../hooks/useInsights'

const DIMS = ['combined', 'safety', 'accessibility', 'comfort']
const DIM_LABELS = {
  combined: 'Combined',
  walkability: 'Walkability',
  safety: 'Safety',
  accessibility: 'Accessibility',
  comfort: 'Comfort',
}

/**
 * SimilarStreets — Shows similar streets with dimension tab switcher.
 */
export default function SimilarStreets({ streetName }) {
  const [activeDim, setActiveDim] = useState('combined')
  const { data, loading } = useSimilarStreets(streetName, activeDim, 5)

  const streets = data?.similar || []

  return (
    <div>
      {/* Dimension tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '20px',
        flexWrap: 'wrap',
      }}>
        {DIMS.map(dim => (
          <button
            key={dim}
            onClick={() => setActiveDim(dim)}
            style={{
              padding: '6px 14px',
              fontSize: '10px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: activeDim === dim ? 600 : 400,
              color: activeDim === dim ? 'var(--text-primary)' : 'var(--text-muted)',
              background: activeDim === dim ? 'rgba(245, 240, 232, 0.08)' : 'transparent',
              border: `1px solid ${activeDim === dim ? 'rgba(245, 240, 232, 0.15)' : 'rgba(245, 240, 232, 0.06)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: "'Be Vietnam Pro', sans-serif",
            }}
          >
            {DIM_LABELS[dim]}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '16px 0' }}>
          Finding similar streets...
        </div>
      )}

      {/* Results */}
      {!loading && streets.length === 0 && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '16px 0' }}>
          No similar streets found.
        </div>
      )}

      {!loading && streets.map((s, i) => (
        <Link
          key={s.name}
          to={`/summary/${encodeURIComponent(s.name)}`}
          style={{
            display: 'block',
            padding: '12px 0',
            borderBottom: i < streets.length - 1 ? '1px solid rgba(245, 240, 232, 0.04)' : 'none',
            textDecoration: 'none',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}>
            <span style={{
              fontSize: '13px',
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}>
              {s.name}
            </span>
            <span style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              fontFamily: "'Be Vietnam Pro', sans-serif",
            }}>
              dist: {s.distance.toFixed(3)}
            </span>
          </div>

          {/* Delta chips */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {Object.entries(s.deltas).map(([dim, delta]) => {
              const val = parseFloat(delta)
              const chipColor = val > 0.1 ? 'var(--accent-green)'
                : val < -0.1 ? 'var(--accent-orange)'
                : 'var(--text-muted)'
              return (
                <span key={dim} style={{
                  fontSize: '10px',
                  color: chipColor,
                  background: 'rgba(245, 240, 232, 0.04)',
                  padding: '2px 8px',
                  letterSpacing: '0.04em',
                }}>
                  {dim.slice(0, 3)}: {delta}
                </span>
              )
            })}
          </div>

          {/* Score row */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
            {['safety', 'accessibility', 'comfort'].map(d => (
              <span key={d} style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
              }}>
                {d.slice(0, 3)}: {s.scores[d]?.toFixed(1)}
              </span>
            ))}
          </div>
        </Link>
      ))}
    </div>
  )
}
