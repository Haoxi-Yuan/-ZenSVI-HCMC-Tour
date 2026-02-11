import { useState } from 'react'

function StoryEvidence({ ev }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={`evidence-thumb ${ev.label === 'best' ? 'best' : ev.label === 'worst' ? 'worst' : 'transition'}`}
      style={{ width: '80px', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {ev.thumbnail_url && (
        <img src={ev.thumbnail_url} alt={`Evidence ${ev.id}`} loading="lazy" />
      )}
      <span className="evidence-label">{ev.id}</span>
      {hovered && (
        <div className="evidence-tooltip" style={{ width: '220px', bottom: 'calc(100% + 6px)' }}>
          <div style={{ fontSize: '10px', color: 'var(--accent-green)', fontWeight: 600, marginBottom: '4px' }}>
            {ev.id} / {ev.label}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {ev.description}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * StoryNarration — Bottom card showing story progress, narration text, and controls.
 */
export default function StoryNarration({
  shots,
  currentIndex,
  phase,
  shotImages = [],
  imageLoading = false,
  canEnterTour = false,
  onEnterTour,
  onPause,
  onResume,
  onSkip,
  onExit,
}) {
  if (!shots || shots.length === 0) return null

  const current = shots[currentIndex] || shots[0]
  const isPlaying = phase === 'PLAYING'
  const isPaused = phase === 'PAUSED'
  const isEnded = phase === 'ENDED'
  const evidence = current.scene_evidence || []

  return (
    <div className="story-narration">
      {/* Progress dots */}
      <div className="story-progress">
        {shots.map((_, i) => (
          <div
            key={i}
            className={`story-dot ${i < currentIndex ? 'done' : i === currentIndex ? 'active' : ''}`}
          />
        ))}
      </div>

      {/* Theme label */}
      <div className="story-theme">
        {current.theme}
        {current.street_name && (
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 400 }}>
            {current.street_name}
          </span>
        )}
      </div>

      {/* Narration text */}
      <div className="story-text">
        {current.narration || 'Loading narration...'}
      </div>

      {current.street_name && (
        <div style={{ marginTop: '10px' }}>
          <div style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '6px',
          }}>
            Street Evidence / Map marker shows this street position
          </div>

          {evidence.length > 0 ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              {evidence.map(ev => (
                <StoryEvidence key={ev.id} ev={ev} />
              ))}
            </div>
          ) : imageLoading ? (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Loading street-view snapshots...
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '6px' }}>
              {shotImages.map((url, idx) => (
                <img
                  key={`${url}-${idx}`}
                  src={url}
                  alt={`Story shot reference ${idx + 1}`}
                  style={{
                    width: '92px',
                    height: '52px',
                    objectFit: 'cover',
                    border: '1px solid rgba(245, 240, 232, 0.15)',
                    opacity: 0.9,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="story-controls">
        {isPlaying && (
          <button className="story-btn" onClick={onPause}>
            Pause
          </button>
        )}
        {isPaused && (
          <button className="story-btn" onClick={onResume}>
            Resume
          </button>
        )}
        {(isPlaying || isPaused) && (
          <button className="story-btn" onClick={onSkip}>
            Skip
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ marginLeft: '4px' }}>
              <path d="M3 2l4 3-4 3" />
            </svg>
          </button>
        )}
        {isEnded && (
          <button className="story-btn" onClick={() => { /* could restart */ onExit() }}>
            Replay or Explore
          </button>
        )}
        {canEnterTour && (
          <button className="story-btn" onClick={onEnterTour}>
            Enter Tour
          </button>
        )}
        <button className="story-btn exit" onClick={onExit}>
          Exit
        </button>

        {/* Shot counter */}
        <span style={{
          marginLeft: 'auto',
          fontSize: '9px',
          color: 'var(--text-muted)',
          letterSpacing: '0.06em',
          alignSelf: 'center',
        }}>
          {currentIndex + 1} / {shots.length}
        </span>
      </div>
    </div>
  )
}
