/**
 * TopologyNetworkLayer — Road network topology mapped onto the sphere surface.
 *
 * Renders adjacency edges as actual road paths on the sphere, not arbitrary
 * connections. Each road's edges come from the adjacency graph filtered to
 * points belonging to that road.
 *
 * Visual elements:
 *   1. All-edge mesh: full adjacency graph as faint lines
 *   2. Major road edges: gold/bright lines using real adjacency pairs
 *   3. Micro-labels: tiny map-style annotations for road names
 *   4. Landmark dots: small glowing points with minimal text
 *
 * LOD by camera distance. Visible in both REST orbit and core-inside views.
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const API = '/api/sphere'

// Radii — roads sit just above sphere surface
const SURFACE_R = SPHERE_RADIUS * 1.002
const MAJOR_R = SPHERE_RADIUS * 1.004
const LABEL_R = SPHERE_RADIUS * 1.015
const LANDMARK_R = SPHERE_RADIUS * 1.012

// Colors
const EDGE_COLOR = new THREE.Color(0.30, 0.30, 0.34)
const MAJOR_COLOR = new THREE.Color(0.85, 0.65, 0.30)
const SECONDARY_COLOR = new THREE.Color(0.55, 0.52, 0.48)
const LABEL_TEXT_COLOR = { r: 200, g: 180, b: 145 }       // warm muted gold
const LANDMARK_TEXT_COLOR = { r: 230, g: 140, b: 100 }     // warm orange

// LOD thresholds (camera distance from origin)
const LOD_MID = 16
const LOD_NEAR = 8

// Subsample for all-edges (performance)
const MAX_VISIBLE_EDGES = 200000

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
    this._forceVisible = false  // for core-inside view
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

  // ─── All adjacency edges (thin background mesh) ───────────────

  _buildAllEdges() {
    const data = this._edgesData
    const totalEdges = data.length / 2
    const step = totalEdges > MAX_VISIBLE_EDGES
      ? Math.ceil(totalEdges / MAX_VISIBLE_EDGES)
      : 1
    const edgeCount = Math.ceil(totalEdges / step)

    const positions = new Float32Array(edgeCount * 6)
    let vi = 0

    for (let i = 0; i < totalEdges; i += step) {
      const idxA = Math.round(data[i * 2])
      const idxB = Math.round(data[i * 2 + 1])

      positions[vi++] = this.positions[idxA * 3] * SURFACE_R
      positions[vi++] = this.positions[idxA * 3 + 1] * SURFACE_R
      positions[vi++] = this.positions[idxA * 3 + 2] * SURFACE_R
      positions[vi++] = this.positions[idxB * 3] * SURFACE_R
      positions[vi++] = this.positions[idxB * 3 + 1] * SURFACE_R
      positions[vi++] = this.positions[idxB * 3 + 2] * SURFACE_R
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vi), 3))

    this._edgeLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }))
    this._edgeLines.renderOrder = 1
    this._edgeLines.visible = false
    this.group.add(this._edgeLines)
  }

  // ─── Road edges from adjacency graph ──────────────────────────

  _buildRoadEdges() {
    if (!this._roadNetwork?.length) return

    const majorPos = []
    const majorCol = []
    const secPos = []
    const secCol = []

    for (const road of this._roadNetwork) {
      const edges = road.edges
      if (!edges?.length) continue

      const isMajor = road.is_major
      const color = isMajor ? MAJOR_COLOR : SECONDARY_COLOR
      const r = isMajor ? MAJOR_R : SURFACE_R * 1.001
      const posArr = isMajor ? majorPos : secPos
      const colArr = isMajor ? majorCol : secCol

      for (const [idxA, idxB] of edges) {
        if (idxA * 3 + 2 >= this.positions.length || idxB * 3 + 2 >= this.positions.length) continue

        posArr.push(
          this.positions[idxA * 3] * r,
          this.positions[idxA * 3 + 1] * r,
          this.positions[idxA * 3 + 2] * r,
          this.positions[idxB * 3] * r,
          this.positions[idxB * 3 + 1] * r,
          this.positions[idxB * 3 + 2] * r,
        )
        colArr.push(color.r, color.g, color.b, color.r, color.g, color.b)
      }
    }

    // Major road lines
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

    // Secondary road lines
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

  // ─── Micro-labels for road names ──────────────────────────────

  _buildRoadLabels() {
    if (!this._roadNetwork?.length) return

    const majorRoads = this._roadNetwork.filter(r => r.is_major)

    for (const road of majorRoads) {
      const idx = road.label_idx
      if (idx == null || idx * 3 + 2 >= this.positions.length) continue

      const sprite = this._microLabel(road.name, LABEL_TEXT_COLOR, 0.28)
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

  // ─── Landmark micro-dots + labels ─────────────────────────────

  _buildLandmarks() {
    if (!this._landmarks?.length) return

    for (const lm of this._landmarks) {
      const idx = lm.nearest_point_idx
      if (idx * 3 + 2 >= this.positions.length) continue

      // Tiny dot
      const dot = this._microDot(lm.type)
      dot.position.set(
        this.positions[idx * 3] * LANDMARK_R,
        this.positions[idx * 3 + 1] * LANDMARK_R,
        this.positions[idx * 3 + 2] * LANDMARK_R,
      )
      dot.renderOrder = 6

      // Micro name label
      const label = this._microLabel(
        lm.name_vi || lm.name,
        LANDMARK_TEXT_COLOR,
        0.22,
      )
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

  // ─── Sprite factories: map-style micro annotations ────────────

  _microLabel(text, color, scale) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const fontSize = 28
    const padding = 4

    ctx.font = `500 ${fontSize}px "Inter", "Segoe UI", sans-serif`
    const tw = ctx.measureText(text).width

    canvas.width = Math.ceil(tw + padding * 2)
    canvas.height = Math.ceil(fontSize * 1.3 + padding)

    // No background — just text with slight shadow for readability
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `500 ${fontSize}px "Inter", "Segoe UI", sans-serif`

    // Subtle shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1

    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
    })

    const sprite = new THREE.Sprite(mat)
    const aspect = canvas.width / canvas.height
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.userData = { canvas, texture }
    return sprite
  }

  _microDot(type) {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const cx = size / 2

    const colorMap = {
      landmark: [232, 140, 90],
      transport: [130, 170, 210],
      park: [80, 180, 110],
      district: [190, 165, 100],
    }
    const [r, g, b] = colorMap[type] || colorMap.landmark

    // Soft glow
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, size / 2)
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`)
    grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.4)`)
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    // Tiny center dot
    ctx.beginPath()
    ctx.arc(cx, cx, 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    })

    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.25, 0.25, 1)
    sprite.userData = { canvas, texture }
    return sprite
  }

  // ─── Visibility control ───────────────────────────────────────

  show() {
    this._targetOpacity = 1
    this.group.visible = true
  }

  hide() {
    this._targetOpacity = 0
    this._forceVisible = false
  }

  /** Keep visible in core-inside view (REST phase interior). */
  setCoreInsideVisible(enabled) {
    this._forceVisible = !!enabled
    if (enabled) {
      this._targetOpacity = 1
      this.group.visible = true
    }
  }

  // ─── Per-frame update ─────────────────────────────────────────

  update(dt, elapsed) {
    if (!this._loaded) return

    // Fade
    const speed = 2.5
    if (this._opacity < this._targetOpacity) {
      this._opacity = Math.min(this._targetOpacity, this._opacity + dt * speed)
    } else if (this._opacity > this._targetOpacity) {
      this._opacity = Math.max(this._targetOpacity, this._opacity - dt * speed)
    }

    if (this._opacity <= 0.001 && this._targetOpacity <= 0) {
      this.group.visible = false
      return
    }

    const camDist = this.engine.camera.position.length()

    // In core-inside mode, camera is near origin — show everything
    const insideCore = this._forceVisible && camDist < 6
    let lod
    if (insideCore) {
      lod = 'core'  // inside the sphere, show major roads + labels
    } else if (camDist < LOD_NEAR) {
      lod = 'hidden'
    } else if (camDist < LOD_MID) {
      lod = 'mid'
    } else {
      lod = 'far'
    }

    const o = this._opacity

    // All-edges: only at mid zoom
    if (this._edgeLines) {
      const show = lod === 'mid'
      this._edgeLines.visible = show
      if (show) this._edgeLines.material.opacity = o * 0.10
    }

    // Major road edges: visible at far, mid, and core-inside
    if (this._majorLines) {
      const show = lod !== 'hidden'
      this._majorLines.visible = show
      if (show) {
        const pulse = 0.88 + 0.12 * Math.sin(elapsed * 0.0008)
        const base = lod === 'core' ? 0.35 : 0.45
        this._majorLines.material.opacity = o * base * pulse
      }
    }

    // Secondary road edges: at mid zoom only
    if (this._secondaryLines) {
      const show = lod === 'mid'
      this._secondaryLines.visible = show
      if (show) this._secondaryLines.material.opacity = o * 0.18
    }

    // Road labels
    const showLabels = lod === 'far' || lod === 'core'
    const labelOp = o * (lod === 'core' ? 0.5 : 0.7)
    for (const s of this._labelSprites) {
      s.visible = showLabels
      if (showLabels) s.material.opacity = labelOp
    }

    // Landmark dots + labels
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

    if (this._opacity <= 0.001) {
      this.group.visible = false
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  dispose() {
    const disposeMesh = (m) => { if (m) { m.geometry.dispose(); m.material.dispose() } }
    disposeMesh(this._edgeLines)
    disposeMesh(this._majorLines)
    disposeMesh(this._secondaryLines)
    for (const s of this._labelSprites) {
      s.material.map?.dispose(); s.material.dispose()
    }
    for (const { dot, label } of this._landmarkSprites) {
      dot.material.map?.dispose(); dot.material.dispose()
      label.material.map?.dispose(); label.material.dispose()
    }
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
