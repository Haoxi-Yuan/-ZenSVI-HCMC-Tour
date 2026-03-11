/**
 * SphereHUD — floating tooltip for hovered sphere point.
 *
 * Shows point index and perception scores from the local Float32Array.
 */

import { PERCEPTION_DIMS, DIM_CONFIG } from '../../utils/sphereConstants'

export default function SphereHUD({ pointIdx, screenPos, perceptionScores, volunteerMatch = null }) {
  if (pointIdx == null || !screenPos || !perceptionScores) return null

  // Extract scores for this point
  const scores = PERCEPTION_DIMS.map((dim, i) => ({
    label: DIM_CONFIG[dim].label,
    value: perceptionScores[pointIdx * 6 + i],
  }))

  return (
    <div
      className="sphere-hud"
      style={{
        left: screenPos.x,
        top: screenPos.y - 16,
      }}
    >
      <div className="sphere-hud-card">
        <div className="sphere-hud-idx">Point #{pointIdx.toLocaleString()}</div>
        {volunteerMatch && (
          <div className="sphere-hud-volunteer">
            <div className="sphere-hud-volunteer-tag">Volunteer Anchor</div>
            <div className="sphere-hud-volunteer-meta">
              {volunteerMatch.volunteer} · {volunteerMatch.session}
            </div>
            {volunteerMatch.volunteer_image && (
              <img
                className="sphere-hud-volunteer-img"
                src={`/api/sphere/volunteers/image/${volunteerMatch.volunteer_image}`}
                alt="Volunteer"
              />
            )}
            {volunteerMatch.note && (
              <div className="sphere-hud-volunteer-note">"{volunteerMatch.note}"</div>
            )}
            <div className="sphere-hud-volunteer-hint">Click this tile to fly in</div>
          </div>
        )}
        <div className="sphere-hud-scores">
          {scores.map((s) => (
            <div key={s.label} className="sphere-hud-score">
              <span className="sphere-hud-score-label">{s.label}</span>
              <span className="sphere-hud-score-value">{s.value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
