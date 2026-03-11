import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStoryShots } from '../hooks/useStory'
import { buildColorExpression } from '../utils/mapConstants'
import StoryNarration from './StoryNarration'

/** Check if a MapLibre map instance is still usable (not removed). */
function isMapAlive(m) {
  try { return Boolean(m && m.getStyle()) } catch { return false }
}

/**
 * StoryCamera — Guided flyTo narrative with 7 pre-defined shots.
 *
 * State machine: LOADING → PLAYING ↔ PAUSED → ENDED
 * - User drag during flyTo → immediate exit
 * - Hides hex-fill for performance during flyTo
 * - Highlights focused street via line-opacity filter
 */
export default function StoryCamera({ map, onExit }) {
  const navigate = useNavigate()
  const { shots, loading, error } = useStoryShots()
  const [phase, setPhase] = useState('LOADING') // LOADING | PLAYING | PAUSED | ENDED
  const [currentIndex, setCurrentIndex] = useState(0)
  const [shotImages, setShotImages] = useState([])
  const [imageLoading, setImageLoading] = useState(false)
  const advanceTimerRef = useRef(null)
  const moveEndHandlerRef = useRef(null)
  const exitingRef = useRef(false)
  const originalLineOpacityRef = useRef(null)
  const originalLineColorRef = useRef(null)
  const originalHexVisibilityRef = useRef(null)
  const imageCacheRef = useRef({})

  const clearPendingAdvance = useCallback(() => {
    clearTimeout(advanceTimerRef.current)
    if (map && moveEndHandlerRef.current) {
      map.off('moveend', moveEndHandlerRef.current)
      moveEndHandlerRef.current = null
    }
  }, [map])

  // Save original map state on mount
  useEffect(() => {
    if (!map) return
    if (map.getLayer('streets-line')) {
      originalLineOpacityRef.current = map.getPaintProperty('streets-line', 'line-opacity')
      originalLineColorRef.current = map.getPaintProperty('streets-line', 'line-color')
    }
    // Hide hex-fill for performance
    if (map.getLayer('hex-fill')) {
      originalHexVisibilityRef.current = map.getLayoutProperty('hex-fill', 'visibility') || 'visible'
      map.setLayoutProperty('hex-fill', 'visibility', 'none')
    }
  }, [map])

  // Restore map state on unmount
  useEffect(() => {
    return () => {
      clearPendingAdvance()
      if (!isMapAlive(map)) return
      if (map.getLayer('streets-line')) {
        if (originalLineOpacityRef.current != null) {
          map.setPaintProperty('streets-line', 'line-opacity', originalLineOpacityRef.current)
        }
        if (originalLineColorRef.current != null) {
          map.setPaintProperty('streets-line', 'line-color', originalLineColorRef.current)
        }
      }
      if (map.getLayer('hex-fill') && originalHexVisibilityRef.current != null) {
        map.setLayoutProperty('hex-fill', 'visibility', originalHexVisibilityRef.current)
      }
    }
  }, [map, clearPendingAdvance])

  // Clean exit handler
  const handleExit = useCallback(() => {
    if (exitingRef.current) return
    exitingRef.current = true
    clearPendingAdvance()

    if (isMapAlive(map)) {
      map.stop() // cancel any in-progress flyTo
      if (map.getLayer('streets-line') && originalLineOpacityRef.current != null) {
        map.setPaintProperty('streets-line', 'line-opacity', originalLineOpacityRef.current)
      }
      if (map.getLayer('streets-line') && originalLineColorRef.current != null) {
        map.setPaintProperty('streets-line', 'line-color', originalLineColorRef.current)
      }
      if (map.getLayer('hex-fill') && originalHexVisibilityRef.current != null) {
        map.setLayoutProperty('hex-fill', 'visibility', originalHexVisibilityRef.current)
      }
    }
    onExit()
  }, [map, onExit, clearPendingAdvance])

  // Detect user drag → exit story
  useEffect(() => {
    if (!map) return
    const onDragStart = () => {
      if (phase === 'PLAYING' || phase === 'PAUSED') {
        handleExit()
      }
    }
    map.on('dragstart', onDragStart)
    return () => { if (isMapAlive(map)) map.off('dragstart', onDragStart) }
  }, [map, phase, handleExit])

  // Add a dedicated point marker layer for current story shot.
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return
    if (!map.getSource('story-shot-point')) {
      map.addSource('story-shot-point', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getLayer('story-shot-point-circle')) {
      map.addLayer({
        id: 'story-shot-point-circle',
        type: 'circle',
        source: 'story-shot-point',
        paint: {
          'circle-radius': 8,
          'circle-color': '#E85D55',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#F5F0E8',
          'circle-opacity': 0.95,
        },
      })
    }
    if (!map.getLayer('story-shot-point-label')) {
      map.addLayer({
        id: 'story-shot-point-label',
        type: 'symbol',
        source: 'story-shot-point',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#F5F0E8',
          'text-halo-color': 'rgba(15,13,10,0.9)',
          'text-halo-width': 1.5,
        },
      })
    }

    return () => {
      if (!isMapAlive(map)) return
      if (map.getLayer('story-shot-point-label')) map.removeLayer('story-shot-point-label')
      if (map.getLayer('story-shot-point-circle')) map.removeLayer('story-shot-point-circle')
      if (map.getSource('story-shot-point')) map.removeSource('story-shot-point')
    }
  }, [map])

  // Update marker position for the current shot.
  useEffect(() => {
    if (!map || !shots[currentIndex] || !map.getSource('story-shot-point')) return
    const source = map.getSource('story-shot-point')
    const shot = shots[currentIndex]
    const hasStreetShot = Boolean(shot.street_name && shot.camera?.center)

    if (!hasStreetShot) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: shot.street_name },
        geometry: { type: 'Point', coordinates: shot.camera.center },
      }],
    })
  }, [map, shots, currentIndex])

  // Play a specific shot
  const playShot = useCallback((index) => {
    if (!map || !shots[index]) return

    const shot = shots[index]
    setCurrentIndex(index)
    clearPendingAdvance()

    // Highlight the focus street
    if (map.getLayer('streets-line')) {
      if (shot.street_name) {
        map.setPaintProperty('streets-line', 'line-opacity', [
          'case',
          ['==', ['get', 'name'], shot.street_name], 1,
          0.15,
        ])
      } else {
        // Overview shots: show all streets normally
        map.setPaintProperty('streets-line', 'line-opacity', 0.7)
      }

      // Color streets by the shot's focus property
      if (shot.focus_property) {
        const expr = buildColorExpression(shot.focus_property)
        if (expr) map.setPaintProperty('streets-line', 'line-color', expr)
      }
    }

    // FlyTo the camera position
    map.flyTo({
      center: shot.camera.center,
      zoom: shot.camera.zoom,
      pitch: shot.camera.pitch || 0,
      bearing: shot.camera.bearing || 0,
      duration: shot.duration_ms || 6000,
      essential: true,
    })

    // After flyTo completes, pause 2s then advance.
    const onMoveEnd = () => {
      if (moveEndHandlerRef.current === onMoveEnd) {
        map.off('moveend', onMoveEnd)
        moveEndHandlerRef.current = null
      }
      if (exitingRef.current) return
      advanceTimerRef.current = setTimeout(() => {
        if (exitingRef.current) return
        const nextIndex = index + 1
        if (nextIndex >= shots.length) {
          setPhase('ENDED')
        } else {
          playShot(nextIndex)
        }
      }, 2000)
    }
    moveEndHandlerRef.current = onMoveEnd
    map.on('moveend', onMoveEnd)
  }, [map, shots, clearPendingAdvance])

  // Load representative street-view thumbnails for current shot street.
  useEffect(() => {
    const shot = shots[currentIndex]
    const streetName = shot?.street_name
    if (!streetName) {
      setShotImages([])
      setImageLoading(false)
      return
    }

    if (imageCacheRef.current[streetName]) {
      setShotImages(imageCacheRef.current[streetName])
      setImageLoading(false)
      return
    }

    let cancelled = false
    setImageLoading(true)
    setShotImages([])

    fetch(`/api/points/by-street/${encodeURIComponent(streetName)}`)
      .then(r => r.json())
      .then(data => {
        const points = data.points || []
        if (points.length === 0) return []
        const idxs = [...new Set([
          0,
          Math.floor((points.length - 1) / 2),
          points.length - 1,
        ])]
        const sampled = idxs.map(i => points[i]).filter(Boolean)
        return Promise.all(
          sampled.map(p =>
            fetch(`/api/images/by-point/${encodeURIComponent(p.id)}`)
              .then(r => r.json())
              .then(imgData => imgData.images?.[0] || null)
              .catch(() => null)
          )
        )
      })
      .then(urls => {
        const valid = (urls || []).filter(Boolean)
        imageCacheRef.current[streetName] = valid
        if (!cancelled) setShotImages(valid)
      })
      .catch(() => {
        if (!cancelled) setShotImages([])
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false)
      })

    return () => { cancelled = true }
  }, [shots, currentIndex])

  const handleEnterTour = useCallback(() => {
    const shot = shots[currentIndex]
    const streetName = shot?.street_name
    if (!streetName) return
    try { handleExit() } catch (e) { console.error('Story exit error:', e) }
    navigate(`/tour/${encodeURIComponent(streetName)}`)
  }, [shots, currentIndex, handleExit, navigate])

  // While paused, allow click on highlighted street line to jump into tour mode.
  useEffect(() => {
    if (!map) return
    const onStreetClick = (e) => {
      if (phase !== 'PAUSED') return
      const shot = shots[currentIndex]
      const targetStreet = shot?.street_name
      if (!targetStreet) return
      const clickedName = e.features?.[0]?.properties?.name
      if (clickedName !== targetStreet) return
      handleEnterTour()
    }
    map.on('click', 'streets-line', onStreetClick)
    return () => { if (isMapAlive(map)) map.off('click', 'streets-line', onStreetClick) }
  }, [map, phase, shots, currentIndex, handleEnterTour])

  // Start playing when shots are loaded
  useEffect(() => {
    if (shots.length > 0 && phase === 'LOADING') {
      setPhase('PLAYING')
      playShot(0)
    }
  }, [shots, phase, playShot])

  // Pause: cancel timer
  const handlePause = useCallback(() => {
    clearPendingAdvance()
    if (map) map.stop()
    setPhase('PAUSED')
  }, [map, clearPendingAdvance])

  // Resume: continue from current shot
  const handleResume = useCallback(() => {
    setPhase('PLAYING')
    playShot(currentIndex)
  }, [currentIndex, playShot])

  // Skip: cancel current, advance
  const handleSkip = useCallback(() => {
    clearPendingAdvance()
    if (map) map.stop()
    const nextIndex = currentIndex + 1
    if (nextIndex >= shots.length) {
      setPhase('ENDED')
    } else {
      setPhase('PLAYING')
      playShot(nextIndex)
    }
  }, [map, currentIndex, shots.length, playShot, clearPendingAdvance])

  // Loading / error states
  if (loading || phase === 'LOADING') {
    return (
      <div className="story-narration">
        <div className="story-theme">Story Tour</div>
        <div className="story-text" style={{ fontStyle: 'italic' }}>
          {error ? `Error loading story: ${error}` : 'Preparing your guided tour...'}
        </div>
        {error && (
          <div className="story-controls">
            <button className="story-btn exit" onClick={handleExit}>Exit</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <StoryNarration
      shots={shots}
      currentIndex={currentIndex}
      phase={phase}
      shotImages={shotImages}
      imageLoading={imageLoading}
      canEnterTour={phase === 'PAUSED' && Boolean(shots[currentIndex]?.street_name)}
      onEnterTour={handleEnterTour}
      onPause={handlePause}
      onResume={handleResume}
      onSkip={handleSkip}
      onExit={handleExit}
    />
  )
}
