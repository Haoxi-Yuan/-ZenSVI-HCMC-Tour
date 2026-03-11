/**
 * PerceptionSphere — page component orchestrating all 5 phases.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import Navbar from '../components/Navbar'
import SphereRenderer from '../components/sphere/SphereRenderer'
import SphereControls from '../components/sphere/SphereControls'
import SphereHUD from '../components/sphere/SphereHUD'
import SynapseNetwork from '../components/sphere/SynapseNetwork'
import FirstPersonHUD from '../components/sphere/FirstPersonHUD'
import ResonancePanel from '../components/sphere/ResonancePanel'
import WalkIndicators from '../components/sphere/WalkIndicators'
import BloomMapView from '../components/sphere/BloomMapView'
import ShapBeeswarm from '../components/sphere/ShapBeeswarm'
import { SphereProvider, useSphere, PHASES } from '../contexts/SphereContext'
import { useSphereData } from '../hooks/useSphereData'
import { useSphereApi } from '../hooks/useSphereApi'
import FLAGS from '../utils/featureFlags'

const RELATION_TOP_N = 64

export default function PerceptionSphere() {
  return (
    <SphereProvider>
      <div className="sphere-page">
        <Navbar />
        <SphereContent />
      </div>
    </SphereProvider>
  )
}

function SphereContent() {
  const { state, dispatch, engineRef } = useSphere()
  const {
    metadata, positions, colorBlocks, perceptionScores, atlasData,
    loading, error, progress,
  } = useSphereData()
  const api = useSphereApi()
  const prevShapRef = useRef(null)
  const restRelationTargetRef = useRef(null)
  const [volunteerByIdx, setVolunteerByIdx] = useState({})
  const [volunteerMatchesByIdx, setVolunteerMatchesByIdx] = useState({})
  const [selectedVolunteerAnchor, setSelectedVolunteerAnchor] = useState(null)
  const [restRelationCenterIdx, setRestRelationCenterIdx] = useState(null)
  const [restRelationFaces, setRestRelationFaces] = useState([])
  const [restViewMode, setRestViewMode] = useState('orbit')
  const volunteerAnchorList = useMemo(
    () => Object.values(volunteerByIdx).sort((a, b) => {
      const v = String(a.volunteer || '').localeCompare(String(b.volunteer || ''))
      if (v !== 0) return v
      const s = String(a.session || '').localeCompare(String(b.session || ''))
      if (s !== 0) return s
      return (a.matched_point_idx ?? 0) - (b.matched_point_idx ?? 0)
    }),
    [volunteerByIdx],
  )

  // Load volunteer data and set sphere anchors
  useEffect(() => {
    if (!positions) return

    let canceled = false

    const attachWhenReady = (matches) => {
      const tryAttach = () => {
        if (canceled) return
        const refs = engineRef.current
        if (!refs?.volunteerAnchors || !refs?.geodesic) {
          requestAnimationFrame(tryAttach)
          return
        }
        refs.volunteerAnchors.setAnchorClickHandler((match) => {
          setSelectedVolunteerAnchor(match || null)
        })
        refs.volunteerAnchors.setVolunteers(matches, positions, refs.geodesic.cellRadius)
      }
      tryAttach()
    }

    api.fetchVolunteers().then(data => {
      if (!data?.matches?.length) return
      const grouped = {}
      for (const m of data.matches) {
        const idx = m?.matched_point_idx
        if (idx == null) continue
        if (!grouped[idx]) grouped[idx] = []
        grouped[idx].push(m)
      }
      for (const idx of Object.keys(grouped)) {
        grouped[idx].sort((a, b) => {
          const ta = Date.parse(a?.timestamp || '') || 0
          const tb = Date.parse(b?.timestamp || '') || 0
          return ta - tb
        })
      }
      const primaryByIdx = {}
      for (const [idx, arr] of Object.entries(grouped)) {
        let best = arr[0]
        for (const m of arr) {
          const preferCurrent = !best
            || (!best.note && !!m.note)
            || (
              (!!best.note === !!m.note)
              && (Number(m.match_distance_m) || Infinity) < (Number(best.match_distance_m) || Infinity)
            )
          if (preferCurrent) best = m
        }
        if (best) primaryByIdx[idx] = best
      }
      setVolunteerMatchesByIdx(grouped)
      setVolunteerByIdx(primaryByIdx)
      attachWhenReady(data.matches)
    }).catch(() => null)

    return () => {
      canceled = true
    }
  }, [positions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.phase !== PHASES.REST) {
      setSelectedVolunteerAnchor(null)
    }
  }, [state.phase])

  // Phase transition: CLICK_FACE → fly camera in → STANDSTILL
  useEffect(() => {
    if (state.phase !== PHASES.FLYING_IN || state.selectedIdx === null) return
    const refs = engineRef.current
    if (!refs) return

    const { geodesic, cameraCtrl, streetView, avatar, synapse3D, volunteerAnchors, topology } = refs
    const idx = state.selectedIdx
    const facePos = geodesic.getFacePosition(idx)
    const faceNormal = geodesic.getFaceNormal(idx)

    // Set default dimension for SHAP display if not set
    if (!state.activeDim) dispatch({ type: 'SET_DIM', dim: 'safer' })

    // Hide the base geodesic shell in first-person to avoid interior overdraw artifacts.
    geodesic.setShellVisible(false)
    geodesic.setSphereOpacity(0.0)
    if (volunteerAnchors) volunteerAnchors.hide()
    if (topology) topology.hide()
    // Disable hover during flight
    geodesic.callbacks.onPointClick = null

    cameraCtrl.flyToFace(facePos, faceNormal, () => {
      dispatch({ type: 'FLY_IN_COMPLETE' })
      // Show street view and avatar after landing
      if (streetView) streetView.show()
      if (avatar) { avatar.setFace(facePos, faceNormal); avatar.show() }
      // Show 3D synapse network above avatar
      if (synapse3D) synapse3D.show(facePos, faceNormal)
    })

    // Fetch data for the selected point
    api.fetchShapAll(idx).then(data => dispatch({ type: 'SET_SHAP_DATA', data }))
    api.fetchNeighbors(idx).then(data => dispatch({ type: 'SET_NEIGHBORS', neighbors: data.neighbors || [] }))
    // Fetch point detail and start loading panorama
    api.fetchPointDetail(idx).then(data => {
      dispatch({ type: 'SET_POINT_DETAIL', detail: data })
      if (streetView) streetView.loadPanorama(idx, data, facePos, faceNormal)
    })
  }, [state.phase, state.selectedIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase transition: EXIT_TO_REST → fly camera out → REST
  const handleExit = useCallback(() => {
    const refs = engineRef.current
    if (!refs) return
    const { geodesic, cameraCtrl, streetView, avatar, synapse3D, volunteerAnchors, topology } = refs

    // Hide street view panorama, avatar, and 3D synapse
    if (streetView) streetView.hide()
    if (avatar) avatar.hide()
    if (synapse3D) synapse3D.hide()

    cameraCtrl.flyToOrbit(() => {
      geodesic.setShellVisible(true)
      geodesic.setSphereOpacity(1.0)
      geodesic.setHighlightedFaces(null)
      // Re-enable hover click
      geodesic.callbacks.onPointClick = (idx) => dispatch({ type: 'CLICK_FACE', idx })
      // Restore volunteer anchors and topology
      if (volunteerAnchors) volunteerAnchors.show()
      if (topology) topology.show()
    })
    dispatch({ type: 'EXIT_TO_REST' })
  }, [dispatch, engineRef])

  // Phase transition: WALK_TO → animate camera → WALK_COMPLETE
  useEffect(() => {
    if (state.phase !== PHASES.WALKING || state.previousIdx === null) return
    const refs = engineRef.current
    if (!refs) return

    const { geodesic, cameraCtrl, streetView, avatar, synapse3D } = refs
    const fromPos = geodesic.getFacePosition(state.previousIdx)
    const toPos = geodesic.getFacePosition(state.selectedIdx)
    const toNormal = geodesic.getFaceNormal(state.selectedIdx)

    if (state.walkMode === 'jump') {
      // During jump, temporarily reveal macro sphere and hide first-person overlays
      // so the user can see the city-scale traversal arc.
      geodesic.setShellVisible(true)
      geodesic.setSphereOpacity(0.95)
      if (streetView) streetView.hide()
      if (avatar) avatar.hide()
      if (synapse3D) synapse3D.hide()

      cameraCtrl.jumpToFace(fromPos, toPos, () => {
        geodesic.setShellVisible(false)
        geodesic.setSphereOpacity(0.0)
        if (streetView) streetView.show()
        if (avatar) {
          avatar.setFace(toPos, toNormal)
          avatar.show()
        }
        if (synapse3D) {
          synapse3D.moveTo(toPos, toNormal)
          synapse3D.show(toPos, toNormal)
        }
        dispatch({ type: 'WALK_COMPLETE' })
      })
    } else {
      // Reposition avatar and synapse network at new face
      if (avatar) avatar.setFace(toPos, toNormal)
      if (synapse3D) synapse3D.moveTo(toPos, toNormal)
      cameraCtrl.walkToFace(fromPos, toPos, () => {
        dispatch({ type: 'WALK_COMPLETE' })
      })
    }

    // Fetch data for new point
    api.fetchShapAll(state.selectedIdx).then(data => dispatch({ type: 'SET_SHAP_DATA', data }))
    api.fetchNeighbors(state.selectedIdx).then(data => dispatch({ type: 'SET_NEIGHBORS', neighbors: data.neighbors || [] }))
    // Fetch point detail and update panorama
    api.fetchPointDetail(state.selectedIdx).then(data => {
      dispatch({ type: 'SET_POINT_DETAIL', detail: data })
      if (streetView) streetView.loadPanorama(state.selectedIdx, data, toPos, toNormal)
    })
  }, [state.phase, state.selectedIdx, state.previousIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // 3D Synapse + Perception Shake: update when SHAP data or active dimension changes
  useEffect(() => {
    const refs = engineRef.current
    if (!refs || !state.shapData || !state.activeDim) return
    const dimData = state.shapData.dimensions?.[state.activeDim]
    if (!dimData) return

    if (refs.synapse3D) refs.synapse3D.setShapData(state.shapData, state.activeDim, state.pointDetail?.features)

    // Compute SHAP delta and trigger perception shake if large enough
    const contributions = dimData.contributions || []
    if (prevShapRef.current) {
      const prevMap = new Map(prevShapRef.current.map(c => [c.feature, c.shap_value]))
      let delta = 0
      for (const c of contributions) {
        delta += Math.abs(c.shap_value - (prevMap.get(c.feature) || 0))
      }
      if (delta >= 2.0 && refs.engine.shakePass) {
        refs.engine.shakePass.trigger(Math.min(1, delta / 3))
      }
    }
    prevShapRef.current = contributions
  }, [state.shapData, state.activeDim, state.pointDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Neighbor projection: show thumbnails for adjacent faces
  useEffect(() => {
    const refs = engineRef.current
    if (!refs?.neighborProj || !positions) return
    const isInside = state.phase === PHASES.STANDSTILL || state.phase === PHASES.WALKING
    if (isInside && state.neighbors.length && state.selectedIdx !== null) {
      refs.neighborProj.show(state.selectedIdx, state.neighbors, positions)
    } else {
      refs.neighborProj.hide()
    }
  }, [state.neighbors, state.selectedIdx, state.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resonance: update highlighted faces when threshold/dim changes
  useEffect(() => {
    if (!state.resonanceEnabled || state.selectedIdx === null || !state.activeDim) return
    const refs = engineRef.current
    if (!refs) return

    api.fetchSimilar(state.selectedIdx, state.activeDim, 2000).then(data => {
      if (state.phase === PHASES.BLOOM) return // Guard against phase change during fetch
      const faces = (data.neighbors || [])
        .filter(n => n.similarity >= state.resonanceThreshold)
      dispatch({ type: 'SET_SIMILAR_FACES', faces })
      refs.geodesic.setHighlightedFaces(faces.map(f => f.idx))
    }).catch(err => {
      console.warn('Similarity search unavailable:', err.message)
      dispatch({ type: 'SET_SIMILAR_FACES', faces: [] })
      dispatch({ type: 'SET_RESONANCE_LOADING', loading: false })
    })
  }, [state.resonanceEnabled, state.resonanceThreshold, state.activeDim, state.selectedIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // REST phase relation fetch (hovered/latest hovered point): show Top-N strongest associations on rotating sphere.
  useEffect(() => {
    if (state.phase !== PHASES.REST) {
      restRelationTargetRef.current = null
      setRestRelationCenterIdx(null)
      setRestRelationFaces([])
      return
    }

    if (state.hoveredPoint !== null && state.hoveredPoint !== undefined) {
      restRelationTargetRef.current = state.hoveredPoint
    }
    const centerIdx = restRelationTargetRef.current
    if (centerIdx === null || centerIdx === undefined) return

    const dim = state.activeDim || 'safer'
    let canceled = false
    const timer = setTimeout(() => {
      api.fetchSimilar(centerIdx, dim, Math.max(360, RELATION_TOP_N * 5)).then(data => {
        if (canceled) return
        const topFaces = (data?.neighbors || [])
          .slice()
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, RELATION_TOP_N)
        setRestRelationCenterIdx(centerIdx)
        setRestRelationFaces(topFaces)
      }).catch(() => {
        if (canceled) return
        setRestRelationCenterIdx(centerIdx)
        setRestRelationFaces([])
      })
    }, 140)

    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [state.phase, state.hoveredPoint, state.activeDim]) // eslint-disable-line react-hooks/exhaustive-deps

  // REST camera mode: orbit outside vs core-inside view.
  useEffect(() => {
    const refs = engineRef.current
    if (!refs?.cameraCtrl || !refs?.geodesic) return
    const inRest = state.phase === PHASES.REST
    if (inRest) {
      refs.cameraCtrl.setRestViewMode(restViewMode, true)
      refs.geodesic.setInteriorViewMode(restViewMode === 'core')
      if (refs.topology) refs.topology.setCoreInsideVisible(restViewMode === 'core')
      return
    }
    refs.cameraCtrl.setRestViewMode('orbit', false)
    refs.geodesic.setInteriorViewMode(false)
    if (refs.topology) refs.topology.setCoreInsideVisible(false)
  }, [state.phase, restViewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // When core-inside view is active, keep looking toward current relation center.
  useEffect(() => {
    const refs = engineRef.current
    if (!refs?.cameraCtrl || !refs?.geodesic) return
    const centerIdx = state.phase === PHASES.REST ? restRelationCenterIdx : state.selectedIdx
    if (centerIdx === null || centerIdx === undefined) return
    refs.cameraCtrl.setRestCoreLookAt(refs.geodesic.getFacePosition(centerIdx))
  }, [state.phase, state.selectedIdx, restRelationCenterIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear highlights when resonance disabled
  useEffect(() => {
    if (!state.resonanceEnabled) {
      const refs = engineRef.current
      if (refs) {
        refs.geodesic.setHighlightedFaces(null)
        if (refs.relationLinks) refs.relationLinks.hide()
      }
      dispatch({ type: 'SET_SIMILAR_FACES', faces: [] })
    }
  }, [state.resonanceEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // In-sphere relation links: selected face → top similar faces
  useEffect(() => {
    const refs = engineRef.current
    if (!refs?.relationLinks) return

    if (state.phase === PHASES.REST) {
      const readyRest = restRelationCenterIdx !== null && restRelationFaces.length > 0
      if (!readyRest) {
        refs.relationLinks.hide()
        return
      }
      refs.relationLinks.show(restRelationCenterIdx, restRelationFaces, RELATION_TOP_N)
      return
    }

    const insidePhase = state.phase === PHASES.STANDSTILL || state.phase === PHASES.WALKING
    if (!insidePhase || !state.resonanceEnabled || state.isResonanceLoading || state.selectedIdx === null) {
      refs.relationLinks.hide()
      return
    }
    if (!state.similarFaces.length) {
      refs.relationLinks.hide()
      return
    }
    const topFaces = state.similarFaces
      .slice()
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, RELATION_TOP_N)
    refs.relationLinks.show(state.selectedIdx, topFaces, RELATION_TOP_N)
  }, [
    state.phase,
    state.resonanceEnabled,
    state.isResonanceLoading,
    state.selectedIdx,
    state.similarFaces,
    restRelationCenterIdx,
    restRelationFaces,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase transition: TRIGGER_BLOOM → three-act bloom animation → show map
  useEffect(() => {
    if (state.phase !== PHASES.BLOOM || !state.similarFaces.length) return
    const refs = engineRef.current
    if (!refs) return

    const { geodesic, cameraCtrl, streetView, avatar, bloomAnim, synapse3D, relationLinks, topology } = refs

    // Hide street view, avatar, synapse, and topology during bloom
    if (streetView) streetView.hide()
    if (avatar) avatar.hide()
    if (synapse3D) synapse3D.hide()
    if (relationLinks) relationLinks.hide()
    if (topology) topology.hide()

    // Fetch geographic details for all similar faces (batch with concurrency limit)
    const fetchDetails = async () => {
      const details = []
      const batchSize = 10
      for (let i = 0; i < state.similarFaces.length; i += batchSize) {
        const batch = state.similarFaces.slice(i, i + batchSize)
        const results = await Promise.all(
          batch.map(f => api.fetchPointDetail(f.idx).catch(() => null))
        )
        for (const r of results) {
          if (r) details.push(r)
        }
      }
      return details
    }

    fetchDetails().then(faceDetails => {
      if (!refs || state.phase !== PHASES.BLOOM) return

      // Start bloom animation
      bloomAnim.startBloom(state.similarFaces, geodesic, faceDetails, () => {
        // Act 3 complete — map can now render underneath
        // (BloomMapView mounts because state.phase === BLOOM)
      })

      // Camera transitions to bird-eye view
      const center = new THREE.Vector3(0, -15, 0)
      cameraCtrl.flyToBirdEye(center, null)

      // Dim sphere further
      geodesic.setSphereOpacity(0.05)
    })
  }, [state.phase, state.similarFaces]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase transition: RETRACT_BLOOM → reverse bloom animation → back to STANDSTILL
  const handleRetractBloom = useCallback(() => {
    const refs = engineRef.current
    if (!refs) return

    const { geodesic, cameraCtrl, streetView, avatar, bloomAnim, synapse3D, relationLinks } = refs

    // Reverse the bloom animation
    bloomAnim.startRetract(() => {
      // Retract complete — restore sphere and first-person view
      geodesic.setShellVisible(false)
      geodesic.setSphereOpacity(0.0)
      if (streetView) streetView.show()
      if (avatar) avatar.show()
      if (synapse3D) synapse3D.show(
        geodesic.getFacePosition(state.selectedIdx),
        geodesic.getFaceNormal(state.selectedIdx),
      )
      if (relationLinks && state.resonanceEnabled && state.similarFaces.length) {
        const topFaces = state.similarFaces
          .slice()
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, RELATION_TOP_N)
        relationLinks.show(state.selectedIdx, topFaces, RELATION_TOP_N)
      }
    })

    // Fly camera back to the selected face
    if (state.selectedIdx !== null) {
      const facePos = geodesic.getFacePosition(state.selectedIdx)
      const faceNormal = geodesic.getFaceNormal(state.selectedIdx)
      cameraCtrl.flyToFace(facePos, faceNormal, null)
    }

    dispatch({ type: 'RETRACT_BLOOM' })
  }, [dispatch, engineRef, state.selectedIdx, state.resonanceEnabled, state.similarFaces])

  if (error) {
    return (
      <div className="sphere-error">
        <div className="sphere-error-title">Failed to load sphere data</div>
        <div className="sphere-error-msg">{error}</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="sphere-loading">
        <div className="sphere-loading-title font-display">PerceptionSphere</div>
        <div className="sphere-loading-subtitle">
          Loading {metadata?.n_points?.toLocaleString() || '178,078'} street view points
        </div>
        <div className="sphere-loading-bar">
          <div className="sphere-loading-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    )
  }

  const isInside = state.phase !== PHASES.REST && state.phase !== PHASES.FLYING_IN
  const isBloom = state.phase === PHASES.BLOOM

  return (
    <>
      <SphereRenderer
        positions={positions}
        colorBlocks={colorBlocks}
        perceptionScores={perceptionScores}
        nPoints={metadata?.n_points || 0}
        atlasData={atlasData}
      />

      {/* Phase 1: Controls + HUD */}
      {state.phase === PHASES.REST && (
        <>
          <SphereControls
            activeDim={state.activeDim}
            onDimChange={(dim) => dispatch({ type: 'SET_DIM', dim })}
            restViewMode={restViewMode}
            onRestViewModeChange={setRestViewMode}
          />
          {volunteerAnchorList.length > 0 && (
            <SphereVolunteerQuickPanel
              anchors={volunteerAnchorList}
              onJump={(match) => {
                dispatch({ type: 'CLICK_FACE', idx: match.matched_point_idx })
                setSelectedVolunteerAnchor(null)
              }}
            />
          )}
          {state.hoveredPoint !== null && state.hoverPos && (
            <SphereHUD
              pointIdx={state.hoveredPoint}
              screenPos={state.hoverPos}
              perceptionScores={perceptionScores}
              volunteerMatch={volunteerByIdx[state.hoveredPoint] || null}
            />
          )}
          {selectedVolunteerAnchor && (
            <SphereVolunteerAnchorCard
              match={selectedVolunteerAnchor}
              onClose={() => setSelectedVolunteerAnchor(null)}
              onFlyIn={() => {
                dispatch({ type: 'CLICK_FACE', idx: selectedVolunteerAnchor.matched_point_idx })
                setSelectedVolunteerAnchor(null)
              }}
            />
          )}
        </>
      )}

      {/* Phase 2-3: Synapse network + FirstPerson HUD + Walk indicators + Beeswarm */}
      {isInside && !isBloom && (
        <>
          {!FLAGS.SYNAPSE_3D && <SynapseNetwork />}
          <FirstPersonHUD
            onExit={handleExit}
            positions={positions}
            volunteerMatchesByIdx={volunteerMatchesByIdx}
          />
          {state.phase === PHASES.STANDSTILL && <WalkIndicators />}
          <ResonancePanel />
          {FLAGS.SHAP_BEESWARM && <ShapBeeswarm width={342} height={460} nFeatures={15} placement="standstill" />}
        </>
      )}

      {/* Phase 5: Bloom map view + Beeswarm */}
      {isBloom && (
        <>
          <BloomMapView onRetract={handleRetractBloom} />
          {FLAGS.SHAP_BEESWARM && <ShapBeeswarm width={302} height={400} nFeatures={12} placement="bloom" />}
        </>
      )}
    </>
  )
}

function SphereVolunteerAnchorCard({ match, onClose, onFlyIn }) {
  if (!match) return null
  return (
    <div className="sphere-volunteer-card">
      <div className="sphere-volunteer-card-header">
        <div>
          <div className="sphere-volunteer-card-tag">Volunteer Anchor</div>
          <div className="sphere-volunteer-card-name">{match.volunteer}</div>
        </div>
        <button className="sphere-volunteer-card-close" onClick={onClose}>×</button>
      </div>
      <div className="sphere-volunteer-card-session">{match.session}</div>
      {match.volunteer_image && (
        <img
          src={`/api/sphere/volunteers/image/${match.volunteer_image}`}
          alt="Volunteer"
          className="sphere-volunteer-card-img"
        />
      )}
      {match.note && <div className="sphere-volunteer-card-note">"{match.note}"</div>}
      <div className="sphere-volunteer-card-meta">
        Point #{match.matched_point_idx} · {match.match_distance_m?.toFixed?.(0) ?? match.match_distance_m}m
      </div>
      <button className="sphere-volunteer-card-flyin" onClick={onFlyIn}>Fly In</button>
    </div>
  )
}

function SphereVolunteerQuickPanel({ anchors, onJump }) {
  return (
    <div className="sphere-volunteer-quick-panel">
      <div className="sphere-volunteer-quick-title">
        Volunteer Anchors ({anchors.length})
      </div>
      <div className="sphere-volunteer-quick-list">
        {anchors.map((m) => (
          <button
            key={`${m.session}|${m.timestamp}|${m.matched_point_idx}|${m.volunteer_image || ''}`}
            className="sphere-volunteer-quick-item"
            onClick={() => onJump(m)}
          >
            <div className="sphere-volunteer-quick-row">
              <span className="sphere-volunteer-quick-name">{m.volunteer}</span>
              <span className="sphere-volunteer-quick-point">#{m.matched_point_idx}</span>
            </div>
            <div className="sphere-volunteer-quick-session">{m.session}</div>
            {m.note && (
              <div className="sphere-volunteer-quick-note">
                {m.note.length > 64 ? `${m.note.slice(0, 64)}...` : m.note}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
