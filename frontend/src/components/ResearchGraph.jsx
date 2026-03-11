import { useRef, useEffect } from 'react'
import * as THREE from 'three'

/* ───── Graph data ───── */
const NODES = [
  { id: 'foundation', label: 'Data Foundation', desc: '24 districts \u00b7 267K+ points \u00b7 1M+ images', layer: 0, hex: 0x3DBB78, target: '#data', x: 0, y: -4, z: 0 },
  { id: 'spatial', label: 'Spatial Layers', desc: 'Hex-grid segmentation & district overlays', layer: 1, hex: 0xD4A855, target: '#map-section', x: -4.2, y: -1.2, z: 0.5 },
  { id: 'profiling', label: 'Street Profiling', desc: 'Per-street walkability across 3 dimensions', layer: 1, hex: 0xD4A855, target: '#map-section', x: 0, y: -1.5, z: -0.5 },
  { id: 'dashboard', label: 'Multi-modal View', desc: 'Panorama viewer & data dashboard', layer: 1, hex: 0xD4A855, target: '#map-section', x: 4.2, y: -1.2, z: 0.5 },
  { id: 'baseline', label: 'City Baseline', desc: 'Statistical baselines & street rankings', layer: 2, hex: 0xE8734A, target: '#map-section', x: -2.8, y: 1.8, z: -0.5 },
  { id: 'comparative', label: 'Comparative Analysis', desc: 'Side-by-side dimension comparison', layer: 2, hex: 0xE8734A, target: '#map-section', x: 2.8, y: 1.8, z: 0.5 },
  { id: 'story', label: 'Story Narrative', desc: 'Guided camera tours with AI narration', layer: 3, hex: 0xF5F0E8, target: '#map-section', x: -2.2, y: 4.2, z: 0 },
  { id: 'insights', label: 'AI Insights', desc: 'LLM-generated analysis with scene evidence', layer: 3, hex: 0xF5F0E8, target: '#map-section', x: 2.2, y: 4.2, z: 0 },
]

const EDGES = [
  [0, 1], [0, 2], [0, 3],
  [1, 4], [1, 5],
  [2, 4], [2, 5],
  [3, 4], [3, 5],
  [4, 6], [4, 7],
  [5, 6], [5, 7],
]

/* ───── Shaders (background ambient particles only) ───── */
const BG_VS = `
attribute float size;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (150.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const BG_FS = `
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.4, d) * 0.2;
  gl_FragColor = vec4(0.96, 0.94, 0.91, a);
}`

/* ───── Physics constants ───── */
const SPRING_K = 1.2
const DAMPING = 0.88
const LINE_SEGS = 24

export default function ResearchGraph() {
  const wrapperRef = useRef(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el || el.childElementCount > 0) return

    const mobile = window.innerWidth < 768
    const W = el.clientWidth, H = el.clientHeight
    if (!W || !H) return

    /* ── renderer ── */
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
    camera.position.set(0, 0, 12)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({
      antialias: !mobile,
      alpha: true,
      powerPreference: 'low-power',
    })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 2))
    el.appendChild(renderer.domElement)

    /* ── scanline overlay ── */
    const scanlines = document.createElement('div')
    scanlines.className = 'research-graph-scanlines'
    el.appendChild(scanlines)

    /* ── label overlay ── */
    const labelLayer = document.createElement('div')
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    el.appendChild(labelLayer)

    /* ── tooltip ── */
    const tooltip = document.createElement('div')
    tooltip.className = 'graph-tooltip'
    tooltip.style.display = 'none'
    el.appendChild(tooltip)

    /* ── node state (physics) ── */
    const nodes = NODES.map(n => ({
      pos: new THREE.Vector3(n.x, n.y, n.z),
      restZ: n.z,
      vx: 0, vy: 0,
      data: n,
    }))

    /* ── node meshes ── */
    const nodeMeshes = []
    const labelEls = []

    nodes.forEach(n => {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.3, 2),
        new THREE.MeshBasicMaterial({ color: n.data.hex }),
      )
      mesh.position.copy(n.pos)
      scene.add(mesh)
      nodeMeshes.push(mesh)

      const lbl = document.createElement('div')
      lbl.className = 'graph-label'
      lbl.textContent = n.data.label
      labelLayer.appendChild(lbl)
      labelEls.push(lbl)
    })

    /* ── edge state ── */
    const edgeData = EDGES.map(([si, ti], idx) => {
      const s = nodes[si].pos, t = nodes[ti].pos
      const dx = t.x - s.x, dy = t.y - s.y
      const restLen = Math.sqrt(dx * dx + dy * dy)
      const arcAmount = (0.4 + (idx % 3) * 0.25) * (idx % 2 === 0 ? 1 : -1)
      const zBump = 0.3 + (idx % 4) * 0.15

      const posArr = new Float32Array(LINE_SEGS * 3)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: NODES[si].hex,
      }))
      scene.add(line)

      return { si, ti, restLen, arcAmount, zBump, geo, posArr }
    })

    /* ── edge curve update ── */
    const updateEdge = (e) => {
      const s = nodes[e.si].pos, t = nodes[e.ti].pos
      const dx = t.x - s.x, dy = t.y - s.y
      const len2D = Math.sqrt(dx * dx + dy * dy) || 0.01
      const nx = -dy / len2D, ny = dx / len2D

      const stretch = Math.min(e.restLen / Math.max(len2D, 0.01), 2.0)
      const mid = new THREE.Vector3(
        (s.x + t.x) / 2 + nx * e.arcAmount * stretch,
        (s.y + t.y) / 2 + ny * e.arcAmount * stretch,
        (s.z + t.z) / 2 + e.zBump * stretch,
      )

      const curve = new THREE.CatmullRomCurve3([s.clone(), mid, t.clone()])
      const pts = curve.getPoints(LINE_SEGS - 1)
      for (let i = 0; i < LINE_SEGS; i++) {
        e.posArr[i * 3] = pts[i].x
        e.posArr[i * 3 + 1] = pts[i].y
        e.posArr[i * 3 + 2] = pts[i].z
      }
      e.geo.getAttribute('position').needsUpdate = true
      e.geo.computeBoundingSphere()
    }

    edgeData.forEach(updateEdge)

    /* ── background particle flow ── */
    const bgCount = mobile ? 80 : 200
    const bgArr = new Float32Array(bgCount * 3)
    const bgSizes = new Float32Array(bgCount)
    const bgVelY = new Float32Array(bgCount)
    const bgVelX = new Float32Array(bgCount)

    for (let i = 0; i < bgCount; i++) {
      bgArr[i * 3] = (Math.random() - 0.5) * 24
      bgArr[i * 3 + 1] = (Math.random() - 0.5) * 14
      bgArr[i * 3 + 2] = (Math.random() - 0.5) * 24
      bgSizes[i] = 1.5 + Math.random() * 3
      bgVelY[i] = 0.3 + Math.random() * 0.5
      bgVelX[i] = (Math.random() - 0.5) * 0.15
    }

    const bgGeo = new THREE.BufferGeometry()
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgArr, 3))
    bgGeo.setAttribute('size', new THREE.BufferAttribute(bgSizes, 1))
    scene.add(new THREE.Points(bgGeo, new THREE.ShaderMaterial({
      vertexShader: BG_VS,
      fragmentShader: BG_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })))

    /* ── drag state ── */
    const ray = new THREE.Raycaster()
    const mouse = new THREE.Vector2(9999, 9999)
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const hitPoint = new THREE.Vector3()
    let dragIdx = -1
    let hoveredIdx = -1
    let dragDist = 0

    const toNDC = (cx, cy) => {
      const r = renderer.domElement.getBoundingClientRect()
      mouse.x = ((cx - r.left) / r.width) * 2 - 1
      mouse.y = -((cy - r.top) / r.height) * 2 + 1
    }

    const hitTest = () => {
      ray.setFromCamera(mouse, camera)
      const hits = ray.intersectObjects(nodeMeshes)
      if (hits.length) {
        const idx = nodeMeshes.indexOf(hits[0].object)
        return idx >= 0 ? idx : -1
      }
      return -1
    }

    /* ── mouse handlers ── */
    const onDown = (e) => {
      toNDC(e.clientX, e.clientY)
      const idx = hitTest()
      if (idx >= 0) {
        dragIdx = idx
        dragDist = 0
        dragPlane.set(new THREE.Vector3(0, 0, 1), -nodes[idx].pos.z)
        nodes[idx].vx = 0
        nodes[idx].vy = 0
        renderer.domElement.style.cursor = 'grabbing'
      }
    }

    const onMove = (e) => {
      toNDC(e.clientX, e.clientY)

      if (dragIdx >= 0) {
        ray.setFromCamera(mouse, camera)
        if (ray.ray.intersectPlane(dragPlane, hitPoint)) {
          dragDist += Math.abs(hitPoint.x - nodes[dragIdx].pos.x) +
                      Math.abs(hitPoint.y - nodes[dragIdx].pos.y)
          nodes[dragIdx].pos.x = hitPoint.x
          nodes[dragIdx].pos.y = hitPoint.y
        }
        return
      }

      // Hover
      const idx = hitTest()
      if (idx !== hoveredIdx) {
        hoveredIdx = idx
        if (hoveredIdx >= 0) {
          const n = nodes[hoveredIdx].data
          tooltip.innerHTML =
            `<div class="graph-tooltip-name">${n.label}</div>` +
            `<div class="graph-tooltip-desc">${n.desc}</div>` +
            `<div class="graph-tooltip-cta">Click to explore</div>`
          tooltip.style.display = ''
          renderer.domElement.style.cursor = 'pointer'
        } else {
          tooltip.style.display = 'none'
          renderer.domElement.style.cursor = 'default'
        }
      }
    }

    const onUp = () => {
      if (dragIdx >= 0) {
        if (dragDist < 5) {
          const target = document.querySelector(nodes[dragIdx].data.target)
          if (target) target.scrollIntoView({ behavior: 'smooth' })
        }
        dragIdx = -1
        renderer.domElement.style.cursor = hoveredIdx >= 0 ? 'pointer' : 'default'
      }
    }

    /* ── touch handlers ── */
    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return
      toNDC(e.touches[0].clientX, e.touches[0].clientY)
      const idx = hitTest()
      if (idx >= 0) {
        dragIdx = idx
        dragDist = 0
        dragPlane.set(new THREE.Vector3(0, 0, 1), -nodes[idx].pos.z)
        nodes[idx].vx = 0
        nodes[idx].vy = 0
      }
    }

    const onTouchMove = (e) => {
      if (dragIdx < 0 || e.touches.length !== 1) return
      toNDC(e.touches[0].clientX, e.touches[0].clientY)
      ray.setFromCamera(mouse, camera)
      if (ray.ray.intersectPlane(dragPlane, hitPoint)) {
        dragDist += Math.abs(hitPoint.x - nodes[dragIdx].pos.x) +
                    Math.abs(hitPoint.y - nodes[dragIdx].pos.y)
        nodes[dragIdx].pos.x = hitPoint.x
        nodes[dragIdx].pos.y = hitPoint.y
      }
    }

    const onTouchEnd = () => {
      if (dragIdx >= 0 && dragDist < 5) {
        const target = document.querySelector(nodes[dragIdx].data.target)
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      }
      dragIdx = -1
    }

    renderer.domElement.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true })
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: true })
    renderer.domElement.addEventListener('touchend', onTouchEnd)

    /* ── animation ── */
    let prevTime = performance.now() / 1000
    let frame = 0
    let animId = null
    let visible = true
    let appeared = false

    const obs = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && !animId) loop()
      if (visible && !appeared) {
        appeared = true
        el.classList.add('visible')
      }
    }, { threshold: 0.05 })
    obs.observe(el)

    const forces = nodes.map(() => ({ x: 0, y: 0 }))

    const loop = () => {
      if (!visible) { animId = null; return }
      animId = requestAnimationFrame(loop)

      const now = performance.now() / 1000
      const dt = Math.min(now - prevTime, 0.05)
      prevTime = now
      frame++

      /* ── spring physics ── */
      for (let i = 0; i < forces.length; i++) { forces[i].x = 0; forces[i].y = 0 }

      edgeData.forEach(({ si, ti, restLen }) => {
        const s = nodes[si].pos, t = nodes[ti].pos
        const dx = t.x - s.x, dy = t.y - s.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const displacement = dist - restLen
        const fx = SPRING_K * displacement * (dx / dist)
        const fy = SPRING_K * displacement * (dy / dist)
        forces[si].x += fx
        forces[si].y += fy
        forces[ti].x -= fx
        forces[ti].y -= fy
      })

      nodes.forEach((n, i) => {
        if (i === dragIdx) return
        n.vx = (n.vx + forces[i].x * dt) * DAMPING
        n.vy = (n.vy + forces[i].y * dt) * DAMPING
        n.pos.x += n.vx * dt
        n.pos.y += n.vy * dt
      })

      /* ── update visuals ── */
      nodes.forEach((n, i) => { nodeMeshes[i].position.copy(n.pos) })
      edgeData.forEach(updateEdge)

      /* ── background particles ── */
      for (let i = 0; i < bgCount; i++) {
        bgArr[i * 3] += bgVelX[i] * dt
        bgArr[i * 3 + 1] += bgVelY[i] * dt
        if (bgArr[i * 3 + 1] > 7) bgArr[i * 3 + 1] = -7
        if (bgArr[i * 3] > 12) bgArr[i * 3] = -12
        if (bgArr[i * 3] < -12) bgArr[i * 3] = 12
      }
      bgGeo.getAttribute('position').needsUpdate = true

      /* ── project labels + tooltip (every 3 frames) ── */
      if (frame % 3 === 0) {
        const rect = renderer.domElement.getBoundingClientRect()
        labelEls.forEach((lbl, i) => {
          const sp = nodes[i].pos.clone().project(camera)
          const lx = (sp.x * 0.5 + 0.5) * rect.width
          const ly = (-sp.y * 0.5 + 0.5) * rect.height + 22
          lbl.style.transform = `translate(${lx}px, ${ly}px) translateX(-50%)`
        })

        if (hoveredIdx >= 0 && dragIdx < 0) {
          const sp = nodes[hoveredIdx].pos.clone().project(camera)
          tooltip.style.left = `${(sp.x * 0.5 + 0.5) * rect.width}px`
          tooltip.style.top = `${(-sp.y * 0.5 + 0.5) * rect.height - 60}px`
        }
      }

      renderer.render(scene, camera)
    }
    loop()

    /* ── resize ── */
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    /* ── cleanup ── */
    return () => {
      obs.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      renderer.domElement.removeEventListener('mousedown', onDown)
      renderer.domElement.removeEventListener('touchstart', onTouchStart)
      renderer.domElement.removeEventListener('touchmove', onTouchMove)
      renderer.domElement.removeEventListener('touchend', onTouchEnd)
      if (animId) cancelAnimationFrame(animId)
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
          else o.material.dispose()
        }
      })
      renderer.dispose()
      while (el.firstChild) el.removeChild(el.firstChild)
    }
  }, [])

  return (
    <section className="research-graph-section" id="research-graph">
      <div className="section-label">Research Logic</div>
      <h2 className="section-title">From data to<br />urban intelligence</h2>
      <p className="section-desc">
        Our pipeline transforms 1M+ street-level images into actionable
        walkability insights through spatial analysis and AI-powered narration.
      </p>
      <div className="research-graph-canvas-wrapper" ref={wrapperRef} />
    </section>
  )
}
