import { useState, useEffect } from 'react'

const API_BASE = '/api'

export function useStoryShots() {
  const [shots, setShots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`${API_BASE}/insights/story/shots`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => setShots(data.shots || []))
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Story shots fetch error:', err)
          setError(err.message)
        }
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  return { shots, loading, error }
}
