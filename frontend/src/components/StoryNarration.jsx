/**
 * StoryNarration — Bottom card showing story progress, narration text, and controls.
 */
export default function StoryNarration({ shots, currentIndex, phase, onPause, onResume, onSkip, onExit }) {
  if (!shots || shots.length === 0) return null

  const current = shots[currentIndex] || shots[0]
  const isPlaying = phase === 'PLAYING'
  const isPaused = phase === 'PAUSED'
  const isEnded = phase === 'ENDED'

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
