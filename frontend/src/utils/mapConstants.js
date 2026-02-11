/**
 * Shared map constants used by LayerSwitcher, CompareMode, and StoryCamera.
 */

export const MAP_STYLE_URL =
  'https://api.maptiler.com/maps/dataviz-dark/style.json?key=2CwZLYrGxLYfszauo1Ec'

export const MAP_CENTER = [106.695, 10.775]
export const MAP_ZOOM = 12

export const WALKABILITY_DIMENSIONS = [
  { id: 'walkability', label: 'Walkability' },
  { id: 'safety', label: 'Safety' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'comfort', label: 'Comfort' },
]

export const SCORE_COLOR_STOPS = {
  walkability: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
  safety: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
  accessibility: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
  comfort: [[2, '#E8734A'], [4, '#D4A855'], [5.5, '#3DBB78'], [7, '#2AAF65']],
}

export function buildColorExpression(dimension) {
  const stops = SCORE_COLOR_STOPS[dimension]
  if (!stops) return null
  const expr = ['interpolate', ['linear'], ['get', dimension]]
  stops.forEach(([val, color]) => expr.push(val, color))
  return expr
}
