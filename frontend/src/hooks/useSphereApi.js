/**
 * useSphereApi — on-demand API fetchers with in-memory caching.
 *
 * Uses a module-level Map cache to avoid re-renders from React state.
 * Returns async functions that can be called imperatively.
 */

const API = '/api/sphere'
const cache = new Map()

async function cachedFetch(key, url) {
  // Trim any accidental spaces in URL before fetching (fixes 422/404 issues)
  const cleanUrl = url.trim().replace(/\s/g, '%20')
  if (cache.has(key)) return cache.get(key)
  const res = await fetch(cleanUrl)
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error')
    console.error(`Fetch failed: ${cleanUrl} [${res.status}]`, errorText)
    throw new Error(`${cleanUrl}: ${res.status}`)
  }
  const data = await res.json()
  cache.set(key, data)
  return data
}

export function useSphereApi() {
  const fetchShapAll = async (idx) => {
    return cachedFetch(`shap-all-${idx}`, `${API}/shap-all/${idx}`)
  }

  const fetchShap = async (idx, dim = 'safer') => {
    return cachedFetch(`shap-${idx}-${dim.trim()}`, `${API}/shap/${idx}?dim=${dim.trim()}`)
  }

  const fetchNeighbors = async (idx) => {
    return cachedFetch(`neighbors-${idx}`, `${API}/neighbors/${idx}`)
  }

  const fetchSimilar = async (idx, dim = 'safer', k = 100) => {
    // Explicitly clamp and cast k to integer to satisfy Pydantic/FastAPI Query constraints
    const cleanK = Math.max(1, Math.min(2000, parseInt(k) || 100))
    const cleanDim = dim.trim()
    return cachedFetch(`similar-${idx}-${cleanDim}-${cleanK}`, `${API}/similar/${idx}?dim=${cleanDim}&k=${cleanK}`)
  }

  const fetchPointDetail = async (idx) => {
    return cachedFetch(`point-${idx}`, `${API}/point/${idx}`)
  }

  const fetchProblemsSummary = async () => {
    return cachedFetch('problems-summary', `${API}/problems-summary`)
  }

  const fetchPointProblems = async (idx) => {
    return cachedFetch(`problems-${idx}`, `${API}/problems/${idx}`)
  }

  const fetchVolunteers = async () => {
    return cachedFetch('volunteers', `${API}/volunteers`)
  }

  const getThumbnailUrl = (idx, size = 128) => {
    return `${API}/thumbnails/${idx}/${size}`
  }

  const getImageUrls = (detail) => {
    if (!detail || !detail.district || !detail.folder) return []
    const { district, folder, image_filenames } = detail

    // Use real filenames from backend if available (headings vary per point)
    if (image_filenames && image_filenames.length > 0) {
      return image_filenames.map(
        (fname) => `/api/images/${district}/${folder}/${fname}`
      )
    }

    // Fallback: construct from id (may 404 if headings don't match)
    if (!detail.id) return []
    const { id } = detail
    return [0, 90, 180, 270].map(
      (h) => `/api/images/${district}/${folder}/${id}_head${String(h).padStart(3, '0')}_pitchp0_640x640.jpg`
    )
  }

  return {
    fetchShapAll,
    fetchShap,
    fetchNeighbors,
    fetchSimilar,
    fetchPointDetail,
    fetchProblemsSummary,
    fetchPointProblems,
    fetchVolunteers,
    getThumbnailUrl,
    getImageUrls,
  }
}
