/**
 * SynapseNetwork — D3 force-directed SHAP factor graph (SVG overlay).
 *
 * Spec §2.2: "小人的头顶上方生成一个factor节点网络，我们称之为'突触丛'。"
 *
 * Displays top-7 SHAP features as nodes connected to a central perception node.
 * Edge thickness = |SHAP value|, color = green (positive) / red (negative).
 * Remaining features collapse into an "Other" aggregate node.
 */

import { useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { useSphere } from '../../contexts/SphereContext'
import {
  FEATURE_LABELS,
  FEATURE_CATEGORIES,
  CATEGORY_COLORS,
  DIM_CONFIG,
  ANIM,
} from '../../utils/sphereConstants'

const TOP_K = 7
const WIDTH = 500
const HEIGHT = 350
const CENTER_RADIUS = 28
const NODE_MIN_R = 10
const NODE_MAX_R = 22
const OTHER_R = 16

function featureLabel(name) {
  return FEATURE_LABELS[name] || name.replace(/^(seg_|det_)/, '').replace(/_/g, ' ')
}

function featureColor(name) {
  const cat = FEATURE_CATEGORIES[name] || 'infra'
  return CATEGORY_COLORS[cat] || '#7B93A8'
}

export default function SynapseNetwork() {
  const svgRef = useRef(null)
  const prevDataRef = useRef(null)
  const { state } = useSphere()
  const { shapData, activeDim, selectedIdx } = state
  const [shakeClass, setShakeClass] = useState('')

  useEffect(() => {
    if (!shapData || !activeDim || !shapData.dimensions?.[activeDim]) return
    const svg = d3.select(svgRef.current)

    const dimData = shapData.dimensions[activeDim]
    const contributions = dimData.contributions || []
    const baseValue = dimData.base_value || 0

    // Split into top-K and others
    const topK = contributions.slice(0, TOP_K)
    const others = contributions.slice(TOP_K)
    const otherAbs = others.reduce((s, c) => s + Math.abs(c.shap_value), 0)

    // Compute delta from previous data for transition effects
    const prevData = prevDataRef.current
    let delta = 0
    if (prevData) {
      const prevMap = new Map(prevData.map(c => [c.feature, c.shap_value]))
      for (const c of contributions) {
        const prev = prevMap.get(c.feature) || 0
        delta += Math.abs(c.shap_value - prev)
      }
    }
    prevDataRef.current = contributions

    // Trigger shake for drastic changes
    if (delta >= 2.0 && prevData) {
      setShakeClass('synapse-shake')
      setTimeout(() => setShakeClass(''), 300)
    }

    // Build graph nodes
    const maxAbsShap = Math.max(...topK.map(c => Math.abs(c.shap_value)), 0.01)
    const nodeScale = d3.scaleLinear().domain([0, maxAbsShap]).range([NODE_MIN_R, NODE_MAX_R])

    const nodes = [
      // Central perception node
      {
        id: 'center',
        label: DIM_CONFIG[activeDim]?.label || activeDim,
        r: CENTER_RADIUS,
        color: '#D4A855',
        fx: WIDTH / 2,
        fy: HEIGHT / 2,
        isCenter: true,
        value: baseValue,
      },
      // Top-K feature nodes
      ...topK.map((c, i) => ({
        id: c.feature,
        label: featureLabel(c.feature),
        r: nodeScale(Math.abs(c.shap_value)),
        color: featureColor(c.feature),
        shapValue: c.shap_value,
        isCenter: false,
      })),
    ]

    // "Other" node
    if (others.length > 0) {
      nodes.push({
        id: 'other',
        label: `${others.length} others`,
        r: OTHER_R,
        color: 'rgba(168, 159, 145, 0.5)',
        shapValue: 0,
        isCenter: false,
        isOther: true,
      })
    }

    // Links from each feature to center
    const links = nodes.filter(n => !n.isCenter).map(n => ({
      source: n.id,
      target: 'center',
      thickness: Math.max(1, Math.min(8, Math.abs(n.shapValue || otherAbs) * 30)),
      color: n.isOther ? '#555' : (n.shapValue >= 0 ? '#3DBB78' : '#E8734A'),
    }))

    // D3 force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.02))
      .force('charge', d3.forceManyBody().strength(-60))
      .force('collide', d3.forceCollide(d => d.r + 5))
      .force('link', d3.forceLink(links).id(d => d.id).distance(d => 80 - d.thickness * 3).strength(0.5))
      .alphaDecay(0.05)

    // Duration for transitions
    const dur = delta < 0.5 ? 0 : ANIM.SYNAPSE_TWEEN_MS

    // Clear and redraw
    svg.selectAll('*').remove()

    const g = svg.append('g')

    // Links
    const linkSel = g.selectAll('.synapse-link')
      .data(links, d => d.source.id || d.source)
      .join('line')
      .attr('class', 'synapse-link')
      .attr('stroke', d => d.color)
      .attr('stroke-width', 0)
      .attr('stroke-opacity', 0.7)

    linkSel.transition().duration(dur)
      .attr('stroke-width', d => d.thickness)

    // Nodes
    const nodeSel = g.selectAll('.synapse-node')
      .data(nodes, d => d.id)
      .join('g')
      .attr('class', 'synapse-node')

    nodeSel.append('circle')
      .attr('r', 0)
      .attr('fill', d => d.color)
      .attr('stroke', d => d.isCenter ? '#F5F0E8' : 'rgba(245,240,232,0.3)')
      .attr('stroke-width', d => d.isCenter ? 2 : 1)
      .transition().duration(dur)
      .attr('r', d => d.r)

    // Labels
    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.isCenter ? -d.r - 6 : d.r + 14)
      .attr('fill', '#F5F0E8')
      .attr('font-size', d => d.isCenter ? 12 : 10)
      .attr('opacity', 0)
      .text(d => d.label)
      .transition().duration(dur)
      .attr('opacity', 1)

    // SHAP value labels on non-center nodes
    nodeSel.filter(d => !d.isCenter && !d.isOther).append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', '#0F0D0A')
      .attr('font-size', 9)
      .attr('font-weight', 'bold')
      .text(d => d.shapValue?.toFixed(2))

    // Center node: show score
    nodeSel.filter(d => d.isCenter).append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 5)
      .attr('fill', '#0F0D0A')
      .attr('font-size', 13)
      .attr('font-weight', 'bold')
      .text(d => d.value?.toFixed(2))

    // Tick
    simulation.on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)

      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    // Breathing animation for minimal changes
    if (delta > 0 && delta < 0.5 && prevData) {
      nodeSel.selectAll('circle')
        .transition().duration(400).ease(d3.easeSinInOut)
        .attr('r', d => d.r * 1.05)
        .transition().duration(400).ease(d3.easeSinInOut)
        .attr('r', d => d.r)
    }

    return () => simulation.stop()
  }, [shapData, activeDim, selectedIdx])

  if (!shapData || !activeDim) return null

  return (
    <div className={`synapse-container ${shakeClass}`}>
      <svg ref={svgRef} width={WIDTH} height={HEIGHT} className="synapse-svg" />
    </div>
  )
}
