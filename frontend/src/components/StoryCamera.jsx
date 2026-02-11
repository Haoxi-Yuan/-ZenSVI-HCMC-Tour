import { useState, useEffect, useRef, useCallback } from 'react'
import { useStoryShots } from '../hooks/useStory'
import { buildColorExpression } from '../utils/mapConstants'
import StoryNarration from './StoryNarration'

/**
 * StoryCamera — Guided flyTo narrative with 7 pre-defined shots.
 *
 * State machine: LOADING → PLAYING ↔ PAUSED → ENDED
 * - User drag during flyTo → immediate exit
 * - Hides hex-fill for performance during flyTo
 * - Highlights focused street via line-opacity filter
 */
export default function StoryCamera({ map, onExit }) {
  const { shots, loading, error } = useStoryShots()
  const [phase, setPhase] = useState('LOADING') // LOADING | PLAYING | PAUSED | ENDED
  const [currentIndex, setCurrentIndex] = useState(0)
  const advanceTimerRef = useRef(null)
  const exitingRef = useRef(false)
  const originalLineOpacityRef = useRef(null)
  const originalLineColorRef = useRef(null)

  // Save original map state on mount
  useEffect(() => {
    if (!map) return
    if (map.getLayer('streets-line')) {
      originalLineOpacityRef.current = map.getPaintProperty('streets-line', 'line-opacity')
      originalLineColorRef.current = map.getPaintProperty('streets-line', 'line-color')
    }
    // Hide hex-fill for performance
    if (map.getLayer('hex-fill')) {
      map.setLayoutProperty('hex-fill', 'visibility', 'none')
    }
  }, [map])

  // Restore map state on unmount
  useEffect(() => {
    return () => {
      if (!map) return
      if (map.getLayer('streets-line')) {
        if (originalLineOpacityRef.current != null) {
          map.setPaintProperty('streets-line', 'line-opacity', originalLineOpacityRef.current)
        }
        if (originalLineColorRef.current != null) {
          map.setPaintProperty('streets-line', 'line-color', originalLineColorRef.current)
        }
      }
    }
  }, [map])

  // Clean exit handler
  const handleExit = useCallback(() => {
    if (exitingRef.current) return
    exitingRef.current = true
    clearTimeout(advanceTimerRef.current)

    if (map) {
      map.stop() // cancel any in-progress flyTo
      // Restore line-opacity
      if (map.getLayer('streets-line') && originalLineOpacityRef.current != null) {
        map.setPaintProperty('streets-line', 'line-opacity', originalLineOpacityRef.current)
      }
      if (map.getLayer('streets-line') && originalLineColorRef.current != null) {
        map.setPaintProperty('streets-line', 'line-color', originalLineColorRef.current)
      }
    }
    onExit()
  }, [map, onExit])

  // Detect user drag → exit story
  useEffect(() => {
    if (!map) return
    const onDragStart = () => {
      if (phase === 'PLAYING' || phase === 'PAUSED') {
        handleExit()
      }
    }
    map.on('dragstart', onDragStart)
    return () => map.off('dragstart', onDragStart)
  }, [map, phase, handleExit])

  // Play a specific shot
  const playShot = useCallback((index) => {
    if (!map || !shots[index]) return

    const shot = shots[index]
    setCurrentIndex(index)

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

    // After flyTo completes, pause 2s then advance
    map.once('moveend', () => {
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
    })
  }, [map, shots])

  // Start playing when shots are loaded
  useEffect(() => {
    if (shots.length > 0 && phase === 'LOADING') {
      setPhase('PLAYING')
      playShot(0)
    }
  }, [shots, phase, playShot])

  // Pause: cancel timer
  const handlePause = useCallback(() => {
    clearTimeout(advanceTimerRef.current)
    if (map) map.stop()
    setPhase('PAUSED')
  }, [map])

  // Resume: continue from current shot
  const handleResume = useCallback(() => {
    setPhase('PLAYING')
    playShot(currentIndex)
  }, [currentIndex, playShot])

  // Skip: cancel current, advance
  const handleSkip = useCallback(() => {
    clearTimeout(advanceTimerRef.current)
    if (map) map.stop()
    const nextIndex = currentIndex + 1
    if (nextIndex >= shots.length) {
      setPhase('ENDED')
    } else {
      setPhase('PLAYING')
      playShot(nextIndex)
    }
  }, [map, currentIndex, shots.length, playShot])

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
      onPause={handlePause}
      onResume={handleResume}
      onSkip={handleSkip}
      onExit={handleExit}
    />
  )
}
