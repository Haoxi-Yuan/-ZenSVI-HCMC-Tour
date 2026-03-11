/**
 * SphereContext — Phase state machine for the PerceptionSphere.
 *
 * Manages transitions between REST → STANDSTILL → WALKING → BLOOM,
 * and tracks all shared state (selected face, dimension, similarity, etc.).
 */

import { createContext, useContext, useReducer, useRef } from 'react'

const SphereContext = createContext(null)

export const PHASES = {
  REST: 'REST',
  FLYING_IN: 'FLYING_IN',
  STANDSTILL: 'STANDSTILL',
  WALKING: 'WALKING',
  BLOOM: 'BLOOM',
}

const initialState = {
  phase: PHASES.REST,
  selectedIdx: null,
  previousIdx: null,
  activeDim: null,
  resonanceEnabled: false,
  resonanceThreshold: 0.8,
  similarFaces: [],
  walkMode: 'topological', // 'topological' | 'jump'
  hoveredPoint: null,
  hoverPos: null,
  shapData: null,        // SHAP data for current selected point
  neighbors: [],         // adjacency neighbors for current point
  pointDetail: null,     // full point detail from API
  isResonanceLoading: false,
}

function sphereReducer(state, action) {
  switch (action.type) {
    case 'CLICK_FACE':
      if (state.phase !== PHASES.REST) return state
      return {
        ...state,
        phase: PHASES.FLYING_IN,
        selectedIdx: action.idx,
        previousIdx: null,
        hoveredPoint: null,
        hoverPos: null,
        isResonanceLoading: false,
      }

    case 'FLY_IN_COMPLETE':
      return { ...state, phase: PHASES.STANDSTILL }

    case 'WALK_TO':
      if (state.phase !== PHASES.STANDSTILL) return state
      return {
        ...state,
        phase: PHASES.WALKING,
        previousIdx: state.selectedIdx,
        selectedIdx: action.idx,
        isResonanceLoading: state.resonanceEnabled,
      }

    case 'WALK_COMPLETE':
      return { ...state, phase: PHASES.STANDSTILL }

    case 'SET_DIM':
      return { ...state, activeDim: action.dim, isResonanceLoading: state.resonanceEnabled }

    case 'SET_RESONANCE_ENABLED':
      return { ...state, resonanceEnabled: action.enabled, isResonanceLoading: action.enabled }

    case 'SET_RESONANCE_THRESHOLD':
      return { ...state, resonanceThreshold: action.threshold }

    case 'SET_SIMILAR_FACES':
      return { ...state, similarFaces: action.faces, isResonanceLoading: false }

    case 'SET_RESONANCE_LOADING':
      return { ...state, isResonanceLoading: action.loading }

    case 'SET_WALK_MODE':
      return { ...state, walkMode: action.mode }

    case 'HOVER_POINT':
      return {
        ...state,
        hoveredPoint: action.idx,
        hoverPos: action.pos,
      }

    case 'TRIGGER_BLOOM':
      if (state.phase !== PHASES.STANDSTILL || state.similarFaces.length === 0) return state
      return { ...state, phase: PHASES.BLOOM }

    case 'RETRACT_BLOOM':
      if (state.phase !== PHASES.BLOOM) return state
      return { ...state, phase: PHASES.STANDSTILL }

    case 'EXIT_TO_REST':
      return {
        ...state,
        phase: PHASES.REST,
        selectedIdx: null,
        previousIdx: null,
        shapData: null,
        neighbors: [],
        pointDetail: null,
        similarFaces: [],
        resonanceEnabled: false,
        isResonanceLoading: false,
      }

    case 'SET_SHAP_DATA':
      return { ...state, shapData: action.data }

    case 'SET_NEIGHBORS':
      return { ...state, neighbors: action.neighbors }

    case 'SET_POINT_DETAIL':
      return { ...state, pointDetail: action.detail }

    case 'SET_STREET_VIEW_URL':
      return { ...state, streetViewUrl: action.url }

    default:
      return state
  }
}

export function SphereProvider({ children }) {
  const [state, dispatch] = useReducer(sphereReducer, initialState)
  // Ref to imperative Three.js objects (engine, layers, camera controller)
  const engineRef = useRef(null)

  return (
    <SphereContext.Provider value={{ state, dispatch, engineRef }}>
      {children}
    </SphereContext.Provider>
  )
}

export function useSphere() {
  const ctx = useContext(SphereContext)
  if (!ctx) throw new Error('useSphere must be used within SphereProvider')
  return ctx
}
