/**
 * NeighborProjection — overlays neighbor face thumbnails on the sphere surface.
 *
 * When standing on a face, loads the 128×128 thumbnails for adjacent faces
 * and projects them onto textured hexagonal meshes just above the sphere.
 * LRU texture cache (max 50) prevents excessive VRAM usage (~3MB total).
 */

import * as THREE from 'three'
import { SPHERE_RADIUS } from '../../../utils/sphereConstants'

const MAX_CACHE = 50
const THUMB_SIZE = 128

export class NeighborProjection {
  constructor() {
    this._meshes = []          // { mesh, idx, opacity }
    this._targetOpacity = 0
    this._opacity = 0
    this._cache = new Map()    // idx → THREE.Texture (LRU)
    this._cacheOrder = []      // LRU order
    this._loader = new THREE.TextureLoader()
    this._hexGeo = null
    this._cellRadius = 0
  }

  init(scene, engine) {
    this.scene = scene
    this.engine = engine
  }

  /** Set cell radius from GeodesicLayer so hex meshes match sphere tile size */
  setCellRadius(r) {
    this._cellRadius = r
    // Shared hex geometry (unit hex, scaled per-instance)
    if (this._hexGeo) this._hexGeo.dispose()
    this._hexGeo = new THREE.CircleGeometry(r * 0.95, 6)
  }

  /**
   * Show neighbor thumbnails around a face.
   * @param {number} centerIdx - Current face index (not displayed)
   * @param {number[]} neighborIndices - Indices of adjacent faces
   * @param {Float32Array} positions - Unit sphere positions (N*3)
   */
  show(centerIdx, neighborIndices, positions) {
    this._clear()
    if (!neighborIndices?.length || !positions || !this._hexGeo) return

    this._targetOpacity = 1

    const zUp = new THREE.Vector3(0, 0, 1)
    const quat = new THREE.Quaternion()
    const nrm = new THREE.Vector3()

    for (const idx of neighborIndices) {
      if (idx < 0 || idx * 3 + 2 >= positions.length) continue

      const x = positions[idx * 3]
      const y = positions[idx * 3 + 1]
      const z = positions[idx * 3 + 2]

      nrm.set(x, y, z).normalize()
      if (nrm.z < -0.9999) quat.set(1, 0, 0, 0)
      else quat.setFromUnitVectors(zUp, nrm)

      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        toneMapped: false,
      })

      const mesh = new THREE.Mesh(this._hexGeo, mat)
      mesh.position.set(
        x * SPHERE_RADIUS + nrm.x * 0.015,
        y * SPHERE_RADIUS + nrm.y * 0.015,
        z * SPHERE_RADIUS + nrm.z * 0.015,
      )
      mesh.quaternion.copy(quat)
      this.scene.add(mesh)

      this._meshes.push({ mesh, idx, opacity: 0 })

      // Load texture (cached or fresh)
      this._loadTexture(idx, (tex) => {
        if (mat.disposed) return
        mat.map = tex
        mat.needsUpdate = true
      })
    }
  }

  hide() {
    this._targetOpacity = 0
  }

  _loadTexture(idx, onLoad) {
    // Check cache
    if (this._cache.has(idx)) {
      // Move to end of LRU
      this._cacheOrder = this._cacheOrder.filter(i => i !== idx)
      this._cacheOrder.push(idx)
      onLoad(this._cache.get(idx))
      return
    }

    this._loader.load(
      `/api/sphere/thumbnails/${idx}/${THUMB_SIZE}`,
      (tex) => {
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false

        // Evict oldest if cache full
        while (this._cacheOrder.length >= MAX_CACHE) {
          const old = this._cacheOrder.shift()
          const oldTex = this._cache.get(old)
          if (oldTex) oldTex.dispose()
          this._cache.delete(old)
        }

        this._cache.set(idx, tex)
        this._cacheOrder.push(idx)
        onLoad(tex)
      },
      undefined,
      () => { /* thumbnail not found — keep untextured */ },
    )
  }

  _clear() {
    for (const { mesh } of this._meshes) {
      this.scene.remove(mesh)
      mesh.material.disposed = true
      mesh.material.dispose()
    }
    this._meshes = []
  }

  update(dt) {
    // Fade in/out
    const speed = dt * 4
    if (this._opacity < this._targetOpacity) {
      this._opacity = Math.min(this._targetOpacity, this._opacity + speed)
    } else if (this._opacity > this._targetOpacity) {
      this._opacity = Math.max(this._targetOpacity, this._opacity - speed)
    }

    for (const entry of this._meshes) {
      entry.mesh.material.opacity = this._opacity
    }

    if (this._opacity <= 0 && this._targetOpacity <= 0 && this._meshes.length) {
      this._clear()
    }
  }

  dispose() {
    this._clear()
    // Dispose texture cache
    for (const tex of this._cache.values()) tex.dispose()
    this._cache.clear()
    this._cacheOrder = []
    if (this._hexGeo) this._hexGeo.dispose()
  }
}
