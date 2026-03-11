/**
 * AvatarSprite — small humanoid silhouette standing on the current face.
 *
 * Visible during STANDSTILL/WALKING phases. Positioned at face center,
 * oriented along face normal (standing upright on the sphere surface).
 * The synapse network conceptually hovers above this avatar's head.
 *
 * Uses a canvas-rendered silhouette as a Sprite texture.
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const AVATAR_HEIGHT = 0.08
const AVATAR_COLOR = '#F5F0E8'

export class AvatarSprite {
  constructor() {
    this.scene = null
    this.sprite = null
    this._targetOpacity = 0
    this._currentOpacity = 0
    this._disposed = false
  }

  init(scene, engine) {
    this.scene = scene

    // Generate silhouette texture on canvas
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 128
    const ctx = canvas.getContext('2d')

    // Draw humanoid silhouette
    ctx.fillStyle = AVATAR_COLOR
    ctx.globalAlpha = 0.85

    // Head (circle)
    ctx.beginPath()
    ctx.arc(32, 20, 10, 0, Math.PI * 2)
    ctx.fill()

    // Neck
    ctx.fillRect(29, 30, 6, 6)

    // Torso (trapezoid)
    ctx.beginPath()
    ctx.moveTo(20, 36)
    ctx.lineTo(44, 36)
    ctx.lineTo(40, 70)
    ctx.lineTo(24, 70)
    ctx.closePath()
    ctx.fill()

    // Left arm
    ctx.beginPath()
    ctx.moveTo(20, 38)
    ctx.lineTo(12, 60)
    ctx.lineTo(16, 62)
    ctx.lineTo(22, 42)
    ctx.closePath()
    ctx.fill()

    // Right arm
    ctx.beginPath()
    ctx.moveTo(44, 38)
    ctx.lineTo(52, 60)
    ctx.lineTo(48, 62)
    ctx.lineTo(42, 42)
    ctx.closePath()
    ctx.fill()

    // Left leg
    ctx.beginPath()
    ctx.moveTo(24, 70)
    ctx.lineTo(20, 110)
    ctx.lineTo(16, 118)
    ctx.lineTo(24, 118)
    ctx.lineTo(28, 110)
    ctx.lineTo(30, 70)
    ctx.closePath()
    ctx.fill()

    // Right leg
    ctx.beginPath()
    ctx.moveTo(34, 70)
    ctx.lineTo(36, 110)
    ctx.lineTo(40, 118)
    ctx.lineTo(48, 118)
    ctx.lineTo(44, 110)
    ctx.lineTo(40, 70)
    ctx.closePath()
    ctx.fill()

    // Glow around silhouette
    ctx.globalAlpha = 0.15
    ctx.shadowColor = AVATAR_COLOR
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(32, 20, 12, 0, Math.PI * 2)
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    })

    this.sprite = new THREE.Sprite(material)
    this.sprite.scale.set(AVATAR_HEIGHT * 0.5, AVATAR_HEIGHT, 1)
    this.sprite.visible = false
    this.sprite.renderOrder = 2
    scene.add(this.sprite)
  }

  /**
   * Position avatar at a face on the sphere surface.
   * @param {THREE.Vector3} facePos - world position of the face
   * @param {THREE.Vector3} faceNormal - outward normal
   */
  setFace(facePos, faceNormal) {
    if (!this.sprite) return
    // Position slightly above face, offset inward (toward camera)
    const normal = faceNormal.clone().normalize()
    this.sprite.position.copy(facePos).addScaledVector(normal, -0.02)
    this.sprite.visible = true
    this._targetOpacity = 0.85
  }

  show() {
    this._targetOpacity = 0.85
    if (this.sprite) this.sprite.visible = true
  }

  hide() {
    this._targetOpacity = 0
  }

  update(dt) {
    if (!this.sprite) return

    if (Math.abs(this._currentOpacity - this._targetOpacity) > 0.01) {
      this._currentOpacity += (this._targetOpacity - this._currentOpacity) * Math.min(1, dt * 5)
      this.sprite.material.opacity = this._currentOpacity

      if (this._currentOpacity < 0.01) {
        this.sprite.visible = false
      }
    }
  }

  dispose() {
    this._disposed = true
    if (this.sprite) {
      this.scene.remove(this.sprite)
      this.sprite.material.map.dispose()
      this.sprite.material.dispose()
    }
  }
}
