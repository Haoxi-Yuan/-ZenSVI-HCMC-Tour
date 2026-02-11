import { useState, useEffect } from 'react'

const API_BASE = '/api'

export function useStreetRank(streetName) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    const controller = new AbortController()
    fetch(`${API_BASE}/insights/rank/${encodeURIComponent(streetName)}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') console.error(err) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [streetName])

  return { data, loading }
}

export function useSimilarStreets(streetName, dimension = 'combined', topK = 5, weights = null) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    const controller = new AbortController()
    let url = `${API_BASE}/insights/similar/${encodeURIComponent(streetName)}?dimension=${dimension}&top_k=${topK}`
    if (weights && dimension === 'combined') {
      url += `&w_safety=${weights.safety}&w_accessibility=${weights.accessibility}&w_comfort=${weights.comfort}`
    }
    fetch(url, { signal: controller.signal })
      .then(r => r.json())
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') console.error(err) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [streetName, dimension, topK, weights?.safety, weights?.accessibility, weights?.comfort])

  return { data, loading }
}

export function useStreetDrivers(streetName) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    const controller = new AbortController()
    fetch(`${API_BASE}/insights/drivers/${encodeURIComponent(streetName)}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') console.error(err) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [streetName])

  return { data, loading }
}

export function useLLMInsight(streetName) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    fetch(`${API_BASE}/insights/llm/${encodeURIComponent(streetName)}`, {
      signal: controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error(err)
          setError(err.message)
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [streetName])

  return { data, loading, error }
}
