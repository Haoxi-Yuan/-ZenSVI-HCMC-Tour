/**
 * Feature flags for PerceptionSphere visual upgrades.
 *
 * Each flag can be independently toggled. When disabled, the system
 * falls back to the previous behavior (solid colors, SVG synapse, etc.).
 *
 * Toggle via browser console: window.__SPHERE_FLAGS.ATLAS_LOD = false
 */

const FLAGS = {
  ATLAS_LOD: true,            // Phase 1: texture atlas on sphere faces
  BLOOM_GLOW: true,           // Phase 1D: UnrealBloomPass for highlighted faces
  SYNAPSE_3D: true,           // Phase 2: 3D Three.js synapse network (false = SVG fallback)
  NEIGHBOR_PROJECTION: true,  // Phase 3A: thumbnail overlays on adjacent faces
  PERCEPTION_SHAKE: true,     // Phase 3B: chromatic aberration + radial blur on SHAP delta
  HEAD_BOB: true,             // Phase 3C: camera oscillation during walking
  GPU_BLOOM_PETALS: true,     // Phase 4: InstancedMesh + vertex shader bloom animation
  SHAP_BEESWARM: true,        // Phase 2-5: SHAP beeswarm scatter plot (all 178K points)
  RELATION_LINKS: true,       // In-sphere subtle neural links between similar points
}

// Expose for runtime debugging
if (typeof window !== 'undefined') {
  window.__SPHERE_FLAGS = FLAGS
}

export default FLAGS
