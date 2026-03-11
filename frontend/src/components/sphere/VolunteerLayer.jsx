/**
 * VolunteerLayer — gold-bordered markers for volunteer-visited faces.
 *
 * Spec §2.7: "志愿者实际调研并拍摄过的采样点使用金色边框加缓慢脉冲动画"
 *
 * Includes SHAP comparison: compares model's top features against volunteer
 * observations. Labels each match as "验证通过" (Verified) or "值得探讨"
 * (Worth Discussing) based on alignment between model and human perceptions.
 */

import { useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useSphereApi } from '../../hooks/useSphereApi'
import { useSphere } from '../../contexts/SphereContext'
import {
  FEATURE_LABELS,
  FEATURE_CATEGORIES,
  CATEGORY_COLORS,
  DIM_CONFIG,
} from '../../utils/sphereConstants'

/**
 * Keyword → feature mapping for aligning volunteer notes with SHAP features.
 * Each keyword can map to multiple features. Matching is case-insensitive.
 */
const NOTE_FEATURE_MAP = {
  // Vegetation / shade
  'shade': ['seg_vegetation', 'det_tree'],
  'tree': ['seg_vegetation', 'det_tree'],
  'green': ['seg_vegetation', 'det_tree'],
  'vegetation': ['seg_vegetation', 'det_tree'],
  'park': ['seg_vegetation', 'seg_terrain'],
  'garden': ['seg_vegetation', 'seg_terrain'],

  // Sidewalk / pedestrian
  'sidewalk': ['seg_sidewalk'],
  'pavement': ['seg_sidewalk'],
  'pedestrian': ['seg_sidewalk', 'seg_person', 'det_person'],
  'walk': ['seg_sidewalk', 'seg_person'],
  'footpath': ['seg_sidewalk'],

  // Vehicles / traffic
  'motorcycle': ['seg_motorcycle', 'det_motorbike'],
  'motorbike': ['seg_motorcycle', 'det_motorbike'],
  'car': ['seg_car', 'det_car'],
  'vehicle': ['seg_car', 'seg_motorcycle', 'det_car', 'det_motorbike'],
  'traffic': ['seg_car', 'seg_motorcycle', 'seg_traffic_light', 'seg_traffic_sign'],
  'bus': ['seg_bus'],
  'truck': ['seg_truck'],
  'parking': ['seg_car', 'seg_motorcycle', 'det_motorbike', 'det_car'],

  // People
  'people': ['seg_person', 'det_person'],
  'crowd': ['seg_person', 'det_person'],
  'person': ['seg_person', 'det_person'],

  // Infrastructure
  'building': ['seg_building'],
  'shop': ['seg_building'],
  'store': ['seg_building'],
  'wall': ['seg_wall'],
  'fence': ['seg_fence'],
  'pole': ['seg_pole'],
  'sign': ['seg_traffic_sign'],

  // Road
  'road': ['seg_road'],
  'street': ['seg_road', 'seg_sidewalk'],
  'lane': ['seg_road'],

  // General quality indicators
  'narrow': ['seg_sidewalk'],
  'wide': ['seg_road', 'seg_sidewalk'],
  'encroach': ['seg_motorcycle', 'det_motorbike', 'seg_sidewalk'],
  'occupy': ['seg_motorcycle', 'det_motorbike', 'seg_sidewalk'],
  'clutter': ['det_motorbike', 'det_car', 'seg_pole'],
  'dirty': ['seg_road', 'seg_terrain'],
  'safe': ['seg_sidewalk', 'seg_vegetation'],
  'danger': ['seg_car', 'seg_motorcycle'],
  'noisy': ['seg_car', 'seg_motorcycle', 'det_motorbike'],
  'quiet': ['seg_vegetation', 'seg_terrain'],
  'beautiful': ['seg_vegetation', 'seg_building'],
  'ugly': ['seg_wall', 'seg_fence'],
  'boring': ['seg_road', 'seg_wall'],
  'lively': ['seg_person', 'det_person', 'seg_building'],
  'depress': ['seg_wall', 'seg_fence'],
  'sky': ['seg_sky'],
  'open': ['seg_sky', 'seg_road'],
}

/**
 * Negative-sentiment keywords that indicate the volunteer observed problems.
 * Used to determine direction of alignment (positive vs negative perception).
 */
const NEGATIVE_KEYWORDS = new Set([
  'no', 'few', 'narrow', 'encroach', 'occupy', 'taken', 'clutter', 'dirty',
  'danger', 'noisy', 'ugly', 'boring', 'depress', 'lack', 'poor', 'bad',
  'broken', 'damage', 'block', 'crowd', 'congest', 'flood', 'dark',
])

/**
 * Analyze alignment between model SHAP profile and volunteer note.
 *
 * @param {string} note - Volunteer observation text
 * @param {object} shapData - SHAP data from /api/sphere/shap-all/{idx}
 * @param {string} activeDim - Currently active perception dimension
 * @returns {{ verdict: 'verified'|'discuss'|'neutral', score: number, modelTopFeatures: Array, noteFeatures: Array, explanation: string }}
 */
function analyzeAlignment(note, shapData, activeDim) {
  if (!note || !note.trim() || !shapData?.dimensions?.[activeDim]) {
    return { verdict: 'neutral', score: 0, modelTopFeatures: [], noteFeatures: [], explanation: '' }
  }

  const dimData = shapData.dimensions[activeDim]
  const contributions = dimData.contributions || []

  // Sort by absolute SHAP value, take top features
  const sorted = [...contributions].sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
  const modelTopFeatures = sorted.slice(0, 5)
  const modelTopSet = new Set(modelTopFeatures.map(f => f.feature))

  // Extract features mentioned in volunteer note
  const noteLower = note.toLowerCase()
  const noteFeatures = new Set()
  const matchedKeywords = []

  for (const [keyword, features] of Object.entries(NOTE_FEATURE_MAP)) {
    if (noteLower.includes(keyword)) {
      matchedKeywords.push(keyword)
      for (const f of features) noteFeatures.add(f)
    }
  }

  if (noteFeatures.size === 0) {
    return { verdict: 'neutral', score: 0, modelTopFeatures, noteFeatures: [], explanation: 'Note does not reference specific features' }
  }

  // Determine if note sentiment is negative
  const hasNegative = [...NEGATIVE_KEYWORDS].some(kw => noteLower.includes(kw))

  // Compute overlap: how many note-mentioned features appear in model's top features
  let overlapCount = 0
  let directionMatch = 0
  const noteFeatureArr = [...noteFeatures]

  for (const nf of noteFeatureArr) {
    const modelEntry = contributions.find(c => c.feature === nf)
    if (!modelEntry) continue

    // Feature appears in model
    if (modelTopSet.has(nf)) overlapCount++

    // Check direction alignment:
    // If volunteer notes are negative and SHAP is also negative (contributing to worse perception),
    // or notes are positive and SHAP is positive — they align
    const shapSign = modelEntry.shap_value >= 0 ? 'positive' : 'negative'
    const inverted = DIM_CONFIG[activeDim]?.inverted
    const modelDirection = inverted
      ? (shapSign === 'positive' ? 'negative' : 'positive')
      : shapSign

    if (hasNegative && modelDirection === 'negative') directionMatch++
    else if (!hasNegative && modelDirection === 'positive') directionMatch++
  }

  const featureOverlapRatio = overlapCount / Math.max(1, noteFeatureArr.length)
  const directionRatio = directionMatch / Math.max(1, noteFeatureArr.length)

  // Combined score: 60% feature overlap + 40% direction alignment
  const score = featureOverlapRatio * 0.6 + directionRatio * 0.4

  let verdict, explanation
  if (score >= 0.35) {
    verdict = 'verified'
    explanation = `Model and volunteer agree on key features (${matchedKeywords.slice(0, 3).join(', ')})`
  } else {
    verdict = 'discuss'
    explanation = `Model emphasis differs from volunteer observations (${matchedKeywords.slice(0, 3).join(', ')})`
  }

  return {
    verdict,
    score,
    modelTopFeatures,
    noteFeatures: noteFeatureArr,
    explanation,
  }
}

export default function VolunteerLayer({ map, bloomIndices }) {
  const getMatchKey = (m) => `${m.session}|${m.timestamp}|${m.matched_point_idx}|${m.volunteer_image || ''}`
  const api = useSphereApi()
  const { state } = useSphere()
  const { activeDim } = state
  const [volunteers, setVolunteers] = useState(null)
  const [activeMatch, setActiveMatch] = useState(null)
  const [shapCache, setShapCache] = useState({}) // idx -> shapData
  const [alignments, setAlignments] = useState({}) // idx -> alignment result

  // Fetch volunteer data
  useEffect(() => {
    api.fetchVolunteers().then(setVolunteers).catch(() => null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch SHAP data for matched volunteer points and compute alignments
  useEffect(() => {
    if (!volunteers || !bloomIndices.length || !activeDim) return

    const bloomSet = new Set(bloomIndices)
    const matched = (volunteers.matches || []).filter(
      m => bloomSet.has(m.matched_point_idx)
    )

    if (!matched.length) return

    // Fetch SHAP for all matched points (with concurrency limit)
    const fetchShapBatch = async () => {
      const newCache = { ...shapCache }
      const batchSize = 5
      const indices = matched.map(m => m.matched_point_idx).filter(idx => !newCache[idx])

      for (let i = 0; i < indices.length; i += batchSize) {
        const batch = indices.slice(i, i + batchSize)
        const results = await Promise.all(
          batch.map(idx => api.fetchShapAll(idx).then(d => ({ idx, data: d })).catch(() => null))
        )
        for (const r of results) {
          if (r) newCache[r.idx] = r.data
        }
      }
      setShapCache(newCache)

      // Compute alignments
      const newAlignments = {}
      for (const m of matched) {
        const shap = newCache[m.matched_point_idx]
        if (shap && m.note) {
          newAlignments[m.matched_point_idx] = analyzeAlignment(m.note, shap, activeDim)
        } else if (!m.note || !m.note.trim()) {
          newAlignments[m.matched_point_idx] = { verdict: 'neutral', score: 0, modelTopFeatures: [], noteFeatures: [], explanation: 'No observation notes' }
        }
      }
      setAlignments(newAlignments)
    }

    fetchShapBatch()
  }, [volunteers, bloomIndices, activeDim]) // eslint-disable-line react-hooks/exhaustive-deps

  // Add volunteer markers to map when both map and data are ready
  useEffect(() => {
    if (!map || !volunteers || !bloomIndices.length) return

    const bloomSet = new Set(bloomIndices)
    const matched = (volunteers.matches || []).filter(
      m => bloomSet.has(m.matched_point_idx)
    )

    if (!matched.length) return

    const addMarkers = () => {
      const markers = []
      for (const m of matched) {
        const alignment = alignments[m.matched_point_idx]
        const verdict = alignment?.verdict || 'neutral'

        const el = document.createElement('div')
        el.className = `volunteer-marker volunteer-marker--${verdict}`

        // Show verdict icon in marker
        const icon = verdict === 'verified' ? '✓'
          : verdict === 'discuss' ? '?'
          : 'V'
        el.innerHTML = `<div class="volunteer-marker-inner volunteer-marker-inner--${verdict}">${icon}</div>`

        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const key = getMatchKey(m)
          setActiveMatch(prev => {
            if (prev && getMatchKey(prev) === key) return null
            return m
          })
        })

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([m.volunteer_lon, m.volunteer_lat])
          .addTo(map)
        markers.push(marker)
      }

      const onMapClick = () => setActiveMatch(null)
      map.on('click', onMapClick)

      return () => {
        map.off('click', onMapClick)
        markers.forEach(mk => mk.remove())
      }
    }

    if (map.loaded()) {
      const cleanup = addMarkers()
      return cleanup
    } else {
      let cleanup
      const onLoad = () => { cleanup = addMarkers() }
      map.on('load', onLoad)
      return () => {
        map.off('load', onLoad)
        if (cleanup) cleanup()
      }
    }
  }, [map, volunteers, bloomIndices, alignments])

  // Render alignment details for the active match
  const renderAlignmentDetails = useCallback(() => {
    if (!activeMatch) return null
    const idx = activeMatch.matched_point_idx
    const alignment = alignments[idx]
    if (!alignment || alignment.verdict === 'neutral') return null

    const shap = shapCache[idx]
    const dimData = shap?.dimensions?.[activeDim]

    return (
      <div className="volunteer-alignment">
        {/* Verdict badge */}
        <div className={`volunteer-verdict volunteer-verdict--${alignment.verdict}`}>
          {alignment.verdict === 'verified' ? '验证通过 Verified' : '值得探讨 Worth Discussing'}
        </div>

        {/* Explanation */}
        <div className="volunteer-explanation">{alignment.explanation}</div>

        {/* Side-by-side comparison */}
        <div className="volunteer-comparison">
          {/* Model's top SHAP features */}
          <div className="volunteer-comp-col">
            <div className="volunteer-comp-label">Model sees</div>
            {alignment.modelTopFeatures.slice(0, 4).map(f => {
              const cat = FEATURE_CATEGORIES[f.feature]
              const color = CATEGORY_COLORS[cat] || '#A89F91'
              const sign = f.shap_value >= 0 ? '+' : ''
              return (
                <div key={f.feature} className="volunteer-comp-feature">
                  <span
                    className="volunteer-comp-dot"
                    style={{ background: color }}
                  />
                  <span className="volunteer-comp-name">
                    {FEATURE_LABELS[f.feature] || f.feature}
                  </span>
                  <span className={`volunteer-comp-value ${f.shap_value >= 0 ? 'positive' : 'negative'}`}>
                    {sign}{f.shap_value.toFixed(3)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Volunteer's noted features */}
          <div className="volunteer-comp-col">
            <div className="volunteer-comp-label">Volunteer noticed</div>
            {alignment.noteFeatures.length > 0 ? (
              alignment.noteFeatures.slice(0, 4).map(f => {
                const cat = FEATURE_CATEGORIES[f]
                const color = CATEGORY_COLORS[cat] || '#A89F91'
                const modelEntry = dimData?.contributions?.find(c => c.feature === f)
                return (
                  <div key={f} className="volunteer-comp-feature">
                    <span
                      className="volunteer-comp-dot"
                      style={{ background: color }}
                    />
                    <span className="volunteer-comp-name">
                      {FEATURE_LABELS[f] || f}
                    </span>
                    {modelEntry && (
                      <span className={`volunteer-comp-value ${modelEntry.shap_value >= 0 ? 'positive' : 'negative'}`}>
                        {modelEntry.shap_value >= 0 ? '+' : ''}{modelEntry.shap_value.toFixed(3)}
                      </span>
                    )}
                  </div>
                )
              })
            ) : (
              <div className="volunteer-comp-empty">No specific features noted</div>
            )}
          </div>
        </div>
      </div>
    )
  }, [activeMatch, alignments, shapCache, activeDim])

  return (
    <>
      {activeMatch && (
        <div className="volunteer-popup">
          <div className="volunteer-popup-header">
            <span className="volunteer-popup-name">{activeMatch.volunteer}</span>
            <span className="volunteer-popup-session">Session {activeMatch.session}</span>
            <button
              className="volunteer-popup-close"
              onClick={() => setActiveMatch(null)}
            >
              ×
            </button>
          </div>
          {activeMatch.volunteer_image && (
            <img
              src={`/api/sphere/volunteers/image/${activeMatch.volunteer_image}`}
              alt="Volunteer photo"
              className="volunteer-popup-img"
            />
          )}
          {activeMatch.note && (
            <div className="volunteer-popup-note">"{activeMatch.note}"</div>
          )}

          {/* SHAP comparison panel */}
          {renderAlignmentDetails()}

          <div className="volunteer-popup-meta">
            Point #{activeMatch.matched_point_idx} &middot; {activeMatch.match_distance_m?.toFixed(0)}m match
          </div>
        </div>
      )}
    </>
  )
}
