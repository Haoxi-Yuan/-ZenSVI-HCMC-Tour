/**
 * TopologyNetworkLayer — Real road network topology on the sphere surface.
 *
 * Edges come from GeoJSON LineString coordinate sequences (OSM road geometry),
 * NOT from the embedding-based adjacency graph. Each edge pair represents
 * consecutive points along an actual street.
 *
 * All lines are drawn as geodesic arcs (slerp interpolation) that hug the
 * sphere surface instead of cutting through the interior.
 *
 * Visual elements:
 *   1. All street edges: faint lines forming the full road mesh
 *   2. Major road edges: brighter gold lines for named arterials
 *   3. Micro-labels: tiny map-style text for major road names
 *   4. Landmark dots: small glowing points with minimal text
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const API = '/api/sphere'

// Radii — roads sit just above sphere faces
const SURFACE_R = SPHERE_RADIUS * 1.003
const MAJOR_R = SPHERE_RADIUS * 1.005
const LABEL_R = SPHERE_RADIUS * 1.018
const LANDMARK_R = SPHERE_RADIUS * 1.014

// Geodesic arc interpolation steps per edge
const ARC_STEPS = 5

// Colors
const EDGE_COLOR = new THREE.Color(0.30, 0.30, 0.34)
const MAJOR_COLOR = new THREE.Color(0.85, 0.65, 0.30)
const SECONDARY_COLOR = new THREE.Color(0.50, 0.48, 0.44)
const LABEL_TEXT = { r: 200, g: 180, b: 145 }
const LANDMARK_TEXT = { r: 230, g: 140, b: 100 }

// LOD thresholds (camera distance from origin)
const LOD_MID = 16
const LOD_NEAR = 8

// Subsample all-edges for performance
const MAX_ALL_EDGES = 100000

// Reusable vectors for slerp
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vT = new THREE.Vector3()

/**
 * Spherical linear interpolation between two unit vectors.
 * Result is written to `out` and normalized, then scaled by `radius`.
 */
function slerpToSurface(vA, vB, t, radius, out) {
  const dot = Math.max(-1, Math.min(1, vA.dot(vB)))
  // For nearly identical directions, lerp is fine
  if (Math.abs(dot) > 0.9999) {
    out.lerpVectors(vA, vB, t).normalize().multiplyScalar(radius)
    return
  }
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)
  const a = Math.sin((1 - t) * omega) / sinOmega
  const b = Math.sin(t * omega) / sinOmega
  out.set(
    vA.x * a + vB.x * b,
    vA.y * a + vB.y * b,
    vA.z * a + vB.z * b,
  ).multiplyScalar(radius)
}

/**
 * Build a geodesic arc (array of 3D positions) between two point indices.
 * Returns flat array [x0,y0,z0, x1,y1,z1, ...] with ARC_STEPS+1 points.
 */
function arcPositions(positions, idxA, idxB, radius, steps) {
  _vA.set(positions[idxA * 3], positions[idxA * 3 + 1], positions[idxA * 3 + 2])
  _vB.set(positions[idxB * 3], positions[idxB * 3 + 1], positions[idxB * 3 + 2])

  const result = []
  for (let i = 0; i <= steps; i++) {
    slerpToSurface(_vA, _vB, i / steps, radius, _vT)
    result.push(_vT.x, _vT.y, _vT.z)
  }
  return result
}

/**
 * Push arc line-segment pairs into position/color arrays.
 * Each arc of N steps produces N line segments (2 vertices each).
 */
function pushArc(positions, idxA, idxB, radius, steps, posArr, colArr, color) {
  const arc = arcPositions(positions, idxA, idxB, radius, steps)
  for (let i = 0; i < steps; i++) {
    const j = i * 3
    const k = (i + 1) * 3
    posArr.push(arc[j], arc[j + 1], arc[j + 2])
    posArr.push(arc[k], arc[k + 1], arc[k + 2])
    colArr.push(color.r, color.g, color.b, color.r, color.g, color.b)
  }
}


export class TopologyNetworkLayer {
  constructor(positions) {
    this.positions = positions
    this.group = new THREE.Group()
    this.group.visible = false

    this._edgeLines = null
    this._majorLines = null
    this._secondaryLines = null
    this._labelSprites = []
    this._landmarkSprites = []

    this._loaded = false
    this._opacity = 0
    this._targetOpacity = 0
    this._forceVisible = false
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
    scene.add(this.group)
    this._loadData()
  }

  async _loadData() {
    try {
      const [edgesRes, roadRes, landmarkRes] = await Promise.all([
        fetch(`${API}/binary/topology_edges`),
        fetch(`${API}/road_network`),
        fetch(`${API}/landmarks`),
      ])

      if (!edgesRes.ok || !roadRes.ok || !landmarkRes.ok) {
        console.warn('Topology data not available')
        return
      }

      const [edgesBuf, roads, landmarks] = await Promise.all([
        edgesRes.arrayBuffer(),
        roadRes.json(),
        landmarkRes.json(),
      ])

      this._edgesData = new Float32Array(edgesBuf)
      this._roadNetwork = roads
      this._landmarks = landmarks

      this._buildAllEdges()
      this._buildRoadEdges()
      this._buildRoadLabels()
      this._buildLandmarks()

      this._loaded = true
      this._targetOpacity = 1
      this.group.visible = true
    } catch (err) {
      console.warn('Failed to load topology data:', err)
    }
  }

  // ─── All street edges (thin geodesic arcs) ────────────────────

  _buildAllEdges() {
    const data = this._edgesData
    const totalEdges = data.length / 2
    const step = totalEdges > MAX_ALL_EDGES
      ? Math.ceil(totalEdges / MAX_ALL_EDGES)
      : 1

    const posArr = []
    const colArr = []

    for (let i = 0; i < totalEdges; i += step) {
      const idxA = Math.round(data[i * 2])
      const idxB = Math.round(data[i * 2 + 1])
      if (idxA * 3 + 2 >= this.positions.length || idxB * 3 + 2 >= this.positions.length) continue
      pushArc(this.positions, idxA, idxB, SURFACE_R, ARC_STEPS, posArr, colArr, EDGE_COLOR)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3))

    this._edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }))
    this._edgeLines.renderOrder = 1
    this._edgeLines.visible = false
    this.group.add(this._edgeLines)
  }

  // ─── Road edges (geodesic arcs with color coding) ─────────────

  _buildRoadEdges() {
    if (!this._roadNetwork?.length) return

    const majorPos = [], majorCol = []
    const secPos = [], secCol = []

    for (const road of this._roadNetwork) {
      if (!road.edges?.length) continue

      const isMajor = road.is_major
      const color = isMajor ? MAJOR_COLOR : SECONDARY_COLOR
      const r = isMajor ? MAJOR_R : SURFACE_R * 1.002
      const posArr = isMajor ? majorPos : secPos
      const colArr = isMajor ? majorCol : secCol

      for (const [idxA, idxB] of road.edges) {
        if (idxA * 3 + 2 >= this.positions.length || idxB * 3 + 2 >= this.positions.length) continue
        pushArc(this.positions, idxA, idxB, r, ARC_STEPS, posArr, colArr, color)
      }
    }

    if (majorPos.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(majorPos, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(majorCol, 3))
      this._majorLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }))
      this._majorLines.renderOrder = 3
      this.group.add(this._majorLines)
    }

    if (secPos.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(secPos, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(secCol, 3))
      this._secondaryLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }))
      this._secondaryLines.renderOrder = 2
      this.group.add(this._secondaryLines)
    }
  }

  // ─── Micro-labels ─────────────────────────────────────────────

  _buildRoadLabels() {
    if (!this._roadNetwork?.length) return
    const majorRoads = this._roadNetwork.filter(r => r.is_major)

    for (const road of majorRoads) {
      const idx = road.label_idx
      if (idx == null || idx * 3 + 2 >= this.positions.length) continue

      const sprite = this._microLabel(road.name, LABEL_TEXT, 0.28)
      sprite.position.set(
        this.positions[idx * 3] * LABEL_R,
        this.positions[idx * 3 + 1] * LABEL_R,
        this.positions[idx * 3 + 2] * LABEL_R,
      )
      sprite.renderOrder = 5
      this._labelSprites.push(sprite)
      this.group.add(sprite)
    }
  }

  // ─── Landmark micro-dots ──────────────────────────────────────

  _buildLandmarks() {
    if (!this._landmarks?.length) return

    for (const lm of this._landmarks) {
      const idx = lm.nearest_point_idx
      if (idx * 3 + 2 >= this.positions.length) continue

      const dot = this._microDot(lm.type)
      dot.position.set(
        this.positions[idx * 3] * LANDMARK_R,
        this.positions[idx * 3 + 1] * LANDMARK_R,
        this.positions[idx * 3 + 2] * LANDMARK_R,
      )
      dot.renderOrder = 6

      const label = this._microLabel(lm.name_vi || lm.name, LANDMARK_TEXT, 0.22)
      const lr = LANDMARK_R * 1.015
      label.position.set(
        this.positions[idx * 3] * lr,
        this.positions[idx * 3 + 1] * lr,
        this.positions[idx * 3 + 2] * lr,
      )
      label.renderOrder = 7

      this._landmarkSprites.push({ dot, label })
      this.group.add(dot)
      this.group.add(label)
    }
  }

  // ─── Sprite factories ────────────────────────────────────────

  _microLabel(text, color, scale) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const fontSize = 28
    const pad = 4

    ctx.font = `500 ${fontSize}px "Inter","Segoe UI",sans-serif`
    const tw = ctx.measureText(text).width
    canvas.width = Math.ceil(tw + pad * 2)
    canvas.height = Math.ceil(fontSize * 1.3 + pad)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `500 ${fontSize}px "Inter","Segoe UI",sans-serif`
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter

    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, sizeAttenuation: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1)
    sprite.userData = { canvas, tex }
    return sprite
  }

  _microDot(type) {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const cx = size / 2
    const colors = { landmark: [232,140,90], transport: [130,170,210], park: [80,180,110], district: [190,165,100] }
    const [r, g, b] = colors[type] || colors.landmark

    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, size / 2)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`)
    grad.addColorStop(0.35, `rgba(${r},${g},${b},0.4)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    ctx.beginPath()
    ctx.arc(cx, cx, 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fill()

    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, sizeAttenuation: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.25, 0.25, 1)
    sprite.userData = { canvas, tex }
    return sprite
  }

  // ─── Visibility ───────────────────────────────────────────────

  show() { this._targetOpacity = 1; this.group.visible = true }
  hide() { this._targetOpacity = 0; this._forceVisible = false }

  setCoreInsideVisible(enabled) {
    this._forceVisible = !!enabled
    if (enabled) { this._targetOpacity = 1; this.group.visible = true }
  }

  // ─── Per-frame update ─────────────────────────────────────────

  update(dt, elapsed) {
    if (!this._loaded) return

    const speed = 2.5
    if (this._opacity < this._targetOpacity)
      this._opacity = Math.min(this._targetOpacity, this._opacity + dt * speed)
    else if (this._opacity > this._targetOpacity)
      this._opacity = Math.max(this._targetOpacity, this._opacity - dt * speed)

    if (this._opacity <= 0.001 && this._targetOpacity <= 0) {
      this.group.visible = false
      return
    }

    const camDist = this.engine.camera.position.length()
    const insideCore = this._forceVisible && camDist < 6
    let lod
    if (insideCore) lod = 'core'
    else if (camDist < LOD_NEAR) lod = 'hidden'
    else if (camDist < LOD_MID) lod = 'mid'
    else lod = 'far'

    const o = this._opacity

    // All street edges
    if (this._edgeLines) {
      const show = lod === 'mid'
      this._edgeLines.visible = show
      if (show) this._edgeLines.material.opacity = o * 0.10
    }

    // Major roads
    if (this._majorLines) {
      const show = lod !== 'hidden'
      this._majorLines.visible = show
      if (show) {
        const pulse = 0.88 + 0.12 * Math.sin(elapsed * 0.0008)
        this._majorLines.material.opacity = o * (lod === 'core' ? 0.35 : 0.45) * pulse
      }
    }

    // Secondary roads
    if (this._secondaryLines) {
      const show = lod === 'mid'
      this._secondaryLines.visible = show
      if (show) this._secondaryLines.material.opacity = o * 0.18
    }

    // Labels
    const showLabels = lod === 'far' || lod === 'core'
    const labelOp = o * (lod === 'core' ? 0.5 : 0.7)
    for (const s of this._labelSprites) {
      s.visible = showLabels
      if (showLabels) s.material.opacity = labelOp
    }

    // Landmarks
    const showLm = lod !== 'hidden' && lod !== 'mid'
    const lmOp = o * (lod === 'core' ? 0.45 : 0.65)
    for (const { dot, label } of this._landmarkSprites) {
      dot.visible = showLm
      label.visible = showLm
      if (showLm) {
        dot.material.opacity = lmOp * (0.7 + 0.3 * Math.sin(elapsed * 0.002))
        label.material.opacity = lmOp
      }
    }

    if (this._opacity <= 0.001) this.group.visible = false
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  dispose() {
    const d = m => { if (m) { m.geometry.dispose(); m.material.dispose() } }
    d(this._edgeLines); d(this._majorLines); d(this._secondaryLines)
    for (const s of this._labelSprites) { s.material.map?.dispose(); s.material.dispose() }
    for (const { dot, label } of this._landmarkSprites) {
      dot.material.map?.dispose(); dot.material.dispose()
      label.material.map?.dispose(); label.material.dispose()
    }
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
