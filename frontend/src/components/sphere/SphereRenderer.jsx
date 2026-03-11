/**
 * SphereRenderer — React wrapper that creates SphereEngine + layers on mount.
 *
 * Delegates all Three.js logic to SphereEngine, GeodesicLayer, and CameraController.
 */

import { useRef, useEffect } from 'react'
import { SphereEngine } from './engine/SphereEngine'
import { GeodesicLayer } from './engine/GeodesicLayer'
import { CameraController } from './engine/CameraController'
import { StreetViewLayer } from './engine/StreetViewLayer'
import { AvatarSprite } from './engine/AvatarSprite'
import { BloomAnimator } from './engine/BloomAnimator'
import { Synapse3DLayer } from './engine/Synapse3DLayer'
import { NeighborProjection } from './engine/NeighborProjection'
import { VolunteerAnchorsLayer } from './engine/VolunteerAnchorsLayer'
import { RelationLinksLayer } from './engine/RelationLinksLayer'
import { useSphere } from '../../contexts/SphereContext'
import FLAGS from '../../utils/featureFlags'

export default function SphereRenderer({
  positions,
  colorBlocks,
  perceptionScores,
  nPoints,
  atlasData,
}) {
  const containerRef = useRef(null)
  const { state, dispatch, engineRef } = useSphere()

  // Main setup effect
  useEffect(() => {
    const el = containerRef.current
    if (!el || !positions || !colorBlocks || !perceptionScores || !nPoints) return

    let engine
    try {
      engine = new SphereEngine(el)
    } catch (e) {
      console.error('WebGL init failed:', e)
      el.innerHTML = '<div style="color:#E8734A;padding:40px;text-align:center;">WebGL not available</div>'
      return
    }

    // Camera controller
    const cameraCtrl = new CameraController()
    engine.addLayer('camera', cameraCtrl)

    // Geodesic sphere layer
    const geodesic = new GeodesicLayer(
      positions, colorBlocks, perceptionScores, nPoints,
      {
        onPointHover: (idx, pos) => {
          dispatch({ type: 'HOVER_POINT', idx, pos })
        },
        onPointClick: (idx) => {
          dispatch({ type: 'CLICK_FACE', idx })
        },
      },
    )
    engine.addLayer('geodesic', geodesic)

    // Street view panorama layer
    const streetView = new StreetViewLayer()
    engine.addLayer('streetView', streetView)

    // Avatar silhouette
    const avatar = new AvatarSprite()
    engine.addLayer('avatar', avatar)

    // Bloom animator for three-act transition
    const bloomAnim = new BloomAnimator()
    engine.addLayer('bloomAnim', bloomAnim)

    // 3D synapse network (above avatar's head) — feature-flagged
    let synapse3D = null
    if (FLAGS.SYNAPSE_3D) {
      synapse3D = new Synapse3DLayer()
      engine.addLayer('synapse3D', synapse3D)
    }

    // Neighbor face thumbnail projection — feature-flagged
    let neighborProj = null
    if (FLAGS.NEIGHBOR_PROJECTION) {
      neighborProj = new NeighborProjection()
      engine.addLayer('neighborProj', neighborProj)
      neighborProj.setCellRadius(geodesic.cellRadius)
    }

    // Volunteer anchors on sphere — gold pulsing rings
    const volunteerAnchors = new VolunteerAnchorsLayer()
    engine.addLayer('volunteerAnchors', volunteerAnchors)

    // In-sphere relation links for resonance/jump associations
    let relationLinks = null
    if (FLAGS.RELATION_LINKS) {
      relationLinks = new RelationLinksLayer(positions)
      engine.addLayer('relationLinks', relationLinks)
    }

    // Store ref for imperative access from other components
    engineRef.current = {
      engine,
      geodesic,
      cameraCtrl,
      streetView,
      avatar,
      bloomAnim,
      synapse3D,
      neighborProj,
      volunteerAnchors,
      relationLinks,
    }
    if (typeof window !== 'undefined') {
      window.__SPHERE_DEBUG__ = engineRef.current
    }

    engine.start()

    return () => {
      if (typeof window !== 'undefined' && window.__SPHERE_DEBUG__ === engineRef.current) {
        delete window.__SPHERE_DEBUG__
      }
      engineRef.current = null
      engine.dispose()
    }
  }, [positions, colorBlocks, nPoints]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dimension change: update colors
  useEffect(() => {
    const refs = engineRef.current
    if (!refs) return
    refs.geodesic.setActiveDim(state.activeDim)
  }, [state.activeDim]) // eslint-disable-line react-hooks/exhaustive-deps

  // Atlas data: load textures when available — feature-flagged
  useEffect(() => {
    if (!FLAGS.ATLAS_LOD) return
    const refs = engineRef.current
    if (!refs || !atlasData) return
    refs.geodesic.setAtlasData(atlasData)
  }, [atlasData]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="sphere-canvas" ref={containerRef} />
}
