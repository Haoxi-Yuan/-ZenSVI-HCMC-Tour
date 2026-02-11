import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import LayerSwitcher from './LayerSwitcher'

/**
 * Mini-map showing current position on the street.
 */
export default function MiniMap({ points, currentIndex, onPointClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !points || points.length === 0) return

    const center = [points[0].lon, points[0].lat]

    if (!mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: containerRef.current,
        style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=2CwZLYrGxLYfszauo1Ec',
        center,
        zoom: 16,
        pitch: 50,
        interactive: true,
        attributionControl: false,
      })

      mapRef.current.on('load', () => {
        // Hex grid for segmentation layers
        mapRef.current.addSource('hex-grid', {
          type: 'geojson',
          data: '/api/layers/hex-grid',
        })
        mapRef.current.addLayer({
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
        })

        // Streets GeoJSON for walkability layer switching
        mapRef.current.addSource('streets', {
          type: 'geojson',
          data: '/api/layers/streets-geojson',
        })
        mapRef.current.addLayer({
          id: 'streets-line',
          type: 'line',
          source: 'streets',
          layout: { visibility: 'none' },
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
              14, 2,
              18, 4,
            ],
            'line-opacity': 0.6,
          },
        })

        // Street path (current tour route)
        const coords = points.map(p => [p.lon, p.lat])
        mapRef.current.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
          },
        })
        mapRef.current.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#3DBB78',
            'line-width': 3,
            'line-opacity': 0.6,
          },
        })

        // Point markers
        mapRef.current.addSource('points', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: points.map((p, i) => ({
              type: 'Feature',
              properties: { index: i, id: p.id },
              geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            })),
          },
        })
        mapRef.current.addLayer({
          id: 'points-circles',
          type: 'circle',
          source: 'points',
          paint: {
            'circle-radius': 4,
            'circle-color': 'rgba(245, 240, 232, 0.3)',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(245, 240, 232, 0.15)',
          },
        })

        // Click handler
        mapRef.current.on('click', 'points-circles', (e) => {
          const idx = e.features[0].properties.index
          if (onPointClick) onPointClick(idx)
        })
        mapRef.current.on('mouseenter', 'points-circles', () => {
          mapRef.current.getCanvas().style.cursor = 'pointer'
        })
        mapRef.current.on('mouseleave', 'points-circles', () => {
          mapRef.current.getCanvas().style.cursor = ''
        })

        setMapReady(true)
      })

      // Current position marker
      const el = document.createElement('div')
      el.style.width = '14px'
      el.style.height = '14px'
      el.style.background = '#3DBB78'
      el.style.border = '2px solid #F5F0E8'
      el.style.borderRadius = '50%'
      el.style.boxShadow = '0 0 8px rgba(61, 187, 120, 0.6)'
      markerRef.current = new maplibregl.Marker(el).setLngLat(center).addTo(mapRef.current)
    }

    return () => {
      // Don't destroy on re-render, only on unmount handled by React
    }
  }, [points])

  // Update marker position
  useEffect(() => {
    if (!points || !markerRef.current || currentIndex === undefined) return
    const p = points[currentIndex]
    if (p) {
      markerRef.current.setLngLat([p.lon, p.lat])
      mapRef.current?.easeTo({ center: [p.lon, p.lat], duration: 500 })
    }
  }, [currentIndex, points])

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      width: '240px',
      height: '180px',
      border: '1px solid rgba(245, 240, 232, 0.1)',
      overflow: 'visible',
      zIndex: 40,
      background: 'var(--bg-deep)',
    }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
      <div style={{
        position: 'absolute',
        top: '8px',
        left: '8px',
        fontSize: '10px',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        background: 'rgba(15, 13, 10, 0.7)',
        padding: '3px 8px',
      }}>Mini Map</div>
      {mapReady && <LayerSwitcher map={mapRef.current} compact />}
    </div>
  )
}
