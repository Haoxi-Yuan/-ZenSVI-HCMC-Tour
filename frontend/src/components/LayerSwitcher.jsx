import { useState, useEffect, useRef } from 'react'
import { SCORE_COLOR_STOPS } from '../utils/mapConstants'

const WALKABILITY_LAYERS = [
  { id: 'walkability', label: 'Overall Walkability', property: 'walkability' },
  { id: 'safety', label: 'Safety', property: 'safety' },
  { id: 'accessibility', label: 'Accessibility', property: 'accessibility' },
  { id: 'comfort', label: 'Comfort', property: 'comfort' },
]

const SEGMENTATION_GROUPS = [
  {
    name: 'Surface',
    layers: [
      { id: 'road', label: 'Road', color: '#8B7355', maxVal: 0.43 },
      { id: 'sidewalk', label: 'Sidewalk', color: '#A0917E', maxVal: 0.20 },
      { id: 'terrain', label: 'Terrain', color: '#5C9E6E', maxVal: 0.34 },
    ],
  },
  {
    name: 'Structures',
    layers: [
      { id: 'building', label: 'Building', color: '#6B6358', maxVal: 0.48 },
      { id: 'wall', label: 'Wall', color: '#5A524A', maxVal: 0.15 },
      { id: 'fence', label: 'Fence', color: '#4E463E', maxVal: 0.29 },
      { id: 'pole', label: 'Pole', color: '#7A7068', maxVal: 0.08 },
      { id: 'traffic_light', label: 'Traffic Light', color: '#E8734A', maxVal: 0.001 },
      { id: 'traffic_sign', label: 'Traffic Sign', color: '#D4A855', maxVal: 0.01 },
    ],
  },
  {
    name: 'Nature',
    layers: [
      { id: 'vegetation', label: 'Vegetation', color: '#3DBB78', maxVal: 0.73 },
      { id: 'sky', label: 'Sky', color: '#6B8DB5', maxVal: 0.50 },
    ],
  },
  {
    name: 'Vehicles',
    layers: [
      { id: 'car', label: 'Car', color: '#A0785C', maxVal: 0.063 },
      { id: 'motorcycle', label: 'Motorcycle', color: '#E87A50', maxVal: 0.023 },
      { id: 'bicycle', label: 'Bicycle', color: '#7BB58E', maxVal: 0.07 },
      { id: 'bus', label: 'Bus', color: '#957050', maxVal: 0.028 },
      { id: 'truck', label: 'Truck', color: '#886548', maxVal: 0.057 },
      { id: 'train', label: 'Train', color: '#786050', maxVal: 0.03 },
    ],
  },
  {
    name: 'People',
    layers: [
      { id: 'person', label: 'Person', color: '#C4956A', maxVal: 0.30 },
      { id: 'rider', label: 'Rider', color: '#B08560', maxVal: 0.048 },
    ],
  },
]

// Flat list for layer lookups
const SEGMENTATION_LAYERS = SEGMENTATION_GROUPS.flatMap(g => g.layers)

const ENVIRONMENT_LAYERS = [
  {
    id: 'walkability_score', label: 'Walkability', color: '#3DBB78',
    range: [2, 7], heightMax: 2000,
    colorStops: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
  },
  {
    id: 'safety_score', label: 'Safety', color: '#5B9BD5',
    range: [2, 8], heightMax: 2000,
    colorStops: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [8, '#2AAF65']],
  },
  {
    id: 'accessibility_score', label: 'Accessibility', color: '#9C6B3A',
    range: [0, 10], heightMax: 2000,
    colorStops: [[0, '#E8734A'], [3, '#D4A855'], [5.5, '#3DBB78'], [10, '#2AAF65']],
  },
  {
    id: 'comfort_score', label: 'Comfort', color: '#7A5C8D',
    range: [2, 7], heightMax: 2000,
    colorStops: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
  },
  {
    id: 'lst_avg', label: 'LST (°C)', color: '#E8734A',
    range: [0, 64], heightMax: 3000,
    colorStops: [[0, '#4575B4'], [20, '#91BFDB'], [30, '#FEE090'], [40, '#FC8D59'], [55, '#D73027'], [64, '#A50026']],
  },
  {
    id: 'avg_building_height', label: 'Building Height', color: '#5B9BD5',
    range: [0, 23], heightMax: 3000,
    colorStops: [[0, '#2C3E50'], [4, '#3498DB'], [8, '#9B59B6'], [14, '#E74C3C'], [23, '#F39C12']],
  },
]

// SCORE_COLOR_STOPS imported from ../utils/mapConstants

/**
 * Layer switcher for walkability street colors and hex grid layers.
 * @param {object} map - MapLibre map instance
 * @param {boolean} compact - Use compact dropdown UI for MiniMap
 */
export default function LayerSwitcher({ map, compact = false }) {
  const [activeWalk, setActiveWalk] = useState('walkability')
  // Single hex layer state: { type: 'seg'|'env', id: string } or null
  const [activeHex, setActiveHex] = useState(null)
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!compact || !open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [compact, open])

  // Update walkability street layer color property
  useEffect(() => {
    if (!map) return
    const applyWalk = () => {
      if (!map.getLayer('streets-line')) return
      if (!activeWalk) {
        map.setLayoutProperty('streets-line', 'visibility', 'none')
        return
      }
      map.setLayoutProperty('streets-line', 'visibility', 'visible')
      const stops = SCORE_COLOR_STOPS[activeWalk]
      const expr = ['interpolate', ['linear'], ['get', activeWalk]]
      stops.forEach(([val, color]) => { expr.push(val, color) })
      map.setPaintProperty('streets-line', 'line-color', expr)
    }

    if (map.isStyleLoaded()) {
      applyWalk()
    } else {
      map.once('idle', applyWalk)
    }
  }, [map, activeWalk])

  // Update hex grid layer (3D fill-extrusion) — handles both segmentation and environment
  useEffect(() => {
    if (!map) return
    const applyHex = () => {
      if (!map.getLayer('hex-fill')) return
      if (!activeHex) {
        map.setLayoutProperty('hex-fill', 'visibility', 'none')
        return
      }
      map.setLayoutProperty('hex-fill', 'visibility', 'visible')

      if (activeHex.type === 'seg') {
        const seg = SEGMENTATION_LAYERS.find(s => s.id === activeHex.id)
        if (!seg) return
        const m = seg.maxVal || 1
        map.setPaintProperty('hex-fill', 'fill-extrusion-color', [
          'interpolate', ['linear'], ['get', activeHex.id],
          0, 'rgba(0,0,0,0)',
          m * 0.01, seg.color + '40',
          m * 0.15, seg.color + '90',
          m * 0.4, seg.color + 'C0',
          m * 0.7, seg.color + 'E8',
          m, seg.color + 'FF',
        ])
        map.setPaintProperty('hex-fill', 'fill-extrusion-height', [
          'interpolate', ['linear'], ['get', activeHex.id],
          0, 0,
          m * 0.2, 600,
          m * 0.5, 1500,
          m, 3000,
        ])
      } else {
        // Environment layer
        const env = ENVIRONMENT_LAYERS.find(e => e.id === activeHex.id)
        if (!env) return
        const colorExpr = ['interpolate', ['linear'], ['get', activeHex.id]]
        env.colorStops.forEach(([val, color]) => { colorExpr.push(val, color) })
        map.setPaintProperty('hex-fill', 'fill-extrusion-color', colorExpr)

        const [rMin, rMax] = env.range
        map.setPaintProperty('hex-fill', 'fill-extrusion-height', [
          'interpolate', ['linear'], ['get', activeHex.id],
          rMin, 0,
          rMin + (rMax - rMin) * 0.25, env.heightMax * 0.15,
          rMin + (rMax - rMin) * 0.5, env.heightMax * 0.4,
          rMax, env.heightMax,
        ])
      }
    }

    if (map.isStyleLoaded()) {
      applyHex()
    } else {
      map.once('idle', applyHex)
    }
  }, [map, activeHex])

  const selectSeg = (id) => setActiveHex(id ? { type: 'seg', id } : null)
  const selectEnv = (id) => setActiveHex(id ? { type: 'env', id } : null)

  const content = (
    <div style={{ fontSize: compact ? '10px' : '12px' }}>
      {/* Walkability streets group */}
      <div style={{ marginBottom: compact ? '8px' : '16px' }}>
        <div style={{
          fontSize: compact ? '9px' : '11px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--accent-green)',
          marginBottom: compact ? '4px' : '8px',
          fontWeight: 500,
        }}>Walkability</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '3px' : '4px' }}>
          <LayerChip label="Off" active={!activeWalk} onClick={() => setActiveWalk(null)} compact={compact} />
          {WALKABILITY_LAYERS.map(l => (
            <LayerChip key={l.id} label={l.label} active={activeWalk === l.id} onClick={() => setActiveWalk(l.id)} compact={compact} />
          ))}
        </div>
      </div>

      {/* Segmentation hex group */}
      <div style={{ marginBottom: compact ? '8px' : '16px' }}>
        <div style={{
          fontSize: compact ? '9px' : '11px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--accent-gold)',
          marginBottom: compact ? '4px' : '8px',
          fontWeight: 500,
        }}>Segmentation</div>
        <div style={{ marginBottom: compact ? '4px' : '6px' }}>
          <LayerChip
            label="Off"
            active={!activeHex || activeHex.type !== 'seg'}
            onClick={() => { if (activeHex?.type === 'seg') selectSeg(null) }}
            compact={compact}
          />
        </div>
        {SEGMENTATION_GROUPS.map(group => (
          <div key={group.name} style={{ marginBottom: compact ? '4px' : '8px' }}>
            <div style={{
              fontSize: compact ? '8px' : '9px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: compact ? '2px' : '4px',
              opacity: 0.7,
            }}>{group.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '3px' : '4px' }}>
              {group.layers.map(l => (
                <LayerChip
                  key={l.id}
                  label={l.label}
                  active={activeHex?.type === 'seg' && activeHex.id === l.id}
                  onClick={() => selectSeg(l.id)}
                  compact={compact}
                  dotColor={l.color}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Environment hex group */}
      <div>
        <div style={{
          fontSize: compact ? '9px' : '11px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#5B9BD5',
          marginBottom: compact ? '4px' : '8px',
          fontWeight: 500,
        }}>Environment</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '3px' : '4px' }}>
          <LayerChip
            label="Off"
            active={!activeHex || activeHex.type !== 'env'}
            onClick={() => { if (activeHex?.type === 'env') selectEnv(null) }}
            compact={compact}
          />
          {ENVIRONMENT_LAYERS.map(l => (
            <LayerChip
              key={l.id}
              label={l.label}
              active={activeHex?.type === 'env' && activeHex.id === l.id}
              onClick={() => selectEnv(l.id)}
              compact={compact}
              dotColor={l.color}
            />
          ))}
        </div>
      </div>
    </div>
  )

  // Compact mode: dropdown
  if (compact) {
    return (
      <div ref={panelRef} style={{ position: 'absolute', bottom: '8px', left: '8px', zIndex: 10 }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            width: '28px',
            height: '28px',
            background: open ? 'rgba(245, 240, 232, 0.15)' : 'rgba(15, 13, 10, 0.7)',
            border: '1px solid rgba(245, 240, 232, 0.15)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          title="Switch layers"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M8 2L14 6L8 10L2 6Z" />
            <path d="M2 9L8 13L14 9" />
          </svg>
        </button>
        {open && (
          <div style={{
            position: 'absolute',
            bottom: '34px',
            left: 0,
            width: '220px',
            background: 'rgba(15, 13, 10, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(245, 240, 232, 0.1)',
            padding: '10px',
            maxHeight: '360px',
            overflowY: 'auto',
          }}>
            {content}
          </div>
        )}
      </div>
    )
  }

  // Full mode: inline panel
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      padding: '20px',
    }}>
      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.05em',
        marginBottom: '16px',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
      }}>Map Layers</div>
      {content}
    </div>
  )
}

function LayerChip({ label, active, onClick, compact, dotColor }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: compact ? '2px 6px' : '4px 10px',
        fontSize: compact ? '9px' : '11px',
        fontFamily: 'inherit',
        background: active ? 'rgba(245, 240, 232, 0.12)' : 'transparent',
        border: `1px solid ${active ? 'rgba(245, 240, 232, 0.25)' : 'rgba(245, 240, 232, 0.08)'}`,
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      {dotColor && (
        <span style={{
          width: compact ? '5px' : '6px',
          height: compact ? '5px' : '6px',
          background: dotColor,
          display: 'inline-block',
          borderRadius: '50%',
          opacity: active ? 1 : 0.4,
        }} />
      )}
      {label}
    </button>
  )
}
