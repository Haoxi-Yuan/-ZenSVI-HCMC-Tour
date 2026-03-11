/**
 * BloomMapView — MapLibre map for Phase 5 (Bloom to Map).
 *
 * Shows geographic distribution of perception-similar faces,
 * problem panel, and volunteer markers.
 *
 * Spec §2.5: "面片最终落到Mapbox GL JS地图上对应的真实地理位置"
 */

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSphere } from '../../contexts/SphereContext'
import { useSphereApi } from '../../hooks/useSphereApi'
import ProblemPanel from './ProblemPanel'
import VolunteerLayer from './VolunteerLayer'
import {
  DIM_CONFIG,
  scoreToColor,
} from '../../utils/sphereConstants'

export default function BloomMapView({ onRetract }) {
  const MAX_BLOOM_MAP_POINTS = 600
  const DETAIL_CONCURRENCY = 20
  const DETAIL_FLUSH_EVERY = 80

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const { state } = useSphere()
  const { similarFaces, activeDim } = state
  const api = useSphereApi()

  const [faceDetails, setFaceDetails] = useState([])
  const [loading, setLoading] = useState(true)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [loadStats, setLoadStats] = useState({ loaded: 0, total: 0 })

  // Fetch detail for bloom faces (progressive, concurrency-limited)
  useEffect(() => {
    if (!similarFaces.length) {
      setFaceDetails([])
      setLoading(false)
      setLoadStats({ loaded: 0, total: 0 })
      return
    }

    let canceled = false
    setLoading(true)
    setFaceDetails([])

    const uniqueIdx = [...new Set(similarFaces.map(f => f.idx))]
      .slice(0, MAX_BLOOM_MAP_POINTS)
    const total = uniqueIdx.length
    setLoadStats({ loaded: 0, total })

    async function fetchProgressively() {
      const results = []
      let cursor = 0
      let loaded = 0

      const flush = () => {
        if (canceled) return
        setFaceDetails([...results])
        setLoadStats({ loaded, total })
      }

      const worker = async () => {
        while (!canceled) {
          const i = cursor++
          if (i >= uniqueIdx.length) return
          const idx = uniqueIdx[i]
          const detail = await api.fetchPointDetail(idx).catch(() => null)
          if (detail) results.push(detail)
          loaded += 1
          if (loaded % DETAIL_FLUSH_EVERY === 0) flush()
        }
      }

      const workers = new Array(Math.min(DETAIL_CONCURRENCY, uniqueIdx.length))
        .fill(null)
        .map(() => worker())

      await Promise.all(workers)
      if (canceled) return
      flush()
      setLoading(false)
    }

    fetchProgressively()

    return () => {
      canceled = true
    }
  }, [similarFaces]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [106.66, 10.78], // HCMC center
      zoom: 11,
    })
    mapRef.current = map

    map.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      try {
        if (map._bloomThumbMarkers) map._bloomThumbMarkers.forEach(m => m.remove())
        map.remove()
      } catch { /* AbortError from pending tile fetches — harmless */ }
      mapRef.current = null
    }
  }, [])

  // Update glow layer + thumbnail markers as data arrives.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    const features = faceDetails.map((d) => {
      const score = d.perception?.[activeDim] || 5
      const norm = Math.max(0, Math.min(1, score / 10))
      const inverted = DIM_CONFIG[activeDim]?.inverted || false
      const [r, g, b] = scoreToColor(norm, inverted)
      const color = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: { idx: d.idx, color },
      }
    })

    const geojson = { type: 'FeatureCollection', features }

    if (!map.getSource('bloom-faces')) {
      map.addSource('bloom-faces', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'bloom-glow',
        type: 'circle',
        source: 'bloom-faces',
        paint: {
          'circle-radius': 24,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.2,
          'circle-blur': 1,
        },
      })
    } else {
      map.getSource('bloom-faces').setData(geojson)
    }

    if (map._bloomThumbMarkers) {
      map._bloomThumbMarkers.forEach(m => m.remove())
    }

    const thumbMarkers = []
    for (const d of faceDetails) {
      const score = d.perception?.[activeDim] || 5
      const norm = Math.max(0, Math.min(1, score / 10))
      const inverted = DIM_CONFIG[activeDim]?.inverted || false
      const [r, g, b] = scoreToColor(norm, inverted)
      const borderColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`

      const el = document.createElement('div')
      el.className = 'bloom-thumb-marker'
      el.style.cssText = `
        width:48px;height:48px;border-radius:6px;overflow:hidden;cursor:pointer;
        border:2px solid ${borderColor};box-shadow:0 0 8px ${borderColor}40;
        background:#1A1714;transition:transform 0.2s;
      `
      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.24)' })
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })

      const img = document.createElement('img')
      img.src = `/api/sphere/thumbnails/${d.idx}/128`
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
      img.onerror = () => { img.style.display = 'none' }
      el.appendChild(img)

      el.addEventListener('click', () => {
        new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat([d.lon, d.lat])
          .setHTML(`
            <div style="color:#0F0D0A;font-family:sans-serif;">
              <div style="font-weight:bold;margin-bottom:4px;">Point #${d.idx}</div>
              <div>${d.district_name || d.district || ''}</div>
              <div>${DIM_CONFIG[activeDim]?.label}: ${score.toFixed(2)}</div>
              <img src="/api/sphere/thumbnails/${d.idx}/128"
                   style="width:100%;margin-top:8px;border-radius:4px;"
                   onerror="this.style.display='none'" />
            </div>
          `)
          .addTo(map)
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([d.lon, d.lat])
        .addTo(map)
      thumbMarkers.push(marker)
    }
    map._bloomThumbMarkers = thumbMarkers

    // Fit once after full fetch; avoid camera jitter during progressive updates.
    if (!loading && loadStats.total > 0 && faceDetails.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      faceDetails.forEach(d => bounds.extend([d.lon, d.lat]))
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 })
    }
  }, [mapLoaded, faceDetails, activeDim, loading, loadStats.total])

  const bloomIndices = similarFaces.map(f => f.idx)

  return (
    <div className="bloom-view">
      <div className="bloom-map-container" ref={mapContainerRef} />

      <button className="bloom-retract-btn" onClick={onRetract}>
        Retract
      </button>

      <div className="bloom-info">
        <div className="bloom-info-title">
          {bloomIndices.length} similar streets &middot; {DIM_CONFIG[activeDim]?.label}
        </div>
      </div>

      {/* Problem Panel (right side) */}
      <ProblemPanel faceIndices={bloomIndices} />

      {/* Volunteer Layer */}
      <VolunteerLayer
        map={mapRef.current}
        bloomIndices={bloomIndices}
      />

      {loading && (
        <div className="bloom-loading">
          Loading map data... {loadStats.loaded}/{loadStats.total}
        </div>
      )}
    </div>
  )
}
