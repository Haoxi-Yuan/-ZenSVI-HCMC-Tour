/**
 * VolunteerAnchorsLayer — gold-bordered pulsing markers on the sphere
 * for volunteer-visited face locations.
 *
 * Spec §2.7: "志愿者实际调研并拍摄过的采样点使用金色边框加缓慢脉冲动画"
 *
 * Uses instanced ring geometry positioned on the sphere surface
 * at each volunteer's matched point index.
 */

import * as THREE from 'three'
import { SPHERE_RADIUS, ANIM } from '../../../utils/sphereConstants'

const RING_INNER = 0.78
const RING_OUTER = 1.0
const RING_SEGMENTS = 32
const VOLUNTEER_GOLD = new THREE.Color('#D4A855')

export class VolunteerAnchorsLayer {
  constructor() {
    this.scene = null
    this.engine = null
    this._mesh = null
    this._count = 0
    this._visible = true
    this._opacity = 1
    this._targetOpacity = 1
    this._reveal = 1
    this._disposed = false
    this._positions = null // Float32Array from sphere data
    this._matches = [] // deduped match objects aligned with instance ids
    this._onAnchorClick = null
    this._raycaster = new THREE.Raycaster()
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
    this._onClick = (e) => this._handleClick(e)
    // Capture phase so we can intercept anchor clicks before geodesic face click.
    engine.renderer.domElement.addEventListener('click', this._onClick, true)
  }

  setAnchorClickHandler(handler) {
    this._onAnchorClick = typeof handler === 'function' ? handler : null
  }

  /**
   * Set volunteer anchor data.
   * @param {Array<{matched_point_idx: number}>} matches - volunteer matches
   * @param {Float32Array} positions - sphere positions buffer (xyz interleaved)
   * @param {number} cellRadius - face cell radius for ring sizing
   */
  setVolunteers(matches, positions, cellRadius) {
    this._cleanup()
    if (!matches || !matches.length || !positions) return

    this._positions = positions
    // Deduplicate by matched point index to avoid stacked rings on the same tile.
    const bestByIdx = new Map()
    for (const m of matches) {
      const idx = m?.matched_point_idx
      if (idx == null) continue
      const prev = bestByIdx.get(idx)
      const preferCurrent = !prev
        || (!prev.note && !!m.note)
        || (
          (!!prev.note === !!m.note)
          && (Number(m.match_distance_m) || Infinity) < (Number(prev.match_distance_m) || Infinity)
        )
      if (preferCurrent) bestByIdx.set(idx, m)
    }
    const dedupMatches = [...bestByIdx.values()]
    this._matches = []
    const N = dedupMatches.length

    // Ring geometry — 1.6× cell size so it's clearly visible during orbit view
    const scale = 1.6
    const ringGeo = new THREE.RingGeometry(
      cellRadius * RING_INNER * scale,
      cellRadius * RING_OUTER * scale,
      RING_SEGMENTS,
    )

    // Per-instance attributes for position & normal
    const aPos = new Float32Array(N * 3)
    const aNorm = new Float32Array(N * 3)
    const validIndices = []

    for (let i = 0; i < N; i++) {
      const idx = dedupMatches[i].matched_point_idx
      if (idx == null || idx * 3 + 2 >= positions.length) continue

      const x = positions[idx * 3]
      const y = positions[idx * 3 + 1]
      const z = positions[idx * 3 + 2]
      const len = Math.sqrt(x * x + y * y + z * z) || 1
      const nx = x / len, ny = y / len, nz = z / len

      // Geodesic faces are placed on radius SPHERE_RADIUS; keep anchors on same surface.
      const baseX = x * SPHERE_RADIUS
      const baseY = y * SPHERE_RADIUS
      const baseZ = z * SPHERE_RADIUS

      // Slight outward offset to avoid Z-fighting with face tiles.
      const offset = 0.08
      aPos.set(
        [baseX + nx * offset, baseY + ny * offset, baseZ + nz * offset],
        validIndices.length * 3,
      )
      aNorm.set([nx, ny, nz], validIndices.length * 3)
      validIndices.push(i)
      this._matches.push(dedupMatches[i])
    }

    this._count = validIndices.length
    if (this._count === 0) return

    // Trim arrays to valid count
    const trimPos = aPos.subarray(0, this._count * 3)
    const trimNorm = aNorm.subarray(0, this._count * 3)

    ringGeo.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(
      new Float32Array(trimPos), 3))
    ringGeo.setAttribute('aAnchorNorm', new THREE.InstancedBufferAttribute(
      new Float32Array(trimNorm), 3))

    const material = new THREE.MeshBasicMaterial({
      color: VOLUNTEER_GOLD,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    })

    // Vertex shader: position rings on sphere + pulsing scale
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.uniforms.uOpacity = { value: 1 }
      shader.uniforms.uReveal = { value: 0 }
      this._shaderUniforms = shader.uniforms

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uReveal;
        attribute vec3 aAnchorPos;
        attribute vec3 aAnchorNorm;

        vec4 qFromVecs(vec3 a, vec3 b) {
          float d = dot(a, b);
          if (d < -0.999) {
            vec3 ax = cross(vec3(1,0,0), a);
            if (length(ax) < 0.001) ax = cross(vec3(0,1,0), a);
            return vec4(normalize(ax), 0.0);
          }
          vec3 c = cross(a, b);
          float s = sqrt((1.0 + d) * 2.0);
          return normalize(vec4(c / s, s * 0.5));
        }

        vec3 rotByQ(vec3 v, vec4 q) {
          vec3 t = 2.0 * cross(q.xyz, v);
          return v + q.w * t + cross(q.xyz, t);
        }`,
      )

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        float reveal = smoothstep(0.0, 1.0, uReveal);
        // Pulsing scale
        float pulse = 1.0 + 0.18 * sin(uTime * 2.5);
        mvPosition.xyz *= pulse * reveal;
        // Orient ring to face outward along normal
        vec4 q = qFromVecs(vec3(0.0, 0.0, 1.0), aAnchorNorm);
        mvPosition.xyz = rotByQ(mvPosition.xyz, q) + aAnchorPos * reveal;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uOpacity;
        uniform float uReveal;`,
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.a *= uOpacity * smoothstep(0.0, 1.0, uReveal);
        // Emissive boost for bloom glow
        gl_FragColor.rgb *= 2.4;`,
      )
    }

    this._mesh = new THREE.InstancedMesh(ringGeo, material, this._count)
    this._mesh.frustumCulled = false
    this._mesh.renderOrder = 10  // render above hex faces

    // Identity instance matrices (positioning done in shader)
    const mat4 = new THREE.Matrix4()
    for (let i = 0; i < this._count; i++) {
      this._mesh.setMatrixAt(i, mat4)
    }
    this._mesh.instanceMatrix.needsUpdate = true

    this.scene.add(this._mesh)
    this._reveal = 0
    if (this._shaderUniforms) this._shaderUniforms.uReveal.value = 0
  }

  _handleClick(e) {
    if (!this._mesh || !this._onAnchorClick) return
    if (!this._mesh.visible || this._opacity < 0.08) return
    const engine = this.engine
    if (!engine?.camera || !engine?.renderer?.domElement) return

    const rect = engine.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this._raycaster.setFromCamera(pointer, engine.camera)
    const hits = this._raycaster.intersectObject(this._mesh, false)
    if (!hits.length) return

    const instanceId = hits[0].instanceId
    if (instanceId == null || instanceId < 0 || instanceId >= this._matches.length) return

    e.preventDefault()
    e.stopPropagation()
    this._onAnchorClick(this._matches[instanceId])
  }

  show() {
    this._targetOpacity = 1
    if (this._mesh) this._mesh.visible = true
  }

  hide() {
    this._targetOpacity = 0
  }

  update(dt, elapsed) {
    if (!this._mesh) return

    // Update pulsing time
    if (this._shaderUniforms) {
      this._shaderUniforms.uTime.value = elapsed / 1000
      const revealSpeed = Math.max(0.1, 1000 / ANIM.ENTRY_MS)
      this._reveal = Math.min(1, this._reveal + dt * revealSpeed)
      this._shaderUniforms.uReveal.value = this._reveal
    }

    // Opacity fade
    if (Math.abs(this._opacity - this._targetOpacity) > 0.01) {
      this._opacity += (this._targetOpacity - this._opacity) * Math.min(1, dt * 4)
      if (this._shaderUniforms) {
        this._shaderUniforms.uOpacity.value = this._opacity
      }
      if (this._opacity < 0.01) {
        this._mesh.visible = false
      }
    }
  }

  _cleanup() {
    if (this._mesh) {
      this.scene.remove(this._mesh)
      this._mesh.geometry.dispose()
      this._mesh.material.dispose()
      this._mesh = null
    }
    this._count = 0
    this._matches = []
    this._shaderUniforms = null
  }

  dispose() {
    this._disposed = true
    if (this.engine?.renderer?.domElement && this._onClick) {
      this.engine.renderer.domElement.removeEventListener('click', this._onClick, true)
    }
    this._cleanup()
  }
}
