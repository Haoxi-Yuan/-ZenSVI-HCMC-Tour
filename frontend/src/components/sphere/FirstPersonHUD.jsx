/**
 * FirstPersonHUD — overlay shown during Phase 2-3 with point info and controls.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSphere, PHASES } from '../../contexts/SphereContext'
import { PERCEPTION_DIMS, DIM_CONFIG } from '../../utils/sphereConstants'
import SphereMacroMiniMap from './SphereMacroMiniMap'

function extractHeading(filename) {
  const m = /head(\d{3})/i.exec(filename || '')
  return m ? Number(m[1]) : 999
}

export default function FirstPersonHUD({ onExit, positions, volunteerMatchesByIdx = {} }) {
  const { state, dispatch } = useSphere()
  const { selectedIdx, pointDetail, activeDim, walkMode, phase, neighbors } = state
  const [galleryCollapsed, setGalleryCollapsed] = useState(false)
  const [volunteerRotIdx, setVolunteerRotIdx] = useState(0)
  const [volunteerSpinTurn, setVolunteerSpinTurn] = useState(0)
  const neighborIndices = (neighbors || [])
    .map((n) => n.idx)
    .filter((idx) => Number.isInteger(idx))
  const galleryItems = useMemo(() => {
    if (!pointDetail?.district || !pointDetail?.folder) return []
    const files = Array.isArray(pointDetail.image_filenames) ? pointDetail.image_filenames : []
    const picked = files.length
      ? [...files].sort((a, b) => extractHeading(a) - extractHeading(b)).slice(0, 4)
      : []

    return picked.map((filename) => ({
      filename,
      heading: extractHeading(filename),
      url: `/api/images/${pointDetail.district}/${pointDetail.folder}/${filename}`,
    }))
  }, [pointDetail])

  const volunteerRecords = useMemo(() => {
    if (selectedIdx == null) return []
    return volunteerMatchesByIdx[selectedIdx] || []
  }, [selectedIdx, volunteerMatchesByIdx])

  useEffect(() => {
    setVolunteerRotIdx(0)
    setVolunteerSpinTurn(0)
  }, [selectedIdx, volunteerRecords.length])

  useEffect(() => {
    if (volunteerRecords.length <= 1) return undefined
    const timer = setInterval(() => {
      setVolunteerRotIdx((i) => (i + 1) % volunteerRecords.length)
      setVolunteerSpinTurn((t) => t + 1)
    }, 3000)
    return () => clearInterval(timer)
  }, [volunteerRecords.length])

  const activeVolunteer = volunteerRecords.length
    ? volunteerRecords[volunteerRotIdx % volunteerRecords.length]
    : null

  return (
    <div className="fp-hud">
      {/* Top-left: point info */}
      <div className="fp-hud-info">
        <div className="fp-hud-label">Point #{selectedIdx?.toLocaleString()}</div>
        {pointDetail && (
          <>
            <div className="fp-hud-detail">{pointDetail.district_name}</div>
            <div className="fp-hud-detail">
              {pointDetail.lat?.toFixed(4)}, {pointDetail.lon?.toFixed(4)}
            </div>
          </>
        )}
        {pointDetail?.perception && (
          <div className="fp-hud-score">
            {DIM_CONFIG[activeDim]?.label}: {pointDetail.perception[activeDim]?.toFixed(2)}
          </div>
        )}
        <SphereMacroMiniMap
          lat={pointDetail?.lat}
          lon={pointDetail?.lon}
        />
      </div>

      {/* Top-right: exit button */}
      <button className="fp-hud-exit" onClick={onExit} title="Return to sphere view">
        Exit
      </button>

      {/* Right: original high-res 4-angle imagery */}
      <div className={`fp-hud-gallery ${galleryCollapsed ? 'collapsed' : ''}`}>
        <div className="fp-hud-gallery-header">
          <div className="fp-hud-gallery-title">Original 4 Angles</div>
          <button
            className="fp-hud-gallery-toggle"
            onClick={() => setGalleryCollapsed(v => !v)}
            title={galleryCollapsed ? 'Expand image panel' : 'Collapse image panel'}
          >
            {galleryCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {!galleryCollapsed && (
          <>
            {galleryItems.length > 0 ? (
              <div className="fp-hud-gallery-list">
                {galleryItems.map((item) => (
                  <a
                    key={item.filename}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="fp-hud-gallery-item"
                    title={`Heading ${item.heading}\u00b0`}
                  >
                    <img
                      src={item.url}
                      alt={`Heading ${item.heading}\u00b0`}
                      className="fp-hud-gallery-img"
                      loading="eager"
                      decoding="async"
                    />
                    <span className="fp-hud-gallery-badge">{item.heading}\u00b0</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="fp-hud-gallery-empty">No raw images for this point.</div>
            )}
          </>
        )}
      </div>

      {/* Right-bottom: volunteer record panel (auto-rotating) */}
      {activeVolunteer && (
        <div className="fp-volunteer-prayer">
          <div className="fp-volunteer-prayer-header">
            <div className="fp-volunteer-prayer-title">Volunteer Record</div>
            <div className="fp-volunteer-prayer-count">
              {volunteerRotIdx + 1}/{volunteerRecords.length}
            </div>
          </div>
          <div
            className="fp-volunteer-prayer-wheel"
            style={{ transform: `rotateY(${volunteerSpinTurn * 360}deg)` }}
          >
            {activeVolunteer.volunteer_image ? (
              <img
                src={`/api/sphere/volunteers/image/${activeVolunteer.volunteer_image}`}
                alt="Volunteer record"
                className="fp-volunteer-prayer-img"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="fp-volunteer-prayer-empty">No volunteer photo</div>
            )}
          </div>
          <div className="fp-volunteer-prayer-meta">
            {activeVolunteer.volunteer} · {activeVolunteer.session}
          </div>
          <div className="fp-volunteer-prayer-note">
            {activeVolunteer.note ? `"${activeVolunteer.note}"` : 'No note for this shot.'}
          </div>
        </div>
      )}

      {/* Bottom-center: walk mode + dimension picker */}
      <div className="fp-hud-controls">
        <div className="fp-hud-walk-mode">
          <button
            className={`fp-hud-mode-btn ${walkMode === 'topological' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_WALK_MODE', mode: 'topological' })}
          >
            Walk
          </button>
          <button
            className={`fp-hud-mode-btn ${walkMode === 'jump' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_WALK_MODE', mode: 'jump' })}
          >
            Jump
          </button>
        </div>
        <div className="fp-hud-dims">
          {PERCEPTION_DIMS.map((dim) => (
            <button
              key={dim}
              className={`fp-hud-dim-btn ${activeDim === dim ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_DIM', dim })}
            >
              {DIM_CONFIG[dim].label}
            </button>
          ))}
        </div>
        {phase === PHASES.STANDSTILL && (
          <div className="fp-hud-hint">Arrow keys to walk &middot; Shift+Space to toggle mode</div>
        )}
      </div>
    </div>
  )
}
