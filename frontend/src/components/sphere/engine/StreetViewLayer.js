/**
 * StreetViewLayer — immersive 360° panoramic street view inside the sphere.
 *
 * When user flies into a face (STANDSTILL/WALKING), loads 4 directional images
 * and composites them onto an inverted sphere surrounding the camera,
 * creating the sensation of "standing on the street."
 *
 * Uses a canvas to stitch 4 images into a 2560×640 panoramic strip, then maps
 * it onto an inverted SphereGeometry positioned at the current face.
 */

import * as THREE from 'three'

const HEADINGS = ['011', '101', '191', '281']
const IMG_SIZE = 640
const PANO_WIDTH = IMG_SIZE * 4  // 2560
const PANO_HEIGHT = IMG_SIZE     // 640

// Panorama geometry: inverted sphere the viewer stands inside
const PANO_RADIUS = 3.0

export class StreetViewLayer {
  constructor() {
    this.scene = null
    this.engine = null
    this.mesh = null
    this._canvas = null
    this._ctx = null
    this._texture = null
    this._loadedImages = 0
    this._targetOpacity = 0
    this._currentOpacity = 0
    this._position = new THREE.Vector3()
    this._normal = new THREE.Vector3()
    this._visible = false
    this._currentPointIdx = -1
    this._loadingPointIdx = -1
    this._disposed = false
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine

    // Offscreen canvas for stitching 4 images
    this._canvas = document.createElement('canvas')
    this._canvas.width = PANO_WIDTH
    this._canvas.height = PANO_HEIGHT
    this._ctx = this._canvas.getContext('2d')

    // Texture from canvas
    this._texture = new THREE.CanvasTexture(this._canvas)
    this._texture.colorSpace = THREE.SRGBColorSpace
    // Flip horizontally so interior view is correct (we see the inside)
    this._texture.repeat.x = -1
    this._texture.offset.x = 1
    this._texture.wrapS = THREE.RepeatWrapping

    // Inverted sphere — BackSide renders the inside surface
    const geo = new THREE.SphereGeometry(PANO_RADIUS, 64, 32)
    const mat = new THREE.MeshBasicMaterial({
      map: this._texture,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
    })

    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.visible = false
    this.mesh.renderOrder = -5  // Keep panorama as background behind foreground overlays
    scene.add(this.mesh)
  }

  /**
   * Load panorama for a given point. Called when entering STANDSTILL.
   */
  loadPanorama(pointIdx, pointDetail, facePos, faceNormal) {
    if (!pointDetail || !pointDetail.district || !pointDetail.folder || !pointDetail.id) {
      return
    }
    if (this._loadingPointIdx === pointIdx) return

    this._loadingPointIdx = pointIdx
    this._loadedImages = 0

    // Clear canvas
    this._ctx.fillStyle = '#0F0D0A'
    this._ctx.fillRect(0, 0, PANO_WIDTH, PANO_HEIGHT)

    // Store position
    this._position.copy(facePos)
    this._normal.copy(faceNormal)

    // Load 4 images in parallel — use real filenames from backend when available
    const { district, folder, id, image_filenames } = pointDetail
    const urls = (image_filenames && image_filenames.length > 0)
      ? image_filenames.map(f => `/api/images/${district}/${folder}/${f}`)
      : HEADINGS.map(h => `/api/images/${district}/${folder}/${id}_head${h}_pitchp0_640x640.jpg`)
    console.log('[StreetView] loadPanorama', pointIdx, 'urls:', urls)
    urls.forEach((url, i) => {
      const heading = HEADINGS[i] || i * 90
      const img = new Image()
      // No crossOrigin needed — images are same-origin through Vite proxy
      img.onload = () => {
        if (this._disposed || this._loadingPointIdx !== pointIdx) return
        this._ctx.drawImage(img, i * IMG_SIZE, 0, IMG_SIZE, IMG_SIZE)
        this._loadedImages++
        console.log(`[StreetView] image ${i} loaded (${this._loadedImages}/4)`, url)
        if (this._loadedImages >= 4) {
          this._onPanoReady(pointIdx)
        }
        // Don't update texture for partial loads — the cleared black canvas
        // would show as dark sections. Wait for all 4 images in _onPanoReady.
      }
      img.onerror = (err) => {
        if (this._disposed || this._loadingPointIdx !== pointIdx) return
        console.warn(`[StreetView] image ${i} FAILED`, url, err)
        this._ctx.fillStyle = '#1A1714'
        this._ctx.fillRect(i * IMG_SIZE, 0, IMG_SIZE, IMG_SIZE)
        this._ctx.fillStyle = '#6B6358'
        this._ctx.font = '24px sans-serif'
        this._ctx.textAlign = 'center'
        this._ctx.fillText(`Image ${heading}°`, i * IMG_SIZE + IMG_SIZE / 2, IMG_SIZE / 2)
        this._loadedImages++
        if (this._loadedImages >= 4) {
          this._onPanoReady(pointIdx)
        }
      }
      img.src = url
    })
  }

  _onPanoReady(pointIdx) {
    this._texture.needsUpdate = true
    this._currentPointIdx = pointIdx

    // Position sphere at the camera position (slightly inside the data sphere)
    const cameraPos = this._position.clone().addScaledVector(this._normal, -0.5)
    this.mesh.position.copy(cameraPos)
    console.log('[StreetView] panorama ready', pointIdx, 'pos:', cameraPos.toArray().map(v => v.toFixed(2)))

    // Orient: rotate the panorama sphere so that the texture "front"
    // (center of the stitched strip) faces outward along the face normal.
    // SphereGeometry UV seam is at -Z in local space. With repeat.x=-1,
    // the "front" of the texture (u=0.5) is at +Z. We want +Z to align
    // with the face normal so the camera sees the correct forward view.
    const forward = this._normal.clone().normalize()
    this.mesh.lookAt(
      cameraPos.x + forward.x,
      cameraPos.y + forward.y,
      cameraPos.z + forward.z,
    )

    this.mesh.visible = true
    this._targetOpacity = 1
  }

  show() {
    this._visible = true
    // Keep panorama visible immediately to avoid blank frames during point transitions.
    this._targetOpacity = 1
    if (this.mesh) this.mesh.visible = true
  }

  hide() {
    this._visible = false
    this._targetOpacity = 0
    // Keep currentPointIdx as fallback so show() can recover instantly
    // if the next panorama is still loading.
    this._loadingPointIdx = -1
    // Immediately suppress to avoid dark disc artifact during fly-out
    // (the camera quickly exits the panorama sphere radius)
    this._currentOpacity = 0
    if (this.mesh) {
      this.mesh.material.opacity = 0
      this.mesh.visible = false
    }
  }

  update(dt) {
    if (!this.mesh) return

    // Animate logical opacity toward target
    if (Math.abs(this._currentOpacity - this._targetOpacity) > 0.01) {
      this._currentOpacity += (this._targetOpacity - this._currentOpacity) * Math.min(1, dt * 4)
    }

    // Camera proximity guard: when the camera is outside the panorama
    // sphere, BackSide rendering shows the far hemisphere as a dark disc.
    // Suppress rendering entirely in that case.
    let effective = this._currentOpacity
    // Only apply out-of-sphere suppression when layer is logically hidden.
    // In first-person mode we prefer stale-but-visible panorama over blank screen.
    if (!this._visible && effective > 0 && this.engine) {
      const distSq = this.engine.camera.position.distanceToSquared(this.mesh.position)
      if (distSq > PANO_RADIUS * PANO_RADIUS) {
        effective = 0
      }
    }

    const wasVisible = this.mesh.visible
    this.mesh.material.opacity = effective
    this.mesh.visible = effective > 0.01
    if (!wasVisible && this.mesh.visible) {
      console.log('[StreetView] panorama now visible, opacity:', effective.toFixed(2))
    }
    if (wasVisible && !this.mesh.visible && this._targetOpacity > 0) {
      const distSq = this.engine ? this.engine.camera.position.distanceToSquared(this.mesh.position) : -1
      console.log('[StreetView] suppressed: camera dist²:', distSq.toFixed(2), 'threshold:', (PANO_RADIUS * PANO_RADIUS).toFixed(2))
    }
  }

  dispose() {
    this._disposed = true
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh.material.dispose()
    }
    if (this._texture) {
      this._texture.dispose()
    }
  }
}
