/**
 * PercentileBar — Shows a street's percentile rank on a horizontal bar.
 * No border-radius (project design constraint).
 */
export default function PercentileBar({ label, score, rank, percentile, total, rankLabel }) {
  const color = percentile >= 75 ? 'var(--accent-green)'
    : percentile >= 40 ? 'var(--accent-gold)'
    : 'var(--accent-orange)'

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '6px',
      }}>
        <span style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 500,
        }}>
          {label}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color }}>
          {score.toFixed(1)}
          <span style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            marginLeft: '8px',
            fontWeight: 400,
          }}>
            #{rank.toLocaleString()} / {total.toLocaleString()}
          </span>
        </span>
      </div>

      <div style={{
        position: 'relative',
        width: '100%',
        height: '6px',
        background: 'rgba(245, 240, 232, 0.06)',
      }}>
        <div style={{
          width: `${percentile}%`,
          height: '100%',
          background: color,
          opacity: 0.25,
          transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
        <div style={{
          position: 'absolute',
          left: `${percentile}%`,
          top: '-3px',
          width: '2px',
          height: '12px',
          background: color,
          transition: 'left 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
        {/* City median marker at 50% */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '-2px',
          width: '1px',
          height: '10px',
          background: 'rgba(245, 240, 232, 0.15)',
        }} />
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '4px',
      }}>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
          {rankLabel}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
          {percentile.toFixed(0)}th percentile
        </span>
      </div>
    </div>
  )
}
