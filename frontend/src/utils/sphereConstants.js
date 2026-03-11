/**
 * PerceptionSphere constants — dimensions, color scales, configuration.
 */

export const SPHERE_RADIUS = 10

export const PERCEPTION_DIMS = [
  'safer', 'livelier', 'wealthier',
  'more_beautiful', 'more_boring', 'more_depressing',
]

export const DIM_CONFIG = {
  safer:           { label: 'Safer',           inverted: false },
  livelier:        { label: 'Livelier',        inverted: false },
  wealthier:       { label: 'Wealthier',       inverted: false },
  more_beautiful:  { label: 'More Beautiful',  inverted: false },
  more_boring:     { label: 'More Boring',     inverted: true },
  more_depressing: { label: 'More Depressing', inverted: true },
}

// Divergent color scale: orange → gold → green
// For inverted dims (boring, depressing): green → gold → orange
const C_GREEN  = [0x3D / 255, 0xBB / 255, 0x78 / 255]
const C_GOLD   = [0xD4 / 255, 0xA8 / 255, 0x55 / 255]
const C_ORANGE = [0xE8 / 255, 0x73 / 255, 0x4A / 255]

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/**
 * Map a [0,1] score to RGB [0,1] triple.
 * For positive-valence dims: 0=orange (bad) → 1=green (good)
 * For inverted dims: color order flipped (high score = bad = orange)
 */
export function scoreToColor(score01, inverted) {
  const s = inverted ? 1 - score01 : score01
  if (s <= 0.5) return lerp3(C_ORANGE, C_GOLD, s * 2)
  return lerp3(C_GOLD, C_GREEN, (s - 0.5) * 2)
}

/** CSS gradient string for the legend bar */
export function legendGradient(inverted) {
  if (inverted) return 'linear-gradient(to right, #3DBB78, #D4A855, #E8734A)'
  return 'linear-gradient(to right, #E8734A, #D4A855, #3DBB78)'
}

/** Human-readable labels for SHAP feature names */
export const FEATURE_LABELS = {
  seg_road: 'Road', seg_sidewalk: 'Sidewalk', seg_building: 'Building',
  seg_wall: 'Wall', seg_fence: 'Fence', seg_pole: 'Pole',
  seg_traffic_sign: 'Traffic Sign', seg_vegetation: 'Vegetation',
  seg_terrain: 'Terrain', seg_sky: 'Sky', seg_person: 'Person',
  seg_rider: 'Rider', seg_car: 'Car', seg_motorcycle: 'Motorcycle',
  seg_bicycle: 'Bicycle', seg_bus: 'Bus', seg_traffic_light: 'Traffic Light',
  seg_truck: 'Truck', seg_train: 'Train',
  det_motorbike: 'Motorbike', det_tree: 'Tree',
  det_car: 'Car (det)', det_person: 'Person (det)',
}

/** Animation timing constants (ms) */
export const ANIM = {
  ENTRY_MS: 3000,
  FLY_IN_MS: 1200,
  FLY_OUT_MS: 1000,
  WALK_MS: 400,
  JUMP_MS: 1500,
  SYNAPSE_TWEEN_MS: 400,
  BLOOM_DETACH_MS: 800,
  BLOOM_UNFURL_MS: 1200,
  BLOOM_LAND_MS: 800,
}

/** Problem rule labels (indices match backend rules) */
export const PROBLEM_LABELS = [
  'Sidewalk Encroachment',
  'Low Shade',
  'Pedestrian Space Deficit',
  'Vehicle Dominance',
  'Visual Clutter',
  'Low Safety Perception',
]

/** Feature color categories for synapse network nodes */
export const FEATURE_CATEGORIES = {
  seg_vegetation: 'nature', seg_terrain: 'nature', seg_sky: 'nature', det_tree: 'nature',
  seg_road: 'road', seg_sidewalk: 'road',
  seg_car: 'vehicle', seg_motorcycle: 'vehicle', seg_bicycle: 'vehicle',
  seg_bus: 'vehicle', seg_truck: 'vehicle', seg_train: 'vehicle',
  seg_rider: 'vehicle', det_motorbike: 'vehicle', det_car: 'vehicle',
  seg_person: 'people', det_person: 'people',
  seg_building: 'infra', seg_wall: 'infra', seg_fence: 'infra',
  seg_pole: 'infra', seg_traffic_sign: 'infra', seg_traffic_light: 'infra',
}

export const CATEGORY_COLORS = {
  nature: '#3DBB78',
  road: '#A89F91',
  vehicle: '#E8734A',
  people: '#D4A855',
  infra: '#7B93A8',
}
