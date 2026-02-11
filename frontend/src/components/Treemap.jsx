import { useRef, useEffect } from 'react'
import * as d3 from 'd3'

const CLASS_COLORS = {
  road: '#8B7355',
  sidewalk: '#A0917E',
  building: '#6B6358',
  wall: '#5A524A',
  fence: '#4E463E',
  pole: '#7A7068',
  'traffic light': '#E8734A',
  'traffic sign': '#D4A855',
  vegetation: '#3DBB78',
  terrain: '#5C9E6E',
  sky: '#6B8DB5',
  person: '#C4956A',
  rider: '#B08560',
  car: '#A0785C',
  motorcycle: '#E87A50',
  bicycle: '#7BB58E',
  bus: '#957050',
  truck: '#886548',
  train: '#786050',
}

/**
 * Treemap visualization for semantic segmentation ratios.
 * Uses D3 transitions for smooth morphing between data states.
 */
export default function Treemap({ data, width = 280, height = 180, title }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!data || Object.keys(data).length === 0) return

    const svg = d3.select(svgRef.current)

    // Filter out zero/tiny values
    const entries = Object.entries(data)
      .filter(([, v]) => v > 0.005)
      .sort((a, b) => b[1] - a[1])

    const root = d3.hierarchy({ children: entries.map(([name, value]) => ({ name, value })) })
      .sum(d => d.value)

    d3.treemap()
      .size([width, height])
      .padding(1)
      (root)

    // Join cells by class name for stable transitions
    const cells = svg.selectAll('g.cell')
      .data(root.leaves(), d => d.data.name)

    // Exit
    cells.exit()
      .transition().duration(200)
      .style('opacity', 0)
      .remove()

    // Enter
    const cellsEnter = cells.enter()
      .append('g').attr('class', 'cell')
      .style('opacity', 0)

    cellsEnter.append('rect')
    cellsEnter.append('text').attr('class', 'label-name')
      .attr('fill', '#F5F0E8')
      .attr('font-size', '9px')
      .attr('font-family', "'Be Vietnam Pro', sans-serif")
      .attr('font-weight', '500')
    cellsEnter.append('text').attr('class', 'label-value')
      .attr('fill', 'rgba(245, 240, 232, 0.6)')
      .attr('font-size', '9px')
      .attr('font-family', "'Be Vietnam Pro', sans-serif")

    // Merge enter + update
    const cellsMerged = cellsEnter.merge(cells)

    cellsMerged
      .transition().duration(400).ease(d3.easeCubicOut)
      .attr('transform', d => `translate(${d.x0},${d.y0})`)
      .style('opacity', 1)

    cellsMerged.select('rect')
      .transition().duration(400).ease(d3.easeCubicOut)
      .attr('width', d => Math.max(0, d.x1 - d.x0))
      .attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('fill', d => CLASS_COLORS[d.data.name] || '#555')
      .attr('opacity', 0.85)

    // Labels — show/hide based on cell size
    cellsMerged.select('.label-name')
      .attr('x', 4).attr('y', 13)
      .text(d => (d.x1 - d.x0) > 35 && (d.y1 - d.y0) > 18 ? d.data.name : '')

    cellsMerged.select('.label-value')
      .attr('x', 4).attr('y', 25)
      .text(d => (d.x1 - d.x0) > 35 && (d.y1 - d.y0) > 30 ? `${(d.data.value * 100).toFixed(1)}%` : '')
  }, [data, width, height])

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
      <svg ref={svgRef} width={width} height={height} />
    </div>
  )
}
