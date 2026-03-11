/**
 * useSphereData — fetch sphere metadata + binary arrays for PerceptionSphere.
 *
 * Loads in two phases:
 *   1. Metadata (JSON) — point count, feature names, etc.
 *   2. Binary data (ArrayBuffer) — positions, colors, scores (parallel)
 */

import { useState, useEffect } from 'react'

const API = '/api/sphere'

export function useSphereData() {
  const [metadata, setMetadata] = useState(null)
  const [positions, setPositions] = useState(null)         // Float32Array (N*3)
  const [colorBlocks, setColorBlocks] = useState(null)     // Uint8Array (N*3)
  const [perceptionScores, setPerceptionScores] = useState(null) // Float32Array (N*6)
  const [atlasData, setAtlasData] = useState(null)         // { metadata, uvOffsets, atlasIndices }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    async function load() {
      try {
        // Phase 1: Metadata
        setProgress(0.05)
        const metaRes = await fetch(`${API}/metadata`, { signal })
        if (!metaRes.ok) throw new Error(`Metadata: ${metaRes.status}`)
        const meta = await metaRes.json()
        setMetadata(meta)
        setProgress(0.1)

        const N = meta.n_points

        // Phase 2: Binary data in parallel
        const [posRes, colorRes, scoresRes] = await Promise.all([
          fetch(`${API}/binary/embedding_cartesian`, { signal }),
          fetch(`${API}/binary/color_blocks`, { signal }),
          fetch(`${API}/binary/perception_scores`, { signal }),
        ])

        setProgress(0.5)

        if (!posRes.ok) throw new Error(`Embedding: ${posRes.status}`)
        if (!scoresRes.ok) throw new Error(`Scores: ${scoresRes.status}`)

        const [posBuf, scoresBuf] = await Promise.all([
          posRes.arrayBuffer(),
          scoresRes.arrayBuffer(),
        ])

        setPositions(new Float32Array(posBuf))
        setPerceptionScores(new Float32Array(scoresBuf))

        // Color blocks are optional (404 = use default gray)
        if (colorRes.ok) {
          const colorBuf = await colorRes.arrayBuffer()
          setColorBlocks(new Uint8Array(colorBuf))
        } else {
          const defaultColors = new Uint8Array(N * 3)
          defaultColors.fill(60)
          setColorBlocks(defaultColors)
        }

        setProgress(0.85)

        // Phase 3: Atlas data (non-blocking, optional)
        try {
          const [atlasMeta, atlasUvRes, atlasIdxRes] = await Promise.all([
            fetch(`${API}/atlas/metadata`, { signal }).then(r => r.ok ? r.json() : null),
            fetch(`${API}/binary/atlas_uv_offsets`.replace(/\s/g, '%20'), { signal }),
            fetch(`${API}/binary/atlas_index`.replace(/\s/g, '%20'), { signal }),
          ])

          if (atlasMeta && atlasUvRes.ok && atlasIdxRes.ok) {
            const [uvBuf, idxBuf] = await Promise.all([
              atlasUvRes.arrayBuffer(),
              atlasIdxRes.arrayBuffer(),
            ])
            setAtlasData({
              metadata: atlasMeta,
              uvOffsets: new Float32Array(uvBuf),
              atlasIndices: new Uint8Array(idxBuf),
            })
          }
        } catch {
          // Atlas is optional — sphere works fine without it
          console.warn('Atlas data not available, using solid colors')
        }

        setProgress(1)
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Sphere data load failed:', err)
          setError(err.message)
        }
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [])

  return { metadata, positions, colorBlocks, perceptionScores, atlasData, loading, error, progress }
}