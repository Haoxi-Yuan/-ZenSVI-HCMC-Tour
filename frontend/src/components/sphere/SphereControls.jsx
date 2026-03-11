/**
 * SphereControls — dimension picker + color legend for PerceptionSphere.
 */

import { PERCEPTION_DIMS, DIM_CONFIG, legendGradient } from '../../utils/sphereConstants'

export default function SphereControls({
  activeDim,
  onDimChange,
  restViewMode = 'orbit',
  onRestViewModeChange = null,
}) {
  const handleClick = (dim) => {
    onDimChange(activeDim === dim ? null : dim)
  }

  const config = activeDim ? DIM_CONFIG[activeDim] : null

  return (
    <div className="sphere-controls">
      <div className="sphere-dim-picker">
        <div className="sphere-dim-label">Perception</div>

        <button
          className={`sphere-dim-btn ${!activeDim ? 'active' : ''}`}
          onClick={() => onDimChange(null)}
        >
          <span
            className="sphere-dim-dot"
            style={{ background: !activeDim ? '#F5F0E8' : '#6B6358' }}
          />
          Natural Colors
        </button>

        {PERCEPTION_DIMS.map((dim) => {
          const isActive = activeDim === dim
          const c = DIM_CONFIG[dim]
          return (
            <button
              key={dim}
              className={`sphere-dim-btn ${isActive ? 'active' : ''}`}
              onClick={() => handleClick(dim)}
            >
              <span
                className="sphere-dim-dot"
                style={{
                  background: isActive ? '#3DBB78'
                    : c.inverted ? '#E8734A' : '#3DBB78',
                  opacity: isActive ? 1 : 0.4,
                }}
              />
              {c.label}
            </button>
          )
        })}
      </div>

      {activeDim && config && (
        <div className="sphere-legend">
          <div className="sphere-dim-label">{config.label}</div>
          <div
            className="sphere-legend-bar"
            style={{ background: legendGradient(config.inverted) }}
          />
          <div className="sphere-legend-labels">
            <span>{config.inverted ? 'Less' : 'Low'}</span>
            <span>{config.inverted ? 'More' : 'High'}</span>
          </div>
        </div>
      )}

      {onRestViewModeChange && (
        <div className="sphere-rest-view">
          <div className="sphere-dim-label">Rest Camera</div>
          <div className="sphere-rest-view-row">
            <button
              className={`sphere-rest-view-btn ${restViewMode === 'orbit' ? 'active' : ''}`}
              onClick={() => onRestViewModeChange('orbit')}
            >
              Orbit Outside
            </button>
            <button
              className={`sphere-rest-view-btn ${restViewMode === 'core' ? 'active' : ''}`}
              onClick={() => onRestViewModeChange('core')}
            >
              Core Inside
            </button>
          </div>
          <div className="sphere-rel-legend">
            <div className="sphere-rel-legend-item">
              <span className="sphere-rel-dot strong" />
              Strong relation (Top tier)
            </div>
            <div className="sphere-rel-legend-item">
              <span className="sphere-rel-dot mid" />
              Medium relation
            </div>
            <div className="sphere-rel-legend-item">
              <span className="sphere-rel-dot weak" />
              Weak but relevant context
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
