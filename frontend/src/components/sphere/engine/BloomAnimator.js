/**
 * BloomAnimator — GPU-driven three-act "Bloom to Map" transition (Spec §2.5).
 *
 * Uses a single InstancedMesh with per-instance attributes to encode all
 * animation parameters. Vertex shader computes position from uniforms
 * (uPhase + uProgress), eliminating N draw calls.
 *
 * Act 1: Detach (800ms) — faces pop out radially from sphere
 * Act 2: Unfurl (1200ms) — Bezier curve from sphere to map plane
 * Act 3: Landing (800ms) — settle at geographic positions
 *
 * Retract reverses all three acts.
 * Petals show atlas textures when available, falling back to instance color.
 */

import * as THREE from 'three'
import { ANIM } from '../../../utils/sphereConstants'

const MAP_PLANE_Y = -15
const MAP_SCALE = 60
const HCMC_CENTER = { lat: 10.822, lon: 106.647 }
const DETACH_OFFSET = 2.0

export class BloomAnimator {
  constructor() {
    this.scene = null
    this.engine = null
    this._mesh = null          // Single InstancedMesh
    this._petalCount = 0
    this._phase = 'idle'       // idle | detach | unfurl | land | hold | retract_land | retract_unfurl | retract_detach
    this._animStart = 0
    this._animDuration = 0
    this._onComplete = null
    this._onRetractComplete = null
    this._disposed = false
    this._uniforms = {
      uPhase: { value: 0 },     // 0=detach, 1=unfurl, 2=land
      uProgress: { value: 0 },  // 0-1 within current phase
      uAtlas0: { value: null },
      uAtlas1: { value: null },
      uAtlas2: { value: null },
      uAtlas3: { value: null },
      uAtlasEnabled: { value: 0 },
      uTileUVSize: { value: 0 },
    }
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
  }

  /**
   * Start the three-act bloom animation.
   * @param {Array<{idx, similarity}>} faces - similar faces to bloom
   * @param {GeodesicLayer} geodesic - to get face positions
   * @param {object[]} faceDetails - array of {idx, lat, lon} for each face
   * @param {Function} onComplete - called after Act 3 finishes
   */
  startBloom(faces, geodesic, faceDetails, onComplete) {
    this._cleanPetals()
    this._onComplete = onComplete

    const detailMap = new Map()
    for (const d of faceDetails) detailMap.set(d.idx, d)

    // Check if atlas data is available on geodesic
    const geoGeom = geodesic.mesh.geometry
    const uvAttr = geoGeom.getAttribute('aUVOffset')
    const idxAttr = geoGeom.getAttribute('aAtlasIndex')
    const hasAtlas = !!(uvAttr && idxAttr && geodesic._atlasEnabled)

    // Collect valid petal data
    const petalData = []
    for (const face of faces) {
      const detail = detailMap.get(face.idx)
      if (!detail || detail.lat == null || detail.lon == null) continue

      const spherePos = geodesic.getFacePosition(face.idx)
      const normal = geodesic.getFaceNormal(face.idx)
      const detachPos = spherePos.clone().addScaledVector(normal, DETACH_OFFSET)

      const mapX = (detail.lon - HCMC_CENTER.lon) * MAP_SCALE
      const mapZ = -(detail.lat - HCMC_CENTER.lat) * MAP_SCALE
      const mapPos = new THREE.Vector3(mapX, MAP_PLANE_Y, mapZ)

      const mid = detachPos.clone().lerp(mapPos, 0.4)
      mid.y = Math.max(detachPos.y, mapPos.y) + 5
      const bezierCP = mid

      const color = new THREE.Color()
      geodesic.mesh.getColorAt(face.idx, color)

      // Atlas UV data for textured petals
      let uvOff = [0, 0]
      let atlIdx = -1
      if (hasAtlas) {
        uvOff = [uvAttr.getX(face.idx), uvAttr.getY(face.idx)]
        atlIdx = idxAttr.getX(face.idx)
      }

      petalData.push({ spherePos, detachPos, mapPos, bezierCP, normal, color, uvOff, atlIdx })
    }

    this._petalCount = petalData.length
    if (this._petalCount === 0) {
      if (onComplete) onComplete()
      return
    }

    // Build InstancedMesh with custom shader
    const N = this._petalCount
    const hexGeo = new THREE.CircleGeometry(geodesic.cellRadius * 1.5, 6)

    // Per-instance attributes
    const aSpherePos = new Float32Array(N * 3)
    const aDetachPos = new Float32Array(N * 3)
    const aBezierCP = new Float32Array(N * 3)
    const aMapPos = new Float32Array(N * 3)
    const aNormal = new Float32Array(N * 3)
    const aUVOff = new Float32Array(N * 2)
    const aAtlIdx = new Float32Array(N)

    for (let i = 0; i < N; i++) {
      const p = petalData[i]
      aSpherePos.set([p.spherePos.x, p.spherePos.y, p.spherePos.z], i * 3)
      aDetachPos.set([p.detachPos.x, p.detachPos.y, p.detachPos.z], i * 3)
      aBezierCP.set([p.bezierCP.x, p.bezierCP.y, p.bezierCP.z], i * 3)
      aMapPos.set([p.mapPos.x, p.mapPos.y, p.mapPos.z], i * 3)
      aNormal.set([p.normal.x, p.normal.y, p.normal.z], i * 3)
      aUVOff.set(p.uvOff, i * 2)
      aAtlIdx[i] = p.atlIdx
    }

    hexGeo.setAttribute('aSpherePos', new THREE.InstancedBufferAttribute(aSpherePos, 3))
    hexGeo.setAttribute('aDetachPos', new THREE.InstancedBufferAttribute(aDetachPos, 3))
    hexGeo.setAttribute('aBezierCP', new THREE.InstancedBufferAttribute(aBezierCP, 3))
    hexGeo.setAttribute('aMapPos', new THREE.InstancedBufferAttribute(aMapPos, 3))
    hexGeo.setAttribute('aNormal', new THREE.InstancedBufferAttribute(aNormal, 3))
    hexGeo.setAttribute('aUVOff', new THREE.InstancedBufferAttribute(aUVOff, 2))
    hexGeo.setAttribute('aAtlIdx', new THREE.InstancedBufferAttribute(aAtlIdx, 1))

    // Copy atlas uniforms from geodesic layer
    if (hasAtlas) {
      for (let i = 0; i < 4; i++) {
        if (geodesic._atlasTextures[i]) {
          this._uniforms[`uAtlas${i}`].value = geodesic._atlasTextures[i]
        }
      }
      this._uniforms.uAtlasEnabled.value = 1
      this._uniforms.uTileUVSize.value = geodesic._animUniforms.uTileUVSize.value
    }

    // Material with vertex shader animation
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      toneMapped: false,
    })

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPhase = this._uniforms.uPhase
      shader.uniforms.uProgress = this._uniforms.uProgress
      shader.uniforms.uAtlas0 = this._uniforms.uAtlas0
      shader.uniforms.uAtlas1 = this._uniforms.uAtlas1
      shader.uniforms.uAtlas2 = this._uniforms.uAtlas2
      shader.uniforms.uAtlas3 = this._uniforms.uAtlas3
      shader.uniforms.uAtlasEnabled = this._uniforms.uAtlasEnabled
      shader.uniforms.uTileUVSize = this._uniforms.uTileUVSize

      // Vertex: compute position from phase + progress, pass atlas UV
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uPhase;
        uniform float uProgress;
        uniform float uTileUVSize;
        attribute vec3 aSpherePos;
        attribute vec3 aDetachPos;
        attribute vec3 aBezierCP;
        attribute vec3 aMapPos;
        attribute vec3 aNormal;
        attribute vec2 aUVOff;
        attribute float aAtlIdx;
        varying float vOpacity;
        varying vec2 vAtlasUV;
        varying float vAtlasIdx;

        // Quaternion from two unit vectors
        vec4 quatFromVectors(vec3 from, vec3 to) {
          float d = dot(from, to);
          if (d < -0.999) {
            vec3 axis = cross(vec3(1,0,0), from);
            if (length(axis) < 0.001) axis = cross(vec3(0,1,0), from);
            axis = normalize(axis);
            return vec4(axis, 0.0);
          }
          vec3 c = cross(from, to);
          float s = sqrt((1.0 + d) * 2.0);
          return normalize(vec4(c / s, s * 0.5));
        }

        // Rotate position by quaternion
        vec3 rotateByQuat(vec3 v, vec4 q) {
          vec3 t = 2.0 * cross(q.xyz, v);
          return v + q.w * t + cross(q.xyz, t);
        }

        // Smoothstep helper
        float smooth01(float t) {
          return t * t * (3.0 - 2.0 * t);
        }`,
      )

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif

        // Pass atlas UV coordinates to fragment
        vAtlasUV = aUVOff + uv * uTileUVSize;
        vAtlasIdx = aAtlIdx;

        // Compute world position based on animation phase
        vec3 worldPos;
        float scale;
        vec4 orient;
        vec3 zUp = vec3(0.0, 0.0, 1.0);
        vec3 yUp = vec3(0.0, 1.0, 0.0);
        vec4 sphereQuat = quatFromVectors(zUp, aNormal);
        vec4 mapQuat = quatFromVectors(zUp, yUp);

        float t = smooth01(uProgress);

        if (uPhase < 0.5) {
          // Act 1: Detach
          worldPos = mix(aSpherePos, aDetachPos, t);
          scale = 1.0 + t * 0.3;
          orient = sphereQuat;
          vOpacity = 0.9;
        } else if (uPhase < 1.5) {
          // Act 2: Unfurl (Bezier)
          float mt = 1.0 - t;
          worldPos = mt * mt * aDetachPos + 2.0 * mt * t * aBezierCP + t * t * aMapPos;
          scale = 1.3 + t * 0.5;
          // Slerp orientation from sphere face to map-up
          float d = dot(sphereQuat, mapQuat);
          if (d < 0.0) { mapQuat = -mapQuat; d = -d; }
          float theta = acos(clamp(d, -1.0, 1.0));
          if (theta > 0.001) {
            float sn = sin(theta);
            orient = (sin((1.0 - t) * theta) / sn) * sphereQuat + (sin(t * theta) / sn) * mapQuat;
          } else {
            orient = mix(sphereQuat, mapQuat, t);
          }
          orient = normalize(orient);
          vOpacity = 0.9;
        } else {
          // Act 3: Land
          worldPos = aMapPos;
          scale = 1.8;
          orient = mapQuat;
          float bounce = t < 0.7 ? t / 0.7 : 1.0 - 0.1 * sin((t - 0.7) / 0.3 * 3.14159);
          vOpacity = 0.9 * bounce;
        }

        // Apply orientation to local vertex
        vec3 rotated = rotateByQuat(mvPosition.xyz * scale, orient);
        mvPosition = vec4(rotated + worldPos, 1.0);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      )

      // Fragment: atlas texture sampling + opacity
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uAtlasEnabled;
        uniform sampler2D uAtlas0;
        uniform sampler2D uAtlas1;
        uniform sampler2D uAtlas2;
        uniform sampler2D uAtlas3;
        varying float vOpacity;
        varying vec2 vAtlasUV;
        varying float vAtlasIdx;`,
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        // Sample atlas texture if available, blend with instance color
        if (uAtlasEnabled > 0.5 && vAtlasIdx >= 0.0) {
          vec4 texColor;
          if (vAtlasIdx < 0.5) texColor = texture2D(uAtlas0, vAtlasUV);
          else if (vAtlasIdx < 1.5) texColor = texture2D(uAtlas1, vAtlasUV);
          else if (vAtlasIdx < 2.5) texColor = texture2D(uAtlas2, vAtlasUV);
          else texColor = texture2D(uAtlas3, vAtlasUV);
          // Mix: 70% texture + 30% perception color tint
          gl_FragColor.rgb = mix(gl_FragColor.rgb, texColor.rgb, 0.7);
        }
        gl_FragColor.a *= vOpacity;`,
      )
    }

    this._mesh = new THREE.InstancedMesh(hexGeo, material, N)
    this._mesh.frustumCulled = false
    this._mesh.visible = false

    // Set identity matrices + colors
    const mat4 = new THREE.Matrix4()
    for (let i = 0; i < N; i++) {
      this._mesh.setMatrixAt(i, mat4)
      this._mesh.setColorAt(i, petalData[i].color)
    }
    this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.instanceColor.needsUpdate = true

    this.scene.add(this._mesh)

    // Start Act 1
    this._startPhase('detach', ANIM.BLOOM_DETACH_MS)
    this._mesh.visible = true
  }

  startRetract(onComplete) {
    this._onRetractComplete = onComplete
    this._startPhase('retract_land', ANIM.BLOOM_LAND_MS)
  }

  _startPhase(phase, duration) {
    this._phase = phase
    this._animStart = performance.now()
    this._animDuration = duration

    // Map phase to shader uPhase
    const phaseMap = {
      detach: 0, unfurl: 1, land: 2,
      retract_land: 2, retract_unfurl: 1, retract_detach: 0,
    }
    if (phaseMap[phase] !== undefined) {
      this._uniforms.uPhase.value = phaseMap[phase]
    }
  }

  _smoothstep(t) {
    return t * t * (3 - 2 * t)
  }

  update() {
    if (this._phase === 'idle' || this._phase === 'hold' || !this._mesh) return

    const now = performance.now()
    const rawT = Math.min(1, (now - this._animStart) / this._animDuration)

    // For retract phases, reverse the progress
    const isRetract = this._phase.startsWith('retract_')
    this._uniforms.uProgress.value = isRetract ? (1 - rawT) : rawT

    if (rawT >= 1) {
      switch (this._phase) {
        case 'detach':
          this._startPhase('unfurl', ANIM.BLOOM_UNFURL_MS)
          break
        case 'unfurl':
          this._startPhase('land', ANIM.BLOOM_LAND_MS)
          break
        case 'land':
          this._phase = 'hold'
          this._uniforms.uProgress.value = 1
          if (this._onComplete) this._onComplete()
          break
        case 'retract_land':
          this._startPhase('retract_unfurl', ANIM.BLOOM_UNFURL_MS)
          break
        case 'retract_unfurl':
          this._startPhase('retract_detach', ANIM.BLOOM_DETACH_MS)
          break
        case 'retract_detach':
          this._cleanPetals()
          this._phase = 'idle'
          if (this._onRetractComplete) this._onRetractComplete()
          break
      }
    }
  }

  _cleanPetals() {
    if (this._mesh) {
      this.scene.remove(this._mesh)
      this._mesh.geometry.dispose()
      this._mesh.material.dispose()
      this._mesh = null
    }
    this._petalCount = 0
    // Reset atlas uniforms (don't dispose — textures owned by GeodesicLayer)
    this._uniforms.uAtlasEnabled.value = 0
  }

  get isAnimating() {
    return this._phase !== 'idle' && this._phase !== 'hold'
  }

  get isHolding() {
    return this._phase === 'hold'
  }

  dispose() {
    this._disposed = true
    this._cleanPetals()
  }
}