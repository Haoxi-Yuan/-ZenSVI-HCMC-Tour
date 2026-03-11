/**
 * SphereEngine — WebGL renderer, scene, camera, post-processing, and render loop.
 *
 * Owns the Three.js lifecycle. Components register "layers" that participate
 * in the animation loop via { init(scene, engine), update(dt, elapsed), dispose() }.
 *
 * Post-processing pipeline: RenderPass → [user passes] → OutputPass
 * Use addPass(pass) to insert effects before OutputPass.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { PerceptionShakePass } from './PerceptionShakePass.js'
import FLAGS from '../../../utils/featureFlags.js'

export class SphereEngine {
  constructor(container) {
    this.container = container
    this.layers = new Map()
    this._animId = null
    this._startTime = performance.now()
    this._lastTime = this._startTime
    this._disposed = false

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x0F0D0A, 1)
    container.appendChild(this.renderer.domElement)

    // Scene
    this.scene = new THREE.Scene()

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50, container.clientWidth / container.clientHeight, 0.1, 200,
    )
    this.camera.position.set(0, 0, 25)

    // Post-processing composer
    this.composer = new EffectComposer(this.renderer)
    this._renderPass = new RenderPass(this.scene, this.camera)
    this._outputPass = new OutputPass()
    this.composer.addPass(this._renderPass)

    // Bloom glow — highlighted faces pulse RGB ×1.3 which exceeds threshold
    this.bloomPass = null
    if (FLAGS.BLOOM_GLOW) {
      const bloomRes = new THREE.Vector2(container.clientWidth, container.clientHeight)
      this.bloomPass = new UnrealBloomPass(bloomRes, 0.3, 0.4, 0.85)
      this.composer.addPass(this.bloomPass)
    }

    // Perception shake — chromatic aberration + radial blur on SHAP delta
    this.shakePass = null
    if (FLAGS.PERCEPTION_SHAKE) {
      this.shakePass = new PerceptionShakePass()
      this.composer.addPass(this.shakePass)
    }

    this.composer.addPass(this._outputPass)

    // Resize
    this._onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      if (!w || !h) return
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
      this.composer.setSize(w, h)
    }
    window.addEventListener('resize', this._onResize)

    // Pointer state (shared with layers)
    this.pointer = new THREE.Vector2(9999, 9999)
    this.pointerPx = { x: 0, y: 0 }
    this._onPointerMove = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.pointerPx.x = e.clientX
      this.pointerPx.y = e.clientY
    }
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove)
  }

  /**
   * Insert a post-processing pass before the OutputPass.
   * @param {Pass} pass - Three.js postprocessing Pass instance
   */
  addPass(pass) {
    // Insert before OutputPass (which is always last)
    const idx = this.composer.passes.indexOf(this._outputPass)
    if (idx >= 0) {
      this.composer.insertPass(pass, idx)
    } else {
      this.composer.addPass(pass)
    }
  }

  /**
   * Remove a post-processing pass.
   * @param {Pass} pass - The pass instance to remove
   */
  removePass(pass) {
    const idx = this.composer.passes.indexOf(pass)
    if (idx >= 0) {
      this.composer.removePass(pass)
    }
  }

  addLayer(name, layer) {
    this.layers.set(name, layer)
    layer.init(this.scene, this)
  }

  removeLayer(name) {
    const layer = this.layers.get(name)
    if (layer) {
      layer.dispose()
      this.layers.delete(name)
    }
  }

  getLayer(name) {
    return this.layers.get(name)
  }

  start() {
    const animate = () => {
      if (this._disposed) return
      this._animId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = (now - this._lastTime) / 1000
      const elapsed = now - this._startTime
      this._lastTime = now

      for (const layer of this.layers.values()) {
        layer.update(dt, elapsed)
      }

      // Tick shake pass decay
      if (this.shakePass) this.shakePass.tick(dt)

      // Use post-processing composer instead of direct render
      this.composer.render()
    }
    animate()
  }

  dispose() {
    this._disposed = true
    if (this._animId) cancelAnimationFrame(this._animId)
    window.removeEventListener('resize', this._onResize)
    this.renderer.domElement.removeEventListener('pointermove', this._onPointerMove)

    for (const layer of this.layers.values()) {
      layer.dispose()
    }
    this.layers.clear()

    // Dispose composer passes
    for (const pass of this.composer.passes) {
      if (pass.dispose) pass.dispose()
    }

    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
        else o.material.dispose()
      }
    })
    this.renderer.dispose()

    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild)
    }
  }
}
