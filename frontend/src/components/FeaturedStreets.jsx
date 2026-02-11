import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function scoreColor(score) {
  if (score >= 5.5) return 'var(--accent-green)'
  if (score >= 4.5) return 'var(--accent-gold)'
  return 'var(--accent-orange)'
}

export default function FeaturedStreets() {
  const [streets, setStreets] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/streets/featured')
      .then(r => r.json())
      .then(data => setStreets(data.featured || []))
      .catch(console.error)
  }, [])

  if (streets.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {streets.map(street => (
        <div
          key={street.name}
          onClick={() => navigate(`/tour/${encodeURIComponent(street.name)}`)}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(245, 240, 232, 0.06)',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.3s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(245, 240, 232, 0.15)'
            e.currentTarget.style.background = 'rgba(36, 32, 25, 0.9)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(245, 240, 232, 0.06)'
            e.currentTarget.style.background = 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {street.name}
            </span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: scoreColor(street.walkability), flexShrink: 0, marginLeft: '8px' }}>
              {street.walkability.toFixed(1)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{
              fontSize: '9px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: street.gradient === 'ascending' ? 'var(--accent-green)' : 'var(--accent-orange)',
              background: street.gradient === 'ascending' ? 'rgba(61, 187, 120, 0.12)' : 'rgba(232, 115, 74, 0.12)',
              padding: '2px 6px',
            }}>
              {street.gradient === 'ascending' ? '\u25B2' : '\u25BC'} {street.tag}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              {street.points} pts
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {street.description}
          </div>
        </div>
      ))}
    </div>
  )
}
