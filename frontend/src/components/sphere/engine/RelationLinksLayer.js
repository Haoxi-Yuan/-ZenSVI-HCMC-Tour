/**
 * RelationLinksLayer — ultra-thin relation lines inside the sphere.
 *
 * Draws subtle quadratic-curve links from selected point to top similar faces,
 * creating an in-sphere "neural thread" visual for jump/resonance associations.
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const MAX_LINKS = 160
const CURVE_SEGMENTS = 12
const SURFACE_R = SPHERE_RADIUS * 0.94
const CONTROL_R = SPHERE_RADIUS * 0.56
const BASE_OPACITY = 0.24
const FADE_SPEED = 3.2
const STRONG_COLOR = new THREE.Color('#66F0B2')
const MID_COLOR = new THREE.Color('#F0C164')
const WEAK_COLOR = new THREE.Color('#6FAFEA')

function clamp01(v) {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

export class RelationLinksLayer {
  constructor(positions) {
    this.positions = positions
    this.group = new THREE.Group()
    this.group.visible = false
    this._line = null
    this._selectedIdx = null
    this._signature = ''
    this._opacity = 0
    this._targetOpacity = 0
    this._vA = new THREE.Vector3()
    this._vB = new THREE.Vector3()
    this._vM = new THREE.Vector3()
    this._c0 = new THREE.Color()
    this._c1 = new THREE.Color()
    this._tmp = new THREE.Vector3()
    this._axisY = new THREE.Vector3(0, 1, 0)
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
    scene.add(this.group)
  }

  show(selectedIdx, similarFaces, topN = MAX_LINKS) {
    if (!Number.isInteger(selectedIdx) || !Array.isArray(similarFaces) || !similarFaces.length) {
      this.hide()
      return
    }
    const signatureFaces = similarFaces
      .filter(f => Number.isInteger(f?.idx) && f.idx >= 0)
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, 16)
    const head = signatureFaces
      .map(f => `${f?.idx ?? 'x'}:${Math.round((Number(f?.similarity) || 0) * 1000)}`)
      .join(',')
    const maxLinks = Math.max(1, Math.min(MAX_LINKS, Number(topN) || MAX_LINKS))
    const signature = `${selectedIdx}|${maxLinks}|${similarFaces.length}|${head}`
    if (this._selectedIdx !== selectedIdx || this._signature !== signature || !this._line) {
      this._selectedIdx = selectedIdx
      this._signature = signature
      this._rebuild(selectedIdx, similarFaces, maxLinks)
    }
    this._targetOpacity = 1
    this.group.visible = true
  }

  hide() {
    this._targetOpacity = 0
  }

  _facePos(idx, out) {
    const i = idx * 3
    out.set(this.positions[i], this.positions[i + 1], this.positions[i + 2]).normalize().multiplyScalar(SURFACE_R)
  }

  _rebuild(selectedIdx, similarFaces, maxLinks = MAX_LINKS) {
    this._clear()
    if (!this.positions) return

    const entries = similarFaces
      .filter(f => {
        if (!Number.isInteger(f?.idx)) return false
        if (f.idx === selectedIdx || f.idx < 0) return false
        return f.idx * 3 + 2 < this.positions.length
      })
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, Math.max(1, Math.min(MAX_LINKS, maxLinks)))

    if (!entries.length) return

    const positions = []
    const colors = []
    const curve = new THREE.QuadraticBezierCurve3()

    this._facePos(selectedIdx, this._vA)
    const total = entries.length
    const strongN = Math.max(1, Math.floor(total * 0.34))
    const midN = Math.max(strongN + 1, Math.floor(total * 0.68))

    for (let rank = 0; rank < entries.length; rank++) {
      const e = entries[rank]
      this._facePos(e.idx, this._vB)

      this._vM.copy(this._vA).add(this._vB)
      if (this._vM.lengthSq() < 1e-6) {
        this._vM.copy(this._vA).cross(this._axisY)
      }
      this._vM.normalize().multiplyScalar(CONTROL_R)

      curve.v0.copy(this._vA)
      curve.v1.copy(this._vM)
      curve.v2.copy(this._vB)

      const similarity = clamp01(Number(e.similarity) || 0)
      const bandColor = rank < strongN ? STRONG_COLOR : (rank < midN ? MID_COLOR : WEAK_COLOR)
      this._c0.copy(bandColor).multiplyScalar(0.62 + similarity * 0.3)
      this._c1.copy(this._c0).multiplyScalar(1.1)

      for (let i = 0; i < CURVE_SEGMENTS; i++) {
        const t0 = i / CURVE_SEGMENTS
        const t1 = (i + 1) / CURVE_SEGMENTS
        const p0 = curve.getPoint(t0, this._tmp)
        positions.push(p0.x, p0.y, p0.z)
        colors.push(this._c0.r, this._c0.g, this._c0.b)
        const p1 = curve.getPoint(t1, this._tmp)
        positions.push(p1.x, p1.y, p1.z)
        colors.push(this._c1.r, this._c1.g, this._c1.b)
      }
    }

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
    })

    this._line = new THREE.LineSegments(geometry, material)
    this._line.renderOrder = 9
    this.group.add(this._line)
  }

  _clear() {
    if (!this._line) return
    this.group.remove(this._line)
    this._line.geometry.dispose()
    this._line.material.dispose()
    this._line = null
  }

  update(dt, elapsed) {
    if (this._opacity < this._targetOpacity) {
      this._opacity = Math.min(this._targetOpacity, this._opacity + dt * FADE_SPEED)
    } else if (this._opacity > this._targetOpacity) {
      this._opacity = Math.max(this._targetOpacity, this._opacity - dt * FADE_SPEED)
    }

    if (this._line) {
      const pulse = 0.9 + 0.1 * Math.sin(elapsed * 0.0016)
      this._line.material.opacity = this._opacity * BASE_OPACITY * pulse
    }

    if (this._opacity <= 0.001 && this._targetOpacity <= 0) {
      this.group.visible = false
      this._clear()
    }
  }

  dispose() {
    this._clear()
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
