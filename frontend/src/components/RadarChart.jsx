import { useRef, useEffect } from 'react'
import * as d3 from 'd3'

/**
 * Radar chart with optional faded previous-point overlay.
 * Uses D3 transitions for smooth animation between data states.
 */
export default function RadarChart({
  data,
  prevData,
  maxValue = 10,
  color = 'var(--accent-green)',
  prevColor = 'rgba(61, 187, 120, 0.2)',
  size = 200,
  title,
}) {
  const svgRef = useRef(null)
  const initializedRef = useRef(false)

  // Draw static elements once
  useEffect(() => {
    if (!data || data.length === 0) return
    const svg = d3.select(svgRef.current)

    // Only build static scaffolding on first render
    if (!initializedRef.current) {
      svg.selectAll('*').remove()

      const margin = 40
      const radius = (size - margin * 2) / 2
      const cx = size / 2
      const cy = size / 2
      const axes = data.length
      const angleSlice = (Math.PI * 2) / axes
      const g = svg.append('g').attr('class', 'radar-root').attr('transform', `translate(${cx},${cy})`)

      // Grid circles
      const levels = 5
      for (let i = 1; i <= levels; i++) {
        g.append('circle')
          .attr('r', (radius / levels) * i)
          .attr('fill', 'none')
          .attr('stroke', 'rgba(245, 240, 232, 0.06)')
          .attr('stroke-width', 0.5)
      }

      // Axis lines and labels
      data.forEach((d, i) => {
        const angle = angleSlice * i - Math.PI / 2
        const x = radius * Math.cos(angle)
        const y = radius * Math.sin(angle)

        g.append('line')
          .attr('x1', 0).attr('y1', 0)
          .attr('x2', x).attr('y2', y)
          .attr('stroke', 'rgba(245, 240, 232, 0.08)')
          .attr('stroke-width', 0.5)

        const labelX = (radius + 18) * Math.cos(angle)
        const labelY = (radius + 18) * Math.sin(angle)
        g.append('text')
          .attr('x', labelX).attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', '#A89F91')
          .attr('font-size', '10px')
          .attr('font-family', "'Be Vietnam Pro', sans-serif")
          .text(d.axis)
      })

      // Persistent path and dot elements (will be animated on data changes)
      g.append('path').attr('class', 'radar-prev')
        .attr('fill', prevColor)
        .attr('stroke', 'rgba(61, 187, 120, 0.3)')
        .attr('stroke-width', 1)
        .style('opacity', 0)

      g.append('path').attr('class', 'radar-current')
        .attr('fill', 'rgba(61, 187, 120, 0.12)')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)

      initializedRef.current = true
    }

    // Animate data
    const margin = 40
    const radius = (size - margin * 2) / 2
    const axes = data.length
    const angleSlice = (Math.PI * 2) / axes
    const rScale = d3.scaleLinear().domain([0, maxValue]).range([0, radius])
    const g = svg.select('.radar-root')

    const radarLine = d3.lineRadial()
      .radius(d => rScale(d.value))
      .angle((d, i) => i * angleSlice)
      .curve(d3.curveLinearClosed)

    // Animate previous data path
    if (prevData && prevData.length > 0) {
      g.select('.radar-prev')
        .datum(prevData)
        .transition().duration(400).ease(d3.easeCubicOut)
        .attr('d', radarLine)
        .style('opacity', 1)
    } else {
      g.select('.radar-prev').style('opacity', 0)
    }

    // Animate current data path
    g.select('.radar-current')
      .datum(data)
      .transition().duration(400).ease(d3.easeCubicOut)
      .attr('d', radarLine)
      .attr('stroke', color)

    // Data dots with enter/update/exit
    const dots = g.selectAll('.radar-dot').data(data)
    dots.enter()
      .append('circle').attr('class', 'radar-dot').attr('r', 3).attr('fill', color)
      .merge(dots)
      .transition().duration(400).ease(d3.easeCubicOut)
      .attr('cx', (d, i) => rScale(d.value) * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('cy', (d, i) => rScale(d.value) * Math.sin(angleSlice * i - Math.PI / 2))
      .attr('fill', color)
    dots.exit().remove()

    // Value labels with enter/update/exit
    const labels = g.selectAll('.radar-val').data(data)
    labels.enter()
      .append('text').attr('class', 'radar-val')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#F5F0E8')
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('font-family', "'Be Vietnam Pro', sans-serif")
      .merge(labels)
      .transition().duration(400).ease(d3.easeCubicOut)
      .attr('x', (d, i) => (rScale(d.value) + 12) * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('y', (d, i) => (rScale(d.value) + 12) * Math.sin(angleSlice * i - Math.PI / 2))
      .tween('text', function(d) {
        const prev = parseFloat(this.textContent) || 0
        const interp = d3.interpolateNumber(prev, d.value)
        return function(t) { this.textContent = interp(t).toFixed(1) }
      })
    labels.exit().remove()

  }, [data, prevData, maxValue, color, prevColor, size])

  // Reset on axis count change (e.g., switching between 3-axis and 6-axis radar)
  useEffect(() => {
    initializedRef.current = false
  }, [data?.length])

  return (
    <div>
      {title && (
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: '8px',
          fontWeight: 500,
        }}>{title}</div>
      )}
      <svg ref={svgRef} width={size} height={size} />
    </div>
  )
}
