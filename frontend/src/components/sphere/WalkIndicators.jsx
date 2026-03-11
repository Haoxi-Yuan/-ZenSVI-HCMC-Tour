/**
 * WalkIndicators — directional arrows showing walkable neighbors.
 *
 * Projects neighbor face positions to screen coordinates and shows
 * clickable chevron arrows at screen edges.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSphere, PHASES } from '../../contexts/SphereContext'
import { useSphereApi } from '../../hooks/useSphereApi'

export default function WalkIndicators() {
  const { state, dispatch, engineRef } = useSphere()
  const { selectedIdx, neighbors, walkMode, phase } = state
  const api = useSphereApi()
  const [indicators, setIndicators] = useState([])
  const [jumpTargets, setJumpTargets] = useState([])

  // Compute screen positions for neighbor faces
  useEffect(() => {
    if (phase !== PHASES.STANDSTILL || !neighbors.length) {
      setIndicators([])
      return
    }
    const refs = engineRef.current
    if (!refs) return

    const { engine, geodesic } = refs
    const camera = engine.camera
    const w = engine.renderer.domElement.clientWidth
    const h = engine.renderer.domElement.clientHeight

    const items = []
    for (const nIdx of neighbors) {
      const pos3d = geodesic.getFacePosition(nIdx)
      const projected = pos3d.clone().project(camera)

      const sx = (projected.x * 0.5 + 0.5) * w
      const sy = (-projected.y * 0.5 + 0.5) * h

      // Determine direction
      const dx = sx - w / 2
      const dy = sy - h / 2
      const angle = Math.atan2(dy, dx)

      // Clamp to edges with padding
      const pad = 40
      const cx = Math.max(pad, Math.min(w - pad, sx))
      const cy = Math.max(pad, Math.min(h - pad, sy))

      items.push({ idx: nIdx, x: cx, y: cy, angle })
    }
    setIndicators(items)
  }, [neighbors, phase, selectedIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch jump targets for jump mode
  useEffect(() => {
    if (walkMode !== 'jump' || selectedIdx === null) {
      setJumpTargets([])
      return
    }
    api.fetchSimilar(selectedIdx, state.activeDim, 5).then(data => {
      setJumpTargets(data.neighbors || [])
    }).catch(() => setJumpTargets([]))
  }, [walkMode, selectedIdx, state.activeDim]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWalk = useCallback((idx) => {
    const refs = engineRef.current
    if (!refs || phase !== PHASES.STANDSTILL) return
    if (refs.cameraCtrl?.isAnimating) return
    dispatch({ type: 'WALK_TO', idx })
  }, [dispatch, engineRef, phase])

  // Keyboard navigation
  useEffect(() => {
    if (phase !== PHASES.STANDSTILL) return

    const handleKey = (e) => {
      const refs = engineRef.current
      if (!refs || !neighbors.length) return
      if (refs.cameraCtrl?.isAnimating) return
      if (e.repeat) return

      const tag = e.target?.tagName?.toLowerCase?.() || ''
      const editable = e.target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
      if (editable) return

      // Require Shift+Space to avoid accidental walk-mode toggles.
      if (e.code === 'Space' && e.shiftKey) {
        e.preventDefault()
        dispatch({
          type: 'SET_WALK_MODE',
          mode: walkMode === 'topological' ? 'jump' : 'topological',
        })
        return
      }

      if (e.key === 'Escape') {
        return // handled by FirstPersonHUD
      }

      // Direction keys: find nearest neighbor in that direction
      const dirMap = {
        ArrowUp: [0, -1], ArrowDown: [0, 1],
        ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
      }
      const dir = dirMap[e.key]
      if (!dir) return
      e.preventDefault()

      if (walkMode === 'jump' && jumpTargets.length > 0) {
        // Jump to first similar face
        handleWalk(jumpTargets[0].idx)
        return
      }

      // Find neighbor closest to the direction
      const { engine, geodesic } = refs
      const camera = engine.camera
      const w = engine.renderer.domElement.clientWidth
      const h = engine.renderer.domElement.clientHeight

      let bestIdx = -1, bestDot = -Infinity
      for (const nIdx of neighbors) {
        const pos3d = geodesic.getFacePosition(nIdx)
        const projected = pos3d.clone().project(camera)
        const sx = projected.x
        const sy = -projected.y
        const dot = sx * dir[0] + sy * dir[1]
        if (dot > bestDot) { bestDot = dot; bestIdx = nIdx }
      }
      if (bestIdx >= 0) handleWalk(bestIdx)
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, neighbors, walkMode, jumpTargets, handleWalk, dispatch, engineRef])

  if (phase !== PHASES.STANDSTILL) return null

  return (
    <div className="walk-indicators">
      {/* Topological walk arrows */}
      {walkMode === 'topological' && indicators.map((ind) => (
        <button
          key={ind.idx}
          className="walk-arrow"
          style={{
            left: ind.x,
            top: ind.y,
            transform: `translate(-50%, -50%) rotate(${ind.angle}rad)`,
          }}
          onClick={() => handleWalk(ind.idx)}
          title={`Walk to #${ind.idx}`}
        >
          &#x276F;
        </button>
      ))}

      {/* Jump mode targets */}
      {walkMode === 'jump' && jumpTargets.map((t, i) => (
        <button
          key={t.idx}
          className="walk-jump-badge"
          style={{
            right: 20,
            top: 120 + i * 50,
          }}
          onClick={() => handleWalk(t.idx)}
          title={`Jump to #${t.idx} (similarity: ${t.similarity.toFixed(3)})`}
        >
          <span className="walk-jump-num">{i + 1}</span>
          <span className="walk-jump-sim">{(t.similarity * 100).toFixed(0)}%</span>
        </button>
      ))}
    </div>
  )
}
