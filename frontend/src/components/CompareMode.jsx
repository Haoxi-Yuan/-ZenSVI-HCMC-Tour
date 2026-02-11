import { useState, useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { MAP_STYLE_URL, WALKABILITY_DIMENSIONS, buildColorExpression } from '../utils/mapConstants'

/**
 * CompareMode — Dual-map swipe overlay for comparing two walkability dimensions.
 *
 * Architecture:
 * - The existing mainMap serves as the right/bottom layer (full viewport).
 * - A second "top" map is created in an overlay div, clipped via CSS clip-path
 *   to show only the left portion up to the divider position.
 * - Only mainMap receives pointer events; the top map mirrors its camera.
 */
export default function CompareMode({ mainMap, containerRef, onExit }) {
  const topMapRef = useRef(null)
  const topContainerRef = useRef(null)
  const syncingRef = useRef(false)
  const [sliderX, setSliderX] = useState(null) // null = uninitialized
  const [leftDim, setLeftDim] = useState('safety')
  const [rightDim, setRightDim] = useState('comfort')
  const [topMapReady, setTopMapReady] = useState(false)
  const draggingRef = useRef(false)

  // Initialize/recompute slider position from container width
  useEffect(() => {
    const updateSlider = () => {
      const width = containerRef.current?.offsetWidth
      if (!width || width <= 0) return
      setSliderX(prev => {
        if (prev == null) return width / 2
        return Math.max(40, Math.min(width - 40, prev))
      })
    }

    updateSlider()
    window.addEventListener('resize', updateSlider)
    return () => window.removeEventListener('resize', updateSlider)
  }, [containerRef])

  // Save original mainMap street color and set right dimension
  const originalColorRef = useRef(null)
  const capturedOriginalColorRef = useRef(false)
  useEffect(() => {
    if (!mainMap || !mainMap.getLayer('streets-line')) return
    if (!capturedOriginalColorRef.current) {
      originalColorRef.current = mainMap.getPaintProperty('streets-line', 'line-color')
      capturedOriginalColorRef.current = true
    }
  }, [mainMap])

  useEffect(() => {
    if (!mainMap || !mainMap.getLayer('streets-line')) return
    const expr = buildColorExpression(rightDim)
    if (expr) mainMap.setPaintProperty('streets-line', 'line-color', expr)
  }, [mainMap, rightDim])

  // Safety restore if component unmounts without explicit exit handler.
  useEffect(() => {
    return () => {
      if (mainMap && capturedOriginalColorRef.current && mainMap.getLayer('streets-line')) {
        mainMap.setPaintProperty('streets-line', 'line-color', originalColorRef.current)
      }
    }
  }, [mainMap])

  // Hide hex-fill during compare
  useEffect(() => {
    if (!mainMap) return
    const hadHex = mainMap.getLayer('hex-fill') &&
      mainMap.getLayoutProperty('hex-fill', 'visibility') === 'visible'
    if (mainMap.getLayer('hex-fill')) {
      mainMap.setLayoutProperty('hex-fill', 'visibility', 'none')
    }
    return () => {
      if (hadHex && mainMap.getLayer('hex-fill')) {
        mainMap.setLayoutProperty('hex-fill', 'visibility', 'visible')
      }
    }
  }, [mainMap])

  // Create top map
  useEffect(() => {
    if (!containerRef.current || topMapRef.current) return

    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
    container.className = 'compare-overlay'
    containerRef.current.appendChild(container)
    topContainerRef.current = container

    const topMap = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: mainMap.getCenter(),
      zoom: mainMap.getZoom(),
      pitch: mainMap.getPitch(),
      bearing: mainMap.getBearing(),
      antialias: true,
      interactive: false,
    })

    topMap.on('load', () => {
      topMap.addSource('streets-compare', {
        type: 'geojson',
        data: '/api/layers/streets-geojson',
      })

      topMap.addLayer({
        id: 'streets-line-compare',
        type: 'line',
        source: 'streets-compare',
        paint: {
          'line-color': buildColorExpression(leftDim),
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 1, 14, 3, 18, 6,
          ],
          'line-opacity': 0.7,
        },
      })

      setTopMapReady(true)
    })

    topMapRef.current = topMap

    return () => {
      if (topMapRef.current) {
        topMapRef.current.remove()
        topMapRef.current = null
      }
      if (topContainerRef.current && containerRef.current) {
        containerRef.current.removeChild(topContainerRef.current)
        topContainerRef.current = null
      }
      setTopMapReady(false)
    }
  }, [containerRef, mainMap]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync top map camera with main map
  useEffect(() => {
    if (!mainMap || !topMapRef.current) return

    const onMove = () => {
      if (syncingRef.current) return
      syncingRef.current = true
      topMapRef.current.jumpTo({
        center: mainMap.getCenter(),
        zoom: mainMap.getZoom(),
        pitch: mainMap.getPitch(),
        bearing: mainMap.getBearing(),
      })
      syncingRef.current = false
    }

    mainMap.on('move', onMove)
    return () => mainMap.off('move', onMove)
  }, [mainMap, topMapReady])

  // Update top map street colors when leftDim changes
  useEffect(() => {
    const topMap = topMapRef.current
    if (!topMap || !topMapReady) return
    if (!topMap.getLayer('streets-line-compare')) return
    const expr = buildColorExpression(leftDim)
    if (expr) topMap.setPaintProperty('streets-line-compare', 'line-color', expr)
  }, [leftDim, topMapReady])

  const effectiveSliderX = sliderX ?? (containerRef.current?.offsetWidth
    ? containerRef.current.offsetWidth / 2
    : 200)

  // Apply clip-path to top map container
  useEffect(() => {
    const width = containerRef.current?.offsetWidth
    if (!topContainerRef.current || !width) return
    topContainerRef.current.style.clipPath = `inset(0 ${width - effectiveSliderX}px 0 0)`
  }, [effectiveSliderX, containerRef])

  // Divider drag handling
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    draggingRef.current = true

    const onMouseMove = (moveEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(40, Math.min(rect.width - 40, moveEvent.clientX - rect.left))
      setSliderX(x)
    }

    const onMouseUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [containerRef])

  // Cleanup: restore original color on exit
  const handleExit = useCallback(() => {
    if (mainMap && originalColorRef.current && mainMap.getLayer('streets-line')) {
      mainMap.setPaintProperty('streets-line', 'line-color', originalColorRef.current)
    }
    onExit()
  }, [mainMap, onExit])

  return (
    <>
      {/* Divider bar */}
      <div
        className="compare-divider"
        style={{ left: `${effectiveSliderX}px` }}
        onMouseDown={handleMouseDown}
      />

      {/* Left dimension label + selector */}
      <div className="compare-label compare-label-left">
        <select
          className="compare-dim-select"
          value={leftDim}
          onChange={(e) => setLeftDim(e.target.value)}
        >
          {WALKABILITY_DIMENSIONS.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Right dimension label + selector */}
      <div className="compare-label compare-label-right">
        <select
          className="compare-dim-select"
          value={rightDim}
          onChange={(e) => setRightDim(e.target.value)}
        >
          {WALKABILITY_DIMENSIONS.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Exit button */}
      <button
        onClick={handleExit}
        style={{
          position: 'absolute',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 12,
          padding: '6px 16px',
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          background: 'rgba(15, 13, 10, 0.85)',
          border: '1px solid rgba(232, 115, 74, 0.4)',
          color: 'var(--accent-orange)',
          cursor: 'pointer',
          fontFamily: "'Be Vietnam Pro', sans-serif",
        }}
      >
        Exit Compare
      </button>
    </>
  )
}
