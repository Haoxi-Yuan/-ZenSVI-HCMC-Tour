import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import Navbar from '../components/Navbar'
import StreetSearch from '../components/StreetSearch'
import StreetRanking from '../components/StreetRanking'
import FeaturedStreets from '../components/FeaturedStreets'
import LayerSwitcher from '../components/LayerSwitcher'
import CompareMode from '../components/CompareMode'
import StoryCamera from '../components/StoryCamera'
import ResearchGraph from '../components/ResearchGraph'
import { useCityStats } from '../hooks/useStreetData'

function Counter({ target, suffix = '', decimals = 0 }) {
  const [value, setValue] = useState(0)
  const ref = useRef(null)
  const animated = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !animated.current) {
        animated.current = true
        const start = performance.now()
        const duration = 2000
        const step = (now) => {
          const progress = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          setValue(target * eased)
          if (progress < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
    }, { threshold: 0.3 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target])

  return (
    <span ref={ref}>
      {decimals > 0 ? value.toFixed(decimals) : Math.round(value)}
      {suffix && <span className="stat-unit">{suffix}</span>}
    </span>
  )
}

function StatCard({ value, suffix, label, sublabel, color, delay, decimals = 0 }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => setVisible(true), delay)
      }
    }, { threshold: 0.15 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [delay])

  return (
    <div ref={ref} className={`stat-card ${color} ${visible ? 'visible' : ''}`}>
      <div className="stat-number">
        <Counter target={value} suffix={suffix} decimals={decimals} />
      </div>
      <div className="stat-label">{label}</div>
      {sublabel && <div className="stat-sublabel">{sublabel}</div>}
    </div>
  )
}

function HeroSection() {
  return (
    <section className="hero" id="hero">
      <div className="hero-bg" />
      <video
        autoPlay
        loop
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.35,
          pointerEvents: 'none',
        }}
        src="/hero-bg.mp4"
      />
      <div className="hero-scanlines" />
      <div className="hero-content">
        <div className="hero-label">Immersive Walkability Study</div>
        <h1 className="hero-title">Walking<br /><em>HCMC</em></h1>
        <p className="hero-subtitle-vn">Buoc Chan HCMC</p>
        <p className="hero-desc">
          An immersive exploration of walkability across Ho Chi Minh City’s 24 districts,
          revealing how pedestrians navigate a motorbike-oriented city through 267,455
          street-level observations.
        </p>
        <a href="#map-section" className="hero-cta">
          Explore the streets
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </a>
      </div>
      <div className="hero-scroll-hint">
        <div className="scroll-line" />
      </div>
    </section>
  )
}


function DataSection() {
  const { stats, loading } = useCityStats()

  if (loading || !stats) return null

  return (
    <section className="data-section" id="data">
      <div className="section-label">The Data</div>
      <h2 className="section-title">Mapping every street,<br />one image at a time</h2>
      <p className="section-desc">
        We analyzed over one million street-level images across all 24 districts
        of Ho Chi Minh City, computing walkability through safety, accessibility,
        and comfort dimensions.
      </p>
      <div className="stats-grid">
        <StatCard value={stats.total_districts} suffix="" label="Districts analyzed" sublabel="Covering the entire HCMC metropolitan area" color="green" delay={0} />
        <StatCard value={267} suffix="K" label="Sampling points" sublabel="Every navigable street corner" color="gold" delay={150} />
        <StatCard value={1.07} suffix="M" label="Street-level images" sublabel="4 directions per point, 640x640 px" color="green" delay={300} decimals={2} />
        <StatCard value={stats.walkability?.mean || 5.0} suffix="/10" label="Average walkability score" sublabel={`Range: ${stats.walkability?.min?.toFixed(1)} - ${stats.walkability?.max?.toFixed(1)}`} color="orange" delay={450} decimals={1} />
      </div>
    </section>
  )
}

function MapSection() {
  const mapContainer = useRef(null)
  const mapWrapperRef = useRef(null) // wrapper div for CompareMode overlay
  const map = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [compareActive, setCompareActive] = useState(false)
  const [storyActive, setStoryActive] = useState(false)
  const modeRef = useRef({ compare: false, story: false }) // avoid stale closures
  const navigate = useNavigate()

  // Keep modeRef in sync
  useEffect(() => {
    modeRef.current = { compare: compareActive, story: storyActive }
  }, [compareActive, storyActive])

  useEffect(() => {
    // React 18 StrictMode runs effects twice in dev (mount -> cleanup -> mount).
    // If we remove the map in cleanup but don't null out the ref, the second run
    // will early-return and the map stays blank.
    if (map.current) return
    if (!mapContainer.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=2CwZLYrGxLYfszauo1Ec',
      center: [106.695, 10.775],
      zoom: 12,
      pitch: 30,
      bearing: -15,
      antialias: true,
    })

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.current.on('load', () => {
      // Load streets GeoJSON
      map.current.addSource('streets', {
        type: 'geojson',
        data: '/api/layers/streets-geojson',
      })

      map.current.addLayer({
        id: 'streets-line',
        type: 'line',
        source: 'streets',
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'walkability'],
            2, '#E8734A',
            4, '#D4A855',
            5.5, '#3DBB78',
            7, '#2AAF65',
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 1,
            14, 3,
            18, 6,
          ],
          'line-opacity': 0.7,
        },
      })

      // Hover
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })

      map.current.on('mousemove', 'streets-line', (e) => {
        map.current.getCanvas().style.cursor = 'pointer'
        const props = e.features[0].properties
        const score = props.walkability?.toFixed(1) || '—'
        const cls = props.walkability >= 5.5 ? 'high' : props.walkability >= 4.5 ? 'mid' : 'low'
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Playfair Display',serif;font-size:16px;margin-bottom:8px">${props.name || 'Unnamed'}</div>
          <div style="font-size:28px;font-weight:700;color:${cls === 'high' ? '#3DBB78' : cls === 'mid' ? '#D4A855' : '#E8734A'}">${score}</div>
          <div style="font-size:11px;color:#6B6358;margin-top:2px">Walkability Score</div>
        `).addTo(map.current)
      })

      map.current.on('mouseleave', 'streets-line', () => {
        map.current.getCanvas().style.cursor = ''
        popup.remove()
      })

      // Hex grid for segmentation layers
      map.current.addSource('hex-grid', {
        type: 'geojson',
        data: '/api/layers/hex-grid',
      })
      map.current.addLayer({
        id: 'hex-fill',
        type: 'fill-extrusion',
        source: 'hex-grid',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': 'rgba(0,0,0,0)',
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
        },
      }, 'streets-line')

      // Click to enter tour (guarded: disabled during compare/story modes)
      map.current.on('click', 'streets-line', (e) => {
        if (modeRef.current.compare || modeRef.current.story) return
        const name = e.features[0].properties.name
        if (name) {
          navigate(`/tour/${encodeURIComponent(name)}`)
        }
      })

      setMapReady(true)
    })

    return () => {
      if (map.current) {
        map.current.remove()
        map.current = null
      }
    }
  }, [navigate])

  return (
    <section className="map-section" id="map-section">
      <div className="map-sidebar">
        <div className="section-label">Interactive Map</div>
        <h2 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '28px',
          fontWeight: 700,
          marginBottom: '8px',
        }}>Street Explorer</h2>
        <p style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          fontWeight: 300,
          marginBottom: '32px',
          lineHeight: 1.7,
        }}>
          Click any street to enter the immersive street-level tour.
          Streets are colored by their walkability score from our analysis
          of {(267455).toLocaleString()} sampling points.
        </p>

        <div style={{ marginBottom: '32px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '10px',
          }}>Search Street / Tim duong</label>
          <StreetSearch placeholder="Enter street name..." />
        </div>

        <div style={{ marginBottom: '32px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '10px',
          }}>Street Rankings / Xep hang duong</label>
          <StreetRanking />
        </div>

        <div style={{ marginBottom: '32px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '10px',
          }}>Featured Streets / Case Studies</label>
          <FeaturedStreets />
        </div>

        <div className="legend" style={{ marginBottom: '40px' }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            marginBottom: '14px',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}>Walkability Score</div>
          <div style={{
            height: '8px',
            background: 'linear-gradient(to right, #E8734A, #D4A855, #3DBB78)',
            marginBottom: '8px',
          }} />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}>
            <span>Low (Unwalkable)</span>
            <span>Moderate</span>
            <span>High (Walkable)</span>
          </div>
        </div>

        {mapReady && !compareActive && !storyActive && <LayerSwitcher map={map.current} />}

        {/* Mode toggle buttons */}
        {mapReady && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              className="mode-toggle-btn"
              onClick={() => setCompareActive(true)}
              disabled={storyActive || compareActive}
            >
              {compareActive ? 'Comparing...' : 'Compare Dimensions'}
            </button>
            <button
              className="mode-toggle-btn"
              onClick={() => setStoryActive(true)}
              disabled={compareActive || storyActive}
            >
              {storyActive ? 'Playing...' : 'Story Tour'}
            </button>
          </div>
        )}
      </div>

      <div className="map-container" ref={mapWrapperRef}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        {!compareActive && !storyActive && (
          <div className="map-overlay-label">
            <strong>Walkability Index</strong> / Click a street to explore
          </div>
        )}
        {compareActive && map.current && (
          <CompareMode
            mainMap={map.current}
            containerRef={mapWrapperRef}
            onExit={() => setCompareActive(false)}
          />
        )}
        {storyActive && map.current && (
          <StoryCamera
            map={map.current}
            onExit={() => setStoryActive(false)}
          />
        )}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer id="about" style={{
      padding: '80px 48px',
      borderTop: '1px solid var(--border-subtle)',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: '20px',
        marginBottom: '12px',
      }}>Buoc Chan HCMC</div>
      <div style={{
        fontSize: '13px',
        color: 'var(--text-muted)',
        marginBottom: '32px',
      }}>An Immersive Walkability Study of Ho Chi Minh City</div>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '48px',
        alignItems: 'center',
        opacity: 0.4,
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>ZenSVI Research</span>
      </div>
      <div style={{
        marginTop: '48px',
        fontSize: '11px',
        color: 'var(--text-muted)',
      }}>2026 Walkability Research Group</div>
    </footer>
  )
}

export default function LandingPage() {
  return (
    <>
      <Navbar transparent />
      <HeroSection />
      <DataSection />
      <ResearchGraph />
      <MapSection />
      <Footer />
    </>
  )
}
