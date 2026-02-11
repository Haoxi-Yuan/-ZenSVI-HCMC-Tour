import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStreetSearch } from '../hooks/useStreetData'

function scoreColor(score) {
  if (score >= 5.5) return 'var(--accent-green)'
  if (score >= 4.5) return 'var(--accent-gold)'
  return 'var(--accent-orange)'
}

export default function StreetSearch({ onSelect, placeholder = 'Search streets...' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const { results } = useStreetSearch(query)
  const navigate = useNavigate()
  const ref = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (street) => {
    setQuery('')
    setOpen(false)
    if (onSelect) {
      onSelect(street)
    } else {
      navigate(`/tour/${encodeURIComponent(street.name)}`)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'var(--bg-card)',
          border: '1px solid rgba(245, 240, 232, 0.1)',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          fontSize: '14px',
          outline: 'none',
          borderRadius: 0,
          transition: 'border-color 0.3s',
        }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--bg-card)',
          border: '1px solid rgba(245, 240, 232, 0.1)',
          borderTop: 'none',
          maxHeight: '300px',
          overflowY: 'auto',
          zIndex: 100,
        }}>
          {results.map((street) => (
            <div
              key={street.name}
              onClick={() => handleSelect(street)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(245, 240, 232, 0.04)',
                transition: 'background 0.2s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 240, 232, 0.04)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500 }}>{street.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                  {street.segments} segments / {street.points} points
                </div>
              </div>
              <div style={{
                fontSize: '18px',
                fontWeight: 700,
                color: scoreColor(street.walkability),
              }}>
                {street.walkability.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
