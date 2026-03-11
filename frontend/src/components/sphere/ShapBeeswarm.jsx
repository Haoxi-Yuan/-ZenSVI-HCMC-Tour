/**
 * ShapBeeswarm — classic SHAP beeswarm scatter plot.
 *
 * Matches the standard SHAP library visual style:
 * - Blue (low) → Red (high) color scheme
 * - Vertical color bar on the right
 * - Proper numeric X axis with ticks
 * - Feature names on Y axis
 * - Highlighted point with leader lines and value callouts
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useSphere } from '../../contexts/SphereContext'
import { useBeeswarmData } from '../../hooks/useBeeswarmData'
import { FEATURE_LABELS, DIM_CONFIG } from '../../utils/sphereConstants'
import {
  computeBeeswarmLayout,
  renderDotsToImageData,
  featureValueToRGB,
} from './beeswarmLayout'

const MARGIN_LEFT = 90
const MARGIN_RIGHT = 46   // space for vertical color bar
const MARGIN_TOP = 10
const MARGIN_BOTTOM = 38  // space for axis + label
const COLORBAR_WIDTH = 12
const COLORBAR_GAP = 10

function featureLabel(name) {
  return FEATURE_LABELS[name] || name.replace(/^(seg_|det_)/, '').replace(/_/g, ' ')
}

function niceAxisTicks(xMin, xMax, plotWidth, marginLeft) {
  const range = xMax - xMin
  if (range <= 0) return []
  const rawStep = range / 5
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const res = rawStep / mag
  let step
  if (res <= 1.5) step = mag
  else if (res <= 3.5) step = 2 * mag
  else if (res <= 7.5) step = 5 * mag
  else step = 10 * mag

  const ticks = []
  const start = Math.ceil(xMin / step) * step
  for (let v = start; v <= xMax + step * 0.01; v += step) {
    const x = marginLeft + ((v - xMin) / range) * plotWidth
    ticks.push({ value: v, x })
  }
  return ticks
}

export default function ShapBeeswarm({ width = 340, height = 460, nFeatures = 15, placement = 'standstill' }) {
  const { state } = useSphere()
  const { selectedIdx, activeDim } = state

  const bgCanvasRef = useRef(null)
  const hlCanvasRef = useRef(null)
  const layoutRef = useRef(null)
  const bgCacheDimRef = useRef(null)
  const prevIdxRef = useRef(null)
  const animFrameRef = useRef(null)
  const prevHighlightRef = useRef(null)
  const [collapsed, setCollapsed] = useState(false)

  const { shapArray, featureArray, featureNames, sortedFeatureIndices, loading } =
    useBeeswarmData(activeDim, nFeatures)

  const plotWidth = width - MARGIN_LEFT - MARGIN_RIGHT
  const plotHeight = height - MARGIN_TOP - MARGIN_BOTTOM
  const rowHeight = plotHeight / nFeatures
  const N = shapArray ? shapArray.length / featureNames.length : 0

  // Recompute layout when dimension changes
  useEffect(() => {
    if (!shapArray || !featureArray || !sortedFeatureIndices.length || !N) return
    layoutRef.current = computeBeeswarmLayout(
      shapArray, featureArray, sortedFeatureIndices,
      N, plotWidth, rowHeight, MARGIN_LEFT, MARGIN_TOP,
    )
    bgCacheDimRef.current = null
  }, [shapArray, featureArray, sortedFeatureIndices, N, plotWidth, rowHeight])

  // Render background canvas
  useEffect(() => {
    if (!layoutRef.current || bgCacheDimRef.current === activeDim) return
    const canvas = bgCanvasRef.current
    if (!canvas) return

    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)

    // Dots via ImageData
    const imageData = ctx.createImageData(width, height)
    renderDotsToImageData(imageData, width, layoutRef.current, N, MARGIN_LEFT)
    ctx.putImageData(imageData, 0, 0)

    const firstRow = layoutRef.current[0]
    if (!firstRow) return

    // Zero line (full height, gray)
    const zeroX = MARGIN_LEFT + (-firstRow.xMin / (firstRow.xMax - firstRow.xMin || 1)) * plotWidth
    if (zeroX >= MARGIN_LEFT && zeroX <= MARGIN_LEFT + plotWidth) {
      ctx.strokeStyle = 'rgba(180, 180, 180, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(zeroX, MARGIN_TOP - 2)
      ctx.lineTo(zeroX, MARGIN_TOP + plotHeight + 2)
      ctx.stroke()
    }

    // Row separators (subtle)
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.15)'
    ctx.lineWidth = 0.5
    for (let i = 1; i < layoutRef.current.length; i++) {
      const y = MARGIN_TOP + i * rowHeight
      ctx.beginPath()
      ctx.moveTo(MARGIN_LEFT, y)
      ctx.lineTo(MARGIN_LEFT + plotWidth, y)
      ctx.stroke()
    }

    // X axis
    const axisY = MARGIN_TOP + plotHeight
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.6)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN_LEFT, axisY)
    ctx.lineTo(MARGIN_LEFT + plotWidth, axisY)
    ctx.stroke()

    // Ticks
    const ticks = niceAxisTicks(firstRow.xMin, firstRow.xMax, plotWidth, MARGIN_LEFT)
    ctx.fillStyle = 'rgba(220, 220, 220, 0.8)'
    ctx.font = '9px "Be Vietnam Pro", sans-serif'
    ctx.textAlign = 'center'
    for (const tick of ticks) {
      ctx.beginPath()
      ctx.moveTo(tick.x, axisY)
      ctx.lineTo(tick.x, axisY + 4)
      ctx.stroke()
      const label = Math.abs(tick.value) < 1e-6 ? '0' : tick.value.toFixed(2)
      ctx.fillText(label, tick.x, axisY + 15)
    }

    // Axis title
    ctx.fillStyle = 'rgba(200, 200, 200, 0.6)'
    ctx.font = '9px "Be Vietnam Pro", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('SHAP value (impact on model output)', MARGIN_LEFT + plotWidth / 2, axisY + 28)

    // Vertical color bar (right side)
    const cbX = width - COLORBAR_WIDTH - 6
    const cbTop = MARGIN_TOP + 6
    const cbHeight = plotHeight - 12
    for (let py = 0; py < cbHeight; py++) {
      const norm = 1 - py / cbHeight  // top=high, bottom=low
      const [r, g, b] = featureValueToRGB(norm)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(cbX, cbTop + py, COLORBAR_WIDTH, 1)
    }
    // Color bar border
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'
    ctx.lineWidth = 0.5
    ctx.strokeRect(cbX, cbTop, COLORBAR_WIDTH, cbHeight)

    // Color bar labels
    ctx.fillStyle = 'rgba(220, 220, 220, 0.8)'
    ctx.font = '8px "Be Vietnam Pro", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('High', cbX + COLORBAR_WIDTH / 2, cbTop - 4)
    ctx.fillText('Low', cbX + COLORBAR_WIDTH / 2, cbTop + cbHeight + 10)

    // "Feature value" label (vertical text)
    ctx.save()
    ctx.translate(cbX + COLORBAR_WIDTH + 10, cbTop + cbHeight / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillStyle = 'rgba(200, 200, 200, 0.5)'
    ctx.font = '8px "Be Vietnam Pro", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Feature value', 0, 0)
    ctx.restore()

    bgCacheDimRef.current = activeDim
  }, [layoutRef.current, activeDim, width, height, plotWidth, plotHeight, rowHeight, N]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute highlight points
  const highlightData = useMemo(() => {
    if (!layoutRef.current || selectedIdx === null || selectedIdx === undefined || !N) return null
    if (!featureNames.length) return null
    const nCols = featureNames.length

    const points = []
    for (const row of layoutRef.current) {
      const xPx = row.xPositions[selectedIdx]
      const yPx = row.yPositions[selectedIdx]
      if (xPx === undefined) continue

      const actualPx = Math.round(xPx) + MARGIN_LEFT
      const actualPy = Math.round(row.yCenter + yPx)
      const norm = row.featureNorm[selectedIdx]
      const [r, g, b] = featureValueToRGB(norm)
      const shapVal = shapArray[selectedIdx * nCols + row.featureIdx]

      points.push({ featureIdx: row.featureIdx, x: actualPx, y: actualPy, r, g, b, norm, shapVal })
    }
    return points
  }, [layoutRef.current, selectedIdx, N, featureNames, shapArray]) // eslint-disable-line react-hooks/exhaustive-deps

  // Render highlight overlay
  const renderHighlight = useCallback((ctx, points, alpha = 1) => {
    if (!points) return
    ctx.clearRect(0, 0, width, height)

    for (const pt of points) {
      // Leader line
      ctx.beginPath()
      ctx.moveTo(MARGIN_LEFT - 2, pt.y)
      ctx.lineTo(pt.x - 8, pt.y)
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * alpha})`
      ctx.lineWidth = 0.5
      ctx.stroke()

      // Outer glow
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 8 * alpha, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * alpha})`
      ctx.fill()

      // Colored ring
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 5 * alpha, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${pt.r}, ${pt.g}, ${pt.b}, ${0.8 * alpha})`
      ctx.fill()

      // White center
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.fill()
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.6 * alpha})`
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }, [width, height])

  useEffect(() => {
    if (!layoutRef.current || selectedIdx === null) return
    const canvas = hlCanvasRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!highlightData) return

    if (prevIdxRef.current === null || prevIdxRef.current === selectedIdx) {
      renderHighlight(ctx, highlightData)
      prevIdxRef.current = selectedIdx
      prevHighlightRef.current = highlightData
      return
    }

    const startTime = performance.now()
    const duration = 300
    const prevPoints = prevHighlightRef.current

    function animate(now) {
      const t = Math.min(1, (now - startTime) / duration)
      ctx.clearRect(0, 0, width, height)
      if (t < 0.5 && prevPoints) renderHighlight(ctx, prevPoints, 1 - t * 2)
      if (t > 0.3) renderHighlight(ctx, highlightData, Math.min(1, (t - 0.3) / 0.7))
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate)
      } else {
        prevIdxRef.current = selectedIdx
        prevHighlightRef.current = highlightData
      }
    }

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = requestAnimationFrame(animate)
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [selectedIdx, highlightData, renderHighlight, width, height])

  if (!activeDim) return null
  const dimLabel = DIM_CONFIG[activeDim]?.label || activeDim

  if (collapsed) {
    return (
      <div className={`beeswarm-panel ${placement} collapsed`}>
        <button className="beeswarm-collapsed-btn" onClick={() => setCollapsed(false)}>
          SHAP &middot; {dimLabel}
        </button>
      </div>
    )
  }

  return (
    <div className={`beeswarm-panel ${placement}`}>
      <div className="beeswarm-header">
        <div>
          <div className="beeswarm-title">SHAP Beeswarm</div>
          <div className="beeswarm-dim-label">{dimLabel}</div>
        </div>
        <button className="beeswarm-toggle" onClick={() => setCollapsed(true)}>Hide</button>
      </div>

      {loading ? (
        <div className="beeswarm-loading">Loading SHAP data\u2026</div>
      ) : (
        <div className="beeswarm-canvas-wrap" style={{ width, height, position: 'relative' }}>
          <canvas ref={bgCanvasRef} className="beeswarm-canvas-bg" style={{ width, height }} />
          <canvas ref={hlCanvasRef} className="beeswarm-canvas-hl" style={{ width, height }} />

          {/* Feature labels */}
          <div className="beeswarm-labels" style={{ width: MARGIN_LEFT, height }}>
            {layoutRef.current && layoutRef.current.map((row) => (
              <div key={row.featureIdx} className="beeswarm-label" style={{ top: row.yCenter - 5 }}>
                {featureLabel(featureNames[row.featureIdx])}
              </div>
            ))}
          </div>

          {/* SHAP value callouts for highlighted point */}
          {highlightData && selectedIdx !== null && (
            <div className="beeswarm-callouts" style={{ width, height }}>
              {highlightData.map((pt) => {
                const sign = pt.shapVal >= 0 ? '+' : ''
                const cls = pt.shapVal >= 0 ? 'positive' : 'negative'
                const nearRight = pt.x > MARGIN_LEFT + plotWidth * 0.8
                return (
                  <div
                    key={pt.featureIdx}
                    className={`beeswarm-callout ${cls}`}
                    style={{
                      left: nearRight ? undefined : pt.x + 10,
                      right: nearRight ? (width - pt.x + 10) : undefined,
                      top: pt.y,
                    }}
                  >
                    {sign}{pt.shapVal.toFixed(3)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
