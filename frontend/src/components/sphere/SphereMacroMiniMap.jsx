/**
 * SphereMacroMiniMap — MapLibre mini-map showing current point location
 * in HCMC with city boundary outline and a red dot marker.
 */

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'

const HCMC_CENTER = [106.66, 10.78]
const HCMC_ZOOM = 11

export default function SphereMacroMiniMap({ lat, lon }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: HCMC_CENTER,
      zoom: HCMC_ZOOM,
      interactive: false,
      attributionControl: false,
    })

    map.on('load', () => {
      // HCMC street network as subtle boundary context
      map.addSource('hcmc-streets', {
        type: 'geojson',
        data: '/api/layers/streets-geojson',
      })
      map.addLayer({
        id: 'hcmc-streets-line',
        type: 'line',
        source: 'hcmc-streets',
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.12)',
          'line-width': 0.5,
        },
      })
      setMapReady(true)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  // Place/update marker when map is ready and lat/lon available
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || lat == null || lon == null) return

    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat])
    } else {
      const el = document.createElement('div')
      el.className = 'macro-map-marker'
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map)
    }

    map.flyTo({ center: [lon, lat], zoom: 13, duration: 800 })
  }, [lat, lon, mapReady])

  return (
    <div className="fp-hud-macro">
      <div className="fp-hud-macro-title">Macro Position</div>
      <div ref={containerRef} className="fp-hud-macro-map" />
    </div>
  )
}
