import { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'

// Simple image URL cache shared across all Sparkline instances
const imageCache = {}

/**
 * Compact sparkline chart showing value over sampling points.
 * @param {Array<number>} values - Array of values over time
 * @param {string} [color] - Line color
 * @param {number} [width] - Chart width
 * @param {number} [height] - Chart height
 * @param {number} [currentIndex] - Highlight current position
 * @param {Array<string>} [pointIds] - Point IDs for hover image preview
 */
export default function Sparkline({
  values,
  color = 'var(--accent-green)',
  width = 260,
  height = 40,
  currentIndex,
  label,
  pointIds,
}) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const initializedRef = useRef(false)
  const [hover, setHover] = useState(null) // { index, x, y, value, imageUrl }

  useEffect(() => {
    if (!values || values.length === 0) return

    const svg = d3.select(svgRef.current)

    const x = d3.scaleLinear().domain([0, values.length - 1]).range([0, width])
    const y = d3.scaleLinear()
      .domain([d3.min(values) * 0.9, d3.max(values) * 1.1])
      .range([height - 2, 2])

    const lineGen = d3.line()
      .x((_, i) => x(i))
      .y(d => y(d))
      .curve(d3.curveMonotoneX)

    const areaGen = d3.area()
      .x((_, i) => x(i))
      .y0(height)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX)

    if (!initializedRef.current) {
      svg.selectAll('*').remove()
      svg.append('path').attr('class', 'spark-area').attr('fill', 'rgba(61, 187, 120, 0.08)')
      svg.append('path').attr('class', 'spark-line').attr('fill', 'none').attr('stroke-width', 1.5)
      svg.append('line').attr('class', 'spark-vline').attr('stroke', 'rgba(245, 240, 232, 0.1)').attr('stroke-width', 1).attr('stroke-dasharray', '2,2')
      svg.append('circle').attr('class', 'spark-marker').attr('r', 3)
      initializedRef.current = true
    }

    // Animate paths
    svg.select('.spark-area')
      .datum(values)
      .transition().duration(300).ease(d3.easeCubicOut)
      .attr('d', areaGen)

    svg.select('.spark-line')
      .datum(values)
      .transition().duration(300).ease(d3.easeCubicOut)
      .attr('d', lineGen)
      .attr('stroke', color)

    // Animate marker
    if (currentIndex !== undefined && currentIndex < values.length) {
      svg.select('.spark-marker')
        .transition().duration(300).ease(d3.easeCubicOut)
        .attr('cx', x(currentIndex))
        .attr('cy', y(values[currentIndex]))
        .attr('fill', color)
        .style('opacity', 1)

      svg.select('.spark-vline')
        .transition().duration(300).ease(d3.easeCubicOut)
        .attr('x1', x(currentIndex)).attr('x2', x(currentIndex))
        .attr('y1', 0).attr('y2', height)
        .style('opacity', 1)
    } else {
      svg.select('.spark-marker').style('opacity', 0)
      svg.select('.spark-vline').style('opacity', 0)
    }
  }, [values, color, width, height, currentIndex])

  const handleMouseMove = useCallback((e) => {
    if (!values || values.length === 0 || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const x = d3.scaleLinear().domain([0, width]).range([0, values.length - 1])
    const idx = Math.round(x(mouseX))
    const clampedIdx = Math.max(0, Math.min(values.length - 1, idx))

    const xScale = d3.scaleLinear().domain([0, values.length - 1]).range([0, width])
    const yScale = d3.scaleLinear()
      .domain([d3.min(values) * 0.9, d3.max(values) * 1.1])
      .range([height - 2, 2])

    const newHover = {
      index: clampedIdx,
      x: xScale(clampedIdx),
      y: yScale(values[clampedIdx]),
      value: values[clampedIdx],
      imageUrl: null,
    }

    // Show cached image immediately if available
    if (pointIds && pointIds[clampedIdx] && imageCache[pointIds[clampedIdx]]) {
      newHover.imageUrl = imageCache[pointIds[clampedIdx]]
    }
    setHover(newHover)

    // Debounce image fetch (150ms dwell time)
    clearTimeout(hoverTimerRef.current)
    if (pointIds && pointIds[clampedIdx]) {
      const pid = pointIds[clampedIdx]
      if (imageCache[pid] !== undefined) return // already cached or loading

      hoverTimerRef.current = setTimeout(() => {
        if (imageCache[pid] !== undefined) return
        imageCache[pid] = null // mark loading
        fetch(`/api/images/by-point/${encodeURIComponent(pid)}`)
          .then(r => r.json())
          .then(data => {
            imageCache[pid] = data.images?.[0] || null
            setHover(prev => prev && prev.index === clampedIdx
              ? { ...prev, imageUrl: imageCache[pid] }
              : prev
            )
            // Prefetch adjacent points
            for (const adjIdx of [clampedIdx - 1, clampedIdx + 1]) {
              if (adjIdx >= 0 && adjIdx < pointIds.length) {
                const adjPid = pointIds[adjIdx]
                if (adjPid && imageCache[adjPid] === undefined) {
                  imageCache[adjPid] = null
                  fetch(`/api/images/by-point/${encodeURIComponent(adjPid)}`)
                    .then(r => r.json())
                    .then(d => { imageCache[adjPid] = d.images?.[0] || null })
                    .catch(() => { imageCache[adjPid] = null })
                }
              }
            }
          })
          .catch(() => { imageCache[pid] = null })
      }, 150)
    }
  }, [values, width, height, pointIds])

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHover(null)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '4px',
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label}
          </span>
          {hover ? (
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {hover.value.toFixed(2)}
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                pt {hover.index + 1}/{values.length}
              </span>
            </span>
          ) : (
            values && currentIndex !== undefined && currentIndex < values.length && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {values[currentIndex].toFixed(2)}
              </span>
            )
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: pointIds ? 'crosshair' : undefined }}
      />
      {/* Hover indicator line + dot */}
      {hover && (
        <>
          <div style={{
            position: 'absolute',
            left: hover.x,
            top: label ? 22 : 0,
            width: '1px',
            height: height,
            background: 'rgba(245, 240, 232, 0.2)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute',
            left: hover.x - 3,
            top: (label ? 22 : 0) + hover.y - 3,
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: color,
            border: '1px solid var(--text-primary)',
            pointerEvents: 'none',
          }} />
        </>
      )}
      {/* Image tooltip */}
      {hover && hover.imageUrl && (
        <div style={{
          position: 'absolute',
          left: Math.min(hover.x - 60, width - 140),
          bottom: height + 8,
          width: '120px',
          background: 'rgba(15, 13, 10, 0.92)',
          border: '1px solid rgba(245, 240, 232, 0.12)',
          padding: '3px',
          pointerEvents: 'none',
          zIndex: 20,
        }}>
          <img
            src={hover.imageUrl}
            alt=""
            style={{ width: '100%', height: '68px', objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            fontSize: '8px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginTop: '2px',
            letterSpacing: '0.05em',
          }}>
            Point {hover.index + 1}
          </div>
        </div>
      )}
    </div>
  )
}
