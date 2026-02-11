import { useState, useEffect } from 'react'

const API_BASE = '/api'

export function useCityStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/city/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { stats, loading }
}

export function useStreetSearch(query) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    const controller = new AbortController()
    fetch(`${API_BASE}/streets/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => setResults(data.results || []))
      .catch(err => { if (err.name !== 'AbortError') console.error(err) })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [query])

  return { results, loading }
}

export function useStreetData(streetName) {
  const [street, setStreet] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    fetch(`${API_BASE}/streets/${encodeURIComponent(streetName)}`)
      .then(r => r.json())
      .then(setStreet)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [streetName])

  return { street, loading }
}

export function useStreetPoints(streetName) {
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!streetName) return
    setLoading(true)
    fetch(`${API_BASE}/points/by-street/${encodeURIComponent(streetName)}`)
      .then(r => r.json())
      .then(data => setPoints(data.points || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [streetName])

  return { points, loading }
}

export function usePointImages(pointId) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!pointId) return
    setLoading(true)
    fetch(`${API_BASE}/images/by-point/${encodeURIComponent(pointId)}`)
      .then(r => r.json())
      .then(data => setImages(data.images || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [pointId])

  return { images, loading }
}

export function useDistribution(dimension) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dimension) return
    setLoading(true)
    fetch(`${API_BASE}/city/distribution/${dimension}`)
      .then(r => r.json())
      .then(d => setData(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [dimension])

  return { data, loading }
}

export function useStreetsList(sort = 'walkability', order = 'desc', limit = 50) {
  const [streets, setStreets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/streets?sort=${sort}&order=${order}&limit=${limit}`)
      .then(r => r.json())
      .then(data => setStreets(data.streets || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sort, order, limit])

  return { streets, loading }
}
