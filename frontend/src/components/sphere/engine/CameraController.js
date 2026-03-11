/**
 * CameraController — multi-mode camera system for all 5 phases.
 *
 * Modes: orbit (Phase 1), fly-in/out (transitions), first-person (Phase 2-3),
 * walk (Phase 3), bird-eye (Phase 5).
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SPHERE_RADIUS, ANIM } from '../../../utils/sphereConstants'
import FLAGS from '../../../utils/featureFlags'

export class CameraController {
  constructor() {
    this.controls = null
    this.engine = null
    this._animation = null // { start, duration, update, onComplete }
    this._autoRotateTarget = 0.3
    this._restViewMode = 'orbit' // 'orbit' | 'core'
    this._coreYaw = 0
    this._coreTargetDir = new THREE.Vector3(0, 0, 1)
    this._coreLook = new THREE.Vector3(0, 0, 1)
    this._coreUp = new THREE.Vector3(0, 1, 0)
  }

  init(scene, engine) {
    this.engine = engine
    this.controls = new OrbitControls(engine.camera, engine.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0
    this.controls.minDistance = 12
    this.controls.maxDistance = 50
    this.controls.enablePan = false
  }

  update(dt, elapsed) {
    // Run active animation
    if (this._animation) {
      const { start, duration, update: updateFn, onComplete } = this._animation
      const t = Math.min(1, (performance.now() - start) / duration)
      const eased = this._smoothstep(t)
      updateFn(eased, t)
      if (t >= 1) {
        this._animation = null
        if (onComplete) onComplete()
      }
    }

    // Ease in auto-rotation after entry animation
    if (this.controls.enabled && elapsed > ANIM.ENTRY_MS) {
      const rotP = Math.min(1, (elapsed - ANIM.ENTRY_MS) / 2000)
      this.controls.autoRotateSpeed = this._autoRotateTarget * rotP
    }

    // REST core view: camera at sphere center looking outward.
    if (!this._animation && this._restViewMode === 'core') {
      const camera = this.engine.camera
      this.controls.enabled = false
      this.controls.autoRotate = false
      camera.position.set(0, 0, 0)
      this._coreYaw += dt * 0.2
      this._coreLook.copy(this._coreTargetDir).applyAxisAngle(this._coreUp, this._coreYaw)
      this._coreLook.y += Math.sin(elapsed * 0.00055) * 0.08
      this._coreLook.normalize()
      camera.lookAt(this._coreLook)
      return
    }

    if (this.controls.enabled) {
      this.controls.update()
    }
  }

  _smoothstep(t) {
    return t * t * (3 - 2 * t)
  }

  /** Phase 1 → Phase 2: fly camera from orbit into a face */
  flyToFace(facePos, faceNormal, onComplete) {
    const camera = this.engine.camera
    this._restViewMode = 'orbit'
    this.controls.enabled = false
    this.controls.autoRotate = false

    // Start position (current camera)
    const startPos = camera.position.clone()
    const startTarget = this.controls.target.clone()

    // End position: on the face, slightly inward (toward sphere center)
    const endPos = facePos.clone().add(faceNormal.clone().multiplyScalar(-0.5))
    // Look outward from the sphere
    const endTarget = facePos.clone().add(faceNormal.clone().multiplyScalar(5))

    // Bezier control points for smooth flight through sphere wall
    const sphereSurface = facePos.clone()
    const cp1 = startPos.clone().lerp(sphereSurface, 0.5)
    const cp2 = sphereSurface.clone().lerp(endPos, 0.3)

    this._animation = {
      start: performance.now(),
      duration: ANIM.FLY_IN_MS,
      update: (eased) => {
        // Cubic bezier interpolation
        const t = eased
        const t2 = t * t
        const t3 = t2 * t
        const mt = 1 - t
        const mt2 = mt * mt
        const mt3 = mt2 * mt

        camera.position.set(
          mt3 * startPos.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * endPos.x,
          mt3 * startPos.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * endPos.y,
          mt3 * startPos.z + 3 * mt2 * t * cp1.z + 3 * mt * t2 * cp2.z + t3 * endPos.z,
        )

        // Interpolate lookAt target
        const targetX = startTarget.x + (endTarget.x - startTarget.x) * eased
        const targetY = startTarget.y + (endTarget.y - startTarget.y) * eased
        const targetZ = startTarget.z + (endTarget.z - startTarget.z) * eased
        camera.lookAt(targetX, targetY, targetZ)
      },
      onComplete,
    }
  }

  /** Phase 2 → Phase 1: fly camera back out to orbit */
  flyToOrbit(onComplete) {
    const camera = this.engine.camera
    this._restViewMode = 'orbit'
    const startPos = camera.position.clone()

    // Default orbit position
    const endPos = new THREE.Vector3(0, 0, 25)
    const endTarget = new THREE.Vector3(0, 0, 0)

    // Get current lookAt direction
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const startTarget = startPos.clone().add(dir.multiplyScalar(5))

    // Control points going outward through sphere wall
    const outward = startPos.clone().normalize().multiplyScalar(SPHERE_RADIUS * 1.5)
    const cp1 = startPos.clone().lerp(outward, 0.4)
    const cp2 = outward.clone().lerp(endPos, 0.5)

    this._animation = {
      start: performance.now(),
      duration: ANIM.FLY_OUT_MS,
      update: (eased) => {
        const t = eased
        const t2 = t * t
        const t3 = t2 * t
        const mt = 1 - t
        const mt2 = mt * mt
        const mt3 = mt2 * mt

        camera.position.set(
          mt3 * startPos.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * endPos.x,
          mt3 * startPos.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * endPos.y,
          mt3 * startPos.z + 3 * mt2 * t * cp1.z + 3 * mt * t2 * cp2.z + t3 * endPos.z,
        )

        const tX = startTarget.x + (endTarget.x - startTarget.x) * eased
        const tY = startTarget.y + (endTarget.y - startTarget.y) * eased
        const tZ = startTarget.z + (endTarget.z - startTarget.z) * eased
        camera.lookAt(tX, tY, tZ)
      },
      onComplete: () => {
        this.controls.target.set(0, 0, 0)
        this.controls.enabled = true
        this.controls.autoRotate = true
        this.controls.update()
        if (onComplete) onComplete()
      },
    }
  }

  /** Phase 3: walk along sphere surface from one face to an adjacent face */
  walkToFace(fromPos, toPos, onComplete) {
    const camera = this.engine.camera

    // Great-circle arc via slerp on the sphere
    const fromNorm = fromPos.clone().normalize()
    const toNorm = toPos.clone().normalize()

    // Camera offset: slightly inward from face
    const inwardOffset = -0.5

    // Start and end lookAt targets (outward)
    const startTarget = fromPos.clone().add(fromNorm.clone().multiplyScalar(5))
    const endTarget = toPos.clone().add(toNorm.clone().multiplyScalar(5))

    // Head bob: perpendicular oscillation axis
    const walkCross = new THREE.Vector3().crossVectors(fromNorm, toNorm)
    const hasCross = walkCross.lengthSq() > 1e-6
    if (hasCross) walkCross.normalize()

    this._animation = {
      start: performance.now(),
      duration: ANIM.WALK_MS,
      update: (eased) => {
        // Slerp on the sphere surface
        const interpNorm = new THREE.Vector3().copy(fromNorm).lerp(toNorm, eased).normalize()
        const interpPos = interpNorm.clone().multiplyScalar(SPHERE_RADIUS)
        camera.position.copy(interpPos).addScaledVector(interpNorm, inwardOffset)

        // Head bobbing: subtle perpendicular oscillation during walk
        if (FLAGS.HEAD_BOB && hasCross) {
          const bobPhase = eased * Math.PI * 2 // one full cycle per walk
          const bobAmp = 0.01
          camera.position.addScaledVector(walkCross, Math.sin(bobPhase) * bobAmp)
        }

        // Interpolate lookAt
        const tgt = new THREE.Vector3().lerpVectors(startTarget, endTarget, eased)
        camera.lookAt(tgt)
      },
      onComplete,
    }
  }

  /** Jump/warp: climb out and arc over the sphere to a distant face */
  jumpToFace(fromPos, toPos, onComplete) {
    const camera = this.engine.camera
    const startPos = camera.position.clone()
    const fromNorm = fromPos.clone().normalize()
    const endNorm = toPos.clone().normalize()
    const endPos = toPos.clone().addScaledVector(endNorm, -0.5)
    const endTarget = toPos.clone().add(endNorm.clone().multiplyScalar(5))

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const startTarget = startPos.clone().add(dir.multiplyScalar(5))
    const arcStartPos = fromNorm.clone().multiplyScalar(SPHERE_RADIUS + 1.8)
    const arcEndPos = endNorm.clone().multiplyScalar(SPHERE_RADIUS + 1.8)
    const arcStartLook = fromNorm.clone().multiplyScalar(SPHERE_RADIUS * 0.96)
    const arcEndLook = endNorm.clone().multiplyScalar(SPHERE_RADIUS * 0.96)
    const arcNorm = new THREE.Vector3()
    const lookTarget = new THREE.Vector3()

    this._animation = {
      start: performance.now(),
      duration: ANIM.JUMP_MS,
      update: (eased) => {
        // 3-stage jump: climb out, arc over sphere, descend to target.
        if (eased < 0.2) {
          const t = eased / 0.2
          camera.position.lerpVectors(startPos, arcStartPos, t)
          lookTarget.lerpVectors(startTarget, arcStartLook, t)
          camera.lookAt(lookTarget)
        } else if (eased < 0.82) {
          const t = (eased - 0.2) / 0.62
          arcNorm.copy(fromNorm).lerp(endNorm, t).normalize()
          const jumpRadius = SPHERE_RADIUS + 1.8 + Math.sin(Math.PI * t) * 3.6
          camera.position.copy(arcNorm).multiplyScalar(jumpRadius)
          lookTarget.copy(arcNorm).multiplyScalar(SPHERE_RADIUS * 0.96)
          camera.lookAt(lookTarget)
        } else {
          const t = (eased - 0.82) / 0.18
          camera.position.lerpVectors(arcEndPos, endPos, t)
          lookTarget.lerpVectors(arcEndLook, endTarget, t)
          camera.lookAt(lookTarget)
        }
      },
      onComplete,
    }
  }

  /** Phase 5: fly camera to bird-eye view above map */
  flyToBirdEye(center, onComplete) {
    const camera = this.engine.camera
    const startPos = camera.position.clone()
    const endPos = new THREE.Vector3(center.x, center.y + 40, center.z + 5)
    const endTarget = new THREE.Vector3(center.x, center.y, center.z)

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const startTarget = startPos.clone().add(dir.multiplyScalar(5))

    this._animation = {
      start: performance.now(),
      duration: 1500,
      update: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased)
        const tgt = new THREE.Vector3().lerpVectors(startTarget, endTarget, eased)
        camera.lookAt(tgt)
      },
      onComplete,
    }
  }

  get isAnimating() {
    return this._animation !== null
  }

  setRestViewMode(mode = 'orbit', applyControls = true) {
    this._restViewMode = mode === 'core' ? 'core' : 'orbit'
    if (!applyControls || !this.controls || this._animation) return
    if (this._restViewMode === 'core') {
      this.controls.enabled = false
      this.controls.autoRotate = false
      return
    }
    this.controls.enabled = true
    this.controls.autoRotate = true
    this.controls.update()
  }

  setRestCoreLookAt(worldPos) {
    if (!worldPos) return
    this._coreTargetDir.copy(worldPos).normalize()
  }

  dispose() {
    if (this.controls) this.controls.dispose()
  }
}
