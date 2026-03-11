import { useRef, useEffect, useState, useMemo } from 'react'
import * as THREE from 'three'

/** Haversine distance between two lat/lng points in meters. */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Bearing from point1 to point2 (degrees, 0=North, clockwise). */
function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180)
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

/**
 * 360 Panorama Viewer using Three.js
 * Maps 4 images (90deg intervals) onto a sphere for immersive view.
 */
export default function PanoramaViewer({
  imageUrls, onNavigateForward, onNavigateBack,
  currentPoint, nextPoint, pointIndex, totalPoints,
}) {
  const containerRef = useRef(null)
  const [imageLoadState, setImageLoadState] = useState('idle') // idle | loading | loaded | error
  const sceneRef = useRef(null)
  const isDragging = useRef(false)
  const prevMouse = useRef({ x: 0, y: 0 })
  const rotation = useRef({ lon: 0, lat: 0 })
  const [cameraHeading, setCameraHeading] = useState(0)

  // Track camera heading from rotation ref (100ms polling)
  useEffect(() => {
    const interval = setInterval(() => {
      setCameraHeading((-rotation.current.lon % 360 + 360) % 360)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  // Compute distance and bearing to next point
  const hudData = useMemo(() => {
    if (!currentPoint?.geometry?.coordinates || !nextPoint?.geometry?.coordinates) return null
    const [lng1, lat1] = currentPoint.geometry.coordinates
    const [lng2, lat2] = nextPoint.geometry.coordinates
    return {
      distance: haversineDistance(lat1, lng1, lat2, lng2),
      bearing: bearingTo(lat1, lng1, lat2, lng2),
    }
  }, [currentPoint, nextPoint])

  // Direction arrow rotation relative to camera
  const dirArrowDeg = hudData ? ((hudData.bearing - cameraHeading + 360) % 360) : 0

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene setup
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.set(0, 0, 0.01)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)

    // Create sphere geometry (inverted so we see inside)
    const geometry = new THREE.SphereGeometry(50, 60, 40)
    geometry.scale(-1, 1, 1)

    // Create canvas to composite 4 images into one equirectangular texture
    const canvas = document.createElement('canvas')
    canvas.width = 2560  // 4 * 640
    canvas.height = 640
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1A1714'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipMapLinearFilter
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    sceneRef.current = { scene, camera, renderer, texture, canvas, ctx }

    // Animation loop
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)

      // Convert lon/lat to camera target
      const phi = THREE.MathUtils.degToRad(90 - rotation.current.lat)
      const theta = THREE.MathUtils.degToRad(rotation.current.lon)
      const target = new THREE.Vector3(
        50 * Math.sin(phi) * Math.cos(theta),
        50 * Math.cos(phi),
        50 * Math.sin(phi) * Math.sin(theta)
      )
      camera.lookAt(target)
      renderer.render(scene, camera)
    }
    animate()

    // Mouse controls
    const onMouseDown = (e) => {
      isDragging.current = true
      prevMouse.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseMove = (e) => {
      if (!isDragging.current) return
      const dx = e.clientX - prevMouse.current.x
      const dy = e.clientY - prevMouse.current.y
      rotation.current.lon -= dx * 0.3
      rotation.current.lat = Math.max(-85, Math.min(85, rotation.current.lat + dy * 0.3))
      prevMouse.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseUp = () => { isDragging.current = false }
    const onWheel = (e) => {
      camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05))
      camera.updateProjectionMatrix()
    }

    container.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    container.addEventListener('wheel', onWheel, { passive: true })

    // Resize
    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      container.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  // Load images when URLs change
  useEffect(() => {
    if (!imageUrls || imageUrls.length === 0 || !sceneRef.current) {
      setImageLoadState('idle')
      return
    }

    setImageLoadState('loading')
    const { texture, ctx } = sceneRef.current

    // Clear canvas for new point
    ctx.fillStyle = '#1A1714'
    ctx.fillRect(0, 0, 2560, 640)

    // Sort images by heading to ensure correct order
    const sortedUrls = [...imageUrls].sort((a, b) => {
      const headA = parseInt(a.match(/head(\d+)/)?.[1] || '0')
      const headB = parseInt(b.match(/head(\d+)/)?.[1] || '0')
      return headA - headB
    })

    let loaded = 0
    let failed = 0
    const total = sortedUrls.length

    sortedUrls.forEach((url, i) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        ctx.drawImage(img, i * 640, 0, 640, 640)
        loaded++
        texture.needsUpdate = true
        if (loaded + failed === total) {
          setImageLoadState(loaded > 0 ? 'loaded' : 'error')
        }
      }
      img.onerror = () => {
        console.warn(`Failed to load panorama image: ${url}`)
        failed++
        if (loaded + failed === total) {
          setImageLoadState(loaded > 0 ? 'loaded' : 'error')
        }
      }
      img.src = url
    })
  }, [imageUrls])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />

      {/* Loading / error overlay */}
      {(imageLoadState === 'loading' || imageLoadState === 'idle') && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 13, 10, 0.6)',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <div style={{ fontSize: '12px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent-green)' }}>
            Loading Street View...
          </div>
        </div>
      )}
      {imageLoadState === 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 13, 10, 0.6)',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <div style={{ fontSize: '12px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E85D55' }}>
            Failed to load images
          </div>
        </div>
      )}

      {/* Navigation arrows */}
      {onNavigateBack && (
        <button
          onClick={onNavigateBack}
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '50%',
            transform: 'translateX(calc(-50% - 60px))',
            width: '48px',
            height: '48px',
            background: 'rgba(15, 13, 10, 0.7)',
            border: '1px solid rgba(245, 240, 232, 0.15)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            transition: 'background 0.3s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 240, 232, 0.15)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(15, 13, 10, 0.7)'}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 4l-6 6 6 6" />
          </svg>
        </button>
      )}
      {onNavigateForward && (
        <button
          onClick={onNavigateForward}
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '50%',
            transform: 'translateX(calc(-50% + 60px))',
            width: '48px',
            height: '48px',
            background: 'rgba(15, 13, 10, 0.7)',
            border: '1px solid rgba(245, 240, 232, 0.15)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            transition: 'background 0.3s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 240, 232, 0.15)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(15, 13, 10, 0.7)'}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 4l6 6-6 6" />
          </svg>
        </button>
      )}

      {/* Compass Rose (top-left, below top bar) */}
      <div style={{
        position: 'absolute',
        top: '80px',
        left: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          position: 'relative',
        }}>
          <svg
            width="56" height="56" viewBox="0 0 56 56"
            style={{ transform: `rotate(${-cameraHeading}deg)`, transition: 'transform 0.1s ease-out' }}
          >
            {/* Outer ring */}
            <circle cx="28" cy="28" r="26" fill="rgba(15, 13, 10, 0.6)" stroke="rgba(245, 240, 232, 0.15)" strokeWidth="1" />
            {/* Cardinal ticks */}
            {[0, 90, 180, 270].map(deg => (
              <line key={deg}
                x1="28" y1="4" x2="28" y2="9"
                stroke={deg === 0 ? '#E85D55' : 'rgba(245, 240, 232, 0.4)'}
                strokeWidth={deg === 0 ? 2 : 1}
                transform={`rotate(${deg} 28 28)`}
              />
            ))}
            {/* Intercardinal ticks */}
            {[45, 135, 225, 315].map(deg => (
              <line key={deg}
                x1="28" y1="5" x2="28" y2="8"
                stroke="rgba(245, 240, 232, 0.2)"
                strokeWidth="0.5"
                transform={`rotate(${deg} 28 28)`}
              />
            ))}
            {/* N label */}
            <text x="28" y="16" textAnchor="middle" fill="#E85D55" fontSize="9" fontWeight="700" fontFamily="'Be Vietnam Pro', sans-serif">N</text>
            {/* Needle */}
            <polygon points="28,12 25,28 28,26 31,28" fill="rgba(232, 93, 85, 0.6)" />
            <polygon points="28,44 25,28 28,30 31,28" fill="rgba(245, 240, 232, 0.2)" />
          </svg>
        </div>
        {/* Heading readout */}
        <div style={{
          background: 'rgba(15, 13, 10, 0.6)',
          padding: '2px 8px',
          fontSize: '11px',
          fontFamily: "'Be Vietnam Pro', monospace",
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
          border: '1px solid rgba(245, 240, 232, 0.08)',
        }}>
          {String(Math.round(cameraHeading)).padStart(3, '0')}°
        </div>
      </div>

      {/* Point progress (top-right, below top bar) */}
      {totalPoints > 0 && (
        <div style={{
          position: 'absolute',
          top: '80px',
          right: '16px',
          background: 'rgba(15, 13, 10, 0.6)',
          backdropFilter: 'blur(8px)',
          padding: '6px 12px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          border: '1px solid rgba(245, 240, 232, 0.08)',
          fontFamily: "'Be Vietnam Pro', monospace",
          letterSpacing: '0.05em',
        }}>
          {(pointIndex || 0) + 1} / {totalPoints}
        </div>
      )}

      {/* Direction arrow to next point */}
      {hudData && (
        <div style={{
          position: 'absolute',
          bottom: '120px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'none',
        }}>
          <svg
            width="36" height="36" viewBox="0 0 36 36"
            style={{
              transform: `rotate(${dirArrowDeg}deg)`,
              transition: 'transform 0.15s ease-out',
              opacity: 0.5,
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))',
            }}
          >
            <polygon points="18,4 28,30 18,24 8,30" fill="#3DBB78" />
          </svg>
          <div style={{
            background: 'rgba(15, 13, 10, 0.6)',
            padding: '3px 10px',
            fontSize: '10px',
            color: 'var(--accent-green)',
            letterSpacing: '0.08em',
            fontFamily: "'Be Vietnam Pro', sans-serif",
            border: '1px solid rgba(61, 187, 120, 0.2)',
            whiteSpace: 'nowrap',
          }}>
            {hudData.distance < 1000
              ? `${Math.round(hudData.distance)}m`
              : `${(hudData.distance / 1000).toFixed(1)}km`
            } to next
          </div>
        </div>
      )}

      {/* Bottom hint */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15, 13, 10, 0.7)',
        backdropFilter: 'blur(8px)',
        padding: '6px 16px',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        border: '1px solid rgba(245, 240, 232, 0.08)',
      }}>
        Drag to look around / Scroll to zoom
      </div>
    </div>
  )
}
