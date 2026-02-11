/**
 * Progress bar with no border-radius, matching the design spec.
 */
export default function ProgressBar({ label, value, maxValue, unit = '', color }) {
  const pct = Math.min(100, Math.max(0, (value / maxValue) * 100))
  const barColor = color || (pct >= 65 ? 'var(--accent-green)' : pct >= 40 ? 'var(--accent-gold)' : 'var(--accent-orange)')

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '4px',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit}
        </span>
      </div>
      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{
            width: `${pct}%`,
            background: barColor,
          }}
        />
      </div>
    </div>
  )
}
