/**
 * ResonancePanel — similarity slider and bloom trigger for Phase 4.
 *
 * Spec §2.4: "系统提供一个滑块（slider），让用户调节相似性阈值。"
 */

import { useSphere, PHASES } from '../../contexts/SphereContext'
import { PERCEPTION_DIMS, DIM_CONFIG } from '../../utils/sphereConstants'

export default function ResonancePanel() {
  const { state, dispatch } = useSphere()
  const {
    phase, resonanceEnabled, resonanceThreshold,
    activeDim, similarFaces, selectedIdx, isResonanceLoading,
  } = state

  if (phase !== PHASES.STANDSTILL) return null

  return (
    <div className="resonance-panel">
      <div className="resonance-header">
        <label className="resonance-toggle">
          <input
            type="checkbox"
            checked={resonanceEnabled}
            onChange={(e) => dispatch({ type: 'SET_RESONANCE_ENABLED', enabled: e.target.checked })}
          />
          <span>Sympathetic Resonance</span>
        </label>
      </div>

      {resonanceEnabled && (
        <>
          <div className="resonance-dim-picker">
            {PERCEPTION_DIMS.map((dim) => (
              <button
                key={dim}
                className={`resonance-dim-btn ${activeDim === dim ? 'active' : ''}`}
                onClick={() => dispatch({ type: 'SET_DIM', dim })}
              >
                {DIM_CONFIG[dim].label}
              </button>
            ))}
          </div>

          <div className="resonance-slider-row">
            <label>Threshold</label>
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.01"
              value={resonanceThreshold}
              onChange={(e) => dispatch({
                type: 'SET_RESONANCE_THRESHOLD',
                threshold: parseFloat(e.target.value),
              })}
            />
            <span>{resonanceThreshold.toFixed(2)}</span>
          </div>

          <div className="resonance-count">
            {isResonanceLoading ? (
              <span className="resonance-loading">Searching patterns...</span>
            ) : (
              <>
                {similarFaces.length} resonating face{similarFaces.length !== 1 ? 's' : ''}
                {similarFaces.length === 0 && resonanceEnabled && (
                  <div className="resonance-hint">Try lowering the threshold</div>
                )}
              </>
            )}
          </div>

          <button
            className="resonance-bloom-btn"
            disabled={similarFaces.length === 0 || isResonanceLoading}
            onClick={() => dispatch({ type: 'TRIGGER_BLOOM' })}
          >
            {isResonanceLoading ? 'Computing...' : 'Bloom to Map'}
          </button>
        </>
      )}
    </div>
  )
}
