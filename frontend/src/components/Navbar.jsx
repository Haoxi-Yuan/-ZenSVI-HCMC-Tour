import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function Navbar({ transparent = false }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      <Link to="/" className="nav-brand">
        <span className="nav-dot" />
        Buoc Chan HCMC
      </Link>
      <ul className="nav-links">
        <li><a href="/#data">Data</a></li>
        <li><a href="/#map-section">Map</a></li>
        <li><Link to="/sphere">Sphere</Link></li>
        <li><a href="/#insights">Insights</a></li>
        <li><a href="/#about">About</a></li>
      </ul>
    </nav>
  )
}
