/**
 * beeswarmLayout — density-based beeswarm positions for SHAP visualization.
 *
 * Two-pass algorithm:
 *   Pass 1 — histogram x-positions per feature, smooth to get density envelope.
 *   Pass 2 — distribute points within the density envelope using alternating
 *            stacking, so dense regions spread wide (violin shape) and sparse
 *            regions stay tight.
 *
 * Color: classic SHAP blue (#3b4cc0) → light → red (#b40426).
 */

function percentile(arr, nCols, colIdx, N, p) {
  const sampleSize = Math.min(N, 10000)
  const step = Math.max(1, Math.floor(N / sampleSize))
  const samples = []
  for (let i = 0; i < N; i += step) {
    samples.push(arr[i * nCols + colIdx])
  }
  samples.sort((a, b) => a - b)
  const idx = Math.floor(samples.length * p / 100)
  return samples[Math.min(idx, samples.length - 1)]
}

/** Classic SHAP: blue (#3b4cc0) → light (#f7f7f7) → red (#b40426) */
export function featureValueToRGB(norm01) {
  let r, g, b
  if (norm01 <= 0.5) {
    const t = norm01 * 2
    r = 0x3b + (0xf7 - 0x3b) * t
    g = 0x4c + (0xf7 - 0x4c) * t
    b = 0xc0 + (0xf7 - 0xc0) * t
  } else {
    const t = (norm01 - 0.5) * 2
    r = 0xf7 + (0xb4 - 0xf7) * t
    g = 0xf7 + (0x04 - 0xf7) * t
    b = 0xf7 + (0x26 - 0xf7) * t
  }
  return [Math.round(r), Math.round(g), Math.round(b)]
}

export function computeBeeswarmLayout(
  shapArray, featureArray, sortedIndices, N, plotWidth, rowHeight, marginLeft, marginTop,
) {
  const nCols = featureArray.length / N
  const rows = []

  for (let ri = 0; ri < sortedIndices.length; ri++) {
    const colIdx = sortedIndices[ri]
    const yCenter = marginTop + ri * rowHeight + rowHeight / 2

    // X domain: clamp to [P1, P99]
    const xMin = percentile(shapArray, nCols, colIdx, N, 1)
    const xMax = percentile(shapArray, nCols, colIdx, N, 99)
    const xRange = xMax - xMin || 1
    const xScale = plotWidth / xRange

    // Feature value range for normalization
    const fMin = percentile(featureArray, nCols, colIdx, N, 1)
    const fMax = percentile(featureArray, nCols, colIdx, N, 99)
    const fRange = fMax - fMin || 1

    const halfRow = (rowHeight / 2) - 2

    const xPositions = new Float32Array(N)
    const featureNorm = new Float32Array(N)

    // ── Pass 1: compute x positions + build density histogram ──
    const numHistBins = Math.max(30, Math.ceil(plotWidth / 3))
    const histogram = new Float32Array(numHistBins)
    const binAssignment = new Int32Array(N)

    for (let i = 0; i < N; i++) {
      const shapVal = shapArray[i * nCols + colIdx]
      const featVal = featureArray[i * nCols + colIdx]

      const clamped = Math.max(xMin, Math.min(xMax, shapVal))
      const xPx = (clamped - xMin) * xScale
      xPositions[i] = xPx

      const bin = Math.min(numHistBins - 1, Math.max(0, Math.floor(xPx / plotWidth * numHistBins)))
      binAssignment[i] = bin
      histogram[bin]++

      const normVal = (featVal - fMin) / fRange
      featureNorm[i] = Math.max(0, Math.min(1, normVal))
    }

    // Smooth histogram (5-tap for a nicer envelope)
    const smoothed = new Float32Array(numHistBins)
    for (let b = 0; b < numHistBins; b++) {
      let sum = histogram[b] * 3
      let weight = 3
      if (b > 0)                 { sum += histogram[b - 1] * 2; weight += 2 }
      if (b < numHistBins - 1)   { sum += histogram[b + 1] * 2; weight += 2 }
      if (b > 1)                 { sum += histogram[b - 2]; weight += 1 }
      if (b < numHistBins - 2)   { sum += histogram[b + 2]; weight += 1 }
      smoothed[b] = sum / weight
    }

    let maxDensity = 0
    for (let b = 0; b < numHistBins; b++) {
      if (smoothed[b] > maxDensity) maxDensity = smoothed[b]
    }
    if (maxDensity === 0) maxDensity = 1

    // ── Pass 2: assign y positions using density envelope ──
    // Track rank within each bin for alternating stacking
    const binRank = new Int32Array(numHistBins)
    const yPositions = new Float32Array(N)

    for (let i = 0; i < N; i++) {
      const bin = binAssignment[i]
      const count = histogram[bin]
      const rank = binRank[bin]++

      // Spread proportional to local density → violin shape
      const density = smoothed[bin] / maxDensity   // 0..1
      const spread = density * halfRow

      // Alternating stacking: even ranks go up, odd go down
      if (count <= 1) {
        yPositions[i] = 0
      } else {
        const sign = (rank % 2 === 0) ? 1 : -1
        const layer = Math.ceil((rank + 1) / 2)
        const maxLayer = Math.ceil(count / 2)
        const t = maxLayer > 0 ? layer / maxLayer : 0
        yPositions[i] = sign * t * spread
      }
    }

    rows.push({
      featureIdx: colIdx,
      xPositions,
      yPositions,
      featureNorm,
      yCenter,
      xMin,
      xMax,
    })
  }

  return rows
}

/** Render all dots onto an ImageData buffer as 2×2 pixel stamps. */
export function renderDotsToImageData(imageData, width, layoutRows, N, marginLeft) {
  const data = imageData.data
  const h = imageData.height

  for (const row of layoutRows) {
    const { xPositions, yPositions, featureNorm, yCenter } = row

    for (let i = 0; i < N; i++) {
      const cx = Math.round(xPositions[i] + marginLeft)
      const cy = Math.round(yCenter + yPositions[i])
      const [r, g, b] = featureValueToRGB(featureNorm[i])

      // 2×2 pixel stamp
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const px = cx + dx
          const py = cy + dy
          if (px < 0 || px >= width || py < 0 || py >= h) continue

          const offset = (py * width + px) * 4
          const existingA = data[offset + 3]
          if (existingA === 0) {
            data[offset] = r
            data[offset + 1] = g
            data[offset + 2] = b
            data[offset + 3] = 190
          } else {
            const newA = Math.min(255, existingA + 25)
            const t = 25 / newA
            data[offset] = Math.round(data[offset] * (1 - t) + r * t)
            data[offset + 1] = Math.round(data[offset + 1] * (1 - t) + g * t)
            data[offset + 2] = Math.round(data[offset + 2] * (1 - t) + b * t)
            data[offset + 3] = newA
          }
        }
      }
    }
  }
}
