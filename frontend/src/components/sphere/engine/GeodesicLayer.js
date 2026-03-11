/**
 * GeodesicLayer — InstancedMesh sphere with 178K hexagonal faces.
 *
 * Extracted from the original SphereRenderer. Handles:
 * - InstancedMesh creation and entry animation
 * - Dimension-based coloring
 * - Hover detection (raycasting + nearest-point)
 * - Highlight for resonance (per-instance glow attribute)
 * - Sphere dimming for bloom
 */

import * as THREE from 'three'
import {
  SPHERE_RADIUS,
  PERCEPTION_DIMS,
  DIM_CONFIG,
  scoreToColor,
  ANIM,
} from '../../../utils/sphereConstants'

export class GeodesicLayer {
  constructor(positions, colorBlocks, perceptionScores, nPoints, callbacks) {
    this.positions = positions
    this.colorBlocks = colorBlocks
    this.perceptionScores = perceptionScores
    this.N = nPoints
    this.callbacks = callbacks || {}

    // State
    this.activeDim = null
    this.mesh = null
    this.hoverRing = null
    this.hoveredIdx = -1
    this._frameCount = 0
    this._entryDone = false
    this._anyHighlighted = false
    this._sphereOpacity = 1.0
    this._targetSphereOpacity = 1.0
    this._shellVisible = true
    this._atlasEnabled = false
    this._atlasTextures = []
    this._atlasLoadedCount = 0

    // Reusable objects
    this._mat4 = new THREE.Matrix4()
    this._pos = new THREE.Vector3()
    this._nrm = new THREE.Vector3()
    this._quat = new THREE.Quaternion()
    this._scl = new THREE.Vector3()
    this._zUp = new THREE.Vector3(0, 0, 1)
    this._color = new THREE.Color()
    this._raycaster = new THREE.Raycaster()

    // Computed
    const surfaceArea = 4 * Math.PI * SPHERE_RADIUS * SPHERE_RADIUS
    const avgArea = surfaceArea / this.N
    this.cellRadius = Math.sqrt(avgArea / 2.598) * 1.3
    this._maxDist2 = Math.pow((this.cellRadius / SPHERE_RADIUS) * 1.5, 2)

    // Hit sphere for raycasting
    this._hitSphere = new THREE.Sphere(new THREE.Vector3(), SPHERE_RADIUS * 1.05)
    this._hitPt = new THREE.Vector3()
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
    const N = this.N

    // Geometry (unit hexagon)
    const geometry = new THREE.CircleGeometry(1, 6)

    // Per-instance animation delay
    const delays = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const z = this.positions[i * 3 + 2]
      const theta = Math.acos(Math.max(-1, Math.min(1, z)))
      delays[i] = (theta / Math.PI) * 0.75
    }
    geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delays, 1))

    // Per-instance highlight (for resonance glow)
    this._highlightAttr = new Float32Array(N)
    geometry.setAttribute('aHighlight',
      new THREE.InstancedBufferAttribute(this._highlightAttr, 1))

    // Animation uniforms
    this._animUniforms = {
      uProgress: { value: 0 },
      uPulseTime: { value: 0 },
      uAnyHighlighted: { value: 0 },
      uSphereOpacity: { value: 1.0 },
      // Atlas uniforms
      uAtlas0: { value: null },
      uAtlas1: { value: null },
      uAtlas2: { value: null },
      uAtlas3: { value: null },
      uAtlasEnabled: { value: 0 },
      uTileUVSize: { value: 0 },
      uTexColorMix: { value: 0.3 },
      // Visual Quality
      uExposure: { value: 1.2 },
      uContrast: { value: 1.15 },
      // Breathing atmosphere
      uBreathTime: { value: 0 },
    }

    // Material with custom shader injection
    const material = new THREE.MeshBasicMaterial({
      // FrontSide avoids back-face rendering when camera is inside first-person mode.
      side: THREE.FrontSide,
      toneMapped: false,
      transparent: false,
    })

    material.onBeforeCompile = (shader) => {
      // Bind all uniforms
      for (const [key, val] of Object.entries(this._animUniforms)) {
        shader.uniforms[key] = val
      }

      // ─── Vertex Shader ────────────────────────────────────
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uProgress;
        uniform float uPulseTime;
        uniform float uAnyHighlighted;
        uniform float uBreathTime;
        uniform float uAtlasEnabled;
        uniform float uTileUVSize;
        attribute float aDelay;
        attribute float aHighlight;
        attribute vec2 aUVOffset;
        attribute float aAtlasIndex;
        varying float vHighlight;
        varying float vAnyHL;
        varying vec2 vAtlasUV;
        varying float vAtlasIdx;
        varying vec3 vViewPosition;`,
      )

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float animT = smoothstep(aDelay, aDelay + 0.25, uProgress);
        mvPosition.xyz *= animT;
        // Breathing displacement for highlighted faces
        if (aHighlight > 0.5) {
          float breath = 0.02 * sin(uBreathTime * 1.5);
          mvPosition.xyz *= (1.0 + breath);
        }
        mvPosition = modelViewMatrix * mvPosition;
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        vHighlight = aHighlight;
        vAnyHL = uAnyHighlighted;
        // Atlas UV: remap hex geometry UV [0,1] to tile window in atlas
        if (uAtlasEnabled > 0.5) {
          vAtlasUV = aUVOffset + uv * uTileUVSize;
          vAtlasIdx = aAtlasIndex;
        } else {
          vAtlasUV = vec2(0.0);
          vAtlasIdx = -1.0;
        }`,
      )

      // ─── Fragment Shader ──────────────────────────────────
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uPulseTime;
        uniform float uSphereOpacity;
        uniform float uAtlasEnabled;
        uniform float uTexColorMix;
        uniform float uExposure;
        uniform float uContrast;
        uniform sampler2D uAtlas0;
        uniform sampler2D uAtlas1;
        uniform sampler2D uAtlas2;
        uniform sampler2D uAtlas3;
        varying float vHighlight;
        varying float vAnyHL;
        varying vec2 vAtlasUV;
        varying float vAtlasIdx;
        varying vec3 vViewPosition;
        
        vec3 adjustContrast(vec3 color, float value) {
          return 0.5 + value * (color - 0.5);
        }
        `,
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        vec3 baseColor = gl_FragColor.rgb;
        
        // Atlas texture blending
        if (uAtlasEnabled > 0.5 && vAtlasIdx >= 0.0) {
          vec4 texColor;
          if (vAtlasIdx < 0.5) texColor = texture2D(uAtlas0, vAtlasUV);
          else if (vAtlasIdx < 1.5) texColor = texture2D(uAtlas1, vAtlasUV);
          else if (vAtlasIdx < 2.5) texColor = texture2D(uAtlas2, vAtlasUV);
          else texColor = texture2D(uAtlas3, vAtlasUV);
          // Blend: 70% texture + 30% perception color tint
          baseColor = mix(texColor.rgb, baseColor, uTexColorMix);
        }
        
        // Apply exposure and contrast boost
        baseColor *= uExposure;
        baseColor = adjustContrast(baseColor, uContrast);

        // Highlight/dimming logic
        // Use color dimming (not alpha blending) to avoid transparent
        // InstancedMesh depth-sorting artifacts in first-person mode.
        float baseDim = mix(0.12, 1.0, clamp(uSphereOpacity, 0.0, 1.0));
        baseColor *= baseDim;
        if (vAnyHL > 0.5) {
          if (vHighlight > 0.5) {
            float pulse = 1.0 + 0.4 * sin(uPulseTime * 4.0);
            baseColor *= pulse;
            // Golden glow
            baseColor += vec3(0.15, 0.1, 0.05) * (0.5 + 0.5 * sin(uPulseTime * 4.0));
          } else {
            baseColor *= 0.22;
          }
        }
        
        // Subtle Fresnel edge lighting for depth
        vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        float fresnel = pow(1.0 - max(0.0, dot(normal, vec3(0.0, 0.0, 1.0))), 3.5);
        baseColor += fresnel * 0.15;

        gl_FragColor = vec4(baseColor, 1.0);`,
      )
    }

    // InstancedMesh
    this.mesh = new THREE.InstancedMesh(geometry, material, N)
    this.mesh.frustumCulled = false

    const { _mat4: mat4, _pos: pos, _nrm: nrm, _quat: quat, _scl: scl, _zUp: zUp, _color: color } = this

    // Set instance matrices and initial colors
    for (let i = 0; i < N; i++) {
      const x = this.positions[i * 3]
      const y = this.positions[i * 3 + 1]
      const z = this.positions[i * 3 + 2]

      pos.set(x * SPHERE_RADIUS, y * SPHERE_RADIUS, z * SPHERE_RADIUS)
      nrm.set(x, y, z).normalize()
      if (nrm.z < -0.9999) quat.set(1, 0, 0, 0)
      else quat.setFromUnitVectors(zUp, nrm)

      scl.setScalar(this.cellRadius)
      mat4.compose(pos, quat, scl)
      this.mesh.setMatrixAt(i, mat4)

      color.setRGB(
        this.colorBlocks[i * 3] / 255,
        this.colorBlocks[i * 3 + 1] / 255,
        this.colorBlocks[i * 3 + 2] / 255,
      )
      this.mesh.setColorAt(i, color)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor.needsUpdate = true
    scene.add(this.mesh)

    // Hover ring
    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(this.cellRadius * 0.85, this.cellRadius * 1.25, 6),
      new THREE.MeshBasicMaterial({
        color: 0xF5F0E8,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    )
    this.hoverRing.visible = false
    scene.add(this.hoverRing)

    // Ambient particles
    const pCount = 400
    const pPos = new Float32Array(pCount * 3)
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 80
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 80
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 80
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    this._particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xF5F0E8,
      size: 0.15,
      transparent: true,
      opacity: 0.12,
      sizeAttenuation: true,
    }))
    scene.add(this._particles)

    // Click handler — raycast at click time for reliable hit detection
    this._onClick = (e) => {
      if (!this._entryDone) return
      // Update pointer from click event coords
      const rect = engine.renderer.domElement.getBoundingClientRect()
      engine.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      engine.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      const idx = this._findNearestPoint()
      if (idx >= 0 && this.callbacks.onPointClick) {
        this.callbacks.onPointClick(idx)
      }
    }
    engine.renderer.domElement.addEventListener('click', this._onClick)
  }

  update(dt, elapsed) {
    // Entry animation
    const progress = Math.min(1, elapsed / ANIM.ENTRY_MS)
    this._animUniforms.uProgress.value = progress
    this._entryDone = progress >= 1

    // Pulse time for resonance glow
    this._animUniforms.uPulseTime.value = elapsed / 1000

    // Breathing time for atmosphere displacement
    this._animUniforms.uBreathTime.value = elapsed / 1000

    // Sphere opacity tween
    if (Math.abs(this._sphereOpacity - this._targetSphereOpacity) > 0.01) {
      this._sphereOpacity += (this._targetSphereOpacity - this._sphereOpacity) * Math.min(1, dt * 5)
      this._animUniforms.uSphereOpacity.value = this._sphereOpacity
    }

    if (!this._shellVisible) {
      if (this.hoverRing) this.hoverRing.visible = false
      return
    }

    // Raycasting (throttled, after entry animation)
    this._frameCount++
    if (this._frameCount % 3 === 0 && this._entryDone && this.callbacks.onPointHover) {
      const idx = this._findNearestPoint()
      this._updateHover(idx)
    }
  }

  _findNearestPoint() {
    const engine = this.engine
    this._raycaster.setFromCamera(engine.pointer, engine.camera)
    const hit = this._raycaster.ray.intersectSphere(this._hitSphere, this._hitPt)
    if (!hit) return -1

    // Normalize hit point to unit sphere (hit sphere is 1.05× radius for easier picking)
    const len = this._hitPt.length()
    const hx = this._hitPt.x / len
    const hy = this._hitPt.y / len
    const hz = this._hitPt.z / len

    let bestIdx = -1, bestD = Infinity
    for (let i = 0, j = 0; i < this.N; i++, j += 3) {
      const dx = this.positions[j] - hx
      const dy = this.positions[j + 1] - hy
      const dz = this.positions[j + 2] - hz
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    return bestD < this._maxDist2 ? bestIdx : -1
  }

  _updateHover(idx) {
    if (idx === this.hoveredIdx) {
      // Still update screen position for tooltip tracking
      if (idx >= 0 && this.callbacks.onPointHover) {
        this.callbacks.onPointHover(idx, { ...this.engine.pointerPx })
      }
      return
    }
    this.hoveredIdx = idx
    const { _mat4: mat4, _pos: pos, _quat: quat, _scl: scl, _nrm: nrm } = this

    if (idx >= 0) {
      this.mesh.getMatrixAt(idx, mat4)
      mat4.decompose(pos, quat, scl)
      this.hoverRing.position.copy(pos)
      this.hoverRing.quaternion.copy(quat)
      nrm.copy(pos).normalize()
      this.hoverRing.position.addScaledVector(nrm, 0.02)
      this.hoverRing.visible = true
      this.engine.renderer.domElement.style.cursor = 'pointer'
      if (this.callbacks.onPointHover) {
        this.callbacks.onPointHover(idx, { ...this.engine.pointerPx })
      }
    } else {
      this.hoverRing.visible = false
      this.engine.renderer.domElement.style.cursor = 'default'
      if (this.callbacks.onPointHover) {
        this.callbacks.onPointHover(null, null)
      }
    }
  }

  setActiveDim(dim) {
    if (!this.mesh || !this.perceptionScores) return
    this.activeDim = dim
    const { N, _color: color } = this

    if (!dim) {
      for (let i = 0; i < N; i++) {
        color.setRGB(
          this.colorBlocks[i * 3] / 255,
          this.colorBlocks[i * 3 + 1] / 255,
          this.colorBlocks[i * 3 + 2] / 255,
        )
        this.mesh.setColorAt(i, color)
      }
    } else {
      const dimIdx = PERCEPTION_DIMS.indexOf(dim)
      if (dimIdx < 0) return
      const inverted = DIM_CONFIG[dim]?.inverted || false

      let min = Infinity, max = -Infinity
      for (let i = 0; i < N; i++) {
        const v = this.perceptionScores[i * 6 + dimIdx]
        if (v < min) min = v
        if (v > max) max = v
      }
      const range = max - min || 1

      for (let i = 0; i < N; i++) {
        const v = this.perceptionScores[i * 6 + dimIdx]
        const s = (v - min) / range
        const [r, g, b] = scoreToColor(s, inverted)
        color.setRGB(r, g, b)
        this.mesh.setColorAt(i, color)
      }
    }
    this.mesh.instanceColor.needsUpdate = true
  }

  setHighlightedFaces(indices) {
    this._highlightAttr.fill(0)
    if (indices && indices.length > 0) {
      for (const idx of indices) {
        if (idx >= 0 && idx < this.N) {
          this._highlightAttr[idx] = 1.0
        }
      }
      this._anyHighlighted = true
    } else {
      this._anyHighlighted = false
    }
    this._animUniforms.uAnyHighlighted.value = this._anyHighlighted ? 1.0 : 0.0
    this.mesh.geometry.attributes.aHighlight.needsUpdate = true
  }

  setSphereOpacity(opacity) {
    this._targetSphereOpacity = opacity
  }

  /**
   * Show/hide the geodesic shell and ambient particles.
   * Use this for first-person mode to avoid interior shell artifacts.
   */
  setShellVisible(visible) {
    this._shellVisible = !!visible
    if (this.mesh) this.mesh.visible = this._shellVisible
    if (this._particles) this._particles.visible = this._shellVisible
    if (!this._shellVisible && this.hoverRing) this.hoverRing.visible = false
    if (!this._shellVisible && this.engine?.renderer?.domElement) {
      this.engine.renderer.domElement.style.cursor = 'default'
    }
  }

  /** Switch face rendering for inside-core view. */
  setInteriorViewMode(enabled) {
    if (!this.mesh?.material) return
    this.mesh.material.side = enabled ? THREE.DoubleSide : THREE.FrontSide
    this.mesh.material.needsUpdate = true
  }

  /** Get 3D world position for a face index */
  getFacePosition(idx) {
    const x = this.positions[idx * 3]
    const y = this.positions[idx * 3 + 1]
    const z = this.positions[idx * 3 + 2]
    return new THREE.Vector3(x * SPHERE_RADIUS, y * SPHERE_RADIUS, z * SPHERE_RADIUS)
  }

  /** Get outward normal for a face */
  getFaceNormal(idx) {
    return new THREE.Vector3(
      this.positions[idx * 3],
      this.positions[idx * 3 + 1],
      this.positions[idx * 3 + 2],
    ).normalize()
  }

  /**
   * Load atlas textures and set per-instance UV/index attributes.
   * @param {{ metadata: Object, uvOffsets: Float32Array, atlasIndices: Uint8Array }} atlasData
   */
  setAtlasData(atlasData) {
    if (!this.mesh || !atlasData) return
    const { metadata, uvOffsets, atlasIndices } = atlasData
    const geom = this.mesh.geometry

    // Per-instance UV offset (vec2)
    geom.setAttribute('aUVOffset',
      new THREE.InstancedBufferAttribute(uvOffsets, 2))

    // Per-instance atlas index (float, from Uint8 → Float32)
    const idxFloat = new Float32Array(atlasIndices.length)
    for (let i = 0; i < atlasIndices.length; i++) idxFloat[i] = atlasIndices[i]
    geom.setAttribute('aAtlasIndex',
      new THREE.InstancedBufferAttribute(idxFloat, 1))

    // Tile UV size from metadata
    this._animUniforms.uTileUVSize.value = metadata.tile_uv_size

    // Load atlas JPEG textures
    const loader = new THREE.TextureLoader()
    const nAtlases = metadata.n_atlases
    const atlasNames = ['uAtlas0', 'uAtlas1', 'uAtlas2', 'uAtlas3']

    for (let i = 0; i < nAtlases && i < 4; i++) {
      loader.load(
        `/api/sphere/atlas/${i}`,
        (tex) => {
          tex.minFilter = THREE.LinearFilter
          tex.magFilter = THREE.LinearFilter
          tex.generateMipmaps = false
          tex.flipY = false
          this._atlasTextures[i] = tex
          this._animUniforms[atlasNames[i]].value = tex
          this._atlasLoadedCount++
          // Enable atlas rendering once all textures are loaded
          if (this._atlasLoadedCount >= nAtlases) {
            this._atlasEnabled = true
            this._animUniforms.uAtlasEnabled.value = 1
          }
        },
        undefined,
        (err) => console.warn(`Atlas ${i} load failed:`, err),
      )
    }
  }

  dispose() {
    if (this.engine) {
      this.engine.renderer.domElement.removeEventListener('click', this._onClick)
    }
    // Clean up atlas textures
    for (const tex of this._atlasTextures) {
      if (tex) tex.dispose()
    }
    this._atlasTextures = []
  }
}
