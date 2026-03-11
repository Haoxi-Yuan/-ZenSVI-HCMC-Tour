/**
 * TopologyNetworkLayer — Road network topology overlay on the sphere surface.
 *
 * Renders three visual elements:
 *   1. Topology mesh: all adjacency edges as thin lines on the sphere
 *   2. Major road highlights: thicker/brighter lines for named roads
 *   3. Labels: road names + city landmark sprites
 *
 * Uses LOD strategy based on camera distance:
 *   - Far (REST orbit): major roads + landmarks only
 *   - Mid: all topology edges visible
 *   - Near (first-person): fade out to avoid clutter
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const API = '/api/sphere'
const SURFACE_R = SPHERE_RADIUS * 1.003  // slightly above sphere surface
const MAJOR_R = SPHERE_RADIUS * 1.006    // major roads float a bit higher
const LABEL_R = SPHERE_RADIUS * 1.06     // labels above roads

// Colors
const EDGE_COLOR = new THREE.Color(0.35, 0.35, 0.40)
const MAJOR_COLOR = new THREE.Color(0.91, 0.68, 0.33)      // gold
const MAJOR_GLOW = new THREE.Color(1.0, 0.82, 0.45)
const LANDMARK_COLOR = new THREE.Color(0.91, 0.45, 0.29)   // warm orange

// LOD thresholds (camera distance from origin)
const LOD_FAR = 22    // only major roads + landmarks
const LOD_MID = 16    // show all edges
const LOD_NEAR = 8    // fade out everything

// Max edges to render for performance (subsample if needed)
const MAX_VISIBLE_EDGES = 200000

export class TopologyNetworkLayer {
  constructor(positions) {
    this.positions = positions  // Float32Array (N*3) unit sphere coords
    this.group = new THREE.Group()
    this.group.visible = false

    // Sub-groups
    this._edgeLines = null
    this._majorLines = null
    this._labelSprites = []
    this._landmarkSprites = []

    // State
    this._loaded = false
    this._opacity = 0
    this._targetOpacity = 0
    this._edgesData = null
    this._roadNetwork = null
    this._landmarks = null
    this._hoveredRoad = null

    // LOD
    this._currentLOD = 'far'  // 'far' | 'mid' | 'hidden'
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

      this._buildEdges()
      this._buildMajorRoads()
      this._buildLabels()
      this._buildLandmarks()

      this._loaded = true
      this._targetOpacity = 1
      this.group.visible = true
    } catch (err) {
      console.warn('Failed to load topology data:', err)
    }
  }

  // ─── Edge mesh (all adjacency edges) ──────────────────────────

  _buildEdges() {
    const data = this._edgesData
    const totalEdges = data.length / 2

    // Subsample if too many edges
    const step = totalEdges > MAX_VISIBLE_EDGES
      ? Math.ceil(totalEdges / MAX_VISIBLE_EDGES)
      : 1
    const edgeCount = Math.ceil(totalEdges / step)

    const positions = new Float32Array(edgeCount * 6) // 2 vertices × 3 coords per edge
    let vi = 0

    for (let i = 0; i < totalEdges; i += step) {
      const idxA = Math.round(data[i * 2])
      const idxB = Math.round(data[i * 2 + 1])

      // Get unit sphere positions and project to surface
      const ax = this.positions[idxA * 3] * SURFACE_R
      const ay = this.positions[idxA * 3 + 1] * SURFACE_R
      const az = this.positions[idxA * 3 + 2] * SURFACE_R
      const bx = this.positions[idxB * 3] * SURFACE_R
      const by = this.positions[idxB * 3 + 1] * SURFACE_R
      const bz = this.positions[idxB * 3 + 2] * SURFACE_R

      positions[vi++] = ax; positions[vi++] = ay; positions[vi++] = az
      positions[vi++] = bx; positions[vi++] = by; positions[vi++] = bz
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vi), 3))

    const material = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })

    this._edgeLines = new THREE.LineSegments(geometry, material)
    this._edgeLines.renderOrder = 1
    this._edgeLines.visible = false  // hidden at far LOD
    this.group.add(this._edgeLines)
  }

  // ─── Major roads (thicker colored lines) ──────────────────────

  _buildMajorRoads() {
    if (!this._roadNetwork?.length) return

    const positions = []
    const colors = []

    for (const road of this._roadNetwork) {
      const indices = road.point_indices
      if (indices.length < 2) continue

      const color = road.is_major ? MAJOR_COLOR : EDGE_COLOR.clone().lerp(MAJOR_COLOR, 0.3)

      // Connect consecutive points along the road
      for (let i = 0; i < indices.length - 1; i++) {
        const idxA = indices[i]
        const idxB = indices[i + 1]

        // Validate indices
        if (idxA * 3 + 2 >= this.positions.length || idxB * 3 + 2 >= this.positions.length) continue

        const r = road.is_major ? MAJOR_R : SURFACE_R * 1.002

        positions.push(
          this.positions[idxA * 3] * r,
          this.positions[idxA * 3 + 1] * r,
          this.positions[idxA * 3 + 2] * r,
          this.positions[idxB * 3] * r,
          this.positions[idxB * 3 + 1] * r,
          this.positions[idxB * 3 + 2] * r,
        )
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
      }
    }

    if (!positions.length) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      linewidth: 1,  // Note: linewidth > 1 only works on some platforms
    })

    this._majorLines = new THREE.LineSegments(geometry, material)
    this._majorLines.renderOrder = 2
    this.group.add(this._majorLines)
  }

  // ─── Road name labels (sprites with canvas text) ─────────────

  _buildLabels() {
    if (!this._roadNetwork?.length) return

    // Only label major roads to avoid clutter
    const majorRoads = this._roadNetwork.filter(r => r.is_major)

    for (const road of majorRoads) {
      const indices = road.point_indices
      if (indices.length < 2) continue

      // Place label at the midpoint of the road
      const midIdx = indices[Math.floor(indices.length / 2)]
      if (midIdx * 3 + 2 >= this.positions.length) continue

      const sprite = this._createTextSprite(road.name, MAJOR_GLOW, 0.7)
      sprite.position.set(
        this.positions[midIdx * 3] * LABEL_R,
        this.positions[midIdx * 3 + 1] * LABEL_R,
        this.positions[midIdx * 3 + 2] * LABEL_R,
      )
      sprite.renderOrder = 5
      this._labelSprites.push({ sprite, road })
      this.group.add(sprite)
    }
  }

  // ─── Landmark markers (icon sprites) ──────────────────────────

  _buildLandmarks() {
    if (!this._landmarks?.length) return

    for (const lm of this._landmarks) {
      const idx = lm.nearest_point_idx
      if (idx * 3 + 2 >= this.positions.length) continue

      // Diamond marker sprite
      const marker = this._createMarkerSprite(lm.type)
      const r = LABEL_R * 1.01
      marker.position.set(
        this.positions[idx * 3] * r,
        this.positions[idx * 3 + 1] * r,
        this.positions[idx * 3 + 2] * r,
      )
      marker.renderOrder = 6

      // Name label slightly offset
      const label = this._createTextSprite(
        lm.name_vi || lm.name,
        LANDMARK_COLOR,
        0.55,
      )
      const lr = LABEL_R * 1.04
      label.position.set(
        this.positions[idx * 3] * lr,
        this.positions[idx * 3 + 1] * lr,
        this.positions[idx * 3 + 2] * lr,
      )
      label.renderOrder = 7

      this._landmarkSprites.push({ marker, label, landmark: lm })
      this.group.add(marker)
      this.group.add(label)
    }
  }

  // ─── Sprite factories ────────────────────────────────────────

  _createTextSprite(text, color, scale = 1) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const fontSize = 48
    const padding = 16

    ctx.font = `bold ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`
    const metrics = ctx.measureText(text)
    const textWidth = metrics.width

    canvas.width = Math.ceil(textWidth + padding * 2)
    canvas.height = Math.ceil(fontSize * 1.4 + padding * 2)

    // Background pill
    ctx.fillStyle = 'rgba(15, 13, 10, 0.75)'
    const radius = canvas.height / 2
    ctx.beginPath()
    ctx.moveTo(radius, 0)
    ctx.lineTo(canvas.width - radius, 0)
    ctx.arc(canvas.width - radius, radius, radius, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(radius, canvas.height)
    ctx.arc(radius, radius, radius, Math.PI / 2, -Math.PI / 2)
    ctx.closePath()
    ctx.fill()

    // Text
    ctx.font = `bold ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`
    ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
    })

    const sprite = new THREE.Sprite(spriteMat)
    const aspect = canvas.width / canvas.height
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.userData = { canvas, texture }

    return sprite
  }

  _createMarkerSprite(type) {
    const canvas = document.createElement('canvas')
    const size = 64
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const cx = size / 2
    const cy = size / 2

    // Glow circle
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2)
    const colorMap = {
      landmark: [232, 115, 74],
      transport: [122, 166, 218],
      park: [61, 187, 120],
      district: [212, 168, 85],
    }
    const [r, g, b] = colorMap[type] || colorMap.landmark
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`)
    gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.8)`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Diamond shape
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.beginPath()
    ctx.moveTo(cx, cy - 12)
    ctx.lineTo(cx + 10, cy)
    ctx.lineTo(cx, cy + 12)
    ctx.lineTo(cx - 10, cy)
    ctx.closePath()
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    })

    const sprite = new THREE.Sprite(spriteMat)
    sprite.scale.set(0.5, 0.5, 1)
    sprite.userData = { canvas, texture }

    return sprite
  }

  // ─── Visibility and LOD control ───────────────────────────────

  show() {
    this._targetOpacity = 1
    this.group.visible = true
  }

  hide() {
    this._targetOpacity = 0
  }

  setPhaseVisibility(phase) {
    // REST: show topology; first-person: hide
    if (phase === 'REST') {
      this.show()
    } else {
      this.hide()
    }
  }

  // ─── Update (called every frame) ─────────────────────────────

  update(dt, elapsed) {
    if (!this._loaded) return

    // Fade opacity
    const fadeSpeed = 2.5
    if (this._opacity < this._targetOpacity) {
      this._opacity = Math.min(this._targetOpacity, this._opacity + dt * fadeSpeed)
    } else if (this._opacity > this._targetOpacity) {
      this._opacity = Math.max(this._targetOpacity, this._opacity - dt * fadeSpeed)
    }

    if (this._opacity <= 0.001 && this._targetOpacity <= 0) {
      this.group.visible = false
      return
    }

    // LOD based on camera distance
    const camDist = this.engine.camera.position.length()
    let lod = 'far'
    if (camDist < LOD_NEAR) lod = 'hidden'
    else if (camDist < LOD_MID) lod = 'mid'

    // Update edge visibility
    if (this._edgeLines) {
      const showEdges = lod === 'mid'
      this._edgeLines.visible = showEdges
      if (showEdges) {
        this._edgeLines.material.opacity = this._opacity * 0.12
      }
    }

    // Update major roads
    if (this._majorLines) {
      const showMajor = lod !== 'hidden'
      this._majorLines.visible = showMajor
      if (showMajor) {
        // Pulse major roads subtly
        const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.0008)
        this._majorLines.material.opacity = this._opacity * 0.55 * pulse
      }
    }

    // Update label sprites
    const showLabels = lod !== 'hidden'
    const labelOpacity = this._opacity * (lod === 'far' ? 0.85 : 0.5)
    for (const { sprite } of this._labelSprites) {
      sprite.visible = showLabels
      if (showLabels) sprite.material.opacity = labelOpacity
    }

    // Update landmark sprites
    for (const { marker, label } of this._landmarkSprites) {
      marker.visible = showLabels
      label.visible = showLabels
      if (showLabels) {
        // Pulsing marker
        const pulse = 0.7 + 0.3 * Math.sin(elapsed * 0.002)
        marker.material.opacity = this._opacity * pulse
        label.material.opacity = labelOpacity
      }
    }

    // Fade out when fully hidden
    if (this._opacity <= 0.001) {
      this.group.visible = false
    }

    this._currentLOD = lod
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  dispose() {
    if (this._edgeLines) {
      this._edgeLines.geometry.dispose()
      this._edgeLines.material.dispose()
    }
    if (this._majorLines) {
      this._majorLines.geometry.dispose()
      this._majorLines.material.dispose()
    }
    for (const { sprite } of this._labelSprites) {
      sprite.material.map?.dispose()
      sprite.material.dispose()
    }
    for (const { marker, label } of this._landmarkSprites) {
      marker.material.map?.dispose()
      marker.material.dispose()
      label.material.map?.dispose()
      label.material.dispose()
    }
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
