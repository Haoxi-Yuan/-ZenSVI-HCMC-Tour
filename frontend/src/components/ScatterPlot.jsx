import { useRef, useEffect } from 'react'
import * as d3 from 'd3'
import { useDistribution } from '../hooks/useStreetData'

/**
 * Histogram showing a dimension's distribution across all streets,
 * with the current street highlighted. Uses D3 transitions.
 */
export default function ScatterPlot({ dimension, highlightStreet, highlightValue, width = 400, height = 200 }) {
  const svgRef = useRef(null)
  const initializedRef = useRef(false)
  const prevDimRef = useRef(null)
  const { data, loading } = useDistribution(dimension)

  useEffect(() => {
    if (!data || data.length === 0 || loading) return

    const svg = d3.select(svgRef.current)
    const margin = { top: 30, right: 20, bottom: 30, left: 20 }
    const w = width - margin.left - margin.right
    const h = height - margin.top - margin.bottom

    const values = data.map(d => d.value)
    const x = d3.scaleLinear().domain([d3.min(values) * 0.95, d3.max(values) * 1.05]).range([0, w])
    const bins = d3.bin().domain(x.domain()).thresholds(40)(values)
    const y = d3.scaleLinear().domain([0, d3.max(bins, d => d.length)]).range([h, 0])

    // Reset on dimension change or first render
    if (!initializedRef.current || prevDimRef.current !== dimension) {
      svg.selectAll('*').remove()

      const g = svg.append('g').attr('class', 'plot-root').attr('transform', `translate(${margin.left},${margin.top})`)

      // Bars
      g.selectAll('.bar')
        .data(bins)
        .join('rect')
        .attr('class', 'bar')
        .attr('x', d => x(d.x0))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
        .attr('y', h)
        .attr('height', 0)
        .attr('fill', 'rgba(245, 240, 232, 0.08)')
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('y', d => y(d.length))
        .attr('height', d => h - y(d.length))

      // X axis
      g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(6).tickSize(0))
        .selectAll('text')
        .attr('fill', '#6B6358')
        .attr('font-size', '10px')
        .attr('font-family', "'Be Vietnam Pro', sans-serif")

      g.selectAll('.domain').attr('stroke', 'rgba(245, 240, 232, 0.08)')
      g.selectAll('.tick line').remove()

      // Highlight group
      g.append('g').attr('class', 'highlight-group')

      // Title
      svg.append('text')
        .attr('class', 'plot-title')
        .attr('x', margin.left)
        .attr('y', 16)
        .attr('fill', '#A89F91')
        .attr('font-size', '11px')
        .attr('font-weight', '500')
        .attr('letter-spacing', '0.08em')
        .attr('text-transform', 'uppercase')
        .attr('font-family', "'Be Vietnam Pro', sans-serif")
        .text(dimension.charAt(0).toUpperCase() + dimension.slice(1))

      initializedRef.current = true
      prevDimRef.current = dimension
    }

    // Update highlight with animation
    const g = svg.select('.plot-root')
    const hg = g.select('.highlight-group')
    hg.selectAll('*').remove()

    if (highlightValue !== undefined) {
      hg.append('line')
        .attr('x1', x(highlightValue))
        .attr('x2', x(highlightValue))
        .attr('y1', 0)
        .attr('y2', h)
        .attr('stroke', '#3DBB78')
        .attr('stroke-width', 2)
        .style('opacity', 0)
        .transition().duration(300)
        .style('opacity', 1)

      hg.append('circle')
        .attr('cx', x(highlightValue))
        .attr('cy', 10)
        .attr('r', 0)
        .attr('fill', '#3DBB78')
        .transition().duration(300)
        .attr('r', 5)

      hg.append('text')
        .attr('x', x(highlightValue))
        .attr('y', -6)
        .attr('text-anchor', 'middle')
        .attr('fill', '#3DBB78')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('font-family', "'Be Vietnam Pro', sans-serif")
        .style('opacity', 0)
        .text(highlightValue.toFixed(1))
        .transition().duration(300)
        .style('opacity', 1)
    }
  }, [data, loading, dimension, highlightStreet, highlightValue, width, height])

  return <svg ref={svgRef} width={width} height={height} />
}
