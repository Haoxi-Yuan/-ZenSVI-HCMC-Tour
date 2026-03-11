/**
 * useBeeswarmData — fetch binary SHAP arrays for beeswarm visualization.
 *
 * Module-level cache avoids React state overhead for 16MB+ arrays.
 * Fetches /api/sphere/binary/shap/{dim} + reuses features binary.
 */

import { useState, useEffect, useMemo } from 'react'

const API = '/api/sphere'

// Module-level cache: dim → Float32Array
const shapCache = new Map()
let featuresCache = null
let featureNamesCache = null

export function useBeeswarmData(activeDim, nFeatures = 15) {
  const [shapArray, setShapArray] = useState(null)
  const [featureArray, setFeatureArray] = useState(featuresCache)
  const [featureNames, setFeatureNames] = useState(featureNamesCache || [])
  const [loading, setLoading] = useState(false)

  // Fetch feature names from metadata (once)
  useEffect(() => {
    if (featureNamesCache) {
      setFeatureNames(featureNamesCache)
      return
    }
    fetch(`${API}/metadata`)
      .then(r => r.json())
      .then(meta => {
        featureNamesCache = meta.feature_names || []
        setFeatureNames(featureNamesCache)
      })
      .catch(() => null)
  }, [])

  // Fetch features binary (once)
  useEffect(() => {
    if (featuresCache) {
      setFeatureArray(featuresCache)
      return
    }
    fetch(`${API}/binary/features`)
      .then(r => r.arrayBuffer())
      .then(buf => {
        featuresCache = new Float32Array(buf)
        setFeatureArray(featuresCache)
      })
      .catch(err => console.warn('Beeswarm: features fetch failed', err))
  }, [])

  // Fetch SHAP binary for active dimension
  useEffect(() => {
    if (!activeDim) return

    if (shapCache.has(activeDim)) {
      setShapArray(shapCache.get(activeDim))
      return
    }

    setLoading(true)
    fetch(`${API}/binary/shap/${activeDim}`)
      .then(r => {
        if (!r.ok) throw new Error(`SHAP binary: ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        const arr = new Float32Array(buf)
        shapCache.set(activeDim, arr)
        setShapArray(arr)
      })
      .catch(err => console.warn('Beeswarm: SHAP fetch failed', err))
      .finally(() => setLoading(false))
  }, [activeDim])

  // Compute sorted feature indices by mean |SHAP|
  const sortedFeatureIndices = useMemo(() => {
    if (!shapArray || !featureNames.length) return []
    const nCols = featureNames.length
    const N = shapArray.length / nCols
    const meanAbs = new Float64Array(nCols)

    for (let i = 0; i < N; i++) {
      const base = i * nCols
      for (let j = 0; j < nCols; j++) {
        meanAbs[j] += Math.abs(shapArray[base + j])
      }
    }
    for (let j = 0; j < nCols; j++) meanAbs[j] /= N

    // Sort descending, take top nFeatures
    const indices = Array.from({ length: nCols }, (_, i) => i)
    indices.sort((a, b) => meanAbs[b] - meanAbs[a])
    return indices.slice(0, nFeatures)
  }, [shapArray, featureNames, nFeatures])

  return { shapArray, featureArray, featureNames, sortedFeatureIndices, loading }
}

/**
 * Clear cached data (call on EXIT_TO_REST to free memory).
 */
export function clearBeeswarmCache() {
  shapCache.clear()
  // Keep featuresCache — dimension-independent, reusable
}
