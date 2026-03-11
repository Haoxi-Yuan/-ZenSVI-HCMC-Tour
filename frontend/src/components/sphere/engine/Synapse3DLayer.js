/**
 * Synapse3DLayer — 3D force-directed SHAP factor graph in Three.js scene.
 *
 * Replaces SVG SynapseNetwork with a 3D neural network visualization
 * positioned above the Avatar's head (face normal direction).
 *
 * - Central node: gold sphere showing base_value
 * - Feature nodes: sized by |SHAP|, colored by category
 * - Links: thick lines, green (positive SHAP) / red (negative SHAP)
 * - Energy particles: small spheres flowing along links
 * - Text labels: canvas-based sprites always facing camera
 */

import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import {
  forceSimulation,
  forceCenter,
  forceManyBody,
  forceCollide,
  forceLink,
} from 'd3-force-3d'
import {
  FEATURE_LABELS,
  FEATURE_CATEGORIES,
  CATEGORY_COLORS,
  DIM_CONFIG,
  ANIM,
} from '../../../utils/sphereConstants'

const TOP_K = 7
const CENTER_RADIUS = 0.12
const NODE_MIN_R = 0.04
const NODE_MAX_R = 0.09
const OTHER_R = 0.06
const NETWORK_SCALE = 0.48   // Overall scale of the synapse network
const NETWORK_OFFSET = 0.58  // Distance above face along normal
const NETWORK_SPIN_SPEED = 0.34 // rad/s, slow self-rotation for readability
const NETWORK_WOBBLE_SPEED = 0.72
const NETWORK_TILT_X = 0.23
const NETWORK_TILT_Z = 0.19
const SIM_SEED_RADIUS = 0.28
const LINE_MIN_LEN_SQ = 1e-8

function featureLabel(name) {
  return FEATURE_LABELS[name] || name.replace(/^(seg_|det_)/, '').replace(/_/g, ' ')
}

function featureColor(name) {
  const cat = FEATURE_CATEGORIES[name] || 'infra'
  return CATEGORY_COLORS[cat] || '#7B93A8'
}

/** Create a high-resolution sprite with text rendered on a canvas */
function makeTextSprite(text, { fontSize = 32, color = '#F5F0E8', bold = false } = {}) {
  // Higher internal resolution to prevent fuzziness
  const scaleFactor = 4 
  const displaySize = fontSize
  const internalSize = fontSize * scaleFactor

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `${bold ? 'bold ' : ''}${internalSize}px "Inter", "Segoe UI", sans-serif`
  ctx.font = font
  
  const metrics = ctx.measureText(text)
  const w = Math.ceil(metrics.width) + 32 * scaleFactor
  const h = internalSize + 16 * scaleFactor
  
  canvas.width = w
  canvas.height = h
  
  // Re-set font after canvas resize
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  
  // High quality text rendering
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  
  // Optional: subtle shadow for readability
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 4 * scaleFactor
  ctx.shadowOffsetX = 1 * scaleFactor
  ctx.shadowOffsetY = 1 * scaleFactor

  ctx.fillText(text, w / 2, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 16
  tex.generateMipmaps = true

  const mat = new THREE.SpriteMaterial({ 
    map: tex, 
    transparent: true, 
    depthTest: false,
    depthWrite: false, // Prevents depth artifacts
    sizeAttenuation: true 
  })
  
  const sprite = new THREE.Sprite(mat)
  // Scale down the sprite so it matches world dimensions while keeping high tex resolution
  const aspect = w / h
  const worldHeight = displaySize / 340 // Slightly smaller world-space labels
  sprite.scale.set(worldHeight * aspect, worldHeight, 1)
  
  return sprite
}

export class Synapse3DLayer {
  constructor() {
    this.group = new THREE.Group()
    this.group.visible = false
    this._opacity = 0
    this._targetOpacity = 0
    this._simulation = null
    this._nodes3D = []     // { mesh, label, valueLbl }
    this._links3D = []     // { line, particles: [] }
    this._particlePool = []
    this._prevContributions = null
    this._shakeTime = 0
    this._shakeIntensity = 0
    this._facePos = new THREE.Vector3()
    this._faceNormal = new THREE.Vector3()
    this._spinYaw = 0
    this._spinWobble = 0
    this._upAxis = new THREE.Vector3(0, 1, 0)
    this._spinEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._spinQuat = new THREE.Quaternion()
    this._targetQuat = new THREE.Quaternion()
    this._tmpResolution = new THREE.Vector2(1, 1)
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
    scene.add(this.group)
    // Click handler for "Other" node expand
    this._onClickBound = (e) => this._handleClick(e)
    engine.renderer.domElement.addEventListener('click', this._onClickBound)
  }

  _safeFinite(v, fallback = 0) {
    return Number.isFinite(v) ? v : fallback
  }

  _getRenderResolution() {
    const renderer = this.engine?.renderer
    if (!renderer) return this._tmpResolution.set(1, 1)
    renderer.getDrawingBufferSize(this._tmpResolution)
    if (this._tmpResolution.x < 1 || this._tmpResolution.y < 1) {
      this._tmpResolution.set(1, 1)
    }
    return this._tmpResolution
  }

  _seedPosition(i, total, radius = SIM_SEED_RADIUS) {
    const golden = 2.399963229728653
    const n = Math.max(1, total)
    const t = (i + 0.5) / n
    const y = 1 - 2 * t
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * golden
    return {
      x: Math.cos(theta) * r * radius,
      y: y * radius * 0.75,
      z: Math.sin(theta) * r * radius,
    }
  }

  _seedSimulationNodes(nodes) {
    const mobile = nodes.filter(n => !n.isCenter)
    const total = mobile.length
    mobile.forEach((node, i) => {
      const p = this._seedPosition(i, total)
      node.x = p.x
      node.y = p.y
      node.z = p.z
      node.vx = 0
      node.vy = 0
      node.vz = 0
    })
    const center = nodes.find(n => n.isCenter)
    if (center) {
      center.x = 0
      center.y = 0
      center.z = 0
      center.vx = 0
      center.vy = 0
      center.vz = 0
    }
  }

  _nodesAreFinite(nodes) {
    return nodes.every(n =>
      Number.isFinite(n.x) &&
      Number.isFinite(n.y) &&
      Number.isFinite(n.z) &&
      Number.isFinite(n.vx) &&
      Number.isFinite(n.vy) &&
      Number.isFinite(n.vz)
    )
  }

  _runForceSimulation(nodes, links, {
    ticks,
    distanceFn,
    chargeStrength = -0.15,
    collidePad = 0.02,
    linkStrength = 0.8,
  }) {
    const attempts = [
      { charge: chargeStrength, pad: collidePad, linkStrength },
      { charge: chargeStrength * 0.6, pad: collidePad * 0.8, linkStrength: Math.max(0.55, linkStrength * 0.9) },
    ]

    for (const attempt of attempts) {
      this._seedSimulationNodes(nodes)
      if (this._simulation) this._simulation.stop()
      this._simulation = forceSimulation(nodes)
        .numDimensions(3)
        .force('center', forceCenter(0, 0, 0).strength(0.05))
        .force('charge', forceManyBody().strength(attempt.charge))
        .force('collide', forceCollide(d => (d.r + attempt.pad) * NETWORK_SCALE))
        .force('link', forceLink(links).id(d => d.id)
          .distance(distanceFn)
          .strength(attempt.linkStrength))
        .stop()

      for (let i = 0; i < ticks; i++) this._simulation.tick()
      if (this._nodesAreFinite(nodes)) return true
    }

    this._seedSimulationNodes(nodes)
    return false
  }

  /** Show network at given face position */
  show(facePos, faceNormal) {
    this._facePos.copy(facePos)
    this._faceNormal.copy(faceNormal)
    this._targetOpacity = 1
    this.group.visible = true
    // Position group above the face
    this.group.position.copy(facePos).addScaledVector(faceNormal, NETWORK_OFFSET)
    // Orient group so local Y aligns with face normal
    const q = new THREE.Quaternion().setFromUnitVectors(this._upAxis, faceNormal)
    this.group.quaternion.copy(q)
    this._spinYaw = 0
    this._spinWobble = 0
  }

  /** Hide with fade-out */
  hide() {
    this._targetOpacity = 0
  }

  /** Move network to new face position (for walking) */
  moveTo(facePos, faceNormal) {
    this._facePos.copy(facePos)
    this._faceNormal.copy(faceNormal)
    // Smooth interpolation handled in update()
  }

  /**
   * Set SHAP data and rebuild the graph.
   * @param {object} shapData - from /shap-all endpoint
   * @param {string} activeDim - perception dimension
   * @param {object} [featureValues] - raw feature values from pointDetail.features
   */
  setShapData(shapData, activeDim, featureValues) {
    if (!shapData || !activeDim || !shapData.dimensions?.[activeDim]) return

    const dimData = shapData.dimensions[activeDim]
    const contributions = dimData.contributions || []
    const baseValue = dimData.base_value || 0

    // Compute delta for shake effect
    let delta = 0
    if (this._prevContributions) {
      const prevMap = new Map(this._prevContributions.map(c => [c.feature, c.shap_value]))
      for (const c of contributions) {
        delta += Math.abs(c.shap_value - (prevMap.get(c.feature) || 0))
      }
    }
    this._prevContributions = contributions

    // Trigger shake for large changes
    if (delta >= 2.0 && this._prevContributions) {
      this._shakeIntensity = 0.03
      this._shakeTime = 0
    }

    // Clear previous graph
    this._clearGraph()

    // Split into top-K and others
    const topK = contributions.slice(0, TOP_K)
    const others = contributions.slice(TOP_K)
    this._otherContributions = others  // Store for expand interaction
    const otherAbs = others.reduce((s, c) => s + Math.abs(c.shap_value), 0)

    // Node radius: use raw feature value if available, else |SHAP|
    const hasFeatures = featureValues && Object.keys(featureValues).length > 0
    let maxVal = 0.01
    if (hasFeatures) {
      for (const c of topK) {
        const v = Math.abs(featureValues[c.feature] || 0)
        if (v > maxVal) maxVal = v
      }
    } else {
      maxVal = Math.max(...topK.map(c => Math.abs(c.shap_value)), 0.01)
    }
    const rScale = (featureName, shapVal) => {
      const raw = hasFeatures ? Math.abs(featureValues[featureName] || 0) : Math.abs(shapVal)
      const t = Math.min(1, raw / maxVal)
      return NODE_MIN_R + t * (NODE_MAX_R - NODE_MIN_R)
    }

    // Build nodes for D3 simulation (XZ plane in local space, Y = up)
    const simNodes = [
      { id: 'center', fx: 0, fy: 0, fz: 0, r: CENTER_RADIUS, isCenter: true },
      ...topK.map(c => ({
        id: c.feature,
        r: rScale(c.feature, c.shap_value),
        shapValue: c.shap_value,
        featureValue: hasFeatures ? featureValues[c.feature] : null,
      })),
    ]
    if (others.length > 0) {
      simNodes.push({
        id: 'other',
        r: OTHER_R,
        shapValue: 0,
        isOther: true,
        otherCount: others.length,
      })
    }

    const simLinks = simNodes.filter(n => !n.isCenter).map(n => ({
      source: n.id,
      target: 'center',
      shapValue: n.shapValue || 0,
      isOther: n.isOther || false,
    }))

    this._runForceSimulation(simNodes, simLinks, {
      ticks: 120,
      distanceFn: d => 0.3 - Math.min(0.2, Math.abs(d.shapValue) * 0.5),
      chargeStrength: -0.15,
      collidePad: 0.02,
      linkStrength: 0.8,
    })

    // Build Three.js objects from settled positions
    for (const node of simNodes) {
      const x = this._safeFinite(node.x) * NETWORK_SCALE
      const y = this._safeFinite(node.z) * NETWORK_SCALE  // D3 z → local Y (up along normal)
      const z = this._safeFinite(node.y) * NETWORK_SCALE  // D3 y → local Z

      // Node sphere
      const color = node.isCenter ? '#D4A855' : (node.isOther ? '#A89F91' : featureColor(node.id))
      const geo = new THREE.SphereGeometry(node.r * NETWORK_SCALE, 12, 8)
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      this.group.add(mesh)

      // Text label (above node)
      const labelText = node.isCenter
        ? (DIM_CONFIG[activeDim]?.label || activeDim)
        : (node.isOther ? `${others.length} others` : featureLabel(node.id))
      const label = makeTextSprite(labelText, { fontSize: 24, color: '#F5F0E8' })
      label.position.set(x, y + node.r * NETWORK_SCALE + 0.04, z)
      label.material.opacity = 0
      this.group.add(label)

      // Value label (inside node): show raw feature value (size semantics)
      let valueLbl = null
      if (node.isCenter) {
        valueLbl = makeTextSprite(baseValue.toFixed(2), { fontSize: 28, color: '#0F0D0A', bold: true })
      } else if (!node.isOther) {
        const displayVal = node.featureValue != null
          ? node.featureValue.toFixed(2)
          : node.shapValue.toFixed(2)
        valueLbl = makeTextSprite(displayVal, { fontSize: 22, color: '#0F0D0A', bold: true })
      } else {
        valueLbl = makeTextSprite(`×${node.otherCount || ''}`, { fontSize: 20, color: '#0F0D0A', bold: true })
      }
      if (valueLbl) {
        valueLbl.position.set(x, y, z)
        valueLbl.material.opacity = 0
        this.group.add(valueLbl)
      }

      if (node.isOther) mesh.userData.isOther = true
      this._nodes3D.push({ mesh, label, valueLbl, node })
    }

    // Store context for Other node expand
    this._expandCtx = { shapData, activeDim, featureValues }
    this._expanded = false

    // Build links
    const resolution = this._getRenderResolution().clone()

    for (const link of simLinks) {
      const src = link.source
      const tgt = link.target
      const sx = this._safeFinite(src.x) * NETWORK_SCALE
      const sy = this._safeFinite(src.z) * NETWORK_SCALE
      const sz = this._safeFinite(src.y) * NETWORK_SCALE
      const tx = this._safeFinite(tgt.x) * NETWORK_SCALE
      const ty = this._safeFinite(tgt.z) * NETWORK_SCALE
      const tz = this._safeFinite(tgt.y) * NETWORK_SCALE
      const dx = tx - sx
      const dy = ty - sy
      const dz = tz - sz
      if (dx * dx + dy * dy + dz * dz < LINE_MIN_LEN_SQ) continue

      const lineColor = link.isOther ? '#555555' : (link.shapValue >= 0 ? '#3DBB78' : '#E8734A')
      const thickness = Math.max(1, Math.min(5, Math.abs(link.shapValue || otherAbs) * 18))

      const lineGeo = new LineGeometry()
      lineGeo.setPositions([sx, sy, sz, tx, ty, tz])

      const lineMat = new LineMaterial({
        color: new THREE.Color(lineColor).getHex(),
        linewidth: thickness,
        transparent: true,
        opacity: 0,
        resolution,
      })
      const line = new Line2(lineGeo, lineMat)
      line.computeLineDistances()
      this.group.add(line)

      // Energy particles (2 per link)
      const particles = []
      for (let p = 0; p < 2; p++) {
        const pGeo = new THREE.SphereGeometry(0.012, 6, 4)
        const pMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(lineColor),
          transparent: true,
          opacity: 0,
        })
        const pMesh = new THREE.Mesh(pGeo, pMat)
        pMesh.userData = {
          phase: p * 0.5,  // stagger particles
          positive: link.shapValue >= 0,
          sx, sy, sz, tx, ty, tz,
        }
        this.group.add(pMesh)
        particles.push(pMesh)
      }

      this._links3D.push({ line, particles })
    }
  }

  /** Expand "Other" node to show all remaining factors */
  expandOther() {
    if (this._expanded || !this._otherContributions?.length || !this._expandCtx) return
    this._expanded = true
    // Re-render with all contributions (TOP_K = total)
    const { shapData, activeDim, featureValues } = this._expandCtx
    const saved = TOP_K
    // Temporarily show all by re-calling with full data
    const dimData = shapData.dimensions?.[activeDim]
    if (!dimData) return
    // Build new contributions with all features (bypass TOP_K split)
    this._prevContributions = null  // prevent shake on expand
    this._clearGraph()
    const contributions = dimData.contributions || []
    const baseValue = dimData.base_value || 0

    const hasFeatures = featureValues && Object.keys(featureValues).length > 0
    let maxVal = 0.01
    if (hasFeatures) {
      for (const c of contributions) {
        const v = Math.abs(featureValues[c.feature] || 0)
        if (v > maxVal) maxVal = v
      }
    } else {
      maxVal = Math.max(...contributions.map(c => Math.abs(c.shap_value)), 0.01)
    }
    const rScale = (name, shap) => {
      const raw = hasFeatures ? Math.abs(featureValues[name] || 0) : Math.abs(shap)
      return NODE_MIN_R + Math.min(1, raw / maxVal) * (NODE_MAX_R - NODE_MIN_R)
    }

    // All contributions as nodes (no "Other" aggregate)
    const simNodes = [
      { id: 'center', fx: 0, fy: 0, fz: 0, r: CENTER_RADIUS, isCenter: true },
      ...contributions.map(c => ({
        id: c.feature,
        r: rScale(c.feature, c.shap_value) * 0.7,  // smaller when showing all
        shapValue: c.shap_value,
        featureValue: hasFeatures ? featureValues[c.feature] : null,
      })),
    ]
    const simLinks = simNodes.filter(n => !n.isCenter).map(n => ({
      source: n.id, target: 'center',
      shapValue: n.shapValue || 0, isOther: false,
    }))

    this._runForceSimulation(simNodes, simLinks, {
      ticks: 150,
      distanceFn: d => 0.25 - Math.min(0.15, Math.abs(d.shapValue) * 0.3),
      chargeStrength: -0.08,
      collidePad: 0.01,
      linkStrength: 0.8,
    })

    // Rebuild 3D objects (same pattern as setShapData)
    for (const node of simNodes) {
      const x = this._safeFinite(node.x) * NETWORK_SCALE
      const y = this._safeFinite(node.z) * NETWORK_SCALE
      const z = this._safeFinite(node.y) * NETWORK_SCALE
      const color = node.isCenter ? '#D4A855' : featureColor(node.id)
      const geo = new THREE.SphereGeometry(node.r * NETWORK_SCALE, 12, 8)
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: this._opacity })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      this.group.add(mesh)

      const labelText = node.isCenter ? (DIM_CONFIG[activeDim]?.label || activeDim) : featureLabel(node.id)
      const label = makeTextSprite(labelText, { fontSize: 20, color: '#F5F0E8' })
      label.position.set(x, y + node.r * NETWORK_SCALE + 0.03, z)
      label.material.opacity = this._opacity
      this.group.add(label)

      let valueLbl = null
      if (node.isCenter) {
        valueLbl = makeTextSprite(baseValue.toFixed(2), { fontSize: 24, color: '#0F0D0A', bold: true })
      } else {
        const dv = node.featureValue != null ? node.featureValue.toFixed(2) : node.shapValue.toFixed(2)
        valueLbl = makeTextSprite(dv, { fontSize: 18, color: '#0F0D0A', bold: true })
      }
      if (valueLbl) { valueLbl.position.set(x, y, z); valueLbl.material.opacity = this._opacity; this.group.add(valueLbl) }
      this._nodes3D.push({ mesh, label, valueLbl, node })
    }

    const resolution = this._getRenderResolution().clone()
    for (const link of simLinks) {
      const src = link.source, tgt = link.target
      const sx = this._safeFinite(src.x) * NETWORK_SCALE
      const sy = this._safeFinite(src.z) * NETWORK_SCALE
      const sz = this._safeFinite(src.y) * NETWORK_SCALE
      const tx = this._safeFinite(tgt.x) * NETWORK_SCALE
      const ty = this._safeFinite(tgt.z) * NETWORK_SCALE
      const tz = this._safeFinite(tgt.y) * NETWORK_SCALE
      const dx = tx - sx
      const dy = ty - sy
      const dz = tz - sz
      if (dx * dx + dy * dy + dz * dz < LINE_MIN_LEN_SQ) continue
      const lineColor = link.shapValue >= 0 ? '#3DBB78' : '#E8734A'
      const thickness = Math.max(1, Math.min(5, Math.abs(link.shapValue) * 18))
      const lineGeo = new LineGeometry()
      lineGeo.setPositions([sx, sy, sz, tx, ty, tz])
      const lineMat = new LineMaterial({ color: new THREE.Color(lineColor).getHex(), linewidth: thickness, transparent: true, opacity: this._opacity * 0.7, resolution })
      const line = new Line2(lineGeo, lineMat)
      line.computeLineDistances()
      this.group.add(line)
      const particles = []
      for (let p = 0; p < 2; p++) {
        const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(lineColor), transparent: true, opacity: this._opacity * 0.8 }))
        pMesh.userData = { phase: p * 0.5, positive: link.shapValue >= 0, sx, sy, sz, tx, ty, tz }
        this.group.add(pMesh)
        particles.push(pMesh)
      }
      this._links3D.push({ line, particles })
    }
  }

  /** Handle click on "Other" node — uses engine raycaster */
  _handleClick(e) {
    if (!this.group.visible || this._opacity < 0.3 || this._expanded) return
    const otherMeshes = this._nodes3D.filter(n => n.node.isOther).map(n => n.mesh)
    if (!otherMeshes.length) return

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(this.engine.pointer, this.engine.camera)
    const hits = raycaster.intersectObjects(otherMeshes)
    if (hits.length > 0) {
      this.expandOther()
    }
  }

  _clearGraph() {
    if (this._simulation) {
      this._simulation.stop()
      this._simulation = null
    }

    // Remove all children from group (except the group itself)
    while (this.group.children.length) {
      const child = this.group.children[0]
      this.group.remove(child)
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (child.material.map) child.material.map.dispose()
        child.material.dispose()
      }
    }

    this._nodes3D = []
    this._links3D = []
  }

  update(dt, elapsed) {
    // Fade in/out
    const fadeSpeed = dt * (1000 / ANIM.SYNAPSE_TWEEN_MS)
    if (this._opacity < this._targetOpacity) {
      this._opacity = Math.min(this._targetOpacity, this._opacity + fadeSpeed)
    } else if (this._opacity > this._targetOpacity) {
      this._opacity = Math.max(this._targetOpacity, this._opacity - fadeSpeed)
    }

    if (this._opacity <= 0 && this._targetOpacity <= 0) {
      this.group.visible = false
      return
    }

    const alpha = this._opacity

    // 3D self-rotation (yaw + wobbling pitch/roll) to reveal occluded labels.
    this._spinYaw += dt * NETWORK_SPIN_SPEED * (0.35 + alpha * 0.65)
    if (this._spinYaw > Math.PI * 2) this._spinYaw -= Math.PI * 2
    this._spinWobble += dt * NETWORK_WOBBLE_SPEED
    if (this._spinWobble > Math.PI * 2) this._spinWobble -= Math.PI * 2
    const tiltX = Math.sin(this._spinWobble) * NETWORK_TILT_X
    const tiltZ = Math.cos(this._spinWobble * 0.7) * NETWORK_TILT_Z

    // Smooth position interpolation
    const targetPos = this._facePos.clone().addScaledVector(this._faceNormal, NETWORK_OFFSET)
    this.group.position.lerp(targetPos, Math.min(1, dt * 5))
    this._targetQuat.setFromUnitVectors(this._upAxis, this._faceNormal)
    this._spinEuler.set(tiltX, this._spinYaw, tiltZ, 'YXZ')
    this._spinQuat.setFromEuler(this._spinEuler)
    this._targetQuat.multiply(this._spinQuat)
    this.group.quaternion.slerp(this._targetQuat, Math.min(1, dt * 5))

    // Update node/link opacities
    for (const { mesh, label, valueLbl } of this._nodes3D) {
      mesh.material.opacity = alpha
      label.material.opacity = alpha
      if (valueLbl) valueLbl.material.opacity = alpha
    }

    for (const { line, particles } of this._links3D) {
      if (line?.material?.resolution) {
        line.material.resolution.copy(this._getRenderResolution())
      }
      line.material.opacity = alpha * 0.7

      // Animate energy particles
      const t = (elapsed / 1000) % 1000
      for (const p of particles) {
        p.material.opacity = alpha * 0.8
        const d = p.userData
        const progress = (t * 0.8 + d.phase) % 1
        // Positive SHAP: flow toward center; negative: flow away
        const dir = d.positive ? progress : (1 - progress)
        p.position.set(
          d.sx + (d.tx - d.sx) * dir,
          d.sy + (d.ty - d.sy) * dir,
          d.sz + (d.tz - d.sz) * dir,
        )
      }
    }

    // Shake effect decay
    if (this._shakeIntensity > 0.001) {
      this._shakeTime += dt
      if (this._shakeTime < 0.3) {
        const shake = this._shakeIntensity * Math.sin(this._shakeTime * 40)
        this.group.position.x += shake
        this.group.position.z += shake * 0.7
      } else {
        this._shakeIntensity = 0
        this._shakeTime = 0
      }
    }
  }

  dispose() {
    this._clearGraph()
    if (this.engine && this._onClickBound) {
      this.engine.renderer.domElement.removeEventListener('click', this._onClickBound)
    }
    if (this.scene) {
      this.scene.remove(this.group)
    }
  }
}
