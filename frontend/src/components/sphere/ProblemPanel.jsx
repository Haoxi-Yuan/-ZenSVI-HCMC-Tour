/**
 * ProblemPanel — aggregated walkability problem statistics for bloom view.
 *
 * Spec §2.6: "面板分为两层。上层是问题聚合统计...下层是具体案例，
 * 以图片加bounding box标注的形式逐条展示：一张街景原图上用目标检测框
 * 标出了问题区域，旁注问题类别和所在街道名称..."
 *
 * Since raw bounding box coordinates are not stored (detection pipeline only
 * persists aggregated counts), we display feature-evidence overlays instead:
 * - Detection count badges on thumbnails
 * - Feature value bars vs rule thresholds
 * - Problem-specific color-coded indicators
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSphereApi } from '../../hooks/useSphereApi'
import { PROBLEM_LABELS, FEATURE_LABELS, FEATURE_CATEGORIES, CATEGORY_COLORS } from '../../utils/sphereConstants'

/**
 * Problem rule definitions matching backend thresholds.
 * Each rule specifies: features used, condition description, threshold values,
 * and how to extract evidence from feature data.
 */
const PROBLEM_RULES = [
  {
    id: 0,
    name: 'Sidewalk Encroachment',
    icon: '\u26A0',  // ⚠
    color: '#E8734A',
    desc: 'Motorcycles/vehicles co-occur with sidewalk area',
    features: ['seg_motorcycle', 'seg_sidewalk'],
    getEvidence: (f) => [
      { label: 'Motorcycle', value: f.seg_motorcycle, threshold: 0.02, unit: '%', scale: 100, exceeds: f.seg_motorcycle > 0.02 },
      { label: 'Sidewalk', value: f.seg_sidewalk, threshold: 0.03, unit: '%', scale: 100, exceeds: f.seg_sidewalk > 0.03 },
    ],
  },
  {
    id: 1,
    name: 'Low Shade',
    icon: '\u2600',  // ☀
    color: '#D4A855',
    desc: 'Low vegetation with high sky exposure',
    features: ['seg_vegetation', 'seg_sky'],
    getEvidence: (f) => [
      { label: 'Vegetation', value: f.seg_vegetation, threshold: 0.05, unit: '%', scale: 100, exceeds: f.seg_vegetation < 0.05, invert: true },
      { label: 'Sky', value: f.seg_sky, threshold: 0.30, unit: '%', scale: 100, exceeds: f.seg_sky > 0.30 },
    ],
  },
  {
    id: 2,
    name: 'Pedestrian Space Deficit',
    icon: '\uD83D\uDEB6',  // 🚶
    color: '#7B93A8',
    desc: 'Very low sidewalk pixel ratio',
    features: ['seg_sidewalk'],
    getEvidence: (f) => [
      { label: 'Sidewalk', value: f.seg_sidewalk, threshold: 0.02, unit: '%', scale: 100, exceeds: f.seg_sidewalk < 0.02, invert: true },
    ],
  },
  {
    id: 3,
    name: 'Vehicle Dominance',
    icon: '\uD83D\uDE97',  // 🚗
    color: '#E8734A',
    desc: 'High proportion of vehicle pixels',
    features: ['seg_car', 'seg_motorcycle', 'seg_bus', 'seg_truck'],
    getEvidence: (f) => {
      const total = (f.seg_car || 0) + (f.seg_motorcycle || 0) + (f.seg_bus || 0) + (f.seg_truck || 0)
      return [
        { label: 'Vehicles total', value: total, threshold: 0.30, unit: '%', scale: 100, exceeds: total > 0.30 },
        { label: 'Car', value: f.seg_car, unit: '%', scale: 100 },
        { label: 'Motorcycle', value: f.seg_motorcycle, unit: '%', scale: 100 },
      ]
    },
  },
  {
    id: 4,
    name: 'Visual Clutter',
    icon: '\uD83D\uDCE6',  // 📦
    color: '#A89F91',
    desc: 'High density of detected objects',
    features: ['det_motorbike', 'det_car'],
    getEvidence: (f) => [
      { label: 'Motorbikes', value: f.det_motorbike, threshold: 5, unit: '', scale: 1, exceeds: f.det_motorbike > 5 },
      { label: 'Cars', value: f.det_car, threshold: 5, unit: '', scale: 1, exceeds: f.det_car > 5 },
    ],
  },
  {
    id: 5,
    name: 'Low Safety',
    icon: '\uD83D\uDEE1',  // 🛡
    color: '#C75B3A',
    desc: 'Safety perception in bottom quartile',
    features: ['perception_safer'],
    getEvidence: (f, perception) => [
      { label: 'Safety score', value: perception?.safer || 0, threshold: 3.0, unit: '', scale: 1, exceeds: (perception?.safer || 0) < 3.0, invert: true },
    ],
  },
]

/**
 * Canvas overlay component drawing detection regions + count badges on thumbnail.
 * Draws approximate spatial zones for detected objects based on typical street
 * view composition: sky (top), buildings (mid-top), vehicles (mid-bottom),
 * road/sidewalk (bottom). Helps visualize where problems concentrate.
 */
function DetectionOverlay({ features, imgRef, problems }) {
  const canvasRef = useRef(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    if (!img.naturalWidth) return  // Image not loaded yet

    canvas.width = img.offsetWidth
    canvas.height = img.offsetHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const w = canvas.width
    const h = canvas.height

    // Spatial region overlays — approximate zones based on street view composition
    // These draw semi-transparent colored zones where problems concentrate
    const regions = [
      // Vehicles occupy lower-mid (60-90% of image height)
      { keys: ['seg_motorcycle', 'seg_car', 'seg_bus', 'seg_truck'],
        y0: 0.55, y1: 0.90, color: '#E8734A', label: 'Vehicles' },
      // Sidewalk/pedestrian in lower band (75-100%)
      { keys: ['seg_sidewalk'],
        y0: 0.70, y1: 1.0, color: '#7B93A8', label: 'Sidewalk' },
      // Vegetation typically mid-height (20-60%)
      { keys: ['seg_vegetation'],
        y0: 0.15, y1: 0.55, color: '#3DBB78', label: 'Green' },
      // Sky in top band (0-30%)
      { keys: ['seg_sky'],
        y0: 0.0, y1: 0.30, color: '#6BA3D6', label: 'Sky' },
    ]

    for (const region of regions) {
      let total = 0
      for (const k of region.keys) total += (features?.[k] || 0)
      if (total < 0.02) continue  // Skip negligible regions

      const intensity = Math.min(0.35, total * 1.5)  // Cap overlay intensity
      const ry = Math.round(region.y0 * h)
      const rh = Math.round((region.y1 - region.y0) * h)

      // Gradient overlay (stronger in center, fading at edges)
      const grad = ctx.createLinearGradient(0, ry, 0, ry + rh)
      grad.addColorStop(0, region.color + '00')
      grad.addColorStop(0.3, region.color + Math.round(intensity * 255).toString(16).padStart(2, '0'))
      grad.addColorStop(0.7, region.color + Math.round(intensity * 255).toString(16).padStart(2, '0'))
      grad.addColorStop(1, region.color + '00')
      ctx.fillStyle = grad
      ctx.fillRect(0, ry, w, rh)

      // Region border lines
      ctx.strokeStyle = region.color
      ctx.lineWidth = 0.5
      ctx.globalAlpha = 0.4
      ctx.setLineDash([3, 3])
      ctx.strokeRect(2, ry + 2, w - 4, rh - 4)
      ctx.setLineDash([])
      ctx.globalAlpha = 1.0
    }

    // Detection count badges (top-right corner)
    const detections = [
      { key: 'det_motorbike', label: 'MBK', color: '#E8734A' },
      { key: 'det_car', label: 'CAR', color: '#D4A855' },
      { key: 'det_person', label: 'PER', color: '#3DBB78' },
      { key: 'det_tree', label: 'TRE', color: '#2D9F6F' },
    ]

    let y = 4
    for (const det of detections) {
      const count = features?.[det.key]
      if (count == null || count <= 0) continue

      const countRound = Math.round(count)
      const text = `${det.label}: ${countRound}`
      ctx.font = 'bold 9px sans-serif'
      const tw = ctx.measureText(text).width

      // Badge background
      ctx.fillStyle = 'rgba(15, 13, 10, 0.80)'
      ctx.beginPath()
      ctx.roundRect(w - tw - 10, y, tw + 8, 14, 3)
      ctx.fill()

      // Badge border
      ctx.strokeStyle = det.color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(w - tw - 10, y, tw + 8, 14, 3)
      ctx.stroke()

      // Badge text
      ctx.fillStyle = det.color
      ctx.fillText(text, w - tw - 6, y + 10)

      y += 17
    }

    // Segmentation composition bar at bottom
    const segs = [
      { key: 'seg_road', color: '#A89F91' },
      { key: 'seg_sidewalk', color: '#7B93A8' },
      { key: 'seg_vegetation', color: '#3DBB78' },
      { key: 'seg_building', color: '#D4A855' },
      { key: 'seg_sky', color: '#6BA3D6' },
      { key: 'seg_motorcycle', color: '#E8734A' },
      { key: 'seg_car', color: '#C97A3A' },
    ]

    let totalSeg = 0
    for (const s of segs) totalSeg += (features?.[s.key] || 0)
    if (totalSeg > 0) {
      const barH = 5
      const barY = h - barH
      let x = 0
      for (const s of segs) {
        const pct = (features?.[s.key] || 0) / totalSeg
        const segW = pct * w
        if (segW < 1) continue
        ctx.fillStyle = s.color
        ctx.globalAlpha = 0.8
        ctx.fillRect(x, barY, segW, barH)
        x += segW
      }
      ctx.globalAlpha = 1.0
    }
  }, [features, imgRef, problems])

  useEffect(() => {
    draw()
    // Redraw on image load
    const img = imgRef.current
    if (img) {
      img.addEventListener('load', draw)
      return () => img.removeEventListener('load', draw)
    }
  }, [draw, imgRef])

  return (
    <canvas
      ref={canvasRef}
      className="problem-case-canvas"
    />
  )
}

/**
 * CaseCard — individual case example with detection overlay and evidence bars.
 */
function CaseCard({ idx, problems, detail }) {
  const imgRef = useRef(null)
  const [expanded, setExpanded] = useState(false)

  const features = detail?.features || {}
  const perception = detail?.perception || {}

  return (
    <div className="problem-case" onClick={() => setExpanded(!expanded)}>
      {/* Image with detection overlay */}
      <div className="problem-case-img-wrapper">
        <img
          ref={imgRef}
          src={`/api/sphere/thumbnails/${idx}/128`}
          alt={`Point ${idx}`}
          className="problem-case-img"
        />
        {Object.keys(features).length > 0 && (
          <DetectionOverlay features={features} imgRef={imgRef} problems={problems} />
        )}
      </div>

      {/* Problem badges */}
      <div className="problem-case-badges">
        {problems.map((ruleIdx) => {
          const rule = PROBLEM_RULES[ruleIdx]
          return (
            <span
              key={ruleIdx}
              className="problem-case-badge"
              style={{ borderColor: rule?.color || '#E8734A' }}
            >
              <span className="problem-case-badge-icon">{rule?.icon}</span>
              {PROBLEM_LABELS[ruleIdx]?.split(' ')[0]}
            </span>
          )
        })}
      </div>

      {/* District info */}
      {detail?.district_name && (
        <div className="problem-case-district">{detail.district_name}</div>
      )}

      {/* Expanded: evidence bars showing feature values vs thresholds */}
      {expanded && Object.keys(features).length > 0 && (
        <div className="problem-case-evidence">
          {problems.map((ruleIdx) => {
            const rule = PROBLEM_RULES[ruleIdx]
            if (!rule) return null
            const evidence = rule.getEvidence(features, perception)
            return (
              <div key={ruleIdx} className="problem-evidence-rule">
                <div className="problem-evidence-title" style={{ color: rule.color }}>
                  {rule.icon} {rule.name}
                </div>
                <div className="problem-evidence-desc">{rule.desc}</div>
                {evidence.map((ev, i) => (
                  <div key={i} className="problem-evidence-bar-row">
                    <span className="problem-evidence-bar-label">{ev.label}</span>
                    <div className="problem-evidence-bar-track">
                      {ev.threshold != null && (
                        <div
                          className="problem-evidence-bar-threshold"
                          style={{
                            left: `${Math.min(100, (ev.threshold / (ev.invert ? 1 : Math.max(ev.threshold * 2, ev.value * ev.scale))) * 100)}%`,
                          }}
                        />
                      )}
                      <div
                        className="problem-evidence-bar-fill"
                        style={{
                          width: `${Math.min(100, (ev.value * ev.scale / Math.max(ev.threshold ? ev.threshold * 2 : 10, ev.value * ev.scale)) * 100)}%`,
                          background: ev.exceeds ? rule.color : 'var(--text-muted)',
                        }}
                      />
                    </div>
                    <span className="problem-evidence-bar-value">
                      {ev.unit === '%' ? `${(ev.value * ev.scale).toFixed(1)}%` : ev.value?.toFixed?.(1) || '0'}
                      {ev.threshold != null && (
                        <span className="problem-evidence-bar-thresh-label">
                          {' '}/ {ev.unit === '%' ? `${(ev.threshold * ev.scale).toFixed(0)}%` : ev.threshold}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ProblemPanel({ faceIndices }) {
  const api = useSphereApi()
  const [summary, setSummary] = useState(null)
  const [faceProblems, setFaceProblems] = useState({}) // idx -> [rule indices]
  const [faceDetails, setFaceDetails] = useState({}) // idx -> point detail
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!faceIndices.length) return
    setLoading(true)

    Promise.all([
      api.fetchProblemsSummary(),
      // Fetch problems for each face (batch with concurrency limit)
      (async () => {
        const results = []
        const batchSize = 5
        const indices = faceIndices.slice(0, 50)
        for (let i = 0; i < indices.length; i += batchSize) {
          const batch = indices.slice(i, i + batchSize)
          const batchResults = await Promise.all(
            batch.map(idx =>
              api.fetchPointProblems(idx).then(d => ({ idx, problems: d.problems })).catch(() => null)
            )
          )
          results.push(...batchResults.filter(Boolean))
        }
        return results
      })(),
    ]).then(([summaryData, problemsData]) => {
      setSummary(summaryData)
      const map = {}
      for (const d of problemsData) {
        if (d) map[d.idx] = d.problems
      }
      setFaceProblems(map)

      // Fetch point details for case examples (those with most problems)
      const caseIndices = Object.entries(map)
        .filter(([, problems]) => problems.length > 0)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 6)
        .map(([idx]) => parseInt(idx))

      if (caseIndices.length > 0) {
        Promise.all(
          caseIndices.map(idx =>
            api.fetchPointDetail(idx).catch(() => null)
          )
        ).then(details => {
          const detailMap = {}
          for (const d of details) {
            if (d) detailMap[d.idx] = d
          }
          setFaceDetails(detailMap)
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
    }).catch(() => setLoading(false))
  }, [faceIndices]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute aggregated stats for the bloom faces
  const aggregated = []
  if (Object.keys(faceProblems).length > 0) {
    const total = Object.keys(faceProblems).length
    const counts = new Array(PROBLEM_LABELS.length).fill(0)
    for (const problems of Object.values(faceProblems)) {
      for (const ruleIdx of problems) {
        if (ruleIdx < counts.length) counts[ruleIdx]++
      }
    }
    for (let i = 0; i < PROBLEM_LABELS.length; i++) {
      if (counts[i] > 0) {
        aggregated.push({
          label: PROBLEM_LABELS[i],
          ruleIdx: i,
          count: counts[i],
          pct: ((counts[i] / total) * 100).toFixed(0),
          color: PROBLEM_RULES[i]?.color || '#E8734A',
          icon: PROBLEM_RULES[i]?.icon || '',
        })
      }
    }
    aggregated.sort((a, b) => b.count - a.count)
  }

  // Case examples: faces with the most problems
  const cases = Object.entries(faceProblems)
    .map(([idx, problems]) => ({ idx: parseInt(idx), problems }))
    .filter(c => c.problems.length > 0)
    .sort((a, b) => b.problems.length - a.problems.length)
    .slice(0, 6)

  return (
    <div className={`problem-panel ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="problem-panel-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? 'Problems' : 'Problems'}
        <span className="problem-panel-chevron">{collapsed ? '\u25C0' : '\u25B6'}</span>
      </button>

      {!collapsed && (
        <div className="problem-panel-content">
          <h3 className="problem-panel-title">Walkability Problems</h3>

          {loading ? (
            <div className="problem-panel-loading">Analyzing...</div>
          ) : (
            <>
              {/* Aggregated statistics with colored bars */}
              <div className="problem-stats">
                {aggregated.map((a) => (
                  <div key={a.label} className="problem-stat-row">
                    <div className="problem-stat-label">
                      <span className="problem-stat-icon">{a.icon}</span>
                      {a.label}
                    </div>
                    <div className="problem-stat-bar-bg">
                      <div
                        className="problem-stat-bar-fill"
                        style={{ width: `${a.pct}%`, background: a.color }}
                      />
                    </div>
                    <div className="problem-stat-pct">{a.pct}%</div>
                    <div className="problem-stat-count">({a.count})</div>
                  </div>
                ))}
                {aggregated.length === 0 && (
                  <div className="problem-stat-empty">No common problems detected</div>
                )}
              </div>

              {/* Case examples with detection overlays */}
              {cases.length > 0 && (
                <>
                  <h4 className="problem-cases-title">Case Examples</h4>
                  <div className="problem-cases-hint">Click a case to see feature evidence</div>
                  <div className="problem-cases-grid">
                    {cases.map((c) => (
                      <CaseCard
                        key={c.idx}
                        idx={c.idx}
                        problems={c.problems}
                        detail={faceDetails[c.idx]}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* City-wide summary with rule descriptions */}
              {summary?.summary && (
                <div className="problem-summary-section">
                  <h4 className="problem-cases-title">City-wide Statistics</h4>
                  {Object.entries(summary.summary).map(([ruleId, info]) => {
                    const idx = parseInt(ruleId)
                    const rule = PROBLEM_RULES[idx]
                    return (
                      <div key={ruleId} className="problem-summary-row">
                        <div className="problem-summary-left">
                          <span className="problem-stat-icon">{rule?.icon}</span>
                          <span>{PROBLEM_LABELS[idx] || `Rule ${ruleId}`}</span>
                        </div>
                        <div className="problem-summary-right">
                          <span className="problem-summary-pct">{info.pct?.toFixed(1)}%</span>
                          <span className="problem-summary-count">({info.count?.toLocaleString()})</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Rule descriptions */}
              <div className="problem-rules-section">
                <h4 className="problem-cases-title">Rule Definitions</h4>
                {PROBLEM_RULES.map(rule => (
                  <div key={rule.id} className="problem-rule-item">
                    <span className="problem-rule-icon" style={{ color: rule.color }}>{rule.icon}</span>
                    <div className="problem-rule-text">
                      <div className="problem-rule-name">{rule.name}</div>
                      <div className="problem-rule-desc">{rule.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
