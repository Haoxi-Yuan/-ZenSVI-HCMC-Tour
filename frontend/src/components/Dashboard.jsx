import { useMemo } from 'react'
import RadarChart from './RadarChart'
import Treemap from './Treemap'
import ProgressBar from './ProgressBar'
import Sparkline from './Sparkline'

const PERCEPTION_DIMS = ['safer', 'livelier', 'wealthier', 'more_beautiful', 'more_boring', 'more_depressing']
const PERCEPTION_LABELS = ['Safer', 'Livelier', 'Wealthier', 'Beautiful', 'Boring', 'Depressing']

function computeWalkabilityScores(point) {
  if (!point) return { safety: 0, accessibility: 0, comfort: 0 }
  const seg = point.segmentation || {}
  const perc = point.perception || {}

  const EPS = 1e-6

  // Safety (approximate — no global normalization available)
  const S_perc = Math.min(1, Math.max(0, (perc.safer || 0) / 10))
  const S_ctrl = (((seg['traffic light'] || 0) > 0 ? 1 : 0) + ((seg['traffic sign'] || 0) > 0 ? 1 : 0)) / 2
  const safety = 10 * (0.5 * S_perc + 0.3 * 0.5 + 0.2 * S_ctrl)

  // Accessibility (approximate)
  const A_side = (seg.sidewalk || 0) / ((seg.sidewalk || 0) + (seg.road || 0) + EPS)
  const accessibility = 10 * (0.6 * Math.min(1, A_side * 3) + 0.4 * 0.5)

  // Comfort (approximate)
  const C_vis = Math.min(1, Math.max(0,
    ((perc.more_beautiful || 0) + (10 - (perc.more_boring || 5)) + (10 - (perc.more_depressing || 5))) / 30
  ))
  const C_svf = seg.sky || 0
  const C_gvi = (seg.vegetation || 0)
  const comfort = 10 * (0.25 * C_gvi * 3 + 0.25 * C_vis + 0.15 * C_svf + 0.20 * 0.5 + 0.15 * 0.5)

  return {
    safety: Math.min(10, Math.max(0, safety)),
    accessibility: Math.min(10, Math.max(0, accessibility)),
    comfort: Math.min(10, Math.max(0, comfort)),
  }
}

/**
 * Floating dashboard sidebar for tour mode.
 */
export default function Dashboard({
  currentPoint, prevPoint, allPoints, currentIndex,
  segmentScores, prevSegmentScores, allSegmentScores,
  collapsed, onToggle,
}) {
  const perceptionData = useMemo(() => {
    if (!currentPoint?.perception) return []
    return PERCEPTION_DIMS.map((dim, i) => ({
      axis: PERCEPTION_LABELS[i],
      value: currentPoint.perception[dim] || 0,
    }))
  }, [currentPoint])

  const prevPerceptionData = useMemo(() => {
    if (!prevPoint?.perception) return null
    return PERCEPTION_DIMS.map((dim, i) => ({
      axis: PERCEPTION_LABELS[i],
      value: prevPoint.perception[dim] || 0,
    }))
  }, [prevPoint])

  // Use pre-computed segment scores when available, fallback to approximate
  const walkScores = useMemo(() => {
    if (segmentScores) {
      return {
        safety: segmentScores.safety_score || 0,
        accessibility: segmentScores.accessibility_score || 0,
        comfort: segmentScores.comfort_score || 0,
      }
    }
    return computeWalkabilityScores(currentPoint)
  }, [currentPoint, segmentScores])

  const walkData = useMemo(() => [
    { axis: 'Safety', value: walkScores.safety },
    { axis: 'Access.', value: walkScores.accessibility },
    { axis: 'Comfort', value: walkScores.comfort },
  ], [walkScores])

  const prevWalkScores = useMemo(() => {
    if (prevSegmentScores) {
      return {
        safety: prevSegmentScores.safety_score || 0,
        accessibility: prevSegmentScores.accessibility_score || 0,
        comfort: prevSegmentScores.comfort_score || 0,
      }
    }
    return computeWalkabilityScores(prevPoint)
  }, [prevPoint, prevSegmentScores])

  const prevWalkData = useMemo(() => {
    if (!prevPoint) return null
    return [
      { axis: 'Safety', value: prevWalkScores.safety },
      { axis: 'Access.', value: prevWalkScores.accessibility },
      { axis: 'Comfort', value: prevWalkScores.comfort },
    ]
  }, [prevPoint, prevWalkScores])

  // Sparkline data from all visited points
  const sparklineData = useMemo(() => {
    if (!allPoints || allPoints.length === 0) return {}
    const data = {}
    const slice = allPoints.slice(0, (currentIndex || 0) + 1)

    PERCEPTION_DIMS.forEach(dim => {
      data[dim] = slice.map(p => p.perception?.[dim] || 0)
    })

    // Walkability from segment scores (true values) or fallback
    data.safety = slice.map(p => {
      const seg = allSegmentScores?.[p.id]
      return seg ? seg.safety_score : computeWalkabilityScores(p).safety
    })

    // Environment trajectories from segment scores
    if (allSegmentScores && Object.keys(allSegmentScores).length > 0) {
      data.lst = slice.map(p => allSegmentScores[p.id]?.lst_avg || 0)
      data.building_height = slice.map(p => allSegmentScores[p.id]?.avg_building_height || 0)
    }

    return data
  }, [allPoints, currentIndex, allSegmentScores])

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'absolute',
          top: '80px',
          right: 0,
          width: '40px',
          height: '120px',
          background: 'rgba(15, 13, 10, 0.85)',
          border: '1px solid rgba(245, 240, 232, 0.08)',
          borderRight: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(12px)',
          writingMode: 'vertical-rl',
          fontSize: '11px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        Dashboard
      </button>
    )
  }

  return (
    <div style={{
      position: 'absolute',
      top: '70px',
      right: 0,
      bottom: '20px',
      width: '320px',
      background: 'rgba(15, 13, 10, 0.88)',
      backdropFilter: 'blur(16px)',
      borderLeft: '1px solid rgba(245, 240, 232, 0.06)',
      overflowY: 'auto',
      padding: '20px',
      zIndex: 50,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--accent-green)',
          fontWeight: 500,
        }}>Live Dashboard</div>
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '4px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Point info */}
      {currentPoint && (
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '16px',
          paddingBottom: '16px',
          borderBottom: '1px solid rgba(245, 240, 232, 0.06)',
        }}>
          Point {(currentIndex || 0) + 1} of {allPoints?.length || '—'} / {currentPoint.district_name}
        </div>
      )}

      {/* Walkability Radar */}
      <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
        <RadarChart data={walkData} prevData={prevWalkData} maxValue={10} size={200} title="Walkability" color="#3DBB78" />
      </div>

      {/* Perception Radar */}
      <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
        <RadarChart data={perceptionData} prevData={prevPerceptionData} maxValue={10} size={200} title="Perception" color="#D4A855" prevColor="rgba(212, 168, 85, 0.15)" />
      </div>

      {/* Perception Sparklines */}
      <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: '12px',
          fontWeight: 500,
        }}>Perception Trend</div>
        {PERCEPTION_DIMS.slice(0, 3).map(dim => (
          <div key={dim} style={{ marginBottom: '8px' }}>
            <Sparkline
              values={sparklineData[dim] || []}
              currentIndex={currentIndex}
              label={dim.replace('_', ' ')}
              width={260}
              height={30}
              color="var(--accent-gold)"
            />
          </div>
        ))}
      </div>

      {/* Environment Trajectory */}
      {sparklineData.lst && sparklineData.lst.some(v => v > 0) && (
        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            fontWeight: 500,
          }}>Environment Trajectory</div>
          <div style={{ marginBottom: '8px' }}>
            <Sparkline
              values={sparklineData.lst}
              currentIndex={currentIndex}
              label="Land Surface Temp (°C)"
              width={260}
              height={30}
              color="var(--accent-orange)"
            />
          </div>
          {sparklineData.building_height && sparklineData.building_height.some(v => v > 0) && (
            <div style={{ marginBottom: '8px' }}>
              <Sparkline
                values={sparklineData.building_height}
                currentIndex={currentIndex}
                label="Building Height (m)"
                width={260}
                height={30}
                color="#5B9BD5"
              />
            </div>
          )}
        </div>
      )}

      {/* Segmentation Treemap */}
      {currentPoint?.segmentation && (
        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
          <Treemap data={currentPoint.segmentation} width={280} height={160} title="Scene Composition" />
        </div>
      )}

      {/* Object Detection Progress Bars */}
      {currentPoint?.detection && (
        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            fontWeight: 500,
          }}>Object Detection</div>
          <ProgressBar label="Motorbike" value={currentPoint.detection.motorbike || 0} maxValue={20} color="var(--accent-orange)" />
          <ProgressBar label="Car" value={currentPoint.detection.car || 0} maxValue={15} color="var(--accent-gold)" />
          <ProgressBar label="Person" value={currentPoint.detection.person || 0} maxValue={20} color="var(--accent-green)" />
          <ProgressBar label="Tree" value={currentPoint.detection.tree || 0} maxValue={20} color="#5C9E6E" />
        </div>
      )}

      {/* Environment Data from Segment */}
      {segmentScores && (segmentScores.lst_avg > 0 || segmentScores.avg_building_height > 0) && (
        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(245, 240, 232, 0.06)' }}>
          <div style={{
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            fontWeight: 500,
          }}>Environment</div>
          {segmentScores.lst_avg > 0 && (
            <ProgressBar
              label="Land Surface Temp"
              value={segmentScores.lst_avg}
              maxValue={64}
              color={segmentScores.lst_avg > 40 ? 'var(--accent-orange)' : segmentScores.lst_avg > 30 ? 'var(--accent-gold)' : '#5B9BD5'}
            />
          )}
          {segmentScores.avg_building_height > 0 && (
            <ProgressBar
              label="Avg Building Height"
              value={segmentScores.avg_building_height}
              maxValue={23}
              color="#5B9BD5"
            />
          )}
        </div>
      )}
    </div>
  )
}
